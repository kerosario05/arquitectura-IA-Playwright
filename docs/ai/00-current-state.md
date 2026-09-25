# Current state

- Recording/direct replay = **PHYSICAL GREEN**
- candidate static gates = **PHYSICAL GREEN**
- functionalExecution admission = **PHYSICAL GREEN**
- pressPromotedTarget entry = **PHYSICAL GREEN**
- target-resolver TS authority = **PHYSICAL GREEN**
- recordedLocatorFactory invocation = **PHYSICAL GREEN**
- structured target resolution = **PHYSICAL GREEN**
- pressPromotedTarget dispatch = **PHYSICAL GREEN**

Closed boundary: `TypeError: recordedLocatorFactory is not a function` (stale `target-resolver.js` shadow) — fixed, no longer active.

Current first-loss: `TypeError: productListPage.executeAction is not a function`.

Location: `.candidate-validation-20008-1789776651167.spec.ts:44` — `await productListPage.executeAction();`

Cause: not yet diagnosed. Do not assume registry/POM generation.

Secondary/open (not current first-loss): auth rejection visible in the page snapshot after the login press step.

Tests: module authority 10/10; focused runtime 28/28; resolver regression 65/65.

Next physical validation: diagnose why `productListPage.executeAction` is called but does not exist at runtime.

Physical reference: `jobId=cb26fb19-d676-4d19-b19d-70613cd9a009`

Separate, additive, non-production kernel: deterministic spec compiler
(`src/automations/spec-compiler/deterministic-spec-compiler.ts`) now has
**targetAuthorityPreserved=GREEN** for steps with `technicalTargetRef`
(1,2,3,4,7 in the real PREVIEW-001 fixture — exact, opaque, no reconstruction)
via the shared `recordedLocatorFactory`/`parseSerializedTechnicalTargetString`
entrypoint. For steps WITHOUT `technicalTargetRef`, the compiler now also
consults the existing `certifiedTechnicalTarget` readiness field
(technical-target-materializer.ts, same materializer for Recording+Discovery):
`targetType="structural"` (non-ambiguous) reuses the certified locator;
`targetType="display"` (tier 5, e.g. real step5) keeps the prior
target.strategy/value fallback unchanged; a `structural` candidate the
materializer's own evidence marks ambiguous (real step6: bare `role:button`,
`identityAmbiguous=true`, 2 matches) now **fails closed**
(`unsupportedCapabilities`, no locator invented) instead of silently emitting
`getByText(...)`. Real-contract result at that point: **6/7** required
actions had valid spec authority (step6 had none). Still code-level only, not
a physical/runtime proof; `productionIntegrated=false`.

**Correction:** "6/7" above describes only the FROZEN, already-persisted
`plan.json` `executionContract` artifact, which predates every fix below and
is never retroactively rewritten. The FRESH pipeline — `buildSpecExecutionContract`
run with current code against the same real PREVIEW-001 evidence shapes —
now reaches **7/7**, proven permanently by
`deterministic-spec-compiler.fresh-pipeline-parity.test.ts`. Do not read
"6/7" as the current builder's ceiling; it is stale-artifact-only.

SpecExecutionContract now transports upstream resolution intent
(`SpecExecutionContractStep.resolutionState`, verbatim from
`CanonicalInteraction.resolutionState`/`RecordedActionReadiness.runtimeResolutionRequired`
in canonical-recording-contract.ts — never recalculated). The compiler honors
it when present: `unresolved_unrecoverable` fails closed unconditionally;
`runtime_resolution_required` lets an action compile from existing structured
evidence (even an otherwise-ambiguous certified candidate), delegating
physical resolution to the existing runtime, never marked certified.
The frozen, already-persisted PREVIEW-001 `executionContract` JSON still
carries no `resolutionState` for step6 and still shows fail-closed there
(6/7) — that artifact predates this fix and is not retroactively rewritten.
But the contract-builder now ALSO infers `resolutionState=runtime_resolution_required`
from an already-existing, already-persisted signal: the validated plan's own
`recorded:<strategy>` target marker (target-resolver.ts's recorded-target/
field-scoped-fallback consumption path — real step6's `plan.steps[6].target.strategy`
is literally `"recorded:css"`), transported without recalculating or
re-resolving anything, and never overriding an explicit upstream value.
Proven end-to-end (composed from the two real persisted PREVIEW-001 evidence
shapes, `spec-execution-contract.resolution-state-transport.test.ts` D1/D2):
once a contract is rebuilt from the validated plan, step6 becomes
candidate-representable via the existing shared runtime resolver, no longer
silently fails closed.

**Correction (same session, follow-up ticket):** the initial `recorded:* =>
runtime_resolution_required` rule was too broad — real steps 4 and 7 ALSO
carry a `recorded:*` plan marker while already having an authoritative
`technicalTargetRef` and a non-ambiguous tier-1 certified structural target;
naively they'd have been mislabeled `runtime_resolution_required` too. The
derivation now only fires when NEITHER an authoritative `technicalTargetRef`
NOR a non-ambiguous certified structural target already exists — verified
against the full real 7-action-step matrix (only step6 now derives
`runtime_resolution_required`; steps 1,2,3,4,5,7 stay `undefined`/unchanged).
spec-side **promotion readiness remains OPEN** (no `promotionReady`
equivalent exists in the spec/compiler/promoted-runtime path — a compiling
candidate has never meant, and still does not mean, promotion-safe).

**Follow-up: "binding emitted" != "runtime executable" (traced, fixed at the
wiring level, not yet physically proven).** step6's compiled callback is
`recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button')!)!.click()`
-- a bare, unscoped `page.getByRole('button')`, still matching 2 elements on
its own. clickPromotedTarget already has a structural-owner/field-scoped
re-resolution path (`resolveActionTarget`, the SAME function Recording Replay
uses, already imported into promoted-spec-runtime.ts -- no new resolver), but
it only activates when `targetIdentity.recordedTechnicalTargets` is
populated, which requires `resolvePromotedFieldIdentityFromPersistedContract`
(promoted-field-target-contract.ts) to locate the persisted plan.json via
`process.env.APP_SLUG`/`SECTION_SLUG`/`SCENARIO_ID` -- env vars the
deterministic compiler never emitted. Fixed: `compileDeterministicSpec` now
emits these three lines (from `contract.appSlug`/`sectionSlug`/`scenarioId`,
fields already on `SpecExecutionContract`) whenever `appSlug` is present,
mirroring the existing AI-generated-spec convention exactly. Proven
file-level (no browser): given the real persisted PREVIEW-001 plan.json and
these env vars, `resolvePromotedFieldIdentityFromPersistedContract(6, ...)`
genuinely finds step6's real ambiguous `certifiedTechnicalTarget` and returns
it as `recordedTechnicalTargets`
(`promoted-field-target-contract.deterministic-compiler-wiring.test.ts`).
**Not yet proven:** whether `resolveActionTarget`'s live DOM structural-owner
resolution can actually disambiguate this specific evidence down to exactly
one element at runtime (the same physical recovery Discovery's
field-scoped-fallback achieved) — that requires a real browser/QA Lab run,
explicitly out of scope here.

**Deterministic POM layer added.** Generated source is now `test → Page
Object → promoted-spec-runtime`, not raw runtime calls: a single generic
`DeterministicPromotedPage` class (emitted once, always identical) with
explicit `fill`/`click`/`press` methods, each a pure 1:1 forward to
`fillPromotedField`/`clickPromotedTarget`/`pressPromotedTarget` — never a
generic `executeAction`. No owner/method is ever selected from business
text, URL, or scenario name: the existing `SemanticMethodIntent`-based
ownership tables in `types/pom-ownership.ts` were deliberately **not**
reused, since they are themselves text/business-derived and are the same
class of authority that produced the historical `ProductListPage.executeAction`
drift this whole session traced. All prior authority (operation, target,
technicalTargetRef, resolutionState, dataRef, oracle order) is unchanged —
the POM layer is purely an organizational wrapper. 28/28 compiler focal
tests green (5 new: POM structure, no-text-influence, fail-closed-not-
keyword-inference, no-runtime-bypass, aiInvoked=false).

**Production wiring attempted — NEW FIRST-LOSS FOUND, not fixed.**
`promoteExecutionPlan` (promote-plan.ts) now has a real, opt-in insertion
point (`input.useDeterministicSpecCompiler === true`): it calls
`buildSpecExecutionContract` + `compileDeterministicSpec` in place of
`generateSpecFromPlanWithPolicy` (the real AI boundary), fails closed with no
AI fallback when the contract lacks full authority
(`DETERMINISTIC_SPEC_GENERATION_FAILED_CLOSED`), and leaves default behavior
(flag omitted) completely unchanged. Confirmed reached and correct in
isolation (`[deterministic-spec-generation] finalSpecOrigin=deterministic_compiler
... aiInvoked=false`). **But** the candidate then flows into the SAME
downstream `runHybridSpecGeneration` (existing, GREEN, untouched) that the AI
path also uses — and its `structuralValidation`/structural-validation-authority
gate does not recognize the new POM wrapper's call shape
(`pageObject.fill/click(...)`, which forwards to
`this.runtime.fillPromotedField/clickPromotedTarget(...)` one level removed)
as satisfying `operation → runtimeMethod` binding for a given `stepIndex` —
real error: `runtime_step_binding_unresolved:step=1:operation=fill:expected=fillPromotedField`.
Result: `status=spec_failed`, `specWritten=false` (an honest failure, not a
silent AI/legacy replacement — `finalSpec.origin` stays `deterministic_draft`
from the existing hybrid pipeline's own vocabulary, nothing was substituted).
`productionIntegrated=false` still — the interception/fail-closed/no-AI
pieces are proven; end-to-end candidate persistence is not, because the POM
wrapper (prior ticket's deliverable) is incompatible with the existing
structural-validation-authority gate's call-shape expectations. Fixing this
needs a scoped decision outside this ticket: either teach that gate to
recognize the POM wrapper (reopens a GREEN, prohibited gate) or have the
compiler's production-emission mode call `promotedRuntime.<method>` directly
instead of through the POM wrapper for now.

**structuralValidation now recognizes the deterministic POM wrapper — fixed.**
Added `extractPomWrapperStepCalls`/`extractPomClassRuntimeForwards`
(spec-generation-hybrid.ts, additive, `ACTION_RUNTIME_METHOD_BY_OPERATION`
reused unchanged): for each `<pageObjectInstance>.<pomMethod>({ stepIndex, ...})`
call, it reads the POM class's OWN method body to find what it actually
forwards to (`this.runtime.<runtimeMethod>(`) — never assumed from the
method's name — and feeds that as a normal `RuntimeStepCall` into the
existing, completely unmodified `runtime_step_binding_unresolved`/
`_ambiguous`/`runtime_method_operation_mismatch` logic. A tampered POM method
(e.g. `click()` that actually calls `fillPromotedField`) is still caught.
8/8 new focal tests pass (`spec-generation-hybrid.deterministic-pom-binding-gate.test.ts`),
including the real fresh-PREVIEW-001-shape 7-action source and step6
(`runtime_resolution_required`) — both structurally PASS with zero
`runtime_` errors. The 21/21 pre-existing press-operation-binding-gate suite
is unaffected.

**CORRECTION (follow-up DIAGNOSE-only ticket): the "inline_executor silent
replacement" claim above was a misattribution, retracted.** Precisely traced
via new `[deterministic-draft-tracking]` instrumentation in promote-plan.ts
(diagnostic-only, no behavior change): for the deterministic path,
`runHybridSpecGeneration` returns the POM draft **unchanged**
(`draftSameAsHybridOutput=true`; its output still contains
`DeterministicPromotedPage`, never `inline_executor`). The `candidate.spec.ts`
inspected earlier belonged to a *different* test run — the pre-existing,
unrelated `specMode="inline-debug"` default path (test H), which has always
legitimately produced `PROMOTED_SPEC_STRATEGY = "inline_executor"` and is
untouched by any of this work. No silent replacement of the deterministic
candidate exists anywhere in this pipeline.

**Both remaining structuralValidation findings — FIXED.**
`compileDeterministicSpec` now emits `process.env.SCENARIO_TITLE = '...'`
alongside APP_SLUG/SECTION_SLUG/SCENARIO_ID, sourced exclusively from
`contract.title` (the same authoritative field, `plan.scenario.title`,
already used for the generated test's own name — never inferred from step
text/appSlug/scenarioId). And `{ test, expect }` is now imported only when a
`navigation_transition` oracle with a real `urlPattern` is actually emitted
(a structural check mirroring `compileNavigationTransitionOracle`'s own
success condition, not a regex over the generated source); otherwise only
`{ test }` is imported. `structuralValidation` now **PASSES end-to-end** for
the real production entrypoint's deterministic candidate
(`structuralValidation.structure = "passed"`, confirmed via
`promote-plan.deterministic-compiler-integration.test.ts` A2). 33/33 compiler
focal tests green (5 new: SCENARIO_TITLE emission, escaping/determinism,
no-unused-expect, expect-present-with-oracle, unsupported-oracle-still-no-expect).

**`playwrightDiscovery=failed` diagnosed — a REAL compiler defect, not just a
fixture limitation. NOT fixed here (DIAGNOSE-only ticket).**
`playwright test --list` (static discovery, no browser, confirmed via source
read of `defaultRunPlaywrightDiscovery`/`spec-generation-hybrid.ts`) has two
independent causes of failure:
1. The integration test's `outputRoot` is a temp directory outside the repo
   root — `playwright.config.ts`'s `testMatch` (`automations/apps/**/cases/**/*.spec.ts`)
   is anchored to the project root and can never match a file there.
   Fixture-only, not a compiler defect.
2. **Independently real**: even when the deterministic candidate is placed at
   the CORRECT real depth inside the repo
   (`automations/apps/<slug>/sections/<section>/cases/<id>/case.spec.ts`),
   static discovery still fails —
   `Error: Cannot find module '../runtime/promoted-spec-runtime'`. Proven with
   a genuine non-browser test using the real `playwright.config.ts` and real
   `defaultRunPlaywrightDiscovery`
   (`spec-generation-hybrid.playwright-discovery-deterministic-source.test.ts`,
   temp case dir inside the real `arquitectura-automatizacion` app, cleaned up
   after). `compileDeterministicSpec` hardcodes its import paths
   (`'../runtime/promoted-spec-runtime'`, `'../../discovery/target-resolver'`)
   relative to its OWN source directory (`src/automations/spec-compiler/`),
   not the real target file's depth six levels down in `automations/apps/...`.
   The AI path (spec-generator-pom.ts) avoids this by computing import paths
   dynamically from the actual target spec path
   (`buildPortablePathFromSpec`); the deterministic compiler never does this.

**FIXED: portable import paths.** `compileDeterministicSpec` now requires a
`SpecCompileContext { targetSpecPath: string }` (a required second parameter
— never optional, never defaulted, so a caller cannot silently receive
imports computed relative to the wrong location) and computes its
`promoted-spec-runtime`/`target-resolver` import paths via the SAME
`buildPortablePathFromSpec` the AI path (`spec-generator-pom.ts`) already
uses — now exported from there and imported, not reimplemented. The physical
spec location stays out of `SpecExecutionContract` entirely (compile context,
not scenario authority). `promoteExecutionPlan` passes its own, already-owned
`appPaths.specPath` (fails closed with `DETERMINISTIC_SPEC_GENERATION_FAILED_CLOSED:
failedGate=deterministic_missing_target_spec_path` if absent — never
re-derives it from appSlug/sectionSlug/scenarioId).

**Real, non-browser proof: `playwright test --list` now PASSES.** With the
candidate placed at its real target depth inside the repo
(`automations/apps/<slug>/sections/<section>/cases/<id>/case.spec.ts`, a
temp case dir cleaned up after), static discovery went from
`Error: Cannot find module '../runtime/promoted-spec-runtime'` /
`Total: 0 tests in 0 files` to `exitCode=0` / `Total: 1 test in 1 file` —
confirmed at two different physical nesting depths, proving the fix adapts
to location rather than being tuned to one directory layout
(`spec-generation-hybrid.playwright-discovery-deterministic-source.test.ts`).
38/38 compiler focal tests green (5 new: portable-import resolution proofs
against real files on disk, two depths, determinism).

The PRODUCTION integration test's own fixture still shows
`playwrightDiscovery=failed` — but now for the SEPARATE, already-identified,
unrelated reason (its `outputRoot` is a temp directory outside the repo root,
which `playwright.config.ts`'s `testMatch` can never match, regardless of
source content) — not the module-resolution defect, which is gone.

**Run against a real, in-repo `outputRoot` — `playwrightDiscovery` now
PASSES end-to-end in the real production entrypoint too.** New test
(`promote-plan.deterministic-compiler-e2e-inrepo.test.ts`) uses
`outputRoot = process.cwd()` with a clearly-temp, never-real app slug
(`zzz-temp-production-e2e-<pid>`, materialized under the real
`automations/apps/` tree, cleaned up in `finally`, no existing app/case
touched). Confirmed via the real `promoteExecutionPlan` →
`compileDeterministicSpec` → `runHybridSpecGeneration` →
`structuralValidation` → `playwrightDiscovery` chain:
`structuralValidation=passed`, `playwrightDiscovery=passed`. The pipeline
then correctly stops at `promotionAllowed=false` — the EXISTING, unmodified
`[promotion-runtime-gate]` explicitly requires `functionalExecution` (a real
browser/app run) before promotion is allowed; deferred, not denied, by
design. `specWritten=false` for this expected, correct, physical-runtime
reason — not a defect. Generation + structural persistence-readiness is
fully proven up to that exact, expected boundary.

Incidental finding, corrected: the first run of this new test (before an env
override was added) caused `runHybridSpecGeneration`'s own, pre-existing
`functionalExecution` gate to actually launch a browser and attempt a real
navigation (this environment's `AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED` default
is `true`, unrelated to any change in this ticket) — a genuine, if
short-lived, physical-runtime side effect neither requested nor needed for
this generation-only proof. Fixed by explicitly setting
`AI_SPEC_FUNCTIONAL_EXECUTION_ENABLED=false` in this test (and retrofitted
into the earlier `promote-plan.deterministic-compiler-integration.test.ts`,
which had the same latent exposure across all of its tests). No gate logic
changed — only an existing, already-supported env override was applied.

`productionIntegrated=false` still (opt-in generation path is fully proven;
promotion itself remains correctly gated behind physical runtime proof, out
of scope). `defaultDeterministicEnabled=false` (unchanged, as instructed).
