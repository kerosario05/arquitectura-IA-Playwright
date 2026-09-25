import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSessionRecorder } from "./web/web-session-recorder";
import { buildCanonicalInteractions, evaluateRecordedScenarioExecutionReadiness, enrichRecordedScenarioContract, toSharedMcpScenario } from "./canonical-recording-contract";
import { buildHappyPathScenario } from "./trace-to-scenario";
import { buildOwnerTechnicalEvidence } from "./capture-engine-v2.action-owner-resolver";
import type { CaptureAction, CaptureFunctionalAction, CaptureOwner } from "./capture-engine-v2.types";
import type { ShadowActionRecord, ShadowFunctionalActionRecord } from "./capture-engine-v2.shadow-bridge";
import type { RecordedEvent, SessionTrace } from "./session-trace.types";
import type { StructuralOwnerIdentity } from "./structural-owner-identity";

/**
 * FIRST_LOSS (recordingId 97f7c6dd-365a-4c5c-b82e-aaf25040916a): a functional selection's owner
 * combobox click was semantically correct and physically produced real structural capture
 * evidence (role="combobox" + structural identity, always attempted by Capture V2's
 * buildCandidateStructuralIdentity for any actionable owner), yet `structuralRuntimeEligible`
 * (canonical-recording-contract.ts) unconditionally excluded EVERY `selectionCovered` owner from
 * the SAME field-scoped runtime-resolution carve-out an equivalent-shaped fill/click/press owner
 * already gets (physically confirmed on "Número de identificación"/"Tasa" in the same recording,
 * both certified runtime_resolution_required with zero technicalTargetRefs). This permanently
 * blocked `executionReady` for every recording containing a correctly-projected combobox
 * selection, even after the prior ticket fixed the selection's own display/synthesis.
 *
 * Fixed by removing the blanket `!selectionCovered` exclusion (the paired OPTION click never
 * qualifies anyway -- it carries no associatedField/headerContext/columnIdentity of its own, and
 * already has real technicalTargetRefs from its own captured identity).
 *
 * REGRESSION FIX (recordingId e5c8ac51-1dff-4c56-9a55-dcd941203a32, interaction-14): this file
 * originally ALSO folded capture-time `structuralContext.identityAmbiguous`/
 * `structuralIdentityMatchCount` into `priorAmbiguityEvidence`, reasoning a capture-time-ambiguous
 * owner should fail closed before ever reaching live re-resolution. Physical replay proved this
 * wrong: `structuralIdentityMatchCount` is a coarse, landmark-wide count taken at CAPTURE time,
 * computed BEFORE the live resolver's own narrower `stableDescendants`/`semanticShape`/
 * `:not(:has(...))` nearest-owner logic ever runs -- not the same precision. The exact same
 * "Número de identificación" button (`identityAmbiguous:true, matchCount:2` at capture) was
 * PHYSICALLY resolved live to exactly one element and executed successfully BEFORE that addition.
 * Reverted: `priorAmbiguityEvidence` now checks only a genuine per-locator `ambiguous` flag again.
 * The LIVE resolver's own independent `count !== 1` fail-closed check (target-resolver.ts's
 * landmark-scoped structural-owner match) is unchanged and remains the real ambiguity safety net
 * -- never relaxed, never a new `resolveComboboxSpecialCase()`.
 */

type RecorderInternals = {
  onV2TechnicalAction(record: ShadowActionRecord): void;
  onV2FunctionalAction(record: ShadowFunctionalActionRecord): void;
  v2IngestionQueue: Promise<void>;
};

function newRecorder() {
  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://selection-owner-field-scoped-fixture.test",
    framesDir: path.join(os.tmpdir(), "selection-owner-field-scoped-test-frames"),
    captureAuthority: "v2",
    onEvent: (event) => events.push(event),
  });
  return { recorder: recorder as unknown as RecorderInternals, events };
}

let seqCounter = 0;
function technicalRecord(action: CaptureAction): ShadowActionRecord {
  seqCounter += 1;
  return { seq: seqCounter, action };
}
function functionalRecord(action: CaptureFunctionalAction): ShadowFunctionalActionRecord {
  seqCounter += 1;
  return { seq: seqCounter, action };
}

// Mirrors the REAL physical shape captured for a PrimeNG-style combobox trigger (role=combobox,
// no id/data-testid/aria-label of its own, only a bare structural identity) -- never a hardcoded
// business field name; `matchCount` is the one axis this suite varies.
function comboboxStructuralIdentity(matchCount: number): StructuralOwnerIdentity {
  return {
    owner: { tag: "span", role: "combobox" },
    stableDirectAttributes: { role: "combobox" },
    stableDescendants: [],
    semanticShape: [],
    landmarkAncestor: { tag: "main" },
    deterministicStructuralIdentity: matchCount === 1,
    ...(matchCount > 1 ? { identityAmbiguous: true } : {}),
    structuralIdentityMatchCount: matchCount,
  };
}

// The real shadow-bridge (capture-engine-v2.shadow-bridge.ts) builds `action.technicalEvidence`
// from `owner.structuralIdentity` via this SAME `buildOwnerTechnicalEvidence` call BEFORE handing
// the finished CaptureAction to `onV2TechnicalAction` -- these fixtures reuse it directly (like
// web-session-recorder.authority-switch.test.ts already does) rather than relying on
// `onV2TechnicalAction` to derive it itself, which it never does.
function comboboxClick(fieldLabel: string, matchCount: number): CaptureAction {
  const owner: CaptureOwner = { tag: "span", role: "combobox", associatedField: fieldLabel, structuralIdentity: comboboxStructuralIdentity(matchCount) };
  return {
    actionType: "click",
    identity: { tagName: "span", role: "combobox" },
    owner,
    technicalEvidence: buildOwnerTechnicalEvidence(owner),
  };
}
function comboboxClickNoField(matchCount: number): CaptureAction {
  const owner: CaptureOwner = { tag: "span", role: "combobox", structuralIdentity: comboboxStructuralIdentity(matchCount) };
  return {
    actionType: "click",
    identity: { tagName: "span", role: "combobox" },
    owner,
    technicalEvidence: buildOwnerTechnicalEvidence(owner),
  };
}
function optionClick(selectedValue: string, domId: string): CaptureAction {
  return {
    actionType: "click",
    identity: { label: selectedValue, tagName: "li", role: "option" },
    owner: { tag: "li", role: "option", technicalRefs: [`id:${domId}`] },
  };
}
function selectFunctionalAction(fieldLabel: string | undefined, sourceTechnicalActionSeqs: number[], selectedValue: string): CaptureFunctionalAction {
  return {
    functionalActionType: "select",
    identity: { label: undefined },
    owner: { tag: "span", role: "combobox", associatedField: fieldLabel },
    sourceTechnicalActionSeqs,
    selectionEvidence: { selectedValue, selectedDisplay: selectedValue },
  };
}

async function fireSelection(
  recorder: RecorderInternals,
  opts: { fieldLabel?: string; matchCount: number; selectedValue: string; optionDomId: string },
): Promise<{ comboboxSeq: number; optionSeq: number }> {
  const comboboxRecord = technicalRecord(opts.fieldLabel ? comboboxClick(opts.fieldLabel, opts.matchCount) : comboboxClickNoField(opts.matchCount));
  recorder.onV2TechnicalAction(comboboxRecord);
  const optionRecord = technicalRecord(optionClick(opts.selectedValue, opts.optionDomId));
  recorder.onV2TechnicalAction(optionRecord);
  recorder.onV2FunctionalAction(functionalRecord(selectFunctionalAction(opts.fieldLabel, [comboboxRecord.seq, optionRecord.seq], opts.selectedValue)));
  await recorder.v2IngestionQueue;
  return { comboboxSeq: comboboxRecord.seq, optionSeq: optionRecord.seq };
}

function trace(events: RecordedEvent[]): SessionTrace {
  return {
    recordingId: "rec-owner-field-scoped",
    projectSlug: "p",
    appSlug: "app",
    platform: "web",
    baseUrl: "http://selection-owner-field-scoped-fixture.test",
    startedAt: new Date().toISOString(),
    status: "completed",
    events,
    screens: [{ screenKey: "inicio", url: "/inicio" } as any],
  } as unknown as SessionTrace;
}

function buildContract(events: RecordedEvent[]) {
  const scenario = buildHappyPathScenario(trace(events), events);
  const canonical = buildCanonicalInteractions(events);
  const enriched = enrichRecordedScenarioContract(scenario, canonical);
  const contract = toSharedMcpScenario(enriched, "app");
  return { enriched, contract, canonical };
}

test("1/fieldScopedCombobox. a field-scoped combobox owner (unique structural identity, real associatedField) becomes runtime_resolution_required, never blocked", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, { fieldLabel: "Categoría de cuenta", matchCount: 1, selectedValue: "Cuenta A", optionDomId: "opt-a" });
  const { enriched } = buildContract(events);
  const readiness = evaluateRecordedScenarioExecutionReadiness(enriched);
  const ownerAction = readiness.actions.find((a) => a.semanticField === "Categoría de cuenta");
  assert.ok(ownerAction, "the owner click must be present in the readiness audit");
  assert.equal(ownerAction!.runtimeResolutionRequired, true);
  assert.equal(ownerAction!.ready, true);
  assert.equal(ownerAction!.blockReasons.length, 0);
});

test("2/captureAmbiguityDeferred. a coarse capture-time structuralIdentityMatchCount=2 does NOT block canonical readiness -- deferred to the live field-scoped resolver's own, more precise re-count, never pre-emptively fail-closed here", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, { fieldLabel: "Categoría de cuenta", matchCount: 2, selectedValue: "Cuenta A", optionDomId: "opt-a" });
  const { enriched } = buildContract(events);
  const readiness = evaluateRecordedScenarioExecutionReadiness(enriched);
  const ownerAction = readiness.actions.find((a) => a.semanticField === "Categoría de cuenta");
  assert.ok(ownerAction);
  assert.equal(ownerAction!.runtimeResolutionRequired, true, "capture-time global ambiguity alone must never block eligibility -- the live resolver re-verifies independently");
  assert.equal(ownerAction!.ready, true);
  assert.equal(readiness.executionReady, true);
});

test("3/perFieldScoping. two DIFFERENT combobox fields (each individually unique) each resolve only their own owner, never a global role match", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, { fieldLabel: "Categoría de cuenta", matchCount: 1, selectedValue: "Cuenta A", optionDomId: "opt-a" });
  await fireSelection(recorder, { fieldLabel: "Tipo de moneda", matchCount: 1, selectedValue: "Dólares", optionDomId: "opt-b" });
  const { enriched } = buildContract(events);
  const readiness = evaluateRecordedScenarioExecutionReadiness(enriched);
  const owner1 = readiness.actions.find((a) => a.semanticField === "Categoría de cuenta");
  const owner2 = readiness.actions.find((a) => a.semanticField === "Tipo de moneda");
  assert.equal(owner1!.ready, true);
  assert.equal(owner2!.ready, true);
  assert.equal(readiness.actions.filter((a) => a.actionType === "click" && a.runtimeResolutionRequired).length, 2, "each field scopes to exactly its own owner -- not a shared/global combobox match");
});

test("4/missingAssociatedField. a combobox owner with no associatedField at all stays blocked -- structuralFieldName is mandatory, never optional", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, { matchCount: 1, selectedValue: "Cuenta A", optionDomId: "opt-a" });
  const { enriched } = buildContract(events);
  const readiness = evaluateRecordedScenarioExecutionReadiness(enriched);
  // technicalTargetCount reflects candidates OR refs, whichever is nonzero -- the owner's bare
  // structural candidate still counts as 1, so owner/option must be told apart by field identity
  // instead: the option's own semanticField is the selected value ("Cuenta A"); the owner here has
  // none at all (no associatedField was ever recorded for it).
  const ownerAction = readiness.actions.find((a) => a.actionType === "click" && a.semanticField !== "Cuenta A");
  assert.ok(ownerAction);
  assert.equal(ownerAction!.semanticField, undefined, "sanity check: this IS the field-less owner, not the option");
  assert.notEqual(ownerAction!.runtimeResolutionRequired, true);
  assert.equal(ownerAction!.ready, false);
  assert.equal(readiness.executionReady, false);
});

test("5/selectionLineage. owner + option + synthetic select keep their lineage (sourceTechnicalEventSeqs) unchanged by this fix", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, { fieldLabel: "Categoría de cuenta", matchCount: 1, selectedValue: "Cuenta A", optionDomId: "opt-a" });
  const selectEvent = events.find((e) => e.target?.compoundRole === "selection");
  // sourceTechnicalEventSeqs references the RecordedEvent.seq of the two raw technical clicks
  // (their position in the pushed events array), not the ShadowActionRecord's own seq counter.
  assert.deepEqual(selectEvent?.target?.sourceTechnicalEventSeqs, [events[0].seq, events[1].seq]);
});

test("6/optionAuthorityPreserved. the certified option click keeps its own real technicalTargetRefs and readiness -- unaffected by the owner's new eligibility", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, { fieldLabel: "Categoría de cuenta", matchCount: 1, selectedValue: "Cuenta A", optionDomId: "opt-a" });
  const { enriched } = buildContract(events);
  const readiness = evaluateRecordedScenarioExecutionReadiness(enriched);
  // A separate ticket (jobId 73e597f1-1312-48ba-b422-66ffdf9b091d) fixed the option's own
  // `semanticField` to adopt the OWNER field's name (via the synthetic select event's
  // corroborating recordedValue) instead of its own display text -- so the option is no longer
  // distinguishable from the owner by semanticField alone; both now correctly share it. The
  // option is still uniquely identified by carrying its own real technical target evidence,
  // which the owner (a `runtime_resolution_required` field-scoped click) never has.
  const optionAction = readiness.actions.find((a) => a.actionType === "click" && a.semanticField === "Categoría de cuenta" && a.technicalTargetCount === 3);
  assert.ok(optionAction, "the option click still carries real technical evidence");
  assert.equal(optionAction!.technicalTargetCount, 3, "the option's own real captured refs, unaffected by the owner's new eligibility");
  assert.equal(optionAction!.ready, true);
  assert.notEqual(optionAction!.runtimeResolutionRequired, true, "the option was already certified -- it never needed the runtime-resolution carve-out");
});

test("7/readinessGreen. a fully field-scoped-resolvable selection reaches executionReady=true for that boundary", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, { fieldLabel: "Categoría de cuenta", matchCount: 1, selectedValue: "Cuenta A", optionDomId: "opt-a" });
  const { enriched } = buildContract(events);
  const readiness = evaluateRecordedScenarioExecutionReadiness(enriched);
  assert.equal(readiness.executionReady, true);
  // Recording Replay may attempt it, but promotion (spec generation/publication) still demands
  // full certification -- a runtime-resolution-required action never counts as promotion-ready.
  assert.equal(readiness.promotionReady, false);
});

test("8/ambiguityNeverFalselyPromoted. a capture-time-ambiguous owner may reach executionReady (deferred to live re-resolution) but never promotionReady -- runtime_resolution_required always blocks promotion, regardless of ambiguity", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, { fieldLabel: "Categoría de cuenta", matchCount: 2, selectedValue: "Cuenta A", optionDomId: "opt-a" });
  const { enriched } = buildContract(events);
  const readiness = evaluateRecordedScenarioExecutionReadiness(enriched);
  assert.equal(readiness.promotionReady, false, "runtime_resolution_required (whether or not capture-time-ambiguous) never counts as promotion-ready");
  assert.equal(readiness.executionReady, true, "execution/replay is deferred to the live resolver's own independent ambiguity check, never blocked here");
});

test("9/existingFieldScopedFlowsUnaffected. a plain (non-selection) field-scoped click, e.g. an unresolved 'Tasa'-shaped button, keeps its pre-existing runtime_resolution_required behavior unchanged", async () => {
  const { recorder, events } = newRecorder();
  const owner: CaptureOwner = { tag: "button", role: "button", associatedField: "Tasa", structuralIdentity: { owner: { tag: "button", role: "button" }, stableDirectAttributes: {}, stableDescendants: [], semanticShape: ["span"], deterministicStructuralIdentity: false, structuralIdentityMatchCount: 1 } };
  const record = technicalRecord({
    actionType: "click",
    identity: { tagName: "button", role: "button" },
    owner,
    technicalEvidence: buildOwnerTechnicalEvidence(owner),
  });
  recorder.onV2TechnicalAction(record);
  await recorder.v2IngestionQueue;
  const { enriched } = buildContract(events);
  const readiness = evaluateRecordedScenarioExecutionReadiness(enriched);
  const action = readiness.actions.find((a) => a.semanticField === "Tasa");
  assert.ok(action);
  assert.equal(action!.runtimeResolutionRequired, true);
  assert.equal(action!.ready, true);
});

test("10/selectionProjectionRegression. the human-facing 'Seleccionar...' step and its execution-authority exclusion are unaffected by this fix", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, { fieldLabel: "Categoría de cuenta", matchCount: 1, selectedValue: "Cuenta A", optionDomId: "opt-a" });
  const scenario = buildHappyPathScenario(trace(events), events);
  const selectSteps = scenario.testRailSteps.filter((step) => step.content?.startsWith("Seleccionar"));
  assert.equal(selectSteps.length, 1, "the selection projection step still renders exactly once");
  const { contract } = buildContract(events);
  const actions = contract.recordingExecutionContract?.actions ?? [];
  assert.ok(actions.every((a) => a.actionType !== "select"), "the display-only select projection is still never itself an executable action");
});
