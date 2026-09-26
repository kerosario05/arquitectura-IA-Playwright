<#
.SYNOPSIS
  Direct Claude Code CLI physical verifier for QA Lab fresh runs (Discovery/Recording/promotion).

.DESCRIPTION
  Replaces `scripts/codex-qa-verify.ps1` as the project's physical verifier (user decision,
  2026-09-25): the Codex CLI stopped being usable here -- it returns 401 Unauthorized against
  api.openai.com -- while the Claude Code CLI is already authenticated under this workspace's
  own subscription.

  What carries over unchanged from the Codex script:
  - the same `<qa_lab_physical_verifier_contract>` guardrail text and the same output contract,
    so the loop documented in CLAUDE.md maps one-to-one;
  - the same repo change guard: tracked status is snapshotted before and after, and an
    unexpected tracked source change stops the workflow as HUMAN_GATE (files reported, never
    auto-reverted);
  - the same effort policy: low by default, medium only under real ambiguity, high rejected.

  What is genuinely BETTER here, and the reason not to mourn Codex:
  Codex could only be asked not to edit source -- the prompt was the whole enforcement, with the
  repo guard as a post-hoc backstop. `--disallowed-tools` denies `Edit`/`Write`/`NotebookEdit`
  and every git write verb at the TOOL level, so the verifier cannot modify source even if it
  decides to try. The repo guard stays as a second line, not the only one.

  What is WEAKER, stated plainly: the verifier is no longer a different vendor's model from the
  one that usually writes the fix. It is still a fresh process with no memory of the fixing
  session's reasoning, and it still has to produce a real run with real artifacts -- but if you
  want true cross-model independence on a boundary that matters, pass `-Model sonnet` while the
  fix was written by opus, or vice versa.

  Sandbox note: unlike Codex on Windows, the Claude CLI does not impose a process-creation
  restriction that blocks Playwright from spawning a browser, so none of the `--add-dir`
  escalation history in the Codex script applies. `--permission-mode bypassPermissions` exists
  here to stop it asking a human that nobody is there to answer, not to unlock spawning.

.PARAMETER Prompt
  Compact task description: problem summary, verification mode, seed job/recording id if any,
  relevant artifact refs, and the expected physical test. Never the full conversation.

.PARAMETER Effort
  low (default) or medium. high is rejected outright -- this verifier never needs it.

.PARAMETER Mode
  discovery | recording | other -- informational only, included in the guardrail prompt.

.PARAMETER Model
  opus (default) or any alias the CLI accepts. Pass a different one than wrote the fix when you
  want cross-model independence.

.EXAMPLE
  ./scripts/claude-qa-verify.ps1 -Mode recording -Effort low -Prompt "Seed recording 58fb8166-...
  (app kiosko). Fix landed in canonical-recording-contract.ts (reconcileTransientRouteTransitions)
  and recording-store.ts. Re-derive this recording as a NEW fresh run and report whether
  stateSequenceValid is now true and which interactions still carry a routeAfter."
#>
param(
  [Parameter(Mandatory = $true)][string]$Prompt,
  [ValidateSet("low", "medium")][string]$Effort = "low",
  [ValidateSet("discovery", "recording", "other")][string]$Mode = "other",
  [string]$Model = "opus"
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

$repoTmp = Join-Path $repoRoot ".artifacts\tmp\claude-qa-verify"
New-Item -ItemType Directory -Force -Path $repoTmp | Out-Null

Write-Output "CLAUDE_VERIFY_STARTED model=$Model effort=$Effort mode=$Mode"

# --- Repo change guard: snapshot tracked status BEFORE the verifier runs -----------------------
$statusBefore = git status --porcelain -- . 2>&1

$guardrails = @"
<qa_lab_physical_verifier_contract>
You are the QA Lab PHYSICAL VERIFIER, not the fixer. Your ONLY job is to run a FRESH physical
test and report the earliest first-loss. You must NEVER:
- edit, patch, or refactor any source file
- run git add, commit, push, reset, clean, checkout, restore, stash, merge, or rebase
- change any functional/runtime configuration file
- attempt to fix the bug yourself

YOU are the verifier. This repository's CLAUDE.md describes delegating physical verification to
another agent -- that instruction produced THIS process. Do not delegate it onward, do not spawn
a subagent for it, and do not invoke any other verifier script. Run the job yourself.

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

# Source-mutating tools are denied outright: the contract above states the rule, this enforces it.
# Joined into ONE comma-separated argument on purpose -- `--disallowed-tools` is variadic, so a
# PowerShell array splat here silently swallows the prompt that follows it.
$denied = @(
  "Edit", "Write", "NotebookEdit",
  "Bash(git add *)", "Bash(git commit *)", "Bash(git push *)", "Bash(git reset *)",
  "Bash(git checkout *)", "Bash(git restore *)", "Bash(git clean *)", "Bash(git stash *)",
  "Bash(git merge *)", "Bash(git rebase *)"
) -join ","

# The prompt goes over stdin rather than as a positional argument, for the same reason: nothing
# after a variadic flag can be trusted to stay positional.
$guardrails | & claude -p `
  --model $Model `
  --effort $Effort `
  --permission-mode bypassPermissions `
  --permission-prompts none `
  --disallowed-tools $denied `
  --add-dir $repoRoot 2>&1 | Tee-Object -FilePath $outFile

$exitCode = $LASTEXITCODE

Write-Output "FRESH_RUN_CREATED id=$(Split-Path -Leaf $outFile)"

$verdict = if (Test-Path $outFile) { Get-Content -Raw $outFile } else { "(no output file produced, exitCode=$exitCode)" }
$firstLossLine = ($verdict -split "`n" | Select-String -Pattern "^file=" | Select-Object -First 1).Line

Write-Output "CLAUDE_VERIFY_FINISHED verdict=exitCode:$exitCode firstLoss=$firstLossLine"

# --- Repo change guard: compare AFTER the verifier runs ----------------------------------------
$statusAfter = git status --porcelain -- . 2>&1
$beforeSet = [System.Collections.Generic.HashSet[string]]::new([string[]]$statusBefore)
$unexpected = @($statusAfter | Where-Object { -not $beforeSet.Contains($_) })
# Never treat the verifier's own permitted runtime-output writes as an unexpected source change.
$unexpectedSource = @($unexpected | Where-Object { $_ -notmatch '\.artifacts[\\/]' })

if ($unexpectedSource.Count -gt 0) {
  Write-Output "REPO_CHANGE_GUARD status=HUMAN_GATE"
  Write-Output "unexpectedTrackedChanges:"
  $unexpectedSource | ForEach-Object { Write-Output "  $_" }
  Write-Output "The verifier may have written outside its allowed scope, or a change appeared during the run that was not present before it. Stopping -- do not revert, a human must review these files."
  exit 2
}

Write-Output "REPO_CHANGE_GUARD status=clean"
Write-Output "----- CLAUDE RESULT -----"
Write-Output $verdict
exit $exitCode
