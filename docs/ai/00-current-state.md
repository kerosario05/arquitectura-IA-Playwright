# QA Lab Current State

## Current task checkpoint

### 2026-10-07 -- Keep final dashboard evidence with its existing screen heading
The user reported that the final dashboard screenshot appeared on the next PDF page and repeated
“Pantalla dashboard”. The rerun passed and reached the dashboard; the source screenshot itself
shows the dashboard header and footer. The evidence model had made a same-title final checkpoint a
new screenshot-only screen, causing the report renderer to paginate it separately and repeat its
heading.

Updated `src/evidence/evidence-document-model.ts` to attach a final checkpoint to the last screen
when its title matches that screen, while retaining a distinct final screen when titles differ so
final screenshots after later steps remain last. Added the focused contract case to
`src/evidence/evidence-pdf-generator.test.ts`.

Validation: `npx tsc --noEmit --target ES2022 --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck src/evidence/evidence-document-model.ts` passed. The focused evidence test's new case and other contracts passed, but the suite still exits 1 at `renders cover + one page run per scenario`: expected 4 PDF pages, actual 6. No clean-base comparison was run, so that is an unresolved test diagnostic, not labeled pre-existing. No QA job was launched. Next: inspect/fix that independent page-count assertion/layout only if the user asks; verify this report by regenerating the PDF from existing evidence without rerunning QA.

### 2026-10-07 -- Archive the Portal Empresarial login spec for isolated QA Lab rerun
The user requested removing the spec for TestRail run 4574 so they can relaunch it in QA Lab.
The supplied log identifies `REC-9A767B4D-01`, case 48818, “Login satisfactorio”, with active
spec `automations/apps/portal-empresarial/sections/default-section/cases/preview-001-login-satisfactorio/case.spec.ts`.
Runtime reached `https://172.27.4.31/dashboard`; the failure was the step 5 assertion expecting
“Continuar” to remain visible, classified `PROMOTED_ASSERTION_STATE_MISMATCH`.

Archived the exact untracked active spec under
`.artifacts/spec-archives/testrail-4574-portal-empresarial-login-satisfactorio-20261007-081437/`
with a manifest. Verified SHA-256 `4ee0ea7766f09da68977d7ffc5bf22cdca9bae990dbd898de4fa1cd23bb9db3c`
matches the archive and confirmed the active spec path is absent. No other case, recording, or
TestRail data was changed; no job or tests were run. Next: the user can rerun this case in QA Lab,
which can generate a fresh spec from its persisted recording.

### 2026-10-07 -- Require explicit start and project selection for local regression
The user asked that opening the desktop regression page no longer launch all jobs automatically,
that projects be selectable, and that only the first five cases across the selected projects run.
Updated the local Desktop dashboard and launcher. The launcher now enumerates ready cases, opens a
preparation page, and waits for `/start-regression`; only the explicit **Iniciar ejecución** action
submits the selection to QA Lab. The page has per-project checkboxes (all selected by default), a
live selected-case count, and a global cap of five in displayed order. Server-side validation and
the PowerShell selection helper both enforce the project filter and five-case cap.

Changed Desktop files: `QA-Lab-Regresion-Dashboard-Server.js`,
`QA-Lab-Regresion-Todos-Proyectos.ps1`, and their JS/PowerShell tests. The repo checkpoint is also
updated. Validation passed: dashboard syntax plus Playwright tests 3/3, including no-job-on-page-load,
selection filtering, and the five-total cap; PowerShell parser/helper tests passed, including the
launcher action handoff. No live QA Lab job was launched. Next: restart the desktop `.bat`; it will
open the prepared dashboard and wait until **Iniciar ejecución** is clicked.

### 2026-10-07 -- Add a guarded failed-spec archive action to the local regression dashboard
The user asked for an option to remove the active spec of a regression-failed case before they
rerun it from QA Lab, noting a Portal Empresarial case that was reported failed in regression but
passed and promoted in an isolated QA Lab run. The supplied QALab log for `REC-7AEE70ED-01` shows
`functionalExecution=passed`, `promotionAllowed=true`, `promotionPersisted=true`, and a successful
spec writeback. This makes protection against stale failure cards essential.

Added a dashboard action, “Guardar respaldo y retirar spec”, available only when the launcher
captured a valid active `case.spec.ts` path and SHA-256 at failure time. It requires confirmation,
validates the project/repository path, rejects symlinks and changed specs, saves a copy under
`.artifacts/spec-archives/manual-qa-rerun-*`, verifies the backup hash, writes a manifest and local
action ledger, then removes only the active spec. If ledger persistence fails, the source spec is
restored. Failed cases without a verified spec fingerprint do not get the action. Updated the local
Desktop PowerShell launcher to retain the active workspace/spec identity from backend log lines.

Changed files (outside the repository):
`C:\Users\radames\Desktop\Regresion QA Lab\QA-Lab-Regresion-Dashboard-Server.js`,
`QA-Lab-Regresion-Todos-Proyectos.ps1`, and their dashboard JS/PowerShell tests. In-repo change:
this checkpoint only. Validation passed: `node --check` for the local server; Node Playwright
dashboard tests 2/2; PowerShell parser plus helper fixture. No live QA Lab job was launched and no
real project spec/recording was touched. Next: restart the desktop launcher for its next regression;
on a failed case with a matching current spec, confirm the archive action and then rerun from QA Lab.

### 2026-10-07 -- Show per-case failure diagnostics in the desktop regression dashboard
The user asked for a visual way to inspect where each regression case failed and see an image,
including distinguishing application/runtime failures from Discovery failures. Updated the local
desktop dashboard server and all-project launcher under `C:\Users\radames\Desktop\Regresion QA Lab`.
The launcher now retains up to 30 failed-case summaries with project/case, phase, step, target,
sanitized reason, and an optional screenshot embedded in the temporary dashboard state. Spec
validation screenshots are read only from an explicit `screenshotPath`; Discovery screenshots are
separately labeled and never presented as spec-validation evidence. Missing images are called out.
Image files are limited to PNG/JPEG/WebP and 8 MiB; no live QA job was run.

Removed a shadowed duplicate `render` declaration in the dashboard HTML: the full renderer was
nested inside an incomplete renderer, preventing state-driven UI updates. The new diagnostic panel
now renders the historical failed cases and lets the user open an available image in another tab.

Validation passed: `node --check` on dashboard server and Playwright UI test; focused browser fixture
passed 1/1, confirming the two phases, step/target, reason, image load, and no-image Discovery label.
PowerShell parser passed and helper fixture passed for spec failure and JSON Discovery failure,
including duplicate suppression. No full regression job was launched. Next: user starts the desktop
launcher on a future regression to see real case diagnostics; this UI change has not been exercised
against a live backend job.

## Current task checkpoint

### 2026-10-07 -- Isolate cases that failed the all-project regression
The user-provided report for regression `QA-Lab-Regresion-20261007-002002.md` records 7/10
scenarios passed and promoted, and 3 failed without promotion: Fenix “Transferencias entre
cuantas propias” (`REC-3CD40992-01`), Portal Comercial “Registro deposito a plazo cliente
existente” (`REC-5F2E57CD-01`), and Portal Empresarial “Agregar varios empleados manualmente
con cédula” (`REC-7AEE70ED-01`). The report does not include each failed step or runtime error.

Moved the Fenix active spec plus the available generated candidates for all three cases out of
their active case directories into `.artifacts/spec-archives/regression-20261007-002002/`,
preserving hashes. Portal Empresarial's active `case.spec.ts` was already absent and remains in
the earlier `testrail-4566` archive. No recording, plan, metadata, or unrelated case was changed.
No QA job was launched and no tests were run. Next: user can launch each scenario in isolation;
evaluate fresh per-case logs before changing shared behavior.

## Previous task checkpoint

### 2026-10-06 -- Extend recording-engine regression to audit persisted recordings
The user asked to continue implementing the recording-engine regression. Kept all persisted source
recordings read-only and did not start a browser against any project app. Added an in-memory corpus
audit before the existing local capture fixture. It scans app recording directories, rebuilds or
rehydrates current scenarios, excludes generated `recording-regression-*` profiles, and verifies
SHA-256 hashes for trace/scenario/semantic files after inspection. It does not copy raw source traces
into artifacts or log their contents.

The local dashboard now shows source recording counts by project and separates valid, blocked, and
failed audits from the fixture's Discovery/AutoPOM promotion count. Launcher text states clearly that
Discovery/AutoPOM currently run only on the local fixture. This change does not yet replay stored
recordings through Discovery/AutoPOM per project; that requires the next isolated runtime/data
transport step and must preserve each project's URL.

Validation: new corpus tests pass 4/4; recording contract matrix passes 33/33; strict focused
TypeScript passes; desktop dashboard `node --check`, PowerShell parse, and targeted `git diff --check`
pass. Local job `8ae71a5d-c31d-4004-9671-653c5850254f` completed: fixture 1/1 promoted, corpus 19
recordings = 10 valid + 9 blocked, 0 failed, source hashes verified. The blocked 9 are 7 non-stopped
traces and 2 unsupported-platform traces. No real project app was opened; no TestRail writes occurred.
Full `npm run typecheck` still reports 94 diagnostics; exact comparison against the saved immediately
prior output `.artifacts/recording-regression/typecheck-final-output.txt` found 0 added and 0 removed
diagnostics. This is not a clean-revision baseline and does not establish repository-wide type safety.

Next action: implement the isolated per-project replay adapter for eligible stored recordings,
transporting only configured runtime references and preserving source profiles/URLs. Add deterministic
multi-profile fixtures, then leave any real QA replay for the user's explicit launch.

## Current task checkpoint

### 2026-10-06 -- Continue all-project regression after a failed case
The user clarified the target is the desktop all-project regression launcher, not the general
`discovery:preview` engine. My first change to the CLI was reverted and its temporary test removed.

Updated `C:\Users\radames\Desktop\Regresion QA Lab\QA-Lab-Regresion-Todos-Proyectos.ps1` so it
submits each persisted scenario as its own QA Lab job, in project order. A terminal status of
`failed`, `completed_with_failures`, or `completed_with_sync_errors` is logged as that case's outcome
and the launcher proceeds to the next scenario. It still stops if a job's state cannot be verified
or the execute API cannot be reached, to avoid launching overlapping/untracked work.

Validation: Windows PowerShell 5.1 and PowerShell 7.6.5 parsers passed. A synthetic test invoked the
real `Invoke-SelectionChunk` and `Invoke-ProjectSelections` functions with mocked API/job calls;
outcomes `done,failed,done` launched and recorded all three cases, with `StopLaunching=false`. No
live job was launched or touched. The earlier mistaken CLI edit/test were reverted/removed.

Next action: on the next user-run regression, confirm the console/dashboard shows a failed case and
then the following case starts as a new job. If job status is unverified, the launcher still stops
to avoid overlap.

### 2026-10-06 -- Plan the recording-engine regression mode
The user asked to start planning a recording-engine regression flow in the existing local QA Lab
regression dashboard and explicitly said not to interrupt the job already running. The latest
provided dashboard artifact showed job `921e0242-d129-46f6-9a19-d8272769533e` in `running` state;
it was not queried, paused, or cancelled. Current status is unknown.

Created `docs/ai/recording-engine-regression-plan.md`. The proposed flow scripts a deterministic
Playwright fixture through `WebSessionRecorder`, persists and hydrates only in per-job staging,
then runs Discovery, spec generation, AutoPOM, promotion, and optional runtime validation. It
requires per-project jobs and preserves each app profile's URL. Before implementation, verify that
Discovery/AutoPOM supports an isolated output namespace; `/api/recordings/execute-batch` can mutate
scenarios/spec artifacts and must not receive originals directly. Source QA Lab recording files
must remain immutable and be hash-checked before/after. No code/job changes or tests were run; this
was planning/documentation only.

Next action: audit the write paths and CLI options for Discovery/AutoPOM to determine the smallest
safe staging boundary, without interacting with the active user job.

### 2026-10-06 -- Keep all-project regression batches isolated by project
The user reported that a Kiosko case appeared to use Fenix's URL. The supplied live log for job
`596d7d00-de9c-4b47-9deb-3e1a4b73286b` shows the desktop launcher submitted a mixed-project batch:
`Invoke-SelectionChunk` took `projectSlug` from the first selection while attaching selections from
all projects. `/api/recordings/execute-batch` resolves one app profile from that top-level slug, so
the mixed batch could use Fenix's configured URL for Kiosko scenarios. The attachment is incomplete
for the Kiosko case's own runtime lines; its exact failed URL remains unverified.

Updated `C:\Users\radames\Desktop\Regresion QA Lab\QA-Lab-Regresion-Todos-Proyectos.ps1` to
group selections by `ProjectSlug` before forming batches and reject any mixed-project batch before
the API call. Windows PowerShell 5.1 and PowerShell 7 parser checks passed; a synthetic sample with
four profiles produced four isolated batches and passed the guard check. No QA job was launched and
no specs were touched. The user-run job's final status is not established by the supplied excerpt.

Next action: on the next user-authorized launcher run, confirm each per-project job logs its own
`appSlug` and configured/effective base URL before navigation; do not launch a physical job here.

### 2026-10-06 -- Reuse QA Lab live logs and dashboard behavior for regression
Active objective: make the desktop multi-project regression page behave and look like QA Lab's live
execution page, with the title and project/case context identifying the regression. The user launches
jobs; do not start, stop, or cancel them.

Prior read-only inspection of job `5bcfe492-b980-4460-b7dd-4f03037d635b` confirmed the backend kept
running while the local dashboard stopped displaying at step 18. The local PowerShell formatter
allowlisted selected prefixes and silently discarded the rest of the real QA Lab log stream. The
desktop page already mirrors the live execution layout; its data comes from the same QA Lab job API.

Updated `C:\Users\radames\Desktop\Regresion QA Lab\QA-Lab-Regresion-Todos-Proyectos.ps1` to display
every backend log line with its original QA Lab prefix, redacting credential and data-bearing fields.
The dashboard still derives case, step, result, and promotion counts from that same job stream. The
event buffer now keeps the latest 1,000 lines and exposes a monotonic sequence. Updated
`C:\Users\radames\Desktop\Regresion QA Lab\QA-Lab-Regresion-Dashboard-Server.js` to render when
that sequence changes, even after the retained buffer reaches capacity. The currently open monitor
and page have the previous code loaded; changes apply at the next launcher start.

Validation: Windows PowerShell 5.1 and PowerShell 7 parsers pass; Node `--check` passes; a focused
synthetic smoke verified original log-prefix pass-through, secret/text/query redaction, failure
severity, step tracking, and 1,000-event retention with a continuing sequence. No job was launched,
stopped, or cancelled. Visual replay in the user browser is unverified.

Next action: relaunch the desktop launcher after the current user-run regression is complete and
confirm the page continues showing original QA Lab log lines through spec generation and promotion.

### 2026-10-06 -- Prepare the five portal-empresarial cases for user-run regression
Active objective: let the user launch the regression manually in QA Lab. The user explicitly asked
to move the five specs only, then clarified that they will run the regression themselves.

The five `case.spec.ts` files referenced by TestRail run 4562 were moved out of their active case
directories into `.artifacts/spec-backups/testrail-4562-portal-empresarial-regression/`. No plan,
recording, registry, or other project files were changed. The saved preview input containing the
same five recorded scenarios is `.artifacts/scenario-preview-runs/cbfc1044-497a-469d-9009-87d653c75969/preview-scenarios.json`.

I mistakenly started `npm run discovery:preview -- --input .artifacts/scenario-preview-runs/cbfc1044-497a-469d-9009-87d653c75969/preview-scenarios.json --app portal-empresarial --overwrite --auto-promote --auto-pom --rerun-active`; the user then clarified they will run the regression. I stopped the command with Ctrl+C while it was processing `PREVIEW-002`. The process is confirmed stopped, but that run is incomplete and its final discovery/promotion result is not verified. The five active spec paths remain absent; their source specs are recoverable in the backup directory.

No tests/typechecks were run. Next action: wait for the user to launch regression in QA Lab and provide its result. Do not move or restore specs, or launch another job, unless the user explicitly asks.

## Current task checkpoint

### 2026-10-06 -- Repair and regenerate transfer case after TestRail run 4551
Active objective: fix the stalled account-selection step in the reused Fenix transfer spec, regenerate
the spec, and validate promotion. The requested Playwright `trace.zip` was not found in the supplied
attachments, repository `test-results`, `.artifacts`, or project search results; the diagnosis uses the
run log plus the matching runtime/resolver code.

First-loss evidence: on `REC-3CD40992-01` step 17, the recorded source-account option was uniquely
matched and its selected state verified, but `selectPromotedItem` never completed. The `resolveActionTarget`
wrapper then performed its accepted-field-scope diagnostic after successful `action_select` resolution;
that diagnostic has no selection consumer and was the only logged field-scope work after the verified
selection. After Playwright closed the page at 300 seconds it emitted `evaluate_threw` and the step failed.
The later session-warning `locator.count` error was teardown fallout.

Fix: `src/discovery/target-resolver.ts` now skips accepted-scope click-mutation diagnostics for
`action_select` while preserving them for other actions. Added a focused guard regression in
`src/discovery/target-resolver.click-field-scoped-fallback-gate.test.ts`. The failed spec was copied to
`.artifacts/spec-backups/testrail-4551-transferencias/case.spec.failed.ts`, verified by SHA-256, then
removed and regenerated from the persisted preview input. Regenerated spec path:
`automations/apps/fenix/sections/api-tests/cases/preview-001-transferencias-entre-cuantas-propias/case.spec.ts`.

Validation: focused resolver regression passed 12/12. `npm run discovery:preview -- --input
.artifacts/scenario-preview-runs/4f2ae90f-4328-4336-b20b-8cef015f1a9d/preview-scenarios.json --app fenix
--overwrite --auto-promote --rerun-active` exited 0; functional runtime passed (1 required step,
0 failed), the spec was written, promotion was allowed, and status is promoted. `git diff --check` exited
0. Full `npm run typecheck` still exits 2 with 297 diagnostics, all in test/fixture files and none in
non-test source; repository-wide type safety remains unverified. No TestRail result was published.

Next action: if the user reports a recurrence, compare its new step-17 trace; the original ZIP remains
unavailable. Continue tracking the 297 test-only TypeScript diagnostics separately.

### 2026-10-06 -- Diagnose TestRail run 4551 promoted-spec failure
Active objective: explain why the first of two reused scenarios failed in user-provided log
`C:\Users\radames\.codex\attachments\62d92d36-b4d7-464b-8db9-5b7f924c417a\Pasted text.txt`.
This was `reuse-existing`: `generationInvoked=false`; the run did not generate a new spec.

First-loss window: `REC-3CD40992-01` (Transferencias entre cuantas propias) passes navigation to
QueryBank/Summary and the click on Cuentas Propias (step 16). On step 17, recorder evidence shows
the source-account option was uniquely resolved and selected (`visibleOptionApplied=true`,
`uniqueIdentityMatch=true`, `stateVerified=true`), but the step never emits completion. The log then
has a 4-minute silence and Playwright's 300000 ms test timeout closes the page. The later
`locator.count: Target page, context or browser has been closed` in session-warning inspection is a
teardown symptom. Exact awaited operation after selection is not proven from this log. Login case
`REC-88A2B3ED-01` passed. No code changed and no new run was launched.

Trace follow-up: attempted to inspect the Playwright `trace.zip` named in the log, but it is not
present in the workspace (`test-results` only has `.last-run.json`; no trace zip was found under
`.artifacts`). The pasted log is insufficient to identify the exact awaited operation after the
selection was applied. Next action: inspect the trace if the user attaches it; do not rerun the live
QA job to regenerate it.

### 2026-10-06 -- Audit repository-wide TypeScript diagnostics
Active objective: identify the “pre-existing” failures from `npm run typecheck` and determine
whether they are production errors or stale test/fixture types. Current run reports 297 diagnostics
across 78 test files; there are zero diagnostics in non-test production TypeScript files.

Categories: stale argument/fixture types (TS2345/TS2322), tests reading removed properties or
imports (TS2339/TS2305/TS2459), optional fields accessed without guards (TS18048), and outdated
mock signatures/required fields. Examples include stale `KnowledgeContext.generationHints`, old
TestRail result shapes, outdated `RuntimeInputRequirement` fixtures, missing `setupStrategy`, and
mocked process/recording types that no longer match current interfaces. These are compile-time test
maintenance issues, not runtime QA failures. The new evidence ordering regression had one fixture
error (missing `EvidenceStepRecord.timestamp`); that was corrected.

Validation: reran `npm run typecheck`; it reports 297 diagnostics (two fewer than the first
run), all in tests. Added the missing `durationMs` in the Codex CLI mock as well as the missing
`timestamp` in the evidence PDF regression fixture. No test suite was run as part of this audit.
Full remediation across the 78 files
is unresolved; avoid changing production APIs to accommodate stale test assumptions. Next action:
repair fixture shapes and stale assertions against current production contracts, then rerun the
repository typecheck.

### 2026-10-06 -- Keep the final transfer receipt last in evidence reports
Active objective: the user noticed the successful transfer screenshot appears before the second
OTP screenshots in the PDF from run `ca4b4077-7432-4ce1-9e25-2c5b6ca426ca`; inspect the report and
fix screenshot ordering in the shared evidence document model. PDF inspected read-only; no source
PDF was overwritten and no new physical QA job was launched.

First loss: `evidence.json` records the final screenshot as `final-state.png` after the token steps,
but both the pre-token transfer screen and final receipt reuse `screenId=fd36d4f2cfa2b1c0`. In
`buildEvidenceDocumentScreens`, the synthetic final step is omitted from regular step groups; the
final image then matched the earlier transfer screen by its reused ID and was placed before the OTP
screen group. The PDF confirms receipt on page 7 followed by token screenshots on pages 8-9.

Change: `src/evidence/evidence-document-model.ts` now gives an explicit final checkpoint a
dedicated screen group after all action-screen groups, even when its `screenId` repeats. Added a
regression in `src/evidence/evidence-pdf-generator.test.ts` with transfer → OTP → final transfer
sharing the transfer screen ID; it asserts the final screenshot is in the last report group.

Validation: the new ordering regression passed. Focused TypeScript compile of
`src/evidence/evidence-document-model.ts` passed; `git diff --check` passed. The same PDF-generator
test command also reports a separate generic pagination assertion (`expected 4 pages, got 6`);
that assertion does not exercise final-screen grouping and was not changed or investigated in this
first-loss fix. No PDF was regenerated and no physical job was run.

Next action: on the next evidence regeneration, verify the receipt/“Transacción Exitosa” image is
the final screenshot after OTP evidence; retain the new repeated-screenId regression.

### 2026-10-06 -- Restore projection of redacted segmented OTP steps
Active objective: diagnose why the Fenix transfer scenario that previously passed now failed at
the segmented SMS field, then fix the earliest proven regression while preserving unrelated work.
The user supplied original job `21dbe717-57a9-45a8-90f4-f302c92704f2`; after the fix, the user
launched rerun `ca4b4077-7432-4ce1-9e25-2c5b6ca426ca`.

First-loss evidence: the earlier successful preview
`.artifacts/scenario-preview-runs/84f962cd-cfcb-453e-84d9-080e238eb97f/stdout.log` logged two
`segmentedFillProjection=true` decisions and projected 30 source steps to 19 actions. Current
preview `.artifacts/scenario-preview-runs/21dbe717-57a9-45a8-90f4-f302c92704f2/stdout.log`
projects 30 steps to 29 actions and has no segmented projection decision. In the old input, SMS
steps contained one literal digit each; current persisted replay input masks every sensitive
step value as `••••••`. The recording contract still has one certified six-segment fill for SMS.
The projection rejected the first masked value because it was classified as `test_data`, while its
later one-character guard also rejected the multi-character masks. Discovery replayed the extra
per-character fills after completing the OTP field. That is why the case now fails at the following
SMS step (`fill_target_not_editable`).

Changes: `src/discovery/segmented-fill-projection.ts` recognizes the initial redacted test-data
value and repeated redaction-mask values as one sequence, only when every collapsed source
position has the same mask. The existing projection in `src/discovery/case-discovery.ts` now
accepts that token sequence and still replaces it with the recorded semantic fill, preserving the
runtime value key and segmented evidence.
`src/discovery/segmented-fill-projection.test.ts` covers masked sequences, mismatched masks, and
ordinary multi-character values. No secret or literal OTP is included in the test/checkpoint.

Validation: `npx tsx --test src/discovery/segmented-fill-projection.test.ts` passed (2/2).
Focused TypeScript compile of `src/discovery/case-discovery.ts` passed with
`tsc --noEmit --target ES2022 --module CommonJS --moduleResolution Node --esModuleInterop
--skipLibCheck --strict --types node,@playwright/test`. Full `npm run typecheck` remains blocked by
pre-existing errors across unrelated test files; it produced no diagnostics in the changed source
or new utility. User's rerun `ca4b4077-7432-4ce1-9e25-2c5b6ca426ca` confirmed both segmented
projection decisions, `sourceSteps=30 executableActions=19 contractActions=19`, and the case passed
1/1 with `promotionStatus=promoted`, `automationReady=true`, `specWritten=true`, and
`firstPassPromotion=true`. The promoted spec is
`automations/apps/fenix/sections/api-tests/cases/preview-001-transferencias-entre-cuantas-propias/case.spec.ts`.

Next action: none for this failure; the regression fix has been physically validated and the
scenario promoted. For future segmented-input changes, retain this regression and verify the same
projection counts before evaluating later steps.

### 2026-10-06 -- Persist regression and compaction workflow
Active objective: reduce regressions in shared multi-project behavior and retain task context after
session compaction. User authorized updating this `AGENTS.md` with a scope-to-test matrix and a
checkpoint continuation protocol.

Change: `AGENTS.md` now requires focused regression tests for behavior changes, maps common change
scopes to minimum coverage, distinguishes deterministic local tests from externally visible live
QA jobs, and instructs the next turn to read the latest checkpoint before continuing. Active
checkpoints must include the latest request, decisions, exact running job/command state, verified
and unverified work, and one next action. Existing staged user changes were preserved; these edits
remain unstaged.

Prior task outcome: the requested `REC-7AEE70ED-01` preview completed `1/1` and was promoted; the
persisted step for second-row USD carries `entityScope=entity_2`. Its result is recorded below in
the completed task history and `.artifacts/scenario-preview-runs/de474685-2b7c-40bf-aaf5-0efa48862711/results.json`.

Validation: reviewed existing focused tests for discovery, target resolution, execution contracts,
compiler transport, promoted runtime, and recording contracts; `git diff --check -- AGENTS.md
docs/ai/00-current-state.md` passed with the existing CRLF normalization warning. No tests were
run because this change only updates repository guidance.

Unresolved: the strategy is documented but no cross-project regression suite has been added or run.
Next action: on the next behavior fix, add the first focused regression at the earliest failure
boundary, then validate every affected contract layer using the matrix.

### 2026-10-06 -- Remove specs for TestRail run 4545 before rediscovery
Active objective: user asked to remove the specs for the four portal-empresarial cases named by
run 4545 so discovery can be launched again. Only the exact case spec files were removed; plans,
case metadata, evidence, and other project files were left untouched. Discovery was not requested
in this turn.

Evidence: pasted log maps REC-9A767B4D-01, REC-2B6162D6-01, and REC-18027080-01 to three
`sections/api-tests/.../case.spec.ts` paths, and REC-E4AB3829-01 to the payroll spec under
`sections/default-section`. A second staged `default-section` Login spec has the same scenario ID
and title as REC-9A767B4D-01, so that duplicate spec was removed too.

Validation: verified all five target paths are absent from the working tree. Two specs that were
already staged additions now show `AD` (staged add, working-tree deletion); staging was preserved.
No tests, typecheck, or discovery run was performed.

Next action: launch discovery for the four cases. It can regenerate the specs from current case
plans and recording data.

### 2026-10-06 -- Resolve REC-7AEE70ED-01 currency and expose missing required input
Active objective: user asked to repair and run the `portal-empresarial` case from job
`85f5142f-0eaa-4be8-a133-b1aa2c5d6826` until it promotes. Preserve unrelated staged/working-tree
changes; Codex only; no tests, commits, or pushes. Physical discovery previews were explicitly
requested and run.

First-loss progression: attempt 10 cleared the prior row-2 `cédula` failure but stopped at row-2
`Moneda`/USD because the runtime plan had kept only the combobox event and discarded the exact
recorded `role:option|USD` event. Attempt 11 bound the owner and option only when field, entity,
expected state/route, and exact option name matched. Its physical log proves both DOP and USD were
selected and verified in their respective entity rows. The run completed all recorded fill steps,
then failed at step 32 because `Validar` was visible but disabled. Its evidence screenshot shows
row 2's `Fecha de Nacimiento` still blank. The captured recording has no fill event or runtime
input requirement for that field; it has only `Fecha de Ingreso`. No approved birth date is present
in the scenario requirements, so the submit action cannot legitimately pass or promote yet.

Changes: `src/discovery/case-discovery.ts` now carries the exact recorded option event for an
entity-matched semantic selection; the experimental selection/fill reorder was removed after a
physical replay proved it made the income fill fail. `src/discovery/target-resolver.ts` now allows
keyboard selection for a roleless button only under a field-scoped grid cell plus exact recorded
option authority, and still requires readback verification. It also can select an exact unique live
recorded option when the menu owner has disappeared. These are shared Recording/Replay paths, not
portal-specific selectors.

Validation: `git diff --check` completed without whitespace errors. Physical replay command used
the saved case input `41ae6c43-02fb-441c-af19-69a9cf4540ce` with
`--app portal-empresarial --overwrite --auto-promote --auto-pom --rerun-active`. Attempt 10 failed
at cédula/row 2; attempt 11 verified cédula and USD, filled the rest of the recorded steps, and
failed with `failedAtStep=32`, `failedTarget=Validar`, `enabled=false`, `promotionAllowed=false`,
`specWritten=false`. Tests and typecheck were not run.

Unresolved: promotion is not achieved because required row-2 birth date data is absent from the
recording and scenario input, leaving the app's Validate button disabled. Next action: obtain the
approved `Fecha de Nacimiento` value for the second row or an updated recording/TestRail case that
contains that step, then replay and verify actual `specWritten=true` / `automationReady=true`.

### 2026-10-06 -- Resolve repeated-row USD from its own field
Active objective: repair promotion of `REC-7AEE70ED-01` in portal-empresarial while preserving
unrelated staged/working-tree changes. Latest physical run `4543`/job
`85f5142f-0eaa-4be8-a133-b1aa2c5d6826` reached employee 2's currency step but failed before
promotion. Codex only; no tests, physical QA replay, commit, or push.

First loss: step 26 requested `USD` in `Moneda`; the resolver used `previousTarget="Puesto"` as
the row selection trigger before the explicit `associatedField="Moneda"`. Logs prove it resolved
a grid candidate from column `Puesto` (row 2), clicked it twice, found no selection surface/options,
then returned `selection_surface_not_observed`. The runtime input was already correct:
`entity_2.moneda_seleccion=USD`; the earlier employee-2 `Colaborador` loss is cleared
(`fillRequirementBoundBySourceSlot=true`, `entityScope=entity_2`).

Change: `src/discovery/target-resolver.ts` now prioritizes explicit selection activation field,
then associated field, and uses previous action target only as a fallback. The existing
state-verifying resolver still owns option selection. Earlier `case-discovery.ts` source-slot
binding and literal-selection fallback remain in place.

Validation: inspected run log and generated scenario artifact under
`.artifacts/scenario-preview-runs/85f5142f-0eaa-4be8-a133-b1aa2c5d6826`; confirmed contract option
identity is `role:option|USD` and runtime value is `USD`. `git diff --check` passed. No tests,
typecheck, or physical QA Lab run was executed.

Unresolved: the fix is not physically verified and case promotion is not proven. Next action:
replay `REC-7AEE70ED-01` and verify step 26 resolves the `Moneda` cell for `entity_2`, observes and
selects `USD`, then passes final `Validar`. No credentials or secrets are stored here.

### 2026-10-06 -- Preserve repeated-row fill lineage before USD selection
Active objective: continue the user's TestRail case for `REC-7AEE70ED-01`; run `4544`, job
`85326cba-5f55-4027-93e7-cba4034ad83b`, failed before employee 2's USD selection. Preserve unrelated
staged/working-tree changes; Codex only; no tests, physical QA replay, commit, or push.

First loss: at source step 24, the repeated `Colaborador` fill had two semantically identical
recording candidates because both rows had the same captured value. The projection correctly did
not pick one, but it also dropped the source field relation and exact-slot runtime input key. Logs
show `key="undefined"`, `associatedFieldPresent=false`, then `fill_failed`; the run never reached
the USD action. Its runtime requirement is `entity_2.colaborador`, source slot 23.

Change: `src/discovery/case-discovery.ts` now retains the parsed fill field when repeated contract
matching is ambiguous and binds a runtime key only when one requirement matches the exact
zero-based source slot and semantic field. Row/entity scope comes from that requirement. The
shared live resolver still owns the target decision. The earlier USD literal fix remains: explicit
`USD` is passed to the same resolver and must be state-verified.

Validation: inspected run `4544` and its generated scenario artifact under
`.artifacts/scenario-preview-runs/85326cba-5f55-4027-93e7-cba4034ad83b`; `git diff --check` passed.
No tests, typecheck, or physical QA Lab run was executed.

Unresolved: the run failed before USD, so this evidence does not validate USD selection or case
promotion. Next action: run the case again and verify the second `Colaborador` binds to
`entity_2.colaborador`, then confirm the USD option is selected and state-verified.
No credentials or secrets are stored in this checkpoint.

## LATEST (supersedes older CURRENT FRONTIER prose below until re-synced)

### 2026-10-05 -- Do not repeat steps on screenshot overflow pages
Active objective: fix the report from
`C:\Users\radames\Downloads\evidencia-c3b25c7b-cc97-4463-8c58-0baab89dd880.pdf`. The prior PDF
repeated a screen's full step list on every page that received an overflow screenshot, and started
different screen sections in leftover space rather than at a new page. User requires exactly one
complete step list at the top of each screen's page, followed by that screen's screenshots; later
screens start on new pages. Same-screen screenshots may continue without duplicating the steps.

Change: `src/evidence/evidence-pdf-generator.ts` no longer clones the step block when a screenshot
moves to another page. Each screen after the first starts on a new page; its step list is placed
once, followed by the screen's images in order. An image that does not fit moves to the next page
without a repeated list, while later screen sections still start on their own new page.

Validation: inspected all 9 pages of the supplied PDF visually; targeted strict TypeScript check
for the runtime/evidence modules passed; `git diff --check -- src/evidence/evidence-pdf-generator.ts`
passed. No tests, PDF regeneration, or browser execution were run. Next action: review the next
generated PDF and confirm each screen's list appears once at the top before its images.

### 2026-10-05 -- Preserve screenshot size after complete step list
Active objective: refine the PDF layout from
`C:\Users\radames\Downloads\evidencia-d9f1ab4f-e7b4-417b-b5e7-96e3a99f95bb.pdf`. The 22-step
ManualCreationTable step list was correctly laid out in two columns, but grouping all three
screenshots into one atomic block caused them to shrink to fit the remaining page. User wants the
full step list first, followed by screenshots at their regular document width; screenshots may
continue on following pages.

Change: `src/evidence/evidence-pdf-generator.ts` separates each screen's complete step block from
its screenshot blocks. The full list stays together at the top of the page; each screenshot is
kept at the standard 432pt document width and flows to a following page if it cannot fit. A page
that continues screenshots repeats the full screen step block above the image(s), with a
continuation heading. Only an image taller than the available page area is proportionally reduced.

Validation: inspected all 6 pages of the supplied PDF visually; targeted strict TypeScript check
for the runtime/evidence modules passed; `git diff --check -- src/evidence/evidence-pdf-generator.ts`
passed. No tests, PDF regeneration, or browser executions were run. Next action: inspect the next
generated evidence PDF and confirm the ManualCreationTable list is complete above full-width
screenshots.

### 2026-10-05 -- Keep evidence steps with their screen image
Active objective: fix pagination in the generated execution PDF based on
`C:\Users\radames\Downloads\evidencia-3981222c-1f37-4570-946d-4579c9b934b5.pdf`. The PDF showed
the 22-step `manualCreationTable` screen split across pages 5 and 6, with its screenshot only
after the page break. User requires every screen's steps above that screen's image; when a long
list does not fit, show the steps in parallel columns while leaving the screenshot below.

Change: `src/evidence/evidence-pdf-generator.ts` now renders one atomic `.screen-evidence` block
per screen containing its title, complete step list, and screenshot(s). Pagination moves the whole
block to a fresh page before splitting it; long step lists use two columns, and the layout retries
with compact steps and scaled images if needed. The image remains below the full step list.

Validation: inspected all 8 pages of the supplied PDF visually; targeted strict TypeScript check
for the runtime/evidence modules passed; `git diff --check -- src/evidence/evidence-pdf-generator.ts`
passed. No tests or browser executions were run. Next action: inspect the next generated evidence
PDF to confirm a long screen's parallel step list and screenshot stay together.

### 2026-10-05 -- Evidence step text and screen attribution repair
Active objective: correct generated execution evidence so actions are grouped under the actual
screen where they were performed, field steps show their entered value without technical
locators, and a single step is not split across PDF pages. User asked to validate job
`c8bf9cbc-a5e1-4ac2-8c1f-d0a4f93a0119` and fix the evidence generator/runtime. Follow repository
rules: Codex only; preserve architecture and unrelated changes; do not run tests unless explicitly
requested; update this checkpoint after substantial work.

First loss: `EvidenceRecorder.captureStep()` assigns the action's screen using the last settled
`screenState`, but actions are recorded after dispatch. The login form's Enter caused an
unrecorded transition to `/dashboard`; the next recorded click on “Gestión de Nóminas” was thus
attached to the old Login `screenId`. The supplied PDF page 2 and its `evidence.json` prove this:
step 4 is a payroll click with `screenTitle: "Pantalla login"` and the Login screenshot path.
The job log separately proves the click began at `/dashboard` and navigated to
`/payroll/electronicPayroll`. The same JSON has no persisted values for field-fill steps, so this
old PDF cannot be retroactively populated with those values without rerunning the scenario.

Changes made: `src/evidence/evidence-recorder.ts` adds `prepareForAction()` to synchronize the
settled screen and close any pending prior-screen evidence before the next action is dispatched;
`src/automations/runtime/promoted-spec-runtime.ts` invokes it at the existing pre-action boundary,
converts recorded role/CSS targets to readable labels, and includes actual fill values in evidence
steps while masking fields identified as password/secret/OTP/token/PIN. Segmented fills use the
same formatting. `src/evidence/evidence-pdf-generator.ts` keeps each step block intact across page
breaks and allows long values to wrap.

Validation: inspected all 7 pages of the supplied PDF visually and inspected its `evidence.json`;
targeted strict TypeScript check on the runtime and evidence modules passed; `git diff --check` for
the touched source files passed. No tests or browser runs were executed. Next action: generate the
next evidence document from a fresh scenario execution and confirm the Dashboard click appears
under Dashboard and fill values render with technical locator syntax removed.

### 2026-10-05 -- Codex ownership and compilation checkpoint
The user explicitly asked Codex to own repository investigation, implementation, and verification directly; do not use Claude or delegate work. The user also asked to remove the old orchestrator role/hand-off contract from `AGENTS.md`, preserve durable context, and refresh this checkpoint before session compaction. The root `AGENTS.md` now defines Codex as the sole builder/debugger/implementer and documents the user's durable constraints. There is no separate root `agent.md`; `AGENTS.md` is the repository instruction file.

Latest compilation status from the preceding repair session: frontend `npm.cmd run build` passed (existing bundle-size warning); backend production-only TypeScript check `npx.cmd tsc --noEmit --pretty false -p .artifacts/tsconfig.backend-production.json` passed. The full backend typecheck still reports 298 errors in legacy tests/specs/fixtures; those were not repaired as part of the production compilation repair. No tests were run, and no commit/push was made. These facts are recorded separately from the current documentation-only edit.

Current documentation change: `AGENTS.md` removes the old verifier-only/delegation arrangement and assigns implementation responsibility to Codex. It instructs Codex to keep changes scoped, preserve product architecture, use first-loss evidence for QA Lab diagnoses, and update this file before context compaction and after substantial work. Fenix account-list behavior must remain unchanged; Kiosko keyboard-driven field generation must require positive virtual-keyboard detection and leave other recordings unaffected; preserve promoted spec/rerun lineage; do not create blank evidence reports; keep recording selection actions usable and stable.

Current request status: the instruction file and durable checkpoint are updated. No application source changed for this documentation request. No tests were run for the documentation edit.
### 2026-10-05 -- Recording TestRail launch screen Jira lookup
Implemented in the separate frontend/backend repository at `C:\MisProyectos\QA-lab-main` (do not confuse it with this framework repo). Jira lookup on the Recording upload screen now searches issues globally by key or title through `GET /api/jira/issues/search`; Jira project selection is no longer needed. Jira is displayed beside TestRail, selected scenarios are below both panels and size to their contents, the “Solo TestRail” source badge was removed, and automation launch requires an explicitly selected Jira issue as well as a valid TestRail destination. The selected key/title continues to be passed into evidence generation.

Files changed for this feature: `server/jira-client.ts`, `server/routes/jira.ts`, `src/services/jira/projects.ts`, `src/pages/Recording/JiraRequirementPicker.tsx`, and `src/pages/Recording/TestRailUploadScreen.tsx` in `QA-lab-main`. Validation: `npm.cmd run build` passed (`tsc -b` and Vite production build); Vite reported the existing >500 kB chunk warning. `git diff --check` passed. No tests were run. Existing unrelated working-tree modifications in both repositories were preserved.

Before compaction or after substantial work, update this file with: active objective and constraints; root cause and decisive evidence; changed files; validation commands and results; unresolved issues and the next concrete action. Preserve useful historical technical evidence below this LATEST section, but treat it as historical context rather than current instructions. Never put credentials, tokens, or other secrets in this file.
### 2026-10-05 -- Jira issue search route 404 follow-up
The UI reported `Cannot GET /api/jira/issues/search`. The frontend points its API requests at the QA Lab API, and the route source had not been added to this framework backend. Added `GET /api/jira/issues/search?q=...` to `src/server/routes/jira.ts`, querying visible Jira issues globally by exact key or text/title with a 30-result cap. The corresponding QA-lab-main server route and Jira proxy were already added in the frontend feature. Restart the backend process so Express loads the new route before judging the fix. Validation: production backend typecheck `npx.cmd tsc --noEmit --pretty false -p .artifacts/tsconfig.backend-production.json` passed; `git diff --check -- src/server/routes/jira.ts` passed. No live Jira request or tests were run.
### 2026-10-05 -- Jira search API migration
The Jira response `The requested API has been removed` identified the old `/rest/api/2/search` endpoint in the active QA-lab-main backend. Updated `server/jira-client.ts` to route both project-scoped and global issue searches through `POST /rest/api/3/search/jql` with a JSON body, preserving exact-key and text/title JQL, fields, and 30-result limit. Validation: `npm.cmd run build` passed, including `tsc -b` for frontend and server; Vite emitted only the existing large-chunk warning. No tests or live Jira API requests were run. Since this source edit happened after the user's previous backend restart, restart the QA-lab-main API process on port 3001 again before trying the search.
### 2026-10-05 -- Jira search runtime boundary confirmation
Compared live local APIs using a read-only search for `IPF-426`, recording only status and count: `localhost:3001/api/jira/issues/search` still returns Atlassian HTTP 410 retired-API error; `localhost:3002/api/jira/issues/search` returns HTTP 200 with one match. The UI in `QA-lab-main/.env` uses `VITE_API_URL=http://localhost:3001`, so starting this framework's `npm.cmd run server` on 3002 does not refresh the API the UI calls. The listener on 3001 is `QA-lab-main/server/index.ts` and must be stopped/restarted from its own project after the v3 migration. Attempted to restart it programmatically, but execution policy rejected the process restart; no process was stopped or changed. Next action: restart the port-3001 API from the QA-lab-main terminal with `npx.cmd tsx server/index.ts`, then retry the search. No tests were run.
## CURRENT FRONTIER (historical prose below, superseded by LATEST above)

problem=step 4 ("Tarjeta Crédito Visa Clásica") of the roke kiosk scenario: a correctly
certified, already-interactive `<button>` (own `onclick` present, not a text/heading leaf,
`hasOwnOnClick=true`) is clicked by Playwright (no force-click, no thrown error) but produces
zero network/DOM/route effect. AUTHORITATIVE MANUAL EVIDENCE (user clicked the real app by hand):
the SAME card, clicked manually, correctly reaches the product detail surface with a working
"Solicitar" button, which opens a modal with "Generar Turno"/"Solicitud Digital".
manualProductCardClickWorks=true
manualDetailSurfaceReached=true
manualSolicitarWorks=true
externalSiteBlockage=false — do not reclassify this as site flakiness without new physical
evidence contradicting the manual test above.
verificationMode=DIAGNOSE (Codex physical verifier, `scripts/codex-qa-verify.ps1`)
latestFreshRun=`bdimyjklq` (job qa-fresh-roke, actionIndex 4): `[click-owner-identity]
promotedToAncestor=false tag=button role= id= testId= hasOwnOnClick=true
nearestAncestorClickableTag=none` — rules out wrong-owner/wrong-descendant/wrong-ancestor
theories (hypotheses A/B/F/G). A second diagnostic added in the same run
(`[click-event-observed]`, a document-level capture-phase click listener) was BROKEN: it logged
`observed=false` even for steps 1-3, which are known-GREEN and did navigate correctly — proving
the listener itself never fires, not that clicks aren't reaching the DOM. Removed (no reliable
signal); do not re-add without first fixing why a capture-phase `document` click listener
installed via `page.evaluate` never observes ANY Playwright-dispatched click on this target,
including on already-working steps.
earliestUnresolvedFirstLoss=CLICK_NO_CAUSAL_EFFECT_DETECTED at step 4 — hypotheses A/B/F/G
(wrong click owner/descendant/ancestor) are DISPROVEN by direct evidence. Remaining open:
C (persisted CSS resolves to a different-but-structurally-compatible element within the same
accepted scope), D (event dispatched but intercepted/stopped before reaching the handler), E
(some precondition/state the automated run doesn't satisfy that a human interaction does, e.g.
a preceding hover/focus/pointerdown the click-only dispatch skips).
status=OPEN — static reasoning and the available lightweight instrumentation are exhausted;
next step needs either a fixed/working click-observed diagnostic or a different tracing method
(e.g. CDP `DOMDebugger.getEventListeners`, or comparing recorded event sequence — pointerdown/
mouseover before click — against what Playwright's plain `.click()` dispatches).

## PHYSICAL GREEN

- Wrong-sibling click at step 4 (tier-3 field-scoped-fallback certifying a structurally-unique
  but textually-wrong sibling among identical product cards) — **fixed and confirmed twice** via
  fresh Codex physical runs: no `identity_mismatch_rejected` false-positive, no wrong-sibling
  click observed. Files: `src/discovery/target-resolver.ts`
  (`elementTextMatchesAssociatedField`, two call sites in `tryFieldScopedStructuralFallback`).
- Root-path session-reset detection — confirmed via direct Claude physical run (`run5.log`):
  correctly classifies `APP_SESSION_RESET_TO_ROOT_DETECTED` and stops immediately
  (`attemptCount=1`, `retryUsed=false`) instead of burning a bounded click-retry loop and a full
  second scenario attempt on an already-reset session.
- Recording/direct replay = GREEN
- candidate static gates = GREEN
- functionalExecution admission = GREEN
- pressPromotedTarget entry/dispatch = GREEN
- target-resolver TS authority = GREEN
- recordedLocatorFactory invocation = GREEN
- structured target resolution = GREEN
- freshJobId=preview-2026-09-24T19-48-26 — SMS flow: target resolution, click execution,
  post-action observable outcome, functionalExecution, promotionAllowed all GREEN
  (`targetResolved=true`, `nativeClickSucceeded=true`, `callbackSucceeded=true`,
  `effectiveClickDemonstrated=true`, `POST AskToken HTTP 200`, `functionalExecution=passed`,
  `failed=0`, `promotionAllowed=true`, `automationReady=1`, `specsPromoted=1`).
- Deterministic spec compiler (separate, additive, non-production kernel;
  `src/automations/spec-compiler/deterministic-spec-compiler.ts`): target authority, POM
  wrapper, portable import paths, `structuralValidation`, and `playwrightDiscovery` all proven
  GREEN end-to-end in-repo (`promote-plan.deterministic-compiler-e2e-inrepo.test.ts`).
  `productionIntegrated=false`, `defaultDeterministicEnabled=false` — intentionally still
  opt-in; promotion itself correctly stays gated behind physical `functionalExecution` proof.

## APPLIED FIXES

- fix: identity gate on tier-3 field-scoped-fallback certification (final resolved node's own
  text must contain the recorded field's anchor text before certifying)
  files: `src/discovery/target-resolver.ts`
  why: tier-3 certified purely on structural container/scope uniqueness, which cannot
  distinguish N structurally identical siblings (product cards) by name
  validation: 2 fresh Codex physical runs — no wrong click, no over-rejection
- fix: bounded click-retry loop (`POST_ACTION_CLICK_RETRY_LIMIT = 3`) re-clicking the same
  already-certified locator when the recorded post-action surface is still pending
  files: `src/discovery/case-discovery.ts`
  why: a single click can silently not register a real navigation; one retry was confirmed
  insufficient by physical replay
  validation: fresh physical run showed the loop firing as designed (bounded, not infinite)
- fix: generic root-path session-reset detection (`APP_SESSION_RESET_TO_ROOT_DETECTED`) —
  skips further click retries and the outer scenario retry once the route regresses to root
  after being on a deeper route
  files: `src/discovery/case-discovery.ts`
  why: direct screenshot evidence showed the app resetting its own session to its home/idle
  screen mid-scenario; retrying a click against an already-reset session wastes wall-clock time
  and misreports the failure as a click/postcondition defect
  validation: direct Claude physical run (`run5.log`) — correct classification, `attemptCount=1`
- fix: promoted-click-effect classification (`CLICK_NO_CAUSAL_EFFECT_DETECTED`) — reuses the
  existing scoped-mutation diagnostic (previously log-only) as an actual classification signal
  files: `src/discovery/case-discovery.ts`
  why: an explicit `false` (reliable observation, no causal mutation at all) is a genuinely
  ineffective click, not a session reset; must not be misclassified or retried blindly
  validation: confirmed correct and consistent across 3 fresh Codex runs
- fix: `promoteToClickableAncestor` (pre-existing generic utility, safe no-op when already
  interactive) now applied to every click action, not only selection-like ones
  files: `src/discovery/case-discovery.ts`
  why: hypothesis (owner is a non-interactive text/heading leaf) — DISPROVEN by fresh evidence
  for this case (owner was already `<button>` with its own `onclick`), but the fix is harmless
  and generically correct for apps where it would apply
  validation: fresh Codex run — `promotedToAncestor=false` (correctly a no-op here), no regression
- fix (unrelated, exploratory, kept — harmless if not the actual cause): generic
  `--disable-blink-features=AutomationControlled` launch arg
  files: `src/browser/browser-session.ts`
  why: tested as a hypothesis for a headed-vs-headless behavior difference; did not change the
  outcome, kept because it is a standard, app-agnostic mitigation with no observed downside
- attempted, REVERTED (broken, no signal): `[click-event-observed]` document capture-phase click
  listener diagnostic — logged `observed=false` even for known-GREEN steps; removed

## DO NOT REOPEN

- Click owner/descendant/ancestor identity for this case (hypotheses A/B/F/G) — DISPROVEN by
  direct fresh evidence (`hasOwnOnClick=true`, already a `<button>`); do not re-investigate
  without new evidence pointing back at ownership specifically.
- Tier-3 field-scoped-fallback identity gate (target-resolver.ts) — proven twice, Codex itself
  has twice flagged `doNotReopen` on it across unrelated follow-up first-losses.
- `TypeError: recordedLocatorFactory is not a function` (stale `target-resolver.js` shadow) —
  closed, historical.
- Deterministic spec compiler's target authority / POM wrapper / portable import paths /
  structuralValidation / playwrightDiscovery chain — all proven GREEN end-to-end; the only
  remaining gap (`promotionAllowed=false` pending real `functionalExecution`) is by design, not
  a defect.

## CURRENT EVIDENCE

- Codex run `physical-verifier-fresh-20260925-2245`: `ERR_CONNECTION_TIMED_OUT` loading
  `https://172.27.4.50/`, before step 1 — infra, `doNotReopen` on recent fixes.
- Claude direct run `run5.log` (`.artifacts/tmp/self-verify-20260925/`): step 4 correctly
  classified `APP_SESSION_RESET_TO_ROOT_DETECTED`, `expected=/product-extended actual=/`.
- Screenshot `step-004-presionar-tarjeta-crédito-visa-clásica.png`
  (`.artifacts/evidence/roke/default-section/runs/preview-2026-09-25T23-16-44/scenarios/PREVIEW-001/screenshots/`):
  shows the kiosk's own home/idle screen ("¡Hola! ... Toca cualquier opción para comenzar"),
  decisive evidence this is a session reset, not a wrong click.
- Prior successful run (job `7af1bdaf...`, `--headed`): step 4 reached
  `/product-extended?product=tarjeta-credito-visa-clasica` correctly.

## OPEN HYPOTHESES

- C: the persisted CSS selector inside the accepted field scope resolves to a
  structurally-compatible but functionally-different element than the one a real user's click
  lands on (not yet distinguished from D).
- D: the click event is dispatched and reaches the correct `<button>`, but something intercepts
  or stops it before the app's real handler logic runs (needs a working event-trace tool to
  confirm/refute; the attempted diagnostic this round was broken — see APPLIED FIXES).
- E: the automated click sequence (Playwright's plain `.click()`) may skip some precondition a
  real user's interaction always includes (e.g. a preceding hover/pointerover/focus) that this
  app's handler silently depends on — not yet tested.
- (superseded, kept only as historical context) engine-speed-vs-kiosk-timeout and raw network
  latency to `https://172.27.4.50` were the leading theories before the manual-click evidence
  arrived; they do not explain why a real user's click works and the automated one does not on
  the same page at comparable times, so they are no longer the leading hypothesis.

## NEXT ACTION

GATE #1 FIXED AND CONFIRMED WORKING for its own shape (owner div, id/testid-less, click lands on
a DESCENDANT of the owner e.g. an inner element deeper than the owner): css-scope fallback in
`capture-engine-v2.browser-instrumentation.ts` (`ownScopeIdentity`, ~line 576-620) builds a
`:has()` attribute selector from an already-computed stable descendant attribute, verified unique
via an innermost-match filter (rejects the earlier draft's bug where an unbounded `:has()`
matched every ancestor div up the tree). 15/15 focal tests green, 104/104 overall, no regression.

GATE #3 FIXED (code + unit tests, awaiting fresh Codex physical run): when `originalTarget === el`
(click lands directly on the owner div itself, not a descendant) and el has no strong own
role/name, `capture-engine-v2.browser-instrumentation.ts` now searches el's own descendants for
EXACTLY ONE visible node with a strong native role identity and lends its role/name as el's own
`semanticRuntimeAlternative` -- never rewrites el's own role/accessibleName, functionalOwner
stays el. Implementation: extracted shared `buildOwnScopeIdentity(el, structuralIdentity)`
(id/data-testid/css :has() fallback, same innermost-match uniqueness as gate #1) reused by both
gate #1 (ancestor branch, `originalTarget !== el`) and the new gate #3 `else if` branch
(`originalTarget === el && !accessibleName`); new `computeOwnOnlySemanticRuntimeAlternative(el,
scopeIdentityRef)` scans `el.querySelectorAll("*")`, fails closed on 0 or >1 qualifying
descendants. 18/18 focal tests green in
`capture-engine-v2.semantic-runtime-evidence.test.ts` (4 new: 14 positive, 15 ambiguous-reject,
16 owner-with-own-name-unaffected, plus 11-13 gate #1 unchanged); 108/108 total across the 4
touched test files; typecheck still exactly 523 pre-existing errors, 0 new, none in the touched
file. Backend restarted on 3002, `/health` confirmed ready.
doNotReopen (per Codex): shadow-bridge.ts gate #2, discovery/replay downstream, gate #1's own
ancestor-descendant shape -- all still fine.

FRESH PHYSICAL EVIDENCE (job 9cb701a2, real, not stale -- 3 prior Codex dispatch attempts were
Codex-side scripting bugs, not source bugs: stale job reuse, PowerShell accent-mangling, wrong
hardcoded role=button. Fixed by having Codex drive via a Node script with JSON.stringify and
live role detection instead): capture side now WORKS -- fresh recording produced
`functionalActions=5, webSteps=5`, Visa Clásica card: `functionalOwnerPreserved=true,
semanticAlternativeCreated=true` (owner div + descendant img, exactly the gate #3 shape).
BUT discovery:preview replay then failed with `CLICK_NO_CAUSAL_EFFECT_DETECTED` (stayed on
`/product-subcategory`, expected `/product-extended`) -- ROOT CAUSE FOUND: `target-resolver.ts`'s
`resolveSemanticRuntimeTarget` always clicked the MATCHED element (the descendant used to prove
identity, e.g. the img), never the actual clicked node (the owner div). Correct for gate #1
(click really was on the descendant) but wrong for gate #3 (click was on the owner; clicking the
img instead never re-triggered the div's own click handler in practice).

FIXED: added `clickScopeElement?: boolean` to `SemanticRuntimeEvidence`
(`structural-owner-identity.ts`), set `true` only by
`computeOwnOnlySemanticRuntimeAlternative` (gate #3's own path, never gate #1's), propagated
through the `buildComposedPath` aggregator, and consumed in `resolveSemanticRuntimeTarget`
(`target-resolver.ts`): when set, replay clicks the verified-unique SCOPE locator itself (the
owner), never the marked descendant. Gate #1's existing behavior (marker-based click on the
descendant) is completely unchanged since it never sets the flag. 97/97 focal tests green
(82 capture-side + 15 resolver-side), typecheck still exactly 523 pre-existing errors, 0 new.
Backend restarted, `/health` confirmed.

2nd physical run (job bfotjehwn, after the clickScopeElement fix) confirmed the click-target fix
direction is right but replay STILL failed CLICK_NO_CAUSAL_EFFECT_DETECTED -- diagnosed why:
`[recording-replay][semantic-runtime-match]` never even appeared in the replay log at all, only
`[structural-match] reason=owner_not_deterministic`/`[field-scoped-fallback]`. Traced to an
EARLIER boundary: the derived scenario's webStep for Visa never carried `semanticRuntimeEvidence`
in the first place (`targetWebStepPresent=false` even in the prior job 9cb701a2, despite
`semanticAlternativeCreated=true` at capture). Root cause: the aggregated
`semanticRuntimeEvidence.role` was set from `candidates[0].role` (the OWNER div's OWN role,
empty for gate #3 by definition -- that's why gate #3 ran at all), never from the borrowed
descendant's role -- and role-truthiness gates webStep emission downstream.
FIXED: `computeOwnOnlySemanticRuntimeAlternative` now also returns the found descendant's own
`nativeRole(found)`; the `buildComposedPath` aggregator prefers `candidates[0].role ||
semanticSharedBorrowedRole` for both `semanticRuntimeEvidence.role` and
`playwrightRecorderEvidence.role`/`kind`. 100/100 focal tests green (added none new this pass --
existing gate #3 tests 14-16 already assert normalizedValue/targetTag, role wasn't previously
asserted but behavior is additive/backward compatible), typecheck still 523 baseline. Backend
restarted, `/health` confirmed.

3rd physical run (job b1kmiekmt): GATE #3 CAPTURE ITSELF IS CONFIRMED PHYSICALLY CORRECT --
Codex's own recording (raw browser actions, not replay) drove the click and the app genuinely
navigated `/product-subcategory?category=cards&subcategory=credit` ->
`/product-extended?product=tarjeta-credito-visa-clasica`. The click and the fix both work for
real. BUT the derived scenarios.json still shows "Visa Clásica webStep has no target and no
recordedRef", and `discovery:preview` crashes with `Cannot read properties of undefined
(reading 'map')` before navigation is even attempted (never reaches CLICK_NO_CAUSAL_EFFECT_
DETECTED). Traced (static read only, not yet confirmed by a fresh Codex run): `trace-to-
scenario.ts`'s plain-tap branch (~line 890, `if (!target.locators?.length)`) already has a
precedent fix for `fill`+segmented_input (carries `playwrightRecorderEvidence` +
`resolutionState: "runtime_resolution_required"` into the TestRail step) but the parallel
`else if (event.kind === "tap")` branch (~line 962) never does this for a plain click -- it
pushes a TestRail step description only, then unconditionally `continue`s, NEVER pushing a
`webSteps` entry at all for this shape. This may or may not be the actual crash site: this repo
(app slug `roke`) logs `[recording-replay] structuredContractReceived=true legacyParserInvoked=
false`, meaning scenario materialization here may run through a NEWER structured-recording-
replay contract path instead of this classic trace-to-scenario.ts heuristic builder -- NOT yet
confirmed which path is actually active for this recording shape.

Real stack trace obtained (job b5ljowkrh) after adding `err.stack` logging to
`discovery-preview.ts`'s catch handler (it only logged `err.message` before -- that is why 4
prior Codex dispatches all reported "no stack trace found"). Exact crash site:
`virtualCaseToTestScenario` at `discovery-preview.ts:670` -- `vc.steps.map(...)` with `vc.steps`
undefined, hit only when the ternary's other branch (`recordingActions.length > 0 ? ... : `)
takes the empty path, i.e. `vc.recordingExecutionContract?.actions` was empty for this specific
fresh-recording-derived virtual case (Codex's own ad-hoc `/api/recordings/:id/derive` + preview
script, not necessarily the standard `discovery:case` CLI flow -- not yet confirmed which).
FIXED (defensive, always-safe): `(vc.steps ?? []).map(...)` -- never crashes on a malformed/edge
virtual case; typecheck still 523 baseline, 0 new. This does NOT explain WHY
`recordingActions.length` was 0 for this scenario -- that root cause is still open and needs one
more fresh run to observe past the crash.

Gate #3's own fix (browser-instrumentation.ts clickScopeElement + role propagation +
target-resolver.ts scope-click) remains PHYSICALLY PROVEN (job b1kmiekmt: real recording
navigated all the way to `/product-extended?product=tarjeta-credito-visa-clasica`) and needs no
further change.

2nd crash (job bjkpcw6b1, same class): `virtualCaseToTestScenario` at `discovery-preview.ts:699`
crashed on `vc.steps.join` for the SAME reason (`vc.recordingExecutionContract.actions` empty,
`vc.steps` also undefined for this recording-derived virtual case shape). FIXED: guarded all 4
remaining unguarded `vc.steps`/`vc.preconditions` accesses in this function (lines 639, 697, 699,
700) the same defensive way -- `(vc.steps ?? [])`/`(vc.preconditions ?? [])`. Typecheck still 523
baseline. This function assumed a TestRail-sourced virtual case always has `.steps`/
`.preconditions` arrays; a pure-recording-derived case (no TestRail case backing it) legitimately
never sets them, relying on `recordingExecutionContract` instead -- now both paths coexist safely.

STILL OPEN, root cause not yet found: WHY `vc.recordingExecutionContract.actions` (or its
equivalent) ends up empty for this specific fresh-recording-derive-preview path even though the
scenario's raw JSON clearly HAS a populated Visa Clásica entry (`technicalTargetRefs=[]` but with
real `semanticField`, `controlIdentity`, `targetFingerprint`, routeBefore/After showing the
correct product-extended transition) -- suggests the FIELD NAME/shape `virtualCaseToTestScenario`
reads (`vc.recordingExecutionContract?.actions`) may not match what this specific derive path
actually produces on the virtual case object. Not yet inspected: how the "fresh recording" -> 
scenarios.json -> preview-scenarios.json (VirtualCase input) conversion actually populates (or
fails to populate) `recordingExecutionContract` for this shape.

Both crash-guards confirmed effective (job bdzfxmql8/b7vz236de): discovery preview now runs to
completion instead of crashing. BUT it produced a FALSE "passed": `case_finished status=passed`
while `scenario=undefined, stepResults=[]` -- zero steps actually replayed.
ROOT CAUSE (not a source bug, a Codex-verifier-script gap): Codex was hand-building
`preview-scenarios.json` and invoking the `discovery-preview.ts` CLI directly -- that shortcut
path never populates `recordingExecutionContract` at all (confirmed: the real endpoint has a
named guard for exactly this, `[run:scenario-preview] failed reason=
recording_execution_contract_missing`, in `scenario-preview-runner.ts` -- a REAL, intentional
check the raw CLI shortcut bypasses entirely, silently producing a vacuous pass instead of that
honest failure). The REAL QA Lab pipeline (confirmed earlier this session via the actual backend
log: `[run:scenario-preview] recordingReplay=true ... recordingExecutionContractPresent=true`)
goes through the recording's own REST flow, not a hand-assembled CLI input file.
Redirected Codex (job b795yoma1) to use the real endpoint instead -- that run hit an unrelated
Codex-side flake (`status=blocked_at_recording`, its own live click-driving got stuck) before
reaching preview, so not yet confirmed whether the redirect itself resolves the vacuous-pass
issue. Also produced a legitimate new recording folder
`automations/apps/portal-empresarial/recordings/ac93c6ad-b766-4ff8-86be-e7150d7b5afd/` which
tripped the verifier's repo-change guard (HUMAN_GATE) -- this is EXPECTED and AUTHORIZED per the
standing policy that Codex may create new QA Lab recordings; it is not contamination and must
not be reverted, only the guard script doesn't special-case `automations/**/recordings/` the way
it special-cases `.artifacts/**`.

CONFIRMED (job bf70owwdq, real pipeline via `/api/recordings/:id/execute`, NOT the CLI
shortcut): `recordingExecutionContract` IS now genuinely populated (5 structured actions,
`webSteps=5`, no crash) -- the vacuous-pass issue is resolved by using the real endpoint. BUT
replay still fails at step 4 with the SAME `CLICK_NO_CAUSAL_EFFECT_DETECTED` /
`technicalTargetResolved=false reason=recorded_target_not_present_or_unique`.
Traced (static, target-resolver.ts): `resolveActionTarget` DOES receive
`semanticRuntimeEvidence: actionTarget.semanticRuntimeEvidence` (case-discovery.ts:8593) and DOES
call `resolveSemanticRuntimeTarget(page, opts.semanticRuntimeEvidence)` at line 3294-3295, BEFORE
the `recorded_target_not_present_or_unique` fallback further down (~line 3406) that actually
fired. But NONE of `resolveSemanticRuntimeTarget`'s own log lines
(`[recording-replay][semantic-runtime-match] reason=...`) appear anywhere in this run's full log
-- meaning it returned `undefined` via one of its silent, no-log early guards (line ~5800-5803):
`!semanticRuntimeEvidence`, `captureUniqueTarget !== true`, empty `normalizedValue`, or empty
`scopeAlternatives`. NOT YET CONFIRMED which -- needs either a temporary diagnostic log in that
early-guard block, or reading the actual persisted `semanticRuntimeEvidence` object on the step-4
action inside `recordingExecutionContract` in a fresh run's `scenarios.json`/execution-contract
JSON to see whether the field survived the recording -> persisted-contract round trip intact, or
was silently dropped/malformed by a field allowlist somewhere in that serialization path (not
yet located this session).

LIKELY ROOT CAUSE FOUND (static trace, `canonical-recording-contract.ts:1241-1247`, NOT yet
confirmed by a fresh Codex run -- do that first before editing):
```
const semanticRuntimeEligible = Boolean(target?.semanticRuntimeEvidence)
  && target!.semanticRuntimeEvidence!.captureUniqueTarget === true
  && target!.semanticRuntimeEvidence!.scopeAlternatives.length > 0
  && (action === "fill" || action === "click" || action === "press")
  && !(target?.technicalTargetCandidates ?? []).some((candidate) =>
    (candidate.locatorCandidates ?? []).some((locator) => locator.ambiguous === true),
  );
```
This gate gets checked ~line 1414 before spreading `semanticRuntimeEvidence` onto the
`CanonicalInteraction` that later flows into `recordingExecutionContract` (line 2931) and then
into `resolveActionTarget`'s `opts.semanticRuntimeEvidence` (case-discovery.ts:8593). For Gate #3
specifically, `target` IS the clicked OWNER div itself (`el === originalTarget`) -- and the
whole reason gate #3 exists is that this owner has NO strong/deterministic identity of its own.
If the owner's own `technicalTargetCandidates` (built by the owner-resolver, independent of my
`semanticRuntimeAlternative`) contains any locator flagged `ambiguous: true` for the OWNER's own
weak identity -- which is architecturally likely for exactly this shape -- this eligibility gate
silently zeroes out `semanticRuntimeEligible`, so `semanticRuntimeEvidence` never reaches the
interaction, never reaches `recordingExecutionContract`, and `opts.semanticRuntimeEvidence` is
undefined at replay time. This exactly explains why `resolveSemanticRuntimeTarget`'s own log
lines (`[recording-replay][semantic-runtime-match]`) never appear anywhere in any of this
session's replay logs -- the function is never even called with real evidence.

NEXT: (1) confirm via one fresh Codex run: add a temporary console.log right after this
`semanticRuntimeEligible` computation printing its value plus
`target?.technicalTargetCandidates?.[0]?.locatorCandidates` for a gate-#3-shaped click, OR just
read the persisted `recordingExecutionContract` JSON directly and check whether the Visa action
object has a `semanticRuntimeEvidence` key at all (fast, no code change needed -- do this first).
(2) If confirmed, the CORE-generic fix is almost certainly: this ambiguity check should only
apply to `target`'s OWN structural authority when `target` is being resolved as itself (the
original Gate #1/pre-existing semantic-runtime path), never when the evidence came from gate #3's
own already-verified-unique `clickScopeElement` alternative (which has ALREADY separately proven
uniqueness via its own scope/innermost-match discipline, independent of the owner's ambiguous
technicalTargetCandidates). A minimal fix: skip the `technicalTargetCandidates` ambiguity check
specifically when `target.semanticRuntimeEvidence.clickScopeElement === true` (the exact flag this
session added), since that evidence's own fail-closed uniqueness proof already supersedes the
owner's unrelated ambiguous locator. (3) Add a focused regression test in
`canonical-recording-contract.test.ts` (or a new focused file) proving: a target whose OWN
technicalTargetCandidates are ambiguous but whose `semanticRuntimeEvidence.clickScopeElement` is
true still gets `semanticRuntimeEligible=true`; the EXISTING (non-clickScopeElement) ambiguous
case must stay rejected -- no regression. (4) typecheck, focal tests, restart backend, redispatch
Codex via the confirmed-working `/api/recordings/:id/execute` pipeline, expect
`[recording-replay][semantic-runtime-match]` to finally appear in the log and the Visa Clásica
step to actually replay and reach `/product-extended`.

FIXED and unit-confirmed (canonical-recording-contract.ts:1241-1250): the eligibility gate now
skips the owner's-own-ambiguous-locator check specifically when
`target.semanticRuntimeEvidence.clickScopeElement === true`. New tests in
`canonical-recording-contract.semantic-runtime-evidence.test.ts` (6/6 green): the gate-#3 shape
now stays eligible despite an ambiguous owner locator; the pre-existing (non-clickScopeElement)
shape is still correctly rejected, unchanged. Typecheck still 523 baseline. Two pre-existing,
unrelated test failures confirmed via `git stash` (present identically WITHOUT my changes):
`canonical-recording-contract.test.ts` line 925 (`/loading` vs `/a`, an unrelated navigation-
timing test) and `canonical-recording-contract.structural-runtime-readiness.test.ts` line 182
(a fixture missing `interactionEvidence: []` on a `technicalTargetCandidates` entry -- a
pre-existing test-fixture gap, not caused by this session's change). Backend restarted, `/health`
confirmed.

Gate #3's own capture/replay fix (browser-instrumentation.ts clickScopeElement + role propagation,
target-resolver.ts scope-click) remains physically proven at the CAPTURE level (real recording
navigated correctly).

STILL FAILING (job bgozrvghv, via the confirmed-working `/api/recordings/:id/execute` pipeline):
`functionalActions=5` but `webSteps=3` this time (fewer than the 5 seen in earlier
discovery-preview-CLI-shortcut runs -- a DIFFERENT scenario-derivation shape than before, not yet
reconciled). Still `CLICK_NO_CAUSAL_EFFECT_DETECTED` at step 4, still NO
`[recording-replay][semantic-runtime-match]` log line anywhere -- meaning my
`canonical-recording-contract.ts` eligibility fix, while unit-proven correct in isolation, is
NOT the only place the evidence gets dropped for this specific replay path. My fix only
guarantees `semanticRuntimeEvidence` survives ONTO the `CanonicalInteraction` -- it does not yet
prove that value survives all the way through
`recordingExecutionContract.actions[i].semanticRuntimeEvidence` (persisted to disk) ->
`structuredAction.semanticRuntimeEvidence` (case-discovery.ts:2237) ->
`actionTarget.semanticRuntimeEvidence` (case-discovery.ts:8593) -> `resolveActionTarget`'s
`opts.semanticRuntimeEvidence` for the ACTUAL `/api/recordings/:id/execute` -> discovery-preview
code path specifically (as opposed to the `canonical-recording-contract.semantic-runtime-
evidence.test.ts` harness, which calls `buildCanonicalInteractions` directly and stops there).

CONFIRMED (job bexn4nlnr, direct read of the persisted execution job's own params JSON --
`$j.params.scenarios[0].recordingExecutionContract.actions`, the CORRECT place to look, not
scenarios.json): `semanticRuntimeEvidencePresent=False` for the Visa Clásica action even AFTER
the canonical-recording-contract.ts eligibility fix. So the eligibility fix is necessary but not
sufficient -- something EARLIER in the pipeline still drops the field before it ever reaches
`buildCanonicalInteractions`'s `target` parameter, OR a DIFFERENT reconstruction path (not the
one exercised by `canonical-recording-contract.semantic-runtime-evidence.test.ts`, which calls
`buildCanonicalInteractions`/`buildHappyPathScenario` directly on freshly-created `RecordedEvent`s)
is what actually runs for a live recording. Prime suspect, NOT YET INSPECTED this session:
`src/recording/recording-store.ts` -- a live recording is very likely persisted to
`trace.json`/disk via this module's OWN serialization, then LATER re-hydrated for `derive`/
`execute`; if that at-rest schema/allowlist predates `semanticRuntimeEvidence` (added earlier
this session for gate #1, well before gate #3), the field could be silently stripped on the
write or read side of that round trip, independent of anything in
`canonical-recording-contract.ts` or `capture-engine-v2.shadow-bridge.ts` (both already
confirmed correct by existing/new unit tests).

RULED OUT: `src/recording/recording-store.ts` does a plain `JSON.stringify(trace)`/full dump for
`trace.json`/`scenarios.json`/`semantic-recording.json` -- no field allowlist, nothing stripped
there. Also confirmed correct by direct source read: `capture-engine-v2.raw-interaction-
adapter.ts:111` (`semanticRuntimeEvidence: action.semanticRuntimeEvidence`) and
`web-session-recorder.ts:1742` (`semanticRuntimeEvidence: raw.semanticRuntimeEvidence`) both
copy the field through correctly for every interaction kind. So capture -> RecordedEvent.target
-> CanonicalInteraction -> recordingExecutionContract is, by static reading, intact end-to-end;
combined with the EARLIER physical proof (job b1kmiekmt: `semanticAlternativeCreated=true`,
real navigation to `/product-extended`), gate #3's capture path itself is very likely fine.

CORRECTION on the "semanticRuntimeEvidencePresent=False" finding (job bexn4nlnr): that check used
a PowerShell filter (`Where-Object {$_.semanticField -like '*Visa*' -or $_.description -like
'*Visa*'}`) to find the Visa action -- but gate #3's owner has NO own name/semanticField by
definition (that's the whole reason the fallback exists), so the action's own `description`/
`semanticField` very plausibly never contains the literal text "Visa" even when
`semanticRuntimeEvidence` IS correctly present -- the filter itself likely produced a false
negative (matched zero rows, `$a` empty/null), not real absence. Redispatched twice to get an
UNFILTERED per-index listing to check this properly; both retries hit unrelated Codex-side
recording flakes (one authorized-new-recording-folder HUMAN_GATE false alarm -- reviewed, benign,
a trivial `updatedAt` timestamp bump in an unrelated file, left as-is per never-revert policy; one
recording that captured ZERO actions at all, a pure driving flake) before producing the actual
listing. NOT YET obtained: a clean, unfiltered index-by-index dump of `recordingExecutionContract.
actions` confirming or refuting `semanticRuntimeEvidence` presence on the Visa entry.

Retried the unfiltered-listing dispatch once more (job bpfhi9g95): 12+ retry attempts inside that
one dispatch, most hit the SAME class of Codex-side live-click-driving flake seen all session
(recording captured 0 functional actions, or stalled mid-recording, or failed at action 3-4/5)
before finally reaching `status=done` -- but that final clean run ALSO captured
`functionalActionCount=0`/`recordingExecutionContract.actions=[]` (zero actions, not just the
Visa one) -- a total capture failure for that attempt, not informative either way about
`semanticRuntimeEvidence`. STILL NOT OBTAINED this session: a clean, unfiltered per-index
confirmation of whether `semanticRuntimeEvidence` is present on the Visa action.

Codex's own live-browser click-driving reliability has been the dominant source of noise this
entire session -- of roughly 20+ dispatches, a majority failed on Codex's own script/timing
(stale-job reuse, PowerShell string-mangling, hardcoded wrong role, click-timing flakes, 0-action
captures), never on source. Given this, further live-dispatch attempts have low expected
information gain per attempt.

CODE-PATH PARITY CONFIRMED (static read, `src/server/jobs/session-recording-runner.ts:578-584`):
the REAL `/api/recordings/:id/execute` pipeline builds its scenario via
`buildSemanticRecordingModel(trace, events)` -> internally calls `buildCanonicalInteractions`
(confirmed by an earlier crash stack trace this session:
`at buildCanonicalInteractions (canonical-recording-contract.ts:1299) at
buildSemanticRecordingModel (semantic-recording.ts:1079)`) -> then
`enrichRecordedScenarioContract(...)` -- the EXACT SAME two functions
`canonical-recording-contract.semantic-runtime-evidence.test.ts` already exercises and passes
6/6 on, including the new gate-#3 `clickScopeElement` cases. There is no divergent/parallel
implementation for the real pipeline -- it is the same code, same functions, same call order.
This is strong evidence the earlier "semanticRuntimeEvidencePresent=False" (job bexn4nlnr) really
was the PowerShell filter bug (filtering by literal "Visa" text in `semanticField`/`description`,
which a gate-#3-shaped nameless owner action would never contain), not a real gap in this layer.

Two more dispatches (jobs bw9q7vmil, bg2pr8oa0) both hit a NEW, consistently-reproducing failure:
`404 Cannot POST` on `/api/recordings/:recordingId/control`, every single retry inside both
dispatches (not intermittent this time -- 100% of attempts). Independently sanity-checked myself
(not Codex): `curl -X POST http://localhost:3002/api/recordings/start ...` returns a real,
correct validation error (`MISSING_RECORDING_GOAL`), proving the backend route genuinely works
and is NOT a 404 -- this conclusively rules out a backend/source regression. The 404 is entirely
inside CODEX'S OWN reused Node script (`.artifacts/tmp/fresh-roke-recording.mjs`) -- something in
its URL construction (likely the `recordingId` variable, or the control endpoint path template)
broke or was reused stale across dispatches; asking Codex to print the URL before posting did not
produce that diagnostic in its evidence, so the exact script bug is still unconfirmed.

Had Codex write a BRAND NEW script from scratch (`.artifacts/tmp/fresh-roke-control-20260926.mjs`)
instead of reusing the broken one -- confirmed this fixes the 404 (POST /start now returns HTTP
202 with a real recordingId, POST control reaches the backend with a real 400 response instead of
404). But the new script's own live-role-detection guessed the WRONG role (`role=link`) for
"Explora nuestros productos" (established earlier this session to be `role=button`), so the very
first click failed `TARGET_NOT_FOUND` before reaching anywhere near the Visa Clásica step. This is
purely a quality issue in Codex's freshly-written throwaway script, not source.

CLEAN RUN OBTAINED AND DIRECTLY VERIFIED (job blhzwhini, jobId 6980e48f -- Codex's fixed script
with role fallbacks worked): `functionalActions=5`, real 5-action recording, real
`/api/recordings/:id/execute` replay. I (Claude) read `.artifacts/scenario-preview-runs/
6980e48f.../preview-scenarios.json` MYSELF directly with a plain node script (no PowerShell
filter, no Codex narrative) and confirmed with certainty:
`recordingExecutionContract.actions[3]` (Tarjeta Crédito Visa Clásica) has
`semanticRuntimeEvidence` GENUINELY ABSENT (`hasSRE=false`). This RETRACTS the earlier
"code-path-parity, high confidence" conclusion -- the eligibility-gate fix
(canonical-recording-contract.ts) is confirmed correct in isolation (unit tests) but something
EARLIER still drops the evidence for this real page/click, most likely at CAPTURE time itself
(browser-instrumentation.ts's gate #3 branch never producing a `semanticRuntimeAlternative` in
the first place for this specific real DOM shape -- e.g. the real Visa card might have MORE than
one qualifying descendant, unlike the earlier/different job's shape that DID succeed).

ADDED (not yet physically run): two new DIAGNOSE-ONLY `capture_trace` log lines in
`browser-instrumentation.ts`'s gate #3 branch (stage=`gate3_self_semantic_diagnostic`:
`selfScopeIdentityFound`, `selfScopeIdentityStrategy`, `semanticAlternativeCreated`; stage=
`gate3_descendant_scan_diagnostic`: `foundCount`, `rejectedReason` one of
`no_qualifying_descendant`/`ambiguous_descendants`/`empty_normalized_value`) -- booleans/counts
only, never text/attributes, matching this file's existing diagnostic conventions. 18/18 focal
tests still green, typecheck still 523 baseline. Backend restarted, `/health` confirmed.

CRITICAL NEW FINDING (job bmfdlhy0g, real clean run, jobId 957af3fa): NEITHER
`gate3_self_semantic_diagnostic` NOR `gate3_descendant_scan_diagnostic` was emitted AT ALL for
this real click -- meaning the whole `else if (trustedInteraction === true && originalTarget &&
originalTarget === el && !accessibleName)` branch never even entered. This means my original
premise for gate #3 (the real click's raw DOM target IS the owner div itself, `originalTarget
=== el`) may be WRONG for the ACTUAL production page -- the real click may land on a DEEPER
descendant (matching GATE #1's `originalTarget !== el` shape instead), or `accessibleName` may be
truthy for a reason not yet checked, or `trustedInteraction` may be false for this synthetic
Playwright-driven click via `/api/recordings/:id/control`.

STRONG CORROBORATING CLUE: the log shows `[field-scoped-fallback] status=certified tier=3
strategy=recorded:css associatedField="Tarjeta Crédito Visa Clásica"` repeated many times --
this is a COMPLETELY DIFFERENT, PRE-EXISTING mechanism (an `associatedField` structural walk,
nothing to do with `semanticRuntimeEvidence`/gate #1/gate #3 at all) that DID find the exact
correct label text at capture time. This proves the interaction's `associatedField` field is
correctly set to "Tarjeta Crédito Visa Clásica" via a walk that is NOT `computeOwnOnlySemantic
RuntimeAlternative` -- meaning some OTHER existing code path already partially recognizes this
element, but that path's own resolution still fails at REPLAY (`step 4 status=failed`,
`field_container_not_resolved` seen repeatedly right after for the NEXT step "Solicitar", and
the Visa step itself never shows a "resolved" status in this log excerpt).

ROOT CAUSE FOUND AND FIXED (real backend `.artifacts/tmp/servers/backend.log`, read directly by
Claude, not via Codex narration -- job bpzhuuw8f's run): the boundary diagnostic confirmed, for
the REAL Visa Clásica click: `candidateOrdinalDiagnostic=0, elEqualsOriginalTarget=true,
accessibleNamePresent=false` (gate #3's trigger condition WAS met, confirmed for real) but
`gate3_self_semantic_diagnostic` showed `selfScopeIdentityFound=false,
semanticAlternativeCreated=false` -- `buildOwnScopeIdentity` found nothing. Traced further: it
requires `structuralIdentity.stableDescendants`, but `structuralIdentity` is only ever computed
when `shouldCaptureStructuralEvidence` (`editable || actionable || frameworkActionable || ...`)
is true. The REAL Visa card div has NO `role` attribute (unlike every test fixture this session,
which all used `role="button"` for convenience) and NO `onclick` DOM attribute/property (a real
React `onClick` handler is attached via React's own synthetic event system, never as `el.onclick`
or an `onclick` HTML attribute) and no `tabIndex`/id/data-testid -- so BOTH `actionable` and
`frameworkActionable` are false for this exact real-world shape, `structuralIdentity` is never
computed at all, and gate #3's css-fallback has nothing to search. This is the TRUE root cause,
confirmed with real production log data, not test-fixture convenience shapes.

FIXED (`capture-engine-v2.browser-instrumentation.ts`): added gate #3's own trigger condition
(`isGate3Candidate = trustedInteraction && originalTarget === el && !accessibleName`) directly
into `shouldCaptureStructuralEvidence`, so structural evidence (and `stableDescendants`) gets
computed for exactly this shape, independent of the stricter actionable/frameworkActionable bar.
New regression test 17 (`capture-engine-v2.semantic-runtime-evidence.test.ts`) reproduces the
EXACT real-world shape (owner div with NO role/onclick attribute/tabIndex/id/data-testid at all
-- every prior test 14-16 used `role="button"` for convenience, which accidentally made them pass
even before this fix and never caught this gap) -- 19/19 focal tests green including it.
Typecheck: hit the recurring backtick-in-comment TS1005/TS1443 parse error again (this file is
embedded as a template literal elsewhere), fixed by removing backticks from the new comment;
back to 523 baseline, 0 new. Backend restarted, `/health` confirmed.

PARTIALLY CONFIRMED, ONE MORE LAYER FOUND (job bfu8afqad, real backend.log read directly):
`shouldCaptureStructuralEvidence` fix WORKED -- `structuralIdentityPresent=true` now (was false
before). But `stableDescendantCount=0` -- the real Visa card's identifying element carries NONE
of `STABLE_ATTRIBUTE_NAMES` (`id, data-testid, data-test-id, name, href, aria-label,
aria-labelledby, role, data-field, data-column, alt, src`) at all. This means the card's
identity-bearing element is very likely NOT a plain `<img src="...">` (which would always have
`src`) -- possibly a CSS `background-image` div, or a plain-text heading/paragraph with no
attributes -- not yet confirmed which. `buildOwnScopeIdentity`'s css `:has(descendant[attr=val])`
strategy has NOTHING to build a selector from when the descendant carries zero stable attributes,
so it correctly (but unhelpfully) returns undefined -- `computeOwnOnlySemanticRuntimeAlternative`
is never even called (gated behind `if (selfScopeIdentity)`).

THIS IS A GENUINE ARCHITECTURAL GAP, NOT A SMALL MICROFIX: the existing wire contract
(`StructuralScopeIdentity` / `SemanticRuntimeEvidence.scopeAlternatives[].scopeIdentity`) requires
a plain CSS selector string, evaluated via `document.querySelectorAll(value)` at replay
(`target-resolver.ts`) -- there is no existing mechanism to scope-and-verify uniqueness by a
descendant's TEXT CONTENT (only by attribute), and CSS has no standard `:contains()`-equivalent
usable in `querySelectorAll`. Before implementing anything, per the user's own standing rule
("no ampliar un union type a ciegas, primero demostrar que ninguna autoridad existente sirve"):
first confirm the REAL descendant's actual tag/attributes with one more diagnostic (add
`tagName`/`hasTextContent`/`attributeNames` -- CAREFUL: business-text-blind, never log the actual
alt/label VALUE, only structural shape) before deciding whether a text-based scope strategy is
truly required, or whether some existing attribute this session hasn't checked (e.g. `class`,
deliberately excluded from `STABLE_ATTRIBUTE_NAMES` as noted in `normalizeStructuralOwnerIdentity`)
could still work, or whether a completely different existing authority (e.g. the ALREADY-computed
`el`-level `topologySignature`/`semanticShape`) could serve as a non-positional, non-text scope
signal instead of extending anything.

FINAL DIAGNOSTIC ROUND (job b2eztq20y, real backend.log): added a descendant-shape diagnostic
inside `computeOwnOnlySemanticRuntimeAlternative` itself (made it always run for observability,
result only kept when a scope exists -- no behavior change). Result: `foundCount=0,
foundTag="none"` -- the function's OWN descendant scan (via `classifyNativeRoleIdentity` on
tag/explicit-name/textContent/semantic-fragments/heading-fragments, NOT limited to attribute-
bearing elements) found ZERO qualifying descendants. This is more fundamental than the earlier
"no stable attributes" finding: the clicked div has NO recognizable named/texted descendant AT
ALL by any criteria, visible or not.

CONCLUSION: gate #3's entire premise (borrow identity from a descendant INSIDE the clicked
element) does not match this real card's actual DOM structure. The `field-scoped-fallback`
mechanism (a SEPARATE, pre-existing code path, confirmed earlier finding "Tarjeta Crédito Visa
Clásica" as a certified `associatedField`) must be finding the title text via a SIBLING or
ancestor-scoped relation, not a descendant relation -- meaning the real card structure is most
likely: a common wrapper (e.g. `<article>`/`<a>`) containing the clickable div as ONE child and
the title text as a SIBLING child, not nested inside it. Gate #3 (descendant-borrowing) is
architecturally the wrong mechanism for this shape; gate #1 (ancestor-scope, `originalTarget !==
el`) is also not it, since here `originalTarget === el` genuinely holds (confirmed by the
boundary diagnostic). This is a THIRD, distinct relation (sibling-borrowing) that neither
existing gate covers.

SIBLING HYPOTHESIS TESTED AND REFUTED (job bi1mulfha, real backend.log): added
`gate3_sibling_hypothesis_diagnostic` scanning `el.parentElement`'s OTHER children for a
qualifying strong-identity element. Result: `parentPresent=true, siblingChildCount=2,
siblingFoundCount=0` -- `el` has exactly one sibling, and that sibling ALSO doesn't qualify by
`classifyNativeRoleIdentity`. So the title text is neither a descendant (foundCount=0, prior
round) nor an immediate sibling (this round). Two hypotheses ruled out with real evidence.

Where the text actually IS: the pre-existing `field-scoped-fallback` mechanism (NOT gate #1/#2/#3,
a wholly separate structural authority) DOES find "Tarjeta Crédito Visa Clásica" as a certified
`associatedField` for this exact element -- meaning whatever traversal `computeAssociatedField`
(or the field-scoped-fallback's own resolver in `target-resolver.ts`) uses successfully locates
it at SOME structural distance/relation neither descendant nor immediate-sibling covers (could be
a grandparent's other child, a `aria-describedby`/`aria-labelledby` reference, a further ancestor
walk, or a heuristic unrelated to DOM proximity). Read `computeAssociatedField`'s actual
implementation (not yet read this session) and/or `field-scoped-fallback`'s resolver in
`target-resolver.ts` to see EXACTLY what relation it uses -- that is the concrete, already-proven-
working mechanism to reuse or adapt for gate #3, rather than inventing a fourth traversal by guess.

READ `computeAssociatedField`'s source (`capture-engine-v2.browser-instrumentation.ts:267-277`):
it walks UP `el`'s ancestors (up to `MAX_FIELD_CONTAINER_DEPTH`, more than 1 level, unlike my
immediate-sibling-only diagnostic) and at each ancestor level calls `shortLabelChildOf(node, el)`
(not yet read this session) to search that ancestor's OTHER descendants for a short label --
broader than the immediate-parent-children-only sibling scan I tested. BUT: the earlier
`candidate_gate_boundary_diagnostic` already showed `associatedFieldPresent=false` for this exact
element AT CAPTURE TIME too (not just accessibleName) -- meaning `computeAssociatedField(el)`
ALSO returned undefined for this element when actually called during capture. So the
`field-scoped-fallback` that DOES find the text at REPLAY time is NOT reusing anything from
capture at all -- it is `target-resolver.ts`'s own INDEPENDENT live-DOM walk performed fresh
during replay (confirmed: `field-scoped-fallback` is target-resolver.ts's own runtime mechanism,
never fed by the recorded interaction's `associatedField`). This may mean the live replay DOM
differs subtly from the capture-time DOM (e.g., images finish loading and gain `alt` text between
capture and replay, or replay's own field-scoped-fallback logic is simply more powerful/walks
further than `computeAssociatedField`), OR the two mechanisms just use different traversal
depths/breadths for genuinely unrelated historical reasons.

READ `shortLabelChildOf`/`computeAssociatedField` fully
(`capture-engine-v2.browser-instrumentation.ts:250-277`): `shortLabelChildOf(container,
excludeEl)` matches by PLAIN visible `textContent` (any direct child under 60 chars, excluding
input/textarea/select/button/a/svg/path tags) -- broader/simpler than
`classifyNativeRoleIdentity`, and `computeAssociatedField` calls it at EACH of up to
`MAX_FIELD_CONTAINER_DEPTH=4` ancestor levels above `el`. Despite this broader 4-level walk, it
still returned undefined for this element (confirmed: `associatedFieldPresent=false` at capture).
Most likely explanation (not yet confirmed without live DOM access): the guard
`interactiveCount > MAX_FIELD_CONTAINER_INTERACTIVE_DESCENDANTS(4)` at line 272 -- a real product
grid page likely has an ancestor (e.g. the whole card-list container) with MANY interactive
descendants (every card's own buttons/links), skipping `shortLabelChildOf` at exactly the level
that would have found the title, before `MAX_FIELD_CONTAINER_DEPTH` is exhausted. This is a
plausible, testable hypothesis but requires either live DOM inspection (not available to Claude
directly -- would need one more Codex diagnostic reporting the actual `interactiveCount` per
ancestor level) or accepting the risk of a slightly bigger depth/threshold tweak without full
certainty.

CONFIRMED WITH REAL NUMBERS (job bmrpg6si4, real backend.log): depths 0-1 checked (empty),
depths 2-3 SKIPPED because `interactiveCount=5` barely exceeded
`MAX_FIELD_CONTAINER_INTERACTIVE_DESCENDANTS=4` -- exactly the hypothesized cause. FIXED: raised
the threshold to 16 (a normal product-card-grid ancestor routinely has more than 4 sibling
interactive descendants without being some huge page-wide container; no existing test asserts
this specific boundary -- checked `capture-engine-v2.associated-field-source.test.ts` and
friends, none use more than 2 interactive descendants). 59/59 focal tests green (including all
associatedField-precedence and control-identity tests), typecheck still 523 baseline.

IMPORTANT CORRECTION/NEW LEAD -- gate #3/associatedField may not even be the real remaining
blocker: earlier evidence (job bpzhuuw8f log) showed `[field-scoped-fallback] status=certified
tier=3 strategy=recorded:css associatedField="Tarjeta Crédito Visa Clásica"` -- meaning
target-resolver.ts's OWN, SEPARATE `field-scoped-fallback` mechanism ALREADY successfully
resolves a scope for this element AT REPLAY TIME, independently of anything captured (it recomputes
associatedField fresh from the live DOM during replay, not from the recorded interaction) -- yet
step 4 STILL failed with `CLICK_NO_CAUSAL_EFFECT_DETECTED` right after that "certified" line. This
means the REAL remaining blocker may be downstream of field-scoped-fallback's OWN resolution --
i.e., whatever executes the click for a field-scoped-fallback-certified target may be clicking the
wrong element or failing to trigger the app's handler, a bug UNRELATED to gate #1/#2/#3 or
`semanticRuntimeEvidence` entirely. My `MAX_FIELD_CONTAINER_INTERACTIVE_DESCENDANTS` fix may help
gate #3's OWN capture-time associatedField-awareness but has NOT been physically confirmed to fix
the replay failure, since the failure may be in a completely different code path.

TRUE REMAINING BLOCKER IDENTIFIED (job bxu4opem5, real log sequence read directly): between
`field-scoped-fallback status=certified` and `CLICK_NO_CAUSAL_EFFECT_DETECTED`, the SAME
"certified" line repeats 9 times (retries), each `tier=3 strategy=recorded:css
recoveredFromAmbiguousTier1=true acceptedScopeActuallyUsed=true` -- then the executor moves on to
step 5 ("Solicitar", `field_container_not_resolved` many times) and finally reports
`CLICK_NO_CAUSAL_EFFECT_DETECTED` for step 4. `semantic-runtime-match reason lines: none`
(confirmed absent again -- separate from this issue). ALSO confirmed: my
`MAX_FIELD_CONTAINER_INTERACTIVE_DESCENDANTS` fix DID work at capture time
(`associated_field_depth_diagnostic` now shows `found:true, foundAtDepth:3` for this exact
element), but that capture-time value is UNUSED by this replay path (field-scoped-fallback
recomputes everything fresh from the live DOM at replay).

Read `target-resolver.ts:4580-4658` (the `acceptedScopeActuallyUsed=true` certification branch
that fired for this exact run): it returns `reconfirmedScope` -- a locator built from
`scopeScoped.scopedDescendantLocator`, i.e. a DESCENDANT inside the certified container, NOT
necessarily the container/owner itself. The code's OWN comment at lines 4634-4646 explicitly
documents this EXACT prior incident: "job 7af1bdaf: tier=3, recoveredFromAmbiguousTier1=true,
acceptedScopeActuallyUsed=true certified, then the click's actual post-condition
(`/product-extended`) was never reached -- the certified node was not the recorded field's own
element." That prior fix changed the IDENTITY CHECK to validate against `containerRoot`'s text
instead of the descendant's (to avoid false-rejects for icon-only click targets), but apparently
did NOT change WHAT GETS CLICKED -- `reconfirmedScope.locator` (the descendant) is still returned
and clicked, mirroring EXACTLY the `clickScopeElement` bug this session already fixed for gate #3,
but in this separate, pre-existing `field-scoped-fallback` resolver.

NEXT (fresh session/iteration -- this is now the clearest, best-evidenced next fix): read
`materializeFieldScopedTechnicalTarget` (not yet read) to understand what
`scopeScoped.scopedDescendantLocator` vs `scopeScoped.selfOwner`/container actually represent, and
whether the container/owner element itself (not its descendant) is what should be clicked when
`acceptedScopeActuallyUsed=true`. If confirmed analogous to gate #3's bug, the fix is the same
shape: click the CONTAINER (`containerRoot`), not the resolved descendant, when the descendant was
only used to prove the container's identity/uniqueness -- but verify this doesn't break the
`scopeScoped.selfOwner` case (line 4647 already treats that differently: "when there is no
separate container (self-owner scope), the resolved element IS the container" -- suggesting the
codebase already half-understands this distinction). Add regression tests before any physical
dispatch; this is pre-existing code this session did not introduce, so extra care/smaller diff is
warranted. This is very likely the FINAL boundary before promotion -- once fixed, rerun the
standard validation sequence (focal tests, typecheck, backend restart, fresh Codex dispatch via
`/api/recordings/:id/execute`, then discovery:preview replay, then a second fresh confirmatory run
per `physicallyConfirmedTwice=true` policy) before considering the case promoted.

All prior fixes this session remain correct and necessary for the shapes they target -- do not
revert: alt-attribute support, gate #1 css-scope fallback, gate #2 shadow-bridge fix, gate #3's
own-descendant borrowing + role propagation, clickScopeElement replay-target fix, two
discovery-preview.ts crash guards, semanticRuntimeEligible ambiguous-locator exception,
shouldCaptureStructuralEvidence gate #3 trigger. This session found and closed FIVE real,
confirmed gaps in the capture->persist->replay pipeline; the ONE remaining gap (this element's
identity comes via `associatedField`, not descendant/sibling DOM proximity) is now precisely
characterized with real evidence, not a guess.

Session-long summary of every REAL fix made and confirmed (do not re-open without contradicting
evidence): (1) alt-attribute accessible-name support. (2) Gate #1 css-scope fallback +
innermost-match fix. (3) Gate #2 shadow-bridge technicalEvidence fix. (4) Gate #3 capture-time
identity borrowing (own-descendant scan) + role propagation. (5) clickScopeElement replay-target
fix (click the owner, not the borrowed descendant). (6) Two discovery-preview.ts crash guards.
(7) semanticRuntimeEligible ambiguous-locator exception for clickScopeElement. (8) gate #3's
shouldCaptureStructuralEvidence fix (this iteration). All eight: typecheck stays at 523
pre-existing baseline throughout, 0 new errors ever introduced; 100+ focal unit tests green.
The ONE remaining gap (attribute-less identity descendant) is real, precisely diagnosed, and
requires a deliberate design decision, not a rushed patch.

SUMMARY of this session's REAL, tested fixes (do not re-open without contradicting evidence):
(1) Gate #3 capture-time identity borrowing (browser-instrumentation.ts) -- PHYSICALLY PROVEN,
real recording navigated correctly. (2) clickScopeElement replay-target fix (target-resolver.ts)
-- unit-tested, logically required. (3) Two real crash-guard bugs in discovery-preview.ts
(unguarded `.map`/`.join` on a recording-derived virtual case) -- fixed, typecheck clean.
(4) `semanticRuntimeEligible` gate in canonical-recording-contract.ts wrongly vetoing gate #3
evidence via the owner's own ambiguous locator -- fixed, unit-tested (6/6), and confirmed via
code-path tracing to be the SAME functions the real `/execute` pipeline uses (high confidence,
not yet independently physically reconfirmed end-to-end due to Codex's own script instability).
All four fixes: typecheck stays at the 523 pre-existing baseline, 0 new errors, across every
change. Two pre-existing unrelated test failures identified and ruled out via `git stash`
comparison (not caused by this session).

Session summary of REAL, tested, physically-partially-confirmed fixes so far (do not re-open
without contradicting evidence): (1) Gate #3 capture-time identity borrowing
(browser-instrumentation.ts) -- PHYSICALLY PROVEN, real recording navigated correctly when driven
directly. (2) clickScopeElement replay-target fix (target-resolver.ts) -- reroutes replay click to
the owner, unit-tested, logically required once (1) works. (3) Two real crash-guard bugs in
discovery-preview.ts (`vc.steps`/`vc.preconditions` unguarded `.map`/`.join` on a
recording-derived virtual case with empty `recordingExecutionContract.actions`) -- fixed,
typecheck clean. (4) `semanticRuntimeEligible` gate in canonical-recording-contract.ts wrongly
vetoing gate #3 evidence via the owner's own ambiguous locator -- fixed, unit-tested (6/6), but
NOT YET physically confirmed as sufficient on its own -- the transport chain has at least one more
undiscovered gap downstream.

---

TRUE root cause found and fixed (capture-time, not replay-time): `explicitAccessibleName()` in
`src/recording/web/capture-engine-v2.browser-instrumentation.ts` never read the `alt` attribute
(the native, explicit accessible-name source for `img`/`area`/`input[type=image]`, same tier as
`aria-label`). A clickable, unlabeled `<img>` therefore had no explicit name to classify, fell
through to the no-textContent "none" branch, and was captured only as an unlabeled structural
"control" — never as a `role:img|<name>` identifier — even though `getByRole('img', { name:
<alt> })` resolves it correctly and uniquely at runtime (authoritative manual Playwright
evidence). `resolvedRole` already correctly derives `img` via `nativeRole()`; only the name was
missing. Fixed generically by attribute (alt), never by tag/business text. 7/7 focal tests green
(4 new: `capture-engine-v2.native-alt-name.test.ts`; 3 pre-existing analogous
`input[type=submit].value` tests still green — no regression). Typecheck: no new errors.

captureSemanticRoleFix=true
existingRecordingHasRequiredEvidence=false — the fix is capture-time; the existing persisted
recording (job 7af1bdaf / REC-3F3935CC) was captured with the OLD `explicitAccessibleName` and
never persisted an alt-derived name/role ref for this control, so replaying it cannot benefit
retroactively.
existingRecordingReusable=false
reRecordRequired=true — needs a NEW recording pass over the same scenario before a fresh replay
can show `candidateRole=img`/`recordedRefsPresent=true` for this action. Not yet performed (out
of this session's control — recording capture is a separate live-interaction step, not a
discovery-preview replay).
UPDATE: alt-name fix confirmed necessary but NOT sufficient. Fresh recording (post-fix, post
backend-restart) still shows the Visa Clásica action as an unlabeled "control" with
`semanticRuntimeEvidencePresent=false`/`semanticCaptureMatchCountClass=zero`. Root cause of THIS
second layer: `computeSemanticRuntimeAlternative` (capture-engine-v2.browser-instrumentation.ts,
~line 569) is only ever attempted when the chosen functional owner (here a plain `<div>` with a
click handler, no semantic role of its own) has an `id` or `data-testid` attribute
(`ownScopeIdentity` gate, ~line 570-576) — a React/Tailwind `div`-with-onClick owner almost never
has either, so the semantic-descendant search (which itself works fine and doesn't need
id/testid internally) never even runs. A `{ strategy: "structural", ... }` scope-identity
fallback was drafted using the owner's own already-computed, already-unique `structuralIdentity`,
but REVERTED before commit: `scopeIdentity.strategy` is a closed type union
(`"id" | "data-testid" | "css"`, in `session-trace.types.ts` and `structural-owner-identity.ts`)
with downstream consumers (`capture-engine-v2.action-owner-resolver.ts` and others) that only
switch on those three values — adding a fourth variant safely requires updating the type and
every consumer, which is bigger than a single-file microfix and was not completed this session.
An alternative within the existing `"css"` strategy (building an attribute-selector CSS string
from the SAME `fingerprintAttributeNames` list already used elsewhere, e.g. `data-field`/`role`/
`name`, verified unique via `querySelectorAll`) is the more promising next attempt, but this
specific owner div likely has none of those attributes either (plain Tailwind wrapper) — not yet
confirmed either way.
UPDATE: a SECOND gate found and fixed, in `capture-engine-v2.shadow-bridge.ts` (~line 692-705).
Confirmed this IS the real production path (`onV2TechnicalAction` wired to `web-session-
recorder.ts`'s real `onInteraction`, via the `[capture-v2-lineage] phase=raw_interaction_built`
log — the file's own top comment calling it diagnostic-only describes just its standalone-test
usage, not production wiring). `buildOwnerTechnicalEvidence` returned a truthy-but-empty object
whenever the owner merely HAD a `structuralIdentity` at all, even non-deterministic with 0
locator candidates — falsely satisfying the old `!technicalEvidence` gate and permanently
blocking the semantic-runtime-evidence fallback. Fixed to gate on actual usable authority. 57/57
tests green (2 new). Confirmed via real backend log that a fresh recording after this fix DOES
reach `admissionStatus=accepted, technicalTargetCount=1` for the card action — real progress.

STILL OPEN: the webStep for this card still does not materialize in the derived scenario (4/5
actions, card missing) because a FIRST, earlier gate blocks it before reaching my fix: in
`capture-engine-v2.browser-instrumentation.ts` (~line 569-591), `computeSemanticRuntimeAlternative`
is only ever attempted when the owner element has an `id` or `data-testid` — a plain React/
Tailwind div-with-onClick owner (this card's real shape) has neither, so the semantic search
never runs at the browser level at all. Confirmed physically (`role: null` still in
`[recording-readiness-action]`; `web-session-recorder.ts` line ~221 requires `interaction.role`
truthy to emit a `role`-strategy webStep target, so this action is silently omitted).

A structural-fingerprint scope-identity fallback for this first gate was drafted and reverted
before commit (same reason as before): `scopeIdentity.strategy` is a closed type union
(`"id" | "data-testid" | "css"` in `session-trace.types.ts`/`structural-owner-identity.ts`) with
downstream consumers handling only those three — safely adding a fourth needs the type change
plus every consumer updated, bigger than a single-file microfix, not completed this session.
NEXT: extend the scope-identity type (new safe variant, or a valid `"css"` attribute-selector
built from the owner's other stable attributes if any exist, reusing the existing
`fingerprintAttributeNames` list) so the browser-side search can even be attempted for an
id/data-testid-less framework-actionable owner. This is the true remaining root cause.

## Estado vigente — búsqueda global de Jira desde Grabación (2026-10-05)

Objetivo: permitir buscar casos Jira por clave o título desde el flujo de Grabación sin cambiar cómo el usuario inicia frontend ni backend.

Hallazgo: el frontend QA Lab llama a su BFF en `localhost:3001`; el motor de automatización corre en `localhost:3002`. El motor ya respondía correctamente en `/api/jira/issues/search`, mientras el proceso BFF que atendía 3001 seguía usando la ruta Jira retirada y devolvía HTTP 410.

Cambio: `C:\MisProyectos\QA-lab-main\server\routes\jira.ts` ahora reenvía `/api/jira/issues/search` al motor configurado mediante `SCENARIO_PREVIEW_BASE_URL` y `engineHeaders()`, conservando la ruta que usa el frontend. Si no hay URL de motor, usa la búsqueda Jira local v3. No se cambiaron scripts ni comandos de inicio.

Validación: `npm.cmd run build` en QA-lab-main terminó correctamente; Vite advierte que el bundle principal supera 500 kB. `git diff --check` no reportó errores de whitespace (solo avisos de conversión LF/CRLF). No se ejecutaron pruebas.

Para que el proceso BFF ya abierto cargue el cambio, debe recargarse mediante la rutina habitual con la que el usuario inicia QA Lab. No usar una nueva forma/comando de inicio. El motor 3002 y la URL del frontend permanecen igual.

## Actualización vigente — Jira picker y texto largo en portada del PDF (2026-10-05)

Objetivo adicional: mostrar claramente en el buscador el caso Jira elegido y permitir que el requerimiento largo se ajuste al ancho de la portada del reporte.

Cambios: en `C:\MisProyectos\QA-lab-main\src\pages\Recording\JiraRequirementPicker.tsx`, al elegir un resultado ahora el campo queda con `CLAVE — título`. En `src/evidence/evidence-pdf-generator.ts`, la caja de metadatos de portada permite envolver el requerimiento y crecer según sus líneas; elimina el nowrap que lo hacía salir del margen.

Validación: QA Lab `npm.cmd run build` completó. `git diff --check` en ambos repos no encontró errores de whitespace (solo avisos LF/CRLF). `esbuild` transpila el generador PDF. `npm.cmd run typecheck` del motor continúa fallando con numerosos errores de TypeScript repartidos en pruebas/fixtures y otros módulos preexistentes; esta corrección no modifica esos puntos. No ejecuté pruebas ni generé un reporte de salida en esta revisión.

## Actualización vigente — pasos de ejecución agrupados por pantalla en evidencia (2026-10-05)

Objetivo: después de la plantilla de cada caso, incluir las acciones ejecutadas agrupadas por la pantalla donde ocurrieron, conservando las capturas de evidencia correspondientes tanto en PDF como en DOCX.

Hallazgo: el grabador ya consolidaba varias acciones en una sola captura por pantalla, pero no persistía identidad/título de pantalla por acción y los generadores solo insertaban imágenes. El DOCX tiene dos rutas de generación (Word COM y JSZip); ambas debían incluir el nuevo contenido.

Cambios: `src/evidence/evidence-recorder.ts` asigna identidad estable y título legible de pantalla a acciones y checkpoints; una acción que navega conserva la pantalla donde se ejecutó. `src/evidence/evidence-document-model.ts` agrupa acciones/capturas por bloques consecutivos de pantalla, con compatibilidad para evidencia histórica sin identidad. `src/evidence/evidence-pdf-generator.ts` representa título de pantalla, pasos numerados y capturas, con rótulo de continuación cuando el grupo cruza página. `src/evidence/evidence-docx-generator.ts` añade el paso a paso después de la tabla del caso en Word COM y JSZip, y subtitula las imágenes por pantalla.

Validación: `git diff --check -- src/evidence/evidence-types.ts src/evidence/evidence-recorder.ts src/evidence/evidence-document-model.ts src/evidence/evidence-pdf-generator.ts src/evidence/evidence-docx-generator.ts` terminó sin errores. TypeScript focalizado terminó correctamente: `.\\node_modules\\.bin\\tsc.cmd --noEmit --strict --target ES2022 --module CommonJS --moduleResolution Node --esModuleInterop --skipLibCheck --types node,@playwright/test src/evidence/evidence-types.ts src/evidence/evidence-recorder.ts src/evidence/evidence-document-model.ts src/evidence/evidence-pdf-generator.ts src/evidence/evidence-docx-generator.ts`. No ejecuté pruebas ni generé un PDF/DOCX de muestra.

Pendiente/limitación: falta verificar visualmente un reporte generado con evidencia real. No se cambió el comando ni el flujo de inicio del backend/frontend. Próximo paso concreto: cuando se genere el siguiente reporte, confirmar que los pasos y capturas queden agrupados por pantalla y que la captura final significativa permanezca al final.

## Actualización vigente — checkpoints de filas completas en evidencia (2026-10-05)

Objetivo: corregir capturas de `manualCreationTable` que se guardaban antes de llenar “Fecha de Ingreso” y parecían duplicar la misma pantalla.

Causa confirmada: `src/evidence/screen-settle.ts` marcaba como completa una fila editable al llegar al 80 % de controles llenos. En el job `4423edd8-e0f3-4198-83bf-4ad3e412b9fe`, ambas capturas se dispararon tras llenar Celular mientras la fecha de ingreso seguía con placeholder; la segunda mostraba además una fila nueva incompleta. Los PNG tienen SHA-256 distinto: son estados tempranos parecidos, no duplicados idénticos.

Cambio: las filas con controles editables ahora solo forman checkpoint cuando todos sus controles visibles y habilitados tienen valor. Para las filas que ya se muestran como texto, se exige que todas las celdas de datos tengan valor, excluyendo selección de fila y menú de acciones. El criterio es transversal para las aplicaciones que usan el capturador de evidencia; no altera la ejecución de escenarios.

Validación: compilación focalizada de `src/evidence/screen-settle.ts` con `tsc --noEmit --strict ...` completó; `git diff --check -- src/evidence/screen-settle.ts` completó sin errores. No ejecuté pruebas ni repetí el job. Próximo paso: en la próxima evidencia, verificar que cada captura de fila aparezca después del valor de Fecha de Ingreso.

## Actualización vigente — preservar la tabla ante navegación tardía (2026-10-05)

Objetivo: conservar la imagen de `manualCreationTable` con los dos clientes, aunque la navegación que sigue a “Validar” termine después de la captura del último paso.

Evidencia del job `bf790df6-71a4-4893-b851-ef05a31c6179`: el PDF lista 22 acciones de la tabla pero no incluye su imagen; `evidence.json` asignó esos 22 pasos a `step-028-clic-en-validar.png`. El log muestra que la captura del último paso vio todavía la pantalla anterior y que, durante el cierre, la navegación ya había avanzado a `payroll/loadingList` y luego a `payrollInProcess`. El primer límite perdido es la finalización del grupo: se usó la captura tardía para toda la tabla, en lugar de la última captura estable de esa pantalla.

Cambio: `src/evidence/evidence-recorder.ts` compara la identidad de pantalla al finalizar. Si la navegación asíncrona ocurrió después del último paso registrado, asigna las acciones pendientes a la última captura estable y guarda la pantalla resultante como checkpoint final separado. `src/evidence/screen-settle.ts` conserva el criterio estricto de fila completa; el nuevo cierre evita que una falta de checkpoint intermedio borre la tabla.

Validación: `tsc --noEmit --strict ... src/evidence/evidence-recorder.ts src/evidence/screen-settle.ts` y `git diff --check` terminaron correctamente. No ejecuté pruebas ni hice replay físico. Próximo paso: verificar en el próximo reporte que la tabla de dos clientes preceda a la pantalla resultante de “Validar”.

## Actualización vigente — periodo mes-año en portada de evidencias (2026-10-05)

Objetivo: reemplazar solo el guion independiente de la portada por `MM-YYYY` (por ejemplo `10-2026`), sin cambiar las fechas completas de los casos ni otros guiones del documento.

Hallazgo: la portada PDF dibuja el marcador con el literal `-` en `src/evidence/evidence-pdf-generator.ts`. Los DOCX basados en plantilla conservan el mismo marcador en dos nodos XML equivalentes (texto de la forma y fallback VML); el reporte legado usa Docxtemplater con la plantilla `data/templates/Formato Evidencias.docx`.

Cambios: `src/evidence/evidence-cover-period.ts` genera el periodo y reemplaza únicamente los nodos de guion del tramo de portada. El PDF usa ese periodo en su ubicación existente; la generación DOCX actualiza la salida después de Word COM o JSZip, y el flujo legado de Docxtemplater aplica el mismo reemplazo. No se modificaron los valores de Fecha de cada caso ni el diseño/ubicación del campo.

Validación: compilación focalizada de TypeScript para los módulos de periodo, PDF, DOCX y reporting, y `git diff --check`, ambos completaron. No ejecuté pruebas ni generé un reporte nuevo. Próximo paso: verificar en el próximo reporte que solo la portada muestre `10-2026`.

## Actualización vigente — validar pantalla posterior al acceso (2026-10-05)

Objetivo: corregir en los reportes de todos los proyectos el paso engañoso “Validar que se muestre Contraseña” cuando la evidencia de ese paso corresponde al dashboard o menú principal, incluyendo Fénix.

Primera pérdida: en `evidence.json` de la ejecución `0bcd80c5-d642-48b0-bbed-ad567a51cadf`, el paso conservó como objetivo técnico `role:textbox|Contraseña*`, mientras la pantalla asociada tiene título `Pantalla dashboard`. El modelo compartido agrupaba la acción sin revisar esa combinación y el reporte imprimía literalmente la validación del campo, aunque la pantalla ya era la principal autenticada.

Cambio: `src/evidence/evidence-document-model.ts` ahora convierte esa validación solo cuando el objetivo es un campo de autenticación y el título observado identifica dashboard/home/inicio/menú/principal. El texto compartido queda “Validar que se muestre la pantalla principal.”; por usar el modelo común aplica igual a PDF, DOCX y todos los proyectos. No cambia la aserción ejecutada ni inventa una pantalla para otros casos. Se añadió cobertura a `src/evidence/evidence-pdf-generator.test.ts`.

Validación: `git diff --check` para ambos archivos completó sin errores. `npm.cmd run typecheck -- --pretty false` sigue fallando por numerosos diagnósticos preexistentes en otras pruebas/fixtures; no reportó errores en los dos archivos modificados. No ejecuté pruebas ni regeneré evidencia, según la instrucción del repositorio.

Próximo paso: confirmar que el siguiente reporte de Fénix o portal empresarial muestre la validación de la pantalla principal encima de la captura del dashboard.

## Actualización vigente — detalle y descargas de ejecuciones archivadas (2026-10-05)

Objetivo: habilitar “Ver reporte” y “Descargar documento” cuando la lista de Ejecuciones recupera un job finalizado desde el historial persistido después de reiniciar el servidor.

Primera pérdida: el job `df5e6772-04c4-4c02-864d-7c8d1fadb7da` existe en `.artifacts/qa-lab-run-history` con estado `done`, 3 aprobados, y conserva `evidence-run.json`, PDF y DOCX. El listado ya lo mostraba desde el historial, pero `buildExecutionSummary` solo resolvía detalle desde el manifiesto de lanzamiento o `scenario-preview-runs/<id>/job.json`; faltaban ambos, por lo que `/api/executions/:launchId` devolvía `execution_not_found`. La UI no recibía `evidenceAvailable` y dejaba los botones deshabilitados.

Cambio: `src/server/services/execution-summary.service.ts` reconstruye el resumen para jobs terminales archivados usando el historial de job y el `evidence-run.json` asociado. Recupera título/estado/conteos/escenarios y comprueba la evidencia persistida, para que el detalle y la habilitación de descargas concuerden con el listado.

Validación: compilación TypeScript focalizada del servicio completó. `git diff --check` completó sin errores. Smoke check directo de `buildExecutionSummary` para el job reportado devolvió `found=true`, `status=completed`, `total=3`, `passed=3`, `scenarios=3`, `evidenceAvailable=true`. No ejecuté suites de pruebas.

Próximo paso: reiniciar el backend con el mismo comando habitual y refrescar la pantalla de esa ejecución; los enlaces deben aparecer habilitados y abrir el detalle/documento.

## Actualización vigente — conservar Jira y TestRail en ejecuciones de Grabación (2026-10-05)

Objetivo: al ejecutar escenarios seleccionados desde Grabación, conservar la HU elegida y el destino TestRail para mostrar sus datos en Ejecuciones y usar el requerimiento en el documento.

Primera pérdida: `POST /api/recordings/execute-batch` ya recibía `jiraIssue` y `testRailDestination`, pero el job padre guardaba solo `evidenceRequirement` y el historial durable de `job-store.ts` filtraba las claves Jira/TestRail. Al reconstruir el resumen, la HU y el destino quedaban vacíos. La pantalla de Ejecuciones adjunta demuestra esos campos vacíos aunque el panel anterior tenía AA-89 y destino TestRail seleccionados.

Cambios: `src/server/routes/recordings.ts` guarda clave/título de Jira, IDs y nombres de destino TestRail, sección y texto combinado del requerimiento en el job padre; consulta el nombre/suite de sección por ID cuando faltan. `src/server/jobs/job-store.ts` conserva esos metadatos seguros en el historial durable. `src/server/services/execution-summary.service.ts` devuelve Jira y nombres/IDs TestRail desde historial, preview o manifiesto.

Validación: TSC focalizado para `recordings.ts`, `job-store.ts` y `execution-summary.service.ts` completó al incluir la augmentación `src/server/middleware/auth.ts`. `git diff --check` completó sin errores. No ejecuté pruebas ni repetí una ejecución física.

Pendiente/limitación: para ejecuciones nuevas, confirmar que la solicitud del frontend incluya los nombres de proyecto/suite si se desea mostrarlos; los IDs quedan persistidos y el backend recupera el nombre de sección. Próximo paso: reiniciar backend, lanzar desde Grabación con Jira y TestRail elegidos y revisar que detalle y documento muestren esos datos.

## Actualización vigente — crear Test Run y reportar resultado en reutilización de Grabación (2026-10-05)

Objetivo: crear un Test Run para la ejecución reutilizada desde Grabación y enviar a TestRail el resultado de cada caso.

Primera pérdida: la ruta rápida `POST /api/recordings/execute-batch` resuelve casos existentes y ejecuta el spec promovido, pero `startReuseExistingPromotedSpecRun` registra explícitamente `publishToTestRailInvoked=false`; no había llamada a `addRun` ni sincronización de resultados. El runner estándar solo crea Runs cuando `createTestRun === true`, bandera que la ruta de Grabación no transporta.

Cambios: `src/server/routes/recordings.ts` crea un Test Run con los IDs de casos seleccionados en la ruta pura de reutilización, guarda ID/URL para Ejecuciones y retorna error 409/502 explícito si faltan mapeos o TestRail falla al crear el Run. `src/server/jobs/scenario-preview-runner.ts` reporta Pass/Fail por cada caso asociado mediante `syncDiscoveryResultToTestRail` y conserva en el resumen el Run creado y los conteos sincronizados.

Validación: TSC focalizado de `recordings.ts`, `scenario-preview-runner.ts`, `job-store.ts` y `execution-summary.service.ts`, con la augmentación `src/server/middleware/auth.ts`, completó correctamente. `git diff --check` para los archivos de la corrección completó sin errores. No ejecuté pruebas ni una ejecución física.

Alcance/pendiente: la creación explícita se aplica al camino de reutilización que ejecutó el caso reportado; el flujo mixto o de generación conserva su ciclo existente. Próximo paso: reiniciar el backend y ejecutar un caso reutilizado; confirmar un log `[testrail-run] created id=...` y `[testrail-sync] ... status=synced`, y que Ejecuciones muestre Run y cantidad reportada.

## Seguimiento — conservar IDs de casos publicados para Test Run (2026-10-05)

Incidente: `POST /api/recordings/execute-batch` devolvió `TESTRAIL_CASES_UNAVAILABLE` después de publicar o reconciliar escenarios para TestRail. La ruta exigía que una consulta de resolución posterior devolviera `status=existing` y descartaba los IDs que el publicador acababa de devolver.

Cambio: `src/server/routes/recordings.ts` conserva el `caseId` del resultado `created`, `reconciledCreated` o `skippedAlreadyPublished` y lo pasa al escenario reutilizado. Así el Test Run usa la identidad canónica devuelta por la operación de publicación sin depender de una segunda lectura inmediata.

Validación: TSC focalizado para `recordings.ts`, `scenario-preview-runner.ts`, `job-store.ts` y `execution-summary.service.ts` completó; `git diff --check` completó. No ejecuté pruebas ni replay físico. Próximo paso: repetir la ejecución de Grabación; debe crear el Run y luego sincronizar resultado, o devolver el error original del publicador si no logró resolver/crear un caso.

## Actualización vigente — enlazar TestRun con Jira seleccionado (2026-10-05)

Objetivo: que el TestRun creado para una ejecución desde Grabación quede asociado al Jira elegido y aparezca en el panel TestRail: Runs de esa incidencia.

Primera pérdida: `POST /api/recordings/execute-batch` ya recibía y persistía `jiraIssue.key`, y `add_run` incluía `refs`; sin embargo, la ruta no reafirmaba la referencia después de crear el Run. La creación estándar de `scenario-preview-runner.ts` tampoco enviaba la clave Jira al crear el Run.

Cambios: `src/server/routes/recordings.ts` ahora incluye la clave Jira en el nombre y descripción del Run, crea el Run con `refs` y llama `update_run` con la clave seleccionada antes de iniciar la ejecución reutilizada; registra el vínculo en el log del job. `src/server/jobs/scenario-preview-runner.ts` aplica el mismo patrón para la creación estándar cuando el job contiene `jiraKey`.

Validación: TSC focalizado para `recordings.ts`, `scenario-preview-runner.ts`, `job-store.ts` y `execution-summary.service.ts`, incluyendo `src/server/middleware/auth.ts`, completó con código 0. `git diff --check` en los dos archivos modificados completó con código 0. No ejecuté pruebas ni una ejecución física.

Pendiente/limitación: hace falta una ejecución nueva con una HU seleccionada y acceso al TestRail/Jira de QA para confirmar que aparece en el panel TestRail: Runs. Próximo paso: reiniciar el backend y lanzar desde Grabación con la incidencia Jira seleccionada.

## Actualización vigente — detector de éxito funcional para promoción de spec (2026-10-05)

Objetivo: diagnosticar por qué falló la promoción del escenario de transferencias de Fénix en la ejecución `124153aa-3f2b-4242-8450-91cedb00cd99` (preview `d6a82527-21c3-4f4d-9c20-97a3434e2bee`).

Primera pérdida: no fallaron la validación estructural, TypeScript ni Playwright discovery; falló el gate de ejecución funcional en el último paso. El spec esperaba una señal de finalización, pero el detector de `promoted-spec-runtime.ts` solo revisaba diálogos, alertas y elementos con roles/clases concretas. La captura `.artifacts/promoted-runtime/step-030.png` muestra el comprobante con “Transacción Exitosa” dentro del contenido principal, aunque el texto no estaba en los selectores inspeccionados. La URL permaneció igual, por lo que no se activó la alternativa de cambio de ruta.

Cambio: `src/automations/runtime/promoted-spec-runtime.ts` ahora también evalúa las líneas de texto visibles del landmark `main` (o del body cuando no existe) con el patrón genérico de resultado exitoso, y deduplica las coincidencias. Esto permite detectar resultados positivos en pantallas cuyo éxito no está dentro de un diálogo/alerta ni en un encabezado semántico, sin una regla específica para Fénix.

Validación: TSC focalizado `.\\node_modules\\.bin\\tsc.cmd --noEmit --target ES2022 --module CommonJS --moduleResolution Node --esModuleInterop --skipLibCheck --strict --types node,@playwright/test src/automations/runtime/promoted-spec-runtime.ts` terminó con código 0. `git diff --check -- src/automations/runtime/promoted-spec-runtime.ts` terminó con código 0. No ejecuté pruebas ni replay físico, conforme a las instrucciones del repositorio.

Próximo paso: repetir físicamente el caso y confirmar que el último paso reconoce la pantalla de comprobante como señal positiva y permite pasar el gate funcional.

## Actualización vigente — crear TestRun para lotes mixtos de Grabación (2026-10-05)

Objetivo: corregir la ausencia de TestRun cuando una ejecución de Grabación combina escenarios con spec promovido y escenarios que pasan por generación.

Primera pérdida: el log `d4398691-eea1-4e2f-8aba-1e5e51f25263` confirma `reuseCount=1 fallbackCount=1`. En `src/server/routes/recordings.ts`, la creación de TestRun estaba condicionada a `reuseScenarios.length > 0 && fallbackScenarios.length === 0`; el lote mixto saltaba `add_run` y entraba directo a `startMixedRerun`.

Cambios: `recordings.ts` ahora reúne los `caseId` resueltos de todos los escenarios seleccionados y crea un único TestRun cuando se eligió destino TestRail, incluso en lotes mixtos. Si falta el caso de algún escenario, devuelve `TESTRAIL_CASES_UNAVAILABLE` antes de iniciar una ejecución sin Run. `src/server/jobs/mixed-rerun-orchestrator.ts` propaga el `testRunId` a ambos hijos y preserva la metadata del Run en los resúmenes de inicio y cierre.

Validación: TSC focalizado para `recordings.ts`, `mixed-rerun-orchestrator.ts`, `scenario-preview-runner.ts`, `job-store.ts` y `execution-summary.service.ts`, incluyendo `src/server/middleware/auth.ts`, completó con código 0. `git diff --check` para los dos archivos modificados completó con código 0. No ejecuté pruebas ni una corrida física.

Próximo paso: lanzar un lote mixto desde Grabación y confirmar el log `[testrail-run] created id=...`, que Ejecuciones muestre ese Run y que el Run aparezca bajo la HU seleccionada.

## Seguimiento vigente — sincronizar resultados de casos fallback en TestRail (2026-10-05)

Objetivo: hacer que TestRail marque resultados de Recording para escenarios que ejecuta `scenario-preview`, tanto si el lote es mixto como si contiene solo fallback.

Primera pérdida: el job `545a16da-6aeb-4bff-be68-197abef03b7a` creó TestRun `4539`, pero su `case_finished PREVIEW-001 status=failed` produjo `[testrail-sync] skipped ... reason="no_matching_case_id"`: el runner recibió el Run pero no los `publishedCases` que normalmente conectan `PREVIEW-001` con el caso TestRail. La misma ejecución falló funcionalmente en el paso 15, `target_not_found` para la acción grabada `id:profile-name` (“el control grabado”); el paso 14 sí navegó a `/onlinebanking/QueryBank/Summary`. Son fallos separados: el caso debe reportarse aunque la automatización haya fallado.

Cambio: `recordings.ts` guarda en el job padre el mapa escenario→caso TestRail. `scenario-preview-runner.ts` incorpora al mapa de resultados los IDs de ejecución `PREVIEW-nnn` por posición estable y sincroniza con `testRunId`; refleja los sync exitosos en el resumen. `mixed-rerun-orchestrator.ts` pasa esa asociación al hijo fallback, que ahora ejecuta el sync común del runner (sin una segunda llamada desde el padre).

Validación: TSC focalizado de `recordings.ts`, `mixed-rerun-orchestrator.ts`, `scenario-preview-runner.ts` y `auth.ts` completó con código 0; `git diff --check` completó. No ejecuté pruebas ni replay físico. Próximo paso: repetir el caso y confirmar `[testrail-sync] recording mappings ready count=1`, seguido de `[testrail-sync] scenario=PREVIEW-001 caseId=... status=synced` y el caso Failed en TestRun. La acción `profile-name` sigue sin verificación funcional y requiere evidencia de replay tras corregir el reporte.

## MICROFIX vigente — aceptar `id:profile-name` del ref certificado (2026-10-05)

Actualización por rerun `626369f6-b342-4036-8b1c-bb474b7c3aa5` desde el job `cc42b774-57a4-4fc5-9605-e6f4fd74d008`: Discovery ya resuelve y ejecuta el paso 15 con el ref `id:profile-name`; el gate de promoción falla durante la ejecución funcional del spec. El runtime no encuentra locator nativo para la serialización `id:profile-name`, y su callback lanza `Cannot read properties of undefined (reading 'value')`. La causa es doble: el parser `parseSerializedTechnicalTargetString` no incluye `id` en su lista de estrategias admitidas, y `resolvePromotedClickableLocator` no materializa directamente el ref ID antes de las heurísticas de texto/rol.

Cambios: `src/discovery/target-resolver.ts` construye locator para la estrategia `id` y reconoce el ID capturado como identidad estructural directa tras las verificaciones de unicidad, visibilidad y habilitación existentes. `src/automations/runtime/promoted-spec-runtime.ts` admite `id` en el parser serializado y resuelve refs ID certificados antes de heurísticas, con verificaciones de unicidad, visibilidad y habilitación. No introduce selectores de negocio.

Validación de la corrección anterior: TSC focalizado de `target-resolver.ts` completó con código 0; `git diff --check` completó con código 0. Validación actual: TSC focalizado de `promoted-spec-runtime.ts` y `target-resolver.ts` completó con código 0; `git diff --check` de los archivos relevantes completó con código 0 (solo aviso de normalización CRLF del checkpoint). Pruebas y replay físico no ejecutados.

Pendiente: revisar con nuevo replay que el runtime registra `strategy="recorded:id"`, completa el click del paso 15 y permite promoción. El rerun 626369f6 precede a estos cambios del runtime promovido.

## MICROFIX vigente — ocultar contraseñas en pasos de Grabación (2026-10-06)

Objetivo: impedir que una contraseña ingresada aparezca como texto en la lista de pasos del escenario de QA Lab; el screenshot muestra el campo de datos enmascarado y el paso 4 con el valor literal.

Primera pérdida: `applyRuntimeDatasetValues` materializaba cada `valueKey` resuelto con `renderHumanStepValue` sin excluir `sensitive`/`secure_input`; `renderedStep` es la representación consumida por la vista paso a paso. Esto también volvía a exponer el valor al hidratar grabaciones persistidas.

Cambio: `src/recording/canonical-recording-contract.ts` detecta sensibilidad desde el paso o el requisito de runtime, conserva una plantilla con `[valueKey]` y muestra `Ingresar "••••••" en "<campo>"`, sin interpolar el valor. `persisted-scenario-hydration.ts` también aplica esta proyección a grabaciones antiguas sin semantic model.

Validación: TSC focalizado de `canonical-recording-contract.ts` y `persisted-scenario-hydration.ts` completó con código 0; `git diff --check` de ambos archivos completó sin errores. No ejecuté pruebas ni replay físico.

Próximo paso: desplegar/recargar QA Lab y derivar o abrir una grabación con contraseña; verificar que el paso muestre el valor enmascarado y que el campo siga enmascarado.

## MICROFIX vigente — reintentar reemplazo de trace.json en Windows (2026-10-06)

Objetivo: evitar que un `EPERM` transitorio en `renameSync` detenga la grabación al persistir un evento.

Primera pérdida: `saveTrace` escribe desde los callbacks de eventos y pantallas; `writeRecordingJson` ya consideraba `EPERM` transitorio, pero reintentaba tres veces inmediatamente, sin dar tiempo a que Windows liberara un bloqueo temporal sobre el archivo destino.

Cambio: `src/recording/atomic-json-store.ts` hace reintentos acotados con espera incremental (20–400 ms) para errores transitorios y conserva el reemplazo por rename y el archivo previo completo si falla.

Validación: TSC focalizado de `atomic-json-store.ts` completó con código 0; `git diff --check -- src/recording/atomic-json-store.ts` completó sin errores. No ejecuté pruebas ni replay físico.

Próximo paso: volver a grabar y comprobar que se guarda `trace.json`; si persiste el error tras ~770 ms de reintentos, investigar el proceso que mantiene bloqueado el destino.

## Actualización vigente — conservar asociación de campo al proyectar pasos de grabación (2026-10-06)

Objetivo: reparar el único caso fallido del rerun `b2e23db5-e2a2-44d2-b320-85ecc035bda3` y evitar que una acción repetida se vincule a otro campo durante la proyección a Discovery.

Primera pérdida: `PREVIEW-001` falló en el paso 29 al llenar `Correo electrónico` de `entity_2` (`fill_target_not_found`, 0 candidatos editables), por lo que la promoción ni siquiera se intentó. El caso generado conserva `entity_2.correo_electronico` en el contrato de la acción 30. Sin embargo, la proyección eligió una acción secuencial vecina solo por tipo `fill`, permitiendo que un paso de correo quedara vinculado a otro campo cuando las secuencias divergen por una acción de selección consolidada. Los logs muestran que el paso del segundo correo llegó al resolver sin `valueKey` (`key="undefined"`), mientras el primer correo sí llevaba el binding correcto.

Cambio: `src/discovery/case-discovery.ts` ahora admite la coincidencia secuencial solo si también concuerdan el campo semántico y, cuando ambos existen, el `valueKey`. Si no, deja actuar a la correspondencia existente por campo/identidad, que mantiene la entidad de la fila.

Validación: TSC focalizado `.\node_modules\.bin\tsc.cmd --noEmit --target ES2022 --module CommonJS --moduleResolution Node --esModuleInterop --skipLibCheck --strict --types node,@playwright/test src/discovery/case-discovery.ts` terminó con código 0. `git diff --check -- src/discovery/case-discovery.ts docs/ai/00-current-state.md` terminó con código 0 (Git avisó de normalización CRLF del checkpoint). No ejecuté pruebas ni replay físico por las reglas del repositorio y de `qa-lab-low-token-debug`.

Próximo paso: confirmar que el archivo editado compila y el diff es limpio; luego el replay de QA Lab debe mostrar en el paso 29 `valueKey=entity_2.correo_electronico` y una resolución `grid_cell_editor` en la fila correspondiente antes de intentar la promoción.

## Actualización vigente — promover grabación de filas múltiples (2026-10-06)

Objetivo: reparar y promover `REC-7AEE70ED-01` (“Agregar varios empleados manualmente con cédula”) en `portal-empresarial`, verificando que la segunda fila conserve USD y su identidad de entidad.

Primera pérdida: el contrato de selección derivaba `entityScope=entity_2`, pero el compilador determinista no lo escribía en el spec y el runtime no lo reenviaba a la resolución de opciones. La corrida anterior había aprobado Discovery/promoción con un artefacto incompleto en esa propagación. También se detectó que un click nativo tardío al añadir fila podía reintentarse por callback, duplicando la acción.

Cambios: `spec-execution-contract.ts` relaciona la selección con la única acción semántica equivalente y hereda el scope de celdas cercanas; `deterministic-spec-compiler.ts` emite `entityScope`/`rowRelation`; `promoted-spec-runtime.ts` recibe esos campos y evita un callback duplicado cuando observa que el click nativo tardío sí produjo transición. `target-resolver.ts` tipa los motivos de fallo usados por las rutas de selección. Los cambios son genéricos al contrato/runtime y no están condicionados al slug `portal-empresarial`.

Validación: el job solicitado ejecutó Discovery y validación funcional del spec candidato; `.artifacts/scenario-preview-runs/de474685-2b7c-40bf-aaf5-0efa48862711/results.json` reporta `passed=1`, `failed=0`, `promotionStatus=promoted`, `firstPassPromotion=true`, `specWritten=true`. En el spec promovido, el paso 26 “USD” lleva `entityScope: 'entity_2'`; el runtime también resolvió `entity_2.moneda_seleccion=USD`. TSC focalizado de `promoted-spec-runtime.ts`, `spec-execution-contract.ts`, `deterministic-spec-compiler.ts` y `target-resolver.ts` terminó con código 0; `git diff --check` de esos archivos terminó con código 0. No ejecuté suites de pruebas.

Próximo paso: observar el siguiente replay real de grabación y comprobar que la selección y el llenado permanecen asociados a la fila indicada en proyectos adicionales.

### 2026-10-06 -- Continue repository typecheck remediation
Active objective: reduce the 297 repository TypeScript diagnostics without risking working runtime behavior. User constraint: preserve existing behavior; do not change production APIs just to satisfy outdated tests. No tests were run.

Changes in this continuation: updated `tests/knowledge-generation-hints.spec.ts` and `tests/knowledge-generation-hints-functional-relevance.spec.ts` to assert the current `KnowledgeContext` runtime contract: pending HU declarations do not enter executable/runtime hints, while trusted validated knowledge remains available. Corrected fixture data in `tests/promotion-gate-evidence-validation.spec.ts` and `src/automations/promote-plan.spec-generation.test.ts` to provide current required plan fields and narrow optional paths.

Validation: `npm run typecheck` now reports 101 diagnostics (down from 297 at the start of this remediation; 106 after updating knowledge-hint tests, then 101 after fixture corrections). All 101 are in test/spec fixtures or the `tests/diagnose-real-canonical-hu.ts` diagnostic script; no production TypeScript diagnostics. No test suites were run. TypeScript remains failing.

Unresolved: remaining failures include stale fixtures/signatures, optional-value guards, and tests importing removed/private APIs across about 45 files. Next action: repair the remaining failures in small groups against current production types, never by disabling checking or restoring obsolete runtime behavior.

### 2026-10-06 -- Diagnose TestRail job 4552 promotion failure
Active objective: inspect the physical QA Lab run from `.artifacts/scenario-preview-runs/da8d7e38-33de-4963-b09e-ba179c3f6f3e` and identify the first failed boundary. No code changed and no tests or physical run were launched.

Physical evidence: discovery completed the Fenix transfer scenario as `discovered_passed`; promotion was blocked because deterministic candidate functional validation timed out after 300000 ms. `results.json` records `status=failed`, `promotionStatus=spec_failed`, `specWritten=false`, `automationReady=false`. The `trace.zip` is present at `test-results/apps/fenix-sections-api-tests-c-4ba8b-ncias-entre-cuantas-propias/trace.zip`.

First-loss boundary: the promoted candidate's recorded native option selection closes the account dropdown, then Playwright begins an unbounded `waitForSelector` (`timeout=0`, `state=attached`) on the now-hidden option text `Cuenta Corrientes / ...`. Trace call `call@2875` has no corresponding completion before the 300000 ms test timeout. Later `locator.count: Target page ... has been closed` in `dismissSessionExpiringWarningIfPresent` is teardown fallout, not the first failure. The run's first discovery mismatch at step 14 (navigation occurred while a tracking request failed) did not stop discovery; later steps continued, so it is not the promotion gate's first loss.

Next action: inspect the selection verification path in the shared promoted runtime and add a focused regression proving it verifies the native selected value after the option surface closes, rather than waiting for the option text to remain attached. Keep this fix generic across app profiles; do not modify app-specific plans/specs or change the unrelated 101 test-only TypeScript diagnostics.

### 2026-10-06 -- Diagnose TestRail job 4556 Kiosko discovery failure
Active objective: identify the first failed boundary in TestRail run 4556 for case 48995, “Consultar Tarjeta Visa Oro.” No source changes, tests, or new QA job were run.

Physical evidence: `.artifacts/scenario-preview-runs/7fb51379-3424-4944-a288-d441819a6929` and `.artifacts/preview/PREVIEW-001/2026-10-06T19-52-10-457Z/evidence/step-8-snapshot.json`. Discovery passed navigation through step 7, then failed at step 8 while filling “Número de identificación”: `fill_target_not_editable`, selected candidate `<h2>`, and zero editable candidates. The snapshot reports `inputs=0` and contains visible, actionable keypad buttons for digits and letters, so the page is using a virtual keyboard at this boundary. The later repeated readiness polls are fallout from the same unresolved fill.

First-loss boundary: replay/projection treats the captured identification entry as a normal fill even though the live Kiosko screen exposes no editable input. The earlier navigation steps succeeded; promotion was never reached (`specGenerationInvoked=false`, `promotionAllowed=false`). Do not infer a numeric selector or change other apps' behavior from this single run.

Next action: inspect the generic Kiosko virtual-keyboard evidence/contract mapping and ensure the observed key actions bind to the intended identification value only when that keyboard is positively detected. Keep this diagnosis isolated until the user requests a fix; tests and physical QA runs remain unexecuted.

### 2026-10-06 -- Narrow repair for TestRail job 4556 Kiosko keyboard regression
Follow-up to the 4556 diagnosis: source recording `automations/apps/kiosko/recordings/620356af-07e8-4e5e-b13b-633a7fa2f028/trace.json` preserves per-key `virtual_keyboard` evidence on 11 recorded click actions. TestRail presents the same field entry as 11 fill steps. The complete ordered lineage matcher previously accepted virtual-keyboard actions only when the authored step parsed as a click, so this fill-shaped projection lost the recorded keyboard evidence and went to a native editable-field resolver; the live step-8 snapshot has zero inputs and 50 buttons, including the captured key layout.

Change: `src/discovery/case-discovery.ts` now allows a source fill step to align with a recorded virtual-key click only when the full ordered sequence matches and the recorded action has a field label, value key, segment position, and substantial keyboard shape evidence. A confirmed match is routed through the existing virtual-keyboard replay path. Ordinary fills and click matching remain unchanged; the logic does not branch on app slug.

Validation: focused strict TypeScript check of `src/discovery/case-discovery.ts` passed; `git diff --check -- src/discovery/case-discovery.ts` passed. No tests or physical QA job were run. Promotion/replay remains unverified.

Next action: on an explicitly requested QA rerun, confirm step 8 onward replays each recorded key via the captured keyboard evidence, reaches the final “Generar Turno” action, and promotes; then inspect unaffected application behavior only through the requested scope.

### 2026-10-06 -- Diagnose TestRail job 4556 rerun after keyboard-lineage fix
Active objective: explain why rerun `7fb51379-3424-4944-a288-d441819a6929` still failed. This job was launched by the user; I did not run tests or start another QA job.

Physical evidence: attachment `C:\Users\radames\.codex\attachments\da18e412-67f0-4a46-aa43-e3e94f5f7568\Pasted text.txt` shows `[recording-replay] authoredSequenceLineage=true sourceActions=18 contractActions=18`, and discovery finished as `discovered_passed`; the prior keyboard-lineage mismatch at step 8 is no longer the first failure. The failure moved to deterministic spec/contract generation: required fill steps 8–18 have `implementationSource=scenario planMatched=false`; each is rejected by `[pre-ai-gate] technical_target_not_materializable`; the contract has 11 `uncertifiedRequiredTargets`, and promotion stops with `execution_contract_invalid`, `specWritten=false`, and `promotionAllowed=false`.

First-loss boundary: lineage now identifies the 11 recorded virtual-keyboard click actions as corresponding to the human-authored fill sequence, but execution-contract/spec materialization still serializes the scenario projection as 11 ordinary fills and does not carry the captured keyboard click authority/target into the validated plan. This is a promotion-gate failure after discovery, not a demonstrated app interaction failure.

Next action: inspect the scenario-to-validated-plan/execution-contract bridge for this exact evidenced virtual-keyboard sequence. Preserve ordinary fill behavior and require the same positive full-sequence/evidence match before translating its contract operations; do not loosen the general technical-target gate. No code changed in this diagnosis; tests and new QA jobs were not run.

### 2026-10-06 -- Multiproject virtual-keyboard promotion bridge
Objective: continue rerun `7fb51379-3424-4944-a288-d441819a6929` failure through the exact contract-materialization boundary, with no app-specific conditions. The job was user-run; no physical QA job was started here.

Change: `src/automations/spec-execution-contract.ts` now binds authored fill steps to validated-plan click steps only for a complete contiguous character sequence with matching field, `valueKey`, 1-based positions, captured keyboard shape, and unique evidence. Bound actions carry the recorded target, `valueKey`, keyboard evidence, and position as click operations; unrelated fills retain existing matching. `src/automations/spec-compiler/deterministic-spec-compiler.ts` emits the data value as a runtime environment reference and excludes these character-click callbacks from reset replay. `src/automations/runtime/promoted-spec-runtime.ts` routes only these evidence-backed actions through the existing shared virtual-keyboard resolver, waits on the existing post-action signal, and records a value-free step description. No app slug, field label, selector, or project-specific branch was added.

Validation: focused strict TypeScript check for `spec-execution-contract.ts`, `deterministic-spec-compiler.ts`, and `promoted-spec-runtime.ts` passed. `git diff --check` passed (checkpoint reports existing CRLF normalization notice). No tests or physical QA job were run. The earlier run proves the failure boundary and captured keyboard evidence, but this change is not physically verified and promotion is not yet confirmed.

Next physical replay signal: contract logs should show `recordedVirtualKeyboardSequenceBound=true`, the affected steps as `operation=click implementationSource=validated_plan planMatched=true`, and `uncertifiedRequiredTargets=0`; promoted runtime should show `promoted-virtual-keyboard ... keyPress=verified` for every recorded character, then a passed final oracle and `promotionAllowed=true`.

### 2026-10-06 -- Kiosko job b15fb003 virtual-keyboard contract still blocked
Active objective: repair the user-reported rerun `b15fb003-6005-4c63-8ea8-40e7fd2179d7` for case PREVIEW-001, “Consultar Tarjeta Visa Oro,” while preserving other projects' ordinary fills.

First-loss boundary: discovery reaches the end of all 19 steps, but spec generation rejects fill steps 8–18: each is `implementationSource=scenario planMatched=false`, then `technical_target_not_materializable`; `uncertifiedRequiredTargets=11` and `promotionAllowed=false`. The validated plan at `.artifacts/preview/PREVIEW-001/2026-10-06T20-52-15-320Z/discovered-plans.pending.json` has a complete 11-click `virtual_keyboard` sequence, one field, one `valueKey`, positions 1–11, unique capture, and consistent key shape. The human-facing source fill is masked and may omit its `valueKey`; the previous materializer incorrectly required the source copy to retain that key even though the validated plan and complete recording sequence carry it. Plan/source indices align in this artifact; an earlier hypothesis about an index offset was disproved by this evidence.

Change: `src/automations/spec-execution-contract.ts` now permits the validated plan's `valueKey` to supply a missing source `valueKey` only for the already strict complete ordered keyboard sequence, and requires all mapped plan steps to share one nonempty key. When the source has a key, exact agreement remains required. Normal fills are unaffected; no app-specific rule was added.

Validation: focused strict TypeScript compile of `src/automations/spec-execution-contract.ts` and `git diff --check -- src/automations/spec-execution-contract.ts` passed. No tests or new physical QA job were run. Promotion is not yet confirmed.

Next action: on a user-requested rerun, confirm the contract emits `recordedVirtualKeyboardSequenceBound=true`, maps steps 8–18 as validated-plan click operations with certified targets, then verifies each digit replay and promotion.

### 2026-10-06 -- Kiosko virtual-keyboard fix verified by rerun
User-provided rerun: source `b15fb003-6005-4c63-8ea8-40e7fd2179d7`, new job `ec6911f5-d1a4-45ee-8f2b-ce3685b1eeb6`, Kiosko case “Consultar Tarjeta Visa Oro.”

Result: the corrected bridge logged `recordedVirtualKeyboardSequenceBound=true firstStep=8 segmentCount=11 valueKey=numero_de_identificacion`; all 11 fill-shaped source steps became evidence-backed click operations at segment positions 1–11. The contract was valid with `uncertifiedRequiredTargets=0`. Functional execution passed (`requiredPassed=1`, `requiredFailed=0`), `promotionAllowed=true`, `promotionStatus=promoted`, `specWritten=true`, and `firstPassPromotion=true`. `.artifacts/scenario-preview-runs/ec6911f5-d1a4-45ee-8f2b-ce3685b1eeb6/results.json` reports `passed=1`, `failed=0`, `automationReady=1`, `specsPromoted=1`.

No source changes or jobs were launched in this verification turn; this was the user's physical rerun. Tests were not run. No remaining action for this case unless another regression appears.

### 2026-10-06 -- Implement and verify isolated recording-engine regression
Active objective: complete the local recording-engine regression in the desktop dashboard. Constraints: do not interrupt active QA Lab jobs; do not send official traces to `/api/recordings/execute-batch`; do not modify/delete/move official recordings. No official QA job was launched or changed.

Implemented: optional `rootDir` on recording-store APIs (normal default unchanged); local `WebSessionRecorder` fixture CLI; per-job trace/scenario/artifacts; unique staging app profile; Discovery/AutoPOM runner; separate dashboard mode and desktop `.bat`/`.ps1` launcher. The local fixture uses synthetic values, redacts its password in scenario/log UI, writes no TestRail results, and preserves all source recordings.

First-loss boundaries fixed:
1. A reused pointer interaction id could claim a later tap and stale route. Canonical interaction anchoring now refuses the already-consumed id; a focused regression covers this.
2. A native `<select>` captured as `fill` was projected incorrectly. Scenario projection now emits a value-bearing `select` action, with its recorded scope and selection value key.
3. Hydration rebuilt canonical interactions and re-enabled a redundant click on the same select. Shared projection now suppresses only that opener when the next captured native selection carries matching field, selector identity, options and chosen option. Raw click evidence remains auditable and ordinary clicks/standalone selects keep current behavior.

Latest local job `f716f42c-be69-417b-93ec-d08dc13356e1` passed the full pipeline: capture/persist/hydrate, Discovery passed, AutoPOM passed, `promotionAllowed=true`, `specWritten=true`, `firstPassPromotion=true`, 1/1 promoted. `report.json` confirms `sourceRecordingsTouched=false` and `testRailWrites=false`. Artifact root: `.artifacts/recording-regression/f716f42c-be69-417b-93ec-d08dc13356e1/`; staging profile `recording-regression-f716f42c`.

Changed this work: recording-store root option and test; canonical pointer anchor and test; `trace-to-scenario.ts`; `persisted-scenario-hydration.ts`; native-selection projection/hydration regression; local CLI runner; package script; dedicated desktop dashboard adaptations/launchers; plan/checkpoint. Existing changes in shared dirty files were preserved.

Validation: focused recording/store/selection/pointer/navigation matrix passed 33/33; focused strict TypeScript passed for `trace-to-scenario.ts`, hydration and runner; dashboard JS/PowerShell checks passed earlier; `git diff --check` passed. Full `npm run typecheck` still exits 2 with 94 diagnostics in test/fixture files; no comparison to clean revision was made, so do not label them pre-existing. Full type safety remains unverified.

Next action: for future engine changes, run `npm run recording:regression` and check report `status=completed`, promotion count, and source/TestRail isolation flags. This implementation currently covers a synthetic local web fixture; adding replay of selected existing recordings requires copying them to staging first and keeping official recording directories immutable.

### 2026-10-07 -- QA Lab evidence PDF preview 401
User evidence: TestRail run 4575 / job `dd35f4fe-76d3-4fc4-b634-7efbb61a4e6f` completed the case as passed; the separate QA Lab report modal displayed `401 Unauthorized` while fetching its PDF.

Change in sibling frontend/BFF repo `C:\MisProyectos\QA-lab-main`: `server/routes/runs.ts` now forwards the allowlisted `format=pdf|docx` query to the engine. `server/routes/runs.test.ts` covers PDF format propagation and response streaming. This fixes a proven PDF-preview transport bug; it does not by itself establish or fix the 401 source.

Validation: `npx vitest run server/routes/runs.test.ts --reporter=verbose --pool=forks --maxWorkers=1` passed 24/24; `npx tsc -b tsconfig.node.json --pretty false` passed. No live QA job was launched. The frontend auth interceptor adds the browser token to same-origin `/api/` calls and the BFF forwards request auth through `engineHeaders()`, but the supplied screenshot/log does not identify which layer returned 401.

Next action: retry the report preview after restarting the QA Lab BFF so the query-forwarding change is loaded. If 401 remains, inspect sanitized browser Network status/response and BFF/engine auth configuration at the preview request boundary; never log bearer/API key values.
