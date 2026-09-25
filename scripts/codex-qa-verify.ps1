<#
.SYNOPSIS
  Direct Codex CLI physical verifier for QA Lab fresh runs (Discovery/Recording/promotion).

.DESCRIPTION
  `codex:rescue` (via codex-companion.mjs --write) caps Codex's sandbox at "workspace-write",
  which blocks child-process spawning needed by Playwright/tsx/esbuild -- physical QA Lab replay
  can never complete under it. This script invokes the Codex CLI directly instead.

  Escalation history (kept for context, do not re-litigate without new evidence):
  1. `-s workspace-write` alone: EPERM creating Playwright's temp artifacts dir.
  2. `--add-dir $env:TEMP`: got past that, then EPERM spawning esbuild's own service worker.
  3. `--add-dir` for TEMP + repo tmp: esbuild/tsx now spawn fine, but `browserType.launch` still
     EPERMs spawning chrome-headless-shell.exe.
  4. `--add-dir` additionally for the Playwright browser install dir: STILL EPERM on the same
     spawn. Confirms `--add-dir` only extends filesystem read/write scope, never the sandbox's
     own process-creation restriction -- no directory allowlist fixes that.
  5. Interactive `codex` (a human present) works because a human can approve the one-off
     escalation prompt; headless `codex exec` has no one to approve it, so the spawn just fails.

  Only `-s danger-full-access` removes the process-creation restriction (Codex CLI's own
  documented options: read-only, workspace-write, danger-full-access -- there is no narrower
  flag for "allow spawning this one more executable"). The user explicitly authorized this
  escalation for physical QA Lab runs specifically (2026-09-24) after the above was demonstrated
  step by step; do not silently revert to workspace-write for this use case.

  Codex remains a VERIFIER ONLY over source code regardless of OS-level sandbox: the prompt sent
  to it hard-forbids editing source, patching, refactoring, or any git write operation. It is
  only ever asked to run a FRESH physical job and report the earliest first-loss -- never to fix
  anything itself. The repo change guard below is the actual enforcement backstop for this.

.PARAMETER Prompt
  Compact task description: problem summary, verification mode, seed job/recording id if any,
  relevant artifact refs, and the expected physical test. Never the full conversation.

.PARAMETER Effort
  low (default) or medium. high is rejected outright -- this verifier never needs it.

.PARAMETER Mode
  discovery | recording | other -- informational only, included in the guardrail prompt.

.EXAMPLE
  ./scripts/codex-qa-verify.ps1 -Prompt "Seed job 17aad15e-...: step 6 (text:SMS) previously
  failed no_observable_post_action_outcome. Fixes landed in promoted-spec-runtime.ts's
  postActionStability (contentFingerprint) and promoted-spec-helpers.ts's scanPageTexts
  (ancestor visibility). Run npm.cmd run discovery:preview -- --input <path> --app fenix
  --overwrite --auto-promote --auto-pom --rerun-active as a NEW fresh run. Report whether step 6
  now passes." -Effort low -Mode discovery
#>
param(
  [Parameter(Mandatory = $true)][string]$Prompt,
  [ValidateSet("low", "medium")][string]$Effort = "medium",
  [ValidateSet("discovery", "recording", "other")][string]$Mode = "other",
  [string]$Model = "gpt-5.6-luna"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

$repoTmp = Join-Path $repoRoot ".artifacts\tmp\codex-qa-verify"
New-Item -ItemType Directory -Force -Path $repoTmp | Out-Null

Write-Output "CODEX_VERIFY_STARTED model=$Model effort=$Effort mode=$Mode"

# --- Repo change guard: snapshot tracked status BEFORE Codex runs -----------------------------
$statusBefore = git status --porcelain -- . 2>&1

$guardrails = @"
<qa_lab_physical_verifier_contract>
You are the QA Lab PHYSICAL VERIFIER, not the fixer. Your ONLY job is to run a FRESH physical
test and report the earliest first-loss. You must NEVER:
- edit, patch, or refactor any source file
- run git add, commit, push, reset, clean, checkout, restore, stash, merge, or rebase
- change any functional/runtime configuration file
- attempt to fix the bug yourself

You MUST:
- run a genuinely NEW fresh job/run for the physical test described below -- historical
  evidence or a past job id may only be used as SEED/context, never as diagnostic authority
- wait for the run to reach a terminal state before analyzing it
- analyze the FRESH artifacts it produced, not older ones
- stop at the EARLIEST first-loss boundary; do not investigate downstream of it
- write only runtime outputs: .artifacts/**, traces, screenshots, temp/runtime output, logs of
  this fresh run -- nothing else

Report back in EXACTLY this structure, nothing more:

FRESH RUN
jobId=
status=
artifacts=

FIRST LOSS
file=
function=
condition=
reason=

EVIDENCE
- (paths / decisive lines only, no full logs, no secrets)

REPAIR DIRECTION
filesLikelyRelevant=
doNotReopen=

SOURCE
modified=false
</qa_lab_physical_verifier_contract>

<mode>$Mode</mode>

<task>
$Prompt
</task>
"@

Write-Output "FRESH_RUN_STARTED seed=inline"

$outFile = Join-Path $repoTmp ("result-{0}.txt" -f (Get-Date -Format "yyyyMMdd-HHmmss"))

& codex exec `
  -m $Model `
  -c "model_reasoning_effort=$Effort" `
  -s danger-full-access `
  -C $repoRoot `
  --skip-git-repo-check `
  -o $outFile `
  $guardrails

$exitCode = $LASTEXITCODE

Write-Output "FRESH_RUN_CREATED id=$(Split-Path -Leaf $outFile)"

$verdict = if (Test-Path $outFile) { Get-Content -Raw $outFile } else { "(no output file produced, exitCode=$exitCode)" }
$firstLossLine = ($verdict -split "`n" | Select-String -Pattern "^file=" | Select-Object -First 1).Line

Write-Output "CODEX_VERIFY_FINISHED verdict=exitCode:$exitCode firstLoss=$firstLossLine"

# --- Repo change guard: compare AFTER Codex runs ----------------------------------------------
$statusAfter = git status --porcelain -- . 2>&1
$beforeSet = [System.Collections.Generic.HashSet[string]]::new([string[]]$statusBefore)
$unexpected = @($statusAfter | Where-Object { -not $beforeSet.Contains($_) })
# Never treat the verifier's own permitted runtime-output writes as an unexpected source change.
$unexpectedSource = @($unexpected | Where-Object { $_ -notmatch '\.artifacts[\\/]' })

if ($unexpectedSource.Count -gt 0) {
  Write-Output "REPO_CHANGE_GUARD status=HUMAN_GATE"
  Write-Output "unexpectedTrackedChanges:"
  $unexpectedSource | ForEach-Object { Write-Output "  $_" }
  Write-Output "Codex may have written outside its allowed scope, or a change appeared during the run that was not present before it. Stopping -- do not revert, a human must review these files."
  exit 2
}

Write-Output "REPO_CHANGE_GUARD status=clean"
Write-Output "----- CODEX RESULT -----"
Write-Output $verdict
exit $exitCode
