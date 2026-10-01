# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this project is

An AI-powered Playwright automation framework. It **discovers** test cases from TestRail by actually navigating the target app, generates typed execution plans and Page Object Model specs, and can auto-repair failures using an AI agent (Codex/Copilot/custom). The output lives under `automations/apps/<app-slug>/`.

## Commands

All commands run from the project root. Copy `.env.example` to `.env` and fill in required variables before running anything.

### Running promoted tests
```bash
npm test                         # run all promoted specs (automations/apps/**/cases/**/*.spec.ts)
npm run test:apps                # same, explicit apps config
npm run test:framework           # framework tests under tests/
npm run test:headed              # headed mode
```

### Discovery lifecycle
```bash
# Discover a single TestRail case and promote it to a spec:
npm run discovery:case -- --case-id <N> --auto-promote [--headed] [--overwrite] [--app <slug>]

# Key flags:
#   --auto-promote          promote to spec after passing discovery
#   --overwrite             replace existing plan/spec for the case
#   --auto-pom              auto-generate and approve POM candidates
#   --verify-promoted-spec  run the generated spec immediately to verify it
#   --inline-debug-spec     produce an inline spec instead of a POM spec
#   --headed                launch a visible browser
#   --app <slug>            target a specific app profile (default: resolved from env/TestRail)

# Batch discovery:
npm run discovery:batch -- --case-ids 37844,37845 --auto-promote

# Scan a URL for page objects (no TestRail case needed):
npm run discovery:scan -- --url <URL>
```

### Page Object management
```bash
npm run page-objects:generate -- --app <slug>  # generate candidate .page.candidate.ts files
npm run page-objects:approve -- --app <slug>   # promote approved candidates to active .page.ts files
```

### Plans (lower-level)
```bash
npm run plans:generate -- --case-id <N>        # generate plan from TestRail without running browser
npm run plans:enrich -- --plans <file>         # enrich plan steps with AI
npm run plans:execute -- --plans <file>        # execute a raw plan JSON
npm run plans:promote -- --from <outputDir>    # promote a pending plan from a discovery output dir
```

### Other tools
```bash
npm run cases:start -- --case-id <N>           # full start workflow (discovery → repair → promote → report)
npm run cases:list                             # list automation registry entries
npm run registry:inspect                       # inspect the automation index
npm run testrail:inspect -- --case-id <N>      # inspect raw TestRail case data
npm run testrail:report                        # push results back to TestRail
npm run explorer:scan -- --url <URL>           # scan a page and dump its accessibility snapshot
npm run data:inspect                           # inspect resolved env/test-data config
npm run typecheck                              # run tsc --noEmit
npm run clean:tmp                              # remove .artifacts/tmp and temp files
```

## Architecture

### Full lifecycle

1. `discovery:case` fetches the TestRail case → launches a browser → walks through the plan steps, resolving each target against the live DOM (locator candidates, AI-assisted disambiguation)
2. If a step fails, the **agent auto-repair** loop invokes the configured AI agent (Codex/Copilot/custom) with a structured handoff package, then re-runs the failed segment
3. On success, `promote-plan` writes the validated plan to `automations/apps/<app>/cases/<case-id>/plan.json` and generates a `.spec.ts` (POM-based or inline-debug)
4. The **auto-pom** pipeline generates `*.page.candidate.ts` files, auto-approves safe ones, updates `page-objects.index.json`, and regenerates the spec
5. `npm test` / `npm run test:apps` executes all promoted specs via Playwright

### App profiles (`automations/apps/<app-slug>/`)

Each app slug is a self-contained automation unit:

```
automations/apps/<slug>/
  app.config.json          # app profile (baseUrl, loginMode, testData)
  index.json               # registry of all automation cases for this app
  page-objects.index.json  # POM registry (active + candidate page objects)
  flows.index.json         # auth flow registry
  pages/
    *.page.ts              # active Page Objects (used in specs)
    *.page.candidate.ts    # AI-generated candidates awaiting approval
  flows/
    auth.flow.ts           # multi-step auth orchestrator (identification → phone → OTP)
    auth.flow.helpers.ts
  components/
    otp.component.ts
    virtual-keyboard.component.ts
  cases/<case-id>/
    plan.json              # execution plan (source of truth for steps)
    case.spec.ts / spec.ts # Playwright spec (generated from plan + POMs)
    case.json              # TestRail case metadata snapshot
    automation.json        # promotion metadata (status, pomStatus, etc.)
```

`default` is the active app slug for this repo; `arquitectura-automatizacion`, `app-a`, `app-b` are additional profiles.

### Execution plan (`plan.json`)

Central artifact. A JSON object with a `steps` array, where each step has:
- `action`: `navigate | login | click | fill | assert | wait`
- `target`: locator strategy (`text`, `role`, `css`, `aria-label`, `data-testid`)
- `description`: human-readable, used as a code comment in the spec

The plan is executed by `src/runner/execution-plan-executor.ts`, which drives Playwright and captures evidence screenshots.

### Playwright configs

| Config file | `testDir` | Use |
|---|---|---|
| `playwright.config.ts` | `automations/apps/**/cases/` | Default — runs all promoted specs |
| `playwright.config.apps.ts` | `automations/apps/` | Explicit apps run |
| `playwright.config.framework.ts` | `tests/` | Framework-level tests |

All three configs read `APP_BASE_URL`, `HEADLESS`, `BROWSER`, and `DEFAULT_TIMEOUT_MS` from `.env`.

### Auth flow

`automations/apps/<slug>/flows/auth.flow.ts` exposes `AuthFlow.ensureAuthenticated()`. It detects the current auth stage by scanning the page snapshot via `src/discovery/auth-gate-detector.ts` and drives identification → phone confirmation → OTP input. Client credentials come from `APP_TEST_DATA_JSON` (structured as `{ clients: { defaultClient: { identificationType, identificationNumber, otp } } }`) with `Identity_Provider` and `OTP_SECRET` as env-var fallbacks.

### Agent auto-repair (`src/agent/`)

When discovery fails with a recoverable reason (e.g. `target_not_found`, `ambiguous_target`), `runAgentAutoRepairAttempt` builds a structured handoff package (current plan, page snapshot, failure summary, skills) and invokes the external AI agent CLI. The agent proposes a repaired plan; `runSegmentedRouteRecovery` then executes that plan segment-by-segment to confirm the fix. Skill definitions live in `src/agent/skills/*.skill.md`.

Agent is configured via env vars: `AGENT_PROVIDER` (`codex | copilot | custom`), `AGENT_CLI_COMMAND`, `AGENT_CLI_ARGS`, `AGENT_AUTO_REPAIR_ENABLED`, `AGENT_AUTO_REPAIR_TIMEOUT_MS`.

### Key env variables

| Variable | Notes |
|---|---|
| `APP_BASE_URL` | Required. Target app URL |
| `APP_LOGIN_MODE` | `password \| no_login \| manual` |
| `APP_USERNAME` / `APP_PASSWORD` | Credentials for password login |
| `APP_TEST_DATA_JSON` | JSON object with test data; supports nested `clients` map for auth |
| `Identity_Provider` | Identification number fallback for auth flow |
| `OTP_SECRET` | OTP fallback for auth flow |
| `HEADLESS` | `true \| false` |
| `BROWSER` | `chromium \| firefox \| webkit` |
| `EVIDENCE_DIR` | Where screenshots are saved |
| `DEFAULT_TIMEOUT_MS` | Playwright default timeout |
| `TESTRAIL_*` | TestRail API credentials and project/suite/section IDs |
| `AGENT_PROVIDER` | AI agent used for auto-repair |
| `APP_PROFILE` / `APP_SLUG` | App profile slug override |

### POM status lifecycle

`pomStatus` on an automation entry tracks where a promoted spec is relative to its Page Objects:

- `needs_page_object` → a new page class must be created
- `needs_page_method` → existing page class is missing a required method
- `page_object_candidate_created` → candidate file generated, awaiting approval
- `promoted` → all referenced POMs are active and the spec passes
- `inline_debug_only` → spec uses inline locators instead of POMs (debugging only)

## QA Lab Codex rules (physical verifier contract)

Role: **physical verifier/tester only**, invoked by Claude via `scripts/codex-qa-verify.ps1`.
Model `gpt-5.6-luna`. Effort: LOW by default, MEDIUM only under real ambiguity, HIGH refused by
the script. Runs with `-s danger-full-access` (needed for Playwright/Chromium child-process
spawning) but remains source-read-only via this contract and the script's own repo-change guard.

Authority: only a genuinely fresh physical QA Lab run just executed by you. A historical
job/artifact/recording id given as seed is context only, never diagnostic authority — always
run a NEW fresh job, wait for it to reach a terminal state, then analyze ONLY its own artifacts.

You MUST:
- run a fresh physical job/run for the described test
- wait for terminal state before analyzing
- isolate the EARLIEST first-loss only; never investigate downstream of it
- return the compact output contract below, nothing more

You MUST NOT:
- edit, patch, or refactor any source file, or attempt to fix the bug yourself
- run any git write operation (add, commit, push, reset, clean, checkout, restore, stash, merge, rebase)
- invent or fabricate a locator/certification
- use hardcoded app/case/business-text/URL/id/step values, or positional selectors (`nth`/`first`/`last`/index/coordinates)
- add fixed sleeps as a synchronization fix
- change any functional/runtime configuration file

Allowed writes: `.artifacts/**`, traces, screenshots, temp/runtime outputs, logs of the run you
just executed — nothing else. An unexpected tracked change outside this scope stops the workflow
as `HUMAN_GATE` (files reported, never auto-reverted).

Output contract (exact structure, nothing more):

```
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
```

## QA Lab Codex Orchestrator (automated loop infrastructure)

`src/orchestrator/` + `scripts/qa-lab-orchestrator.ts` automate the manual copy/paste cycle above
into three roles. The Orchestrator never touches QA Lab source; it only reads structured results
and decides.

1. **ORCHESTRATOR** (`src/orchestrator/state-machine.ts`, pure, no I/O) -- reads
   `TaskContract` + latest `ClaudeResult`/`CodexPhysicalResult`, applies the evidence hierarchy
   (fresh physical > runtime artifact > integration test > unit test > prose), and returns exactly
   one `OrchestratorDecision`: `CALL_CLAUDE`, `CALL_CODEX_PHYSICAL`, `SUCCESS`, `HUMAN_GATE`, or
   `EXTERNAL_BLOCKER`. `readyForPhysicalReplay=true`/tests-green/automationReady alone can NEVER
   produce `SUCCESS` when `task.physicalValidationRequired` is true -- only a FRESH
   `CodexPhysicalResult` whose `successCriteriaSatisfied` covers every `task.successCriteria`
   entry does. Serial only: one actor invoked per iteration, never concurrently.
2. **CLAUDE BUILDER** -- the only role that edits source. Invoked via `CLAUDE_CLI_COMMAND`/
   `CLAUDE_CLI_EXTRA_ARGS` (same shape as this file's `CODEX_CLI_COMMAND`; unset by default --
   no Claude CLI invocation is hardcoded or assumed). Must reply with the structured
   `actor=CLAUDE` contract (see `src/orchestrator/types.ts`); prose is never parsed for state.
3. **CODEX PHYSICAL** -- unchanged from the contract above: source read-only, always invoked
   through `scripts/codex-qa-verify.ps1` (never a direct `codex exec`), reports the structured
   `actor=CODEX_PHYSICAL` contract.

Prompts to Claude Builder are generated by `src/orchestrator/prompt-builder.ts`: exactly one
first-loss per ticket, physical GREEN boundaries carried forward verbatim as "NO REABRIR", and
checked by `findForbiddenHints` before dispatch (rejects any generated prompt that would inject
`nth(`/`.first()`/`.last()`/`sleep(N)`/`waitForTimeout(` as authority).

Run: `npx tsx scripts/qa-lab-orchestrator.ts --task <task.json> [--dry-run] [--fixture <evidence.json>] [--max-iterations N]`.
`--dry-run` never invokes either actor -- it decides once, writes the generated prompt under
`.artifacts/orchestrator/<taskId>/prompts/`, and exits. State persists at
`.artifacts/orchestrator/<taskId>/state.json` (runtime-only; `docs/ai/00-current-state.md` stays
the human checkpoint of record).

**CODEX ORCHESTRATOR agent** (`src/orchestrator/codex-orchestrator-invoker.ts`) is the reasoning
layer on top of the deterministic state machine: source READ-ONLY (`-s read-only`), model
`gpt-5.6-luna`, effort `medium` (never high, never escalated without explicit sign-off). It
reasons over the task/state/evidence and proposes a decision + (when `CALL_CLAUDE`) its own
critical-prompt draft -- but `state-machine.ts`'s `validateAgentDecision` is the ONLY thing
allowed to act on that proposal: any proposal that disagrees with the independently-computed
`decide()` result on SUCCESS validity, mismatches `decision`<->`nextActor`, tries to reopen a
physically-GREEN boundary without contradicting evidence, or whose raw output claims a source
edit, is rejected and the deterministic decision is used instead (fail closed, never "execute
anyway"). Opt-in via `runOneIteration({ useCodexOrchestratorAgent: true })`; off by default (pure
`decide()`), since it additionally requires a resolvable Codex CLI (`resolveCodexCliPath`, same
resolution `scripts/codex-qa-verify.ps1` already documents) on top of `CLAUDE_CLI_COMMAND`.

The known OPEN `capture-attach-boundary` (Codex Physical driving `playwright-cli` against its own
independent Page instead of the recorder-owned one, so CaptureEngine V2 observes nothing) is
preserved as a fixture at `.artifacts/orchestrator/fixtures/capture-attach-boundary.json` for the
Orchestrator to resume from -- NOT diagnosed or fixed by this infrastructure task.
