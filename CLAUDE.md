# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
npm run db:init                                # create/verify the project registry DB, print row counts
npm run db:inspect                             # alias of db:init
npm run server                                 # start the Express API (default http://localhost:3001)
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

### Project registry database (`src/db/`)

`/api/projects` stores project definitions in a relational DB and **materializes** them onto
disk: `POST /api/projects/:slug/materialize` writes `automations/apps/<slug>/app.config.json`,
`mobile.config.json` and `app.knowledge.json` from the DB rows. The DB is the source of truth;
the app-profile files are generated artifacts.

Two drivers sit behind one interface (`DbConnection` in `src/db/db-connection.ts`), selected by
`DB_DRIVER`:

| Driver | Value | Notes |
|---|---|---|
| SQLite | `sqlite` (default) | Uses Node's built-in `node:sqlite` — no install, no service. File at `SQLITE_DB_PATH` (default `data/qa-lab.db`), schema applied automatically on first connect. |
| SQL Server | `sqlserver` | Original behaviour. Requires `npm install odbc` + ODBC Driver 18, and `SQL_SERVER_HOST` / `SQL_SERVER_DATABASE`. |

Repositories and routes keep writing T-SQL (`dbo.` prefixes, `SYSUTCDATETIME()`,
`OUTPUT INSERTED.*`, lock hints); `translateSql` in `src/db/sqlite-connection.ts` rewrites those
constructs for SQLite. Schema DDL lives in `src/db/sqlite-schema.ts`.

Two SQLite-specific behaviours worth knowing:
- Unlike ODBC, all transactions share one file handle, so top-level `withTransaction` calls are
  serialized through a promise chain and nested ones become `SAVEPOINT`s.
- `id` and `slug` columns are `COLLATE NOCASE` to reproduce SQL Server's case-insensitive
  comparisons (the API returns uppercase ids for shared connections).

Tables: `Projects`, `SharedConnection`, `WebProjectConfiguration`, `MobileProjectConfiguration`,
`ProjectOtpConfiguration`, `ProjectJiraConfiguration`, `ProjectTestRailConfiguration`,
`ProjectKnowledge`, `ProjectConfigurationHistory`.

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
| `DB_DRIVER` | `sqlite` (default) \| `sqlserver` |
| `SQLITE_DB_PATH` | SQLite file, relative to repo root. Default `data/qa-lab.db` |
| `SQL_SERVER_HOST` / `SQL_SERVER_DATABASE` / `SQL_SERVER_TRUSTED_CONNECTION` | Only for `DB_DRIVER=sqlserver` |
| `PORT` / `API_PORT` | API server port (default 3001) |
| `API_KEY` | When set, all routes except `/health` require the `X-Api-Key` header |

### POM status lifecycle

`pomStatus` on an automation entry tracks where a promoted spec is relative to its Page Objects:

- `needs_page_object` → a new page class must be created
- `needs_page_method` → existing page class is missing a required method
- `page_object_candidate_created` → candidate file generated, awaiting approval
- `promoted` → all referenced POMs are active and the spec passes
- `inline_debug_only` → spec uses inline locators instead of POMs (debugging only)

## QA Lab knowledge

Project knowledge: `docs/ai/`

For QA Lab debugging:
- read `docs/ai/00-current-state.md` first
- do not recursively read `docs/ai/`
- read at most one additional referenced note unless evidence requires more
- `archive/` is historical, not current authority
- preserve already PHYSICAL GREEN boundaries
- stop at earliest unresolved boundary
- never expose secrets

### QA Lab agent workflow (Claude = builder/fixer, Codex = verifier/tester)

For every QA Lab bug, before touching source: delegate PHYSICAL reproduction to Codex via
`scripts/codex-qa-verify.ps1` — never `codex:rescue` for this. `codex:rescue` goes through
`codex-companion.mjs --write`, which caps Codex's sandbox at `workspace-write` with no
`--add-dir`, and physical QA Lab replay needs Playwright/tsx/esbuild to spawn child processes and
write temp artifacts outside the repo tree — confirmed to fail there with `EPERM` (first on
Playwright's own temp dir, then on esbuild's service-worker spawn) no matter how the prompt is
phrased. `scripts/codex-qa-verify.ps1` calls the Codex CLI directly. `--add-dir` only ever
extends filesystem read/write scope, never the sandbox's own process-creation restriction — with
`-s workspace-write` plus `--add-dir` for the OS temp dir, `.artifacts/tmp`, and the Playwright
browser install dir, `tsx`/`esbuild` spawn fine but `browserType.launch` still EPERMs spawning
the Chromium executable itself (interactive `codex` has a human to approve that one-off
escalation; headless `codex exec` does not, so it just fails). The user explicitly authorized
`-s danger-full-access` for physical QA Lab runs specifically (2026-09-24) after this was
demonstrated step by step — see the script's own header comment for the full escalation history;
do not silently revert to `workspace-write` for this use case, and do not re-litigate it without
new evidence. Codex stays source-read-only via the prompt guardrails and the repo change guard
below regardless of the OS-level sandbox. `/codex:review` remains available for reviewing a
diff, but never substitutes for a physical run.

Codex stays a VERIFIER ONLY over source code even when write-capable for runtime execution: the
script's guardrail prompt hard-forbids editing/patching/refactoring source or any git write
operation, permits only `.artifacts/**`/traces/screenshots/temp/log writes, and the script itself
snapshots tracked repo status before and after — an unexpected tracked source change stops the
workflow as HUMAN_GATE (files reported, never auto-reverted) instead of continuing. Historical
evidence (docs/ai, prior artifacts/job ids) is seed/context only, never diagnostic authority —
Codex must run a genuinely fresh job every time.

Loop:
1. Claude identifies which physical test corresponds to the reported problem.
2. Claude runs `scripts/codex-qa-verify.ps1` with a compact prompt (problem summary, mode,
   seed job/recording id if any, relevant artifact refs, expected physical test — never the
   full conversation) and waits for it to finish before doing anything else: no parallel
   investigation of the same first-loss, no second verifier for the same boundary.
3. Codex reports back job/run id, earliest first-loss, decisive evidence (paths/log lines, not
   full logs), and likely files/boundary, in the script's structured output contract.
4. Claude applies the smallest fix for that one first-loss, respecting the discipline above
   (one first-loss per iteration, preserve GREEN boundaries, no forbidden authorities).
5. Claude runs focal tests only (not full suites) for the touched files.
6. If the change touches runtime/backend code, restart the QA Lab backend and wait for real
   `/health` readiness before the next Codex delegation.
7. Claude reruns `scripts/codex-qa-verify.ps1` for the SAME physical test with a NEW fresh run —
   never reuse the diagnostic run's job id as authority for the retest.
8. PASS → done. FAIL → Codex returns the new earliest first-loss; repeat from step 4.
9. Stop at PASS, HUMAN_GATE, BLOCKED, or a reasonable iteration limit — never loop indefinitely
   on the same unresolved boundary.

Codex effort: LOW by default; MEDIUM only under real ambiguity; HIGH is rejected by the script.
Never spawn more than one Codex verifier for the same first-loss.
