import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSessionRecorder } from "./web/web-session-recorder";
import { buildCanonicalInteractions, enrichRecordedScenarioContract, evaluateRecordedScenarioExecutionReadiness, toSharedMcpScenario, validateInteractionStateSequence } from "./canonical-recording-contract";
import { buildHappyPathScenario } from "./trace-to-scenario";
import type { CaptureAction, CaptureFunctionalAction } from "./capture-engine-v2.types";
import type { ShadowActionRecord, ShadowFunctionalActionRecord } from "./capture-engine-v2.shadow-bridge";
import type { RecordedEvent, SessionTrace } from "./session-trace.types";

/**
 * FIRST_LOSS (this ticket): the previous ticket correctly stopped a completed selection's two raw
 * technical clicks from ALSO rendering as independent "Presionar" steps, by marking them
 * `technicalOnly: true`. But `technicalOnly` was ALSO the exact flag `enrichRecordedScenarioContract`
 * and `toSharedMcpScenario` used to decide `executableInteractions`/`RecordingExecutionContract.actions`
 * -- so the two REAL, replayable clicks silently dropped out of the execution contract entirely,
 * while the display-only synthesized "select" interaction (locators: [], never captured against a
 * real DOM target) was the only one left, and would have become the sole (unexecutable) "action"
 * for the whole selection had nothing else changed.
 *
 * Fixed by decoupling "hidden from display" from "excluded from execution" via a new
 * `executionAuthority` override: the two raw clicks get `executionAuthority: true` (stay
 * technicalOnly for DISPLAY, but ARE included in execution); the display-only select projection
 * (detected generically via `target.sourceTechnicalEventSeqs`) gets `executionAuthority: false`
 * (shown as its own step, but never itself picked as an executable action).
 */

type RecorderInternals = {
  onV2TechnicalAction(record: ShadowActionRecord): void;
  onV2FunctionalAction(record: ShadowFunctionalActionRecord): void;
  v2IngestionQueue: Promise<void>;
};

function newRecorder() {
  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://contract-fixture.test",
    framesDir: path.join(os.tmpdir(), "functional-selection-execution-test-frames"),
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

function comboboxClick(domId?: string): CaptureAction {
  return {
    actionType: "click",
    identity: { tagName: "span", role: "combobox" },
    owner: domId ? { tag: "span", role: "combobox", technicalRefs: [`id:${domId}`], associatedField: "Tipo de cuenta" } : { tag: "span", role: "combobox", associatedField: "Tipo de cuenta" },
  };
}
function optionClick(label: string, domId?: string): CaptureAction {
  return {
    actionType: "click",
    identity: { label, tagName: "li", role: "option" },
    owner: domId ? { tag: "li", role: "option", technicalRefs: [`id:${domId}`] } : { tag: "li", role: "option" },
  };
}
function selectFunctionalAction(sourceTechnicalActionSeqs: number[], selectedValue: string): CaptureFunctionalAction {
  return {
    functionalActionType: "select",
    identity: {},
    owner: { tag: "span", role: "combobox", technicalRefs: ["id:tipo-cuenta"], associatedField: "Tipo de cuenta" },
    sourceTechnicalActionSeqs,
    selectionEvidence: { selectedValue, selectedDisplay: selectedValue },
  };
}

/** `null` explicitly means "no domId at all" (unresolved fixture); omitted/`undefined` means "use the default real id". */
async function fireSelection(recorder: RecorderInternals, opts: { comboboxDomId?: string | null; optionDomId?: string | null; missingLineage?: boolean } = {}): Promise<void> {
  const comboboxDomId = opts.comboboxDomId === null ? undefined : (opts.comboboxDomId ?? "tipo-cuenta");
  const comboboxRecord = technicalRecord(comboboxClick(comboboxDomId));
  recorder.onV2TechnicalAction(comboboxRecord);
  const optionDomId = opts.optionDomId === null ? undefined : opts.optionDomId;
  const optionRecord = technicalRecord(optionClick("Cuenta A", optionDomId));
  recorder.onV2TechnicalAction(optionRecord);
  const seqs = opts.missingLineage ? [9999, 9998] : [comboboxRecord.seq, optionRecord.seq];
  recorder.onV2FunctionalAction(functionalRecord(selectFunctionalAction(seqs, "Cuenta A")));
  await recorder.v2IngestionQueue;
}

function trace(events: RecordedEvent[]): SessionTrace {
  return {
    recordingId: "rec-1",
    projectSlug: "p",
    appSlug: "app",
    platform: "web",
    baseUrl: "http://contract-fixture.test",
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

test("4. execution contract contains BOTH real technical clicks (combobox + option), not the display-only select projection", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, { optionDomId: "cuenta-a" });
  const { contract } = buildContract(events);
  const actions = contract.recordingExecutionContract?.actions ?? [];
  assert.equal(actions.length, 2, "exactly the two real clicks -- never the display-only select interaction");
  assert.ok(actions.every((a) => a.actionType === "click"));
});

test("5/order. the combobox click precedes the option click in the execution contract", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, { optionDomId: "cuenta-a" });
  const { contract } = buildContract(events);
  const actions = contract.recordingExecutionContract?.actions ?? [];
  // buildWebLocators ranks a real role+name locator ahead of the id-derived one for a target
  // that has both (the option has a real label "Cuenta A"); the combobox has no name of its own,
  // so its highest-ranked locator is the id-derived css one -- either way, both are REAL,
  // re-findable technical identity, never positional/invented.
  assert.equal(actions[0].technicalTargetRef, "css:#tipo-cuenta");
  assert.equal(actions[1].technicalTargetRef, "role:option|Cuenta A");
});

test("2/lineage. targets preserved: both real technical targets (combobox + option) survive into the execution contract", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, { optionDomId: "cuenta-a" });
  const { contract } = buildContract(events);
  const refs = (contract.recordingExecutionContract?.actions ?? []).map((a) => a.technicalTargetRef);
  assert.deepEqual(refs, ["css:#tipo-cuenta", "role:option|Cuenta A"]);
});

test("1/display. the functional select is still shown as its own human step -- executionAuthority only affects execution, never display", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, { optionDomId: "cuenta-a" });
  const scenario = buildHappyPathScenario(trace(events), events);
  const selectSteps = scenario.testRailSteps.filter((step) => step.content?.startsWith("Seleccionar"));
  assert.equal(selectSteps.length, 1);
});

test("3/technicalPreserved. both clicks are still readiness-audited (not silently dropped from the readiness check)", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, { optionDomId: "cuenta-a" });
  const { enriched } = buildContract(events);
  const readiness = evaluateRecordedScenarioExecutionReadiness(enriched);
  assert.equal(readiness.actions.length, 2, "both real clicks are audited for readiness, not the display-only projection");
  assert.ok(readiness.actions.every((a) => a.technicalTargetCount > 0));
});

test("8/unresolvedCombobox. an unresolved combobox click (no technical id, real associatedField) is handed to live field-scoped runtime resolution -- same carve-out fill/click/press owners already get, never a fabricated pass", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, { comboboxDomId: null, optionDomId: "cuenta-a" });
  const { enriched } = buildContract(events);
  const readiness = evaluateRecordedScenarioExecutionReadiness(enriched);
  // FIRST_LOSS fix (recordingId 97f7c6dd-365a-4c5c-b82e-aaf25040916a): a combobox owner that is
  // part of a functional selection (selectionCovered) used to be unconditionally excluded from
  // the SAME field-scoped runtime-resolution carve-out already granted to an equivalent-shaped
  // fill/click/press owner with a real associatedField and zero captured technicalTargetRefs
  // (e.g. "Número de identificación", "Tasa" -- both physically confirmed to reach this exact
  // state with zero technicalTargetCandidates too, and still pass). That exclusion left a
  // correctly-semantically-synthesized selection permanently blocking `executionReady`, even
  // though the generic field-scoped structural-owner resolver (target-resolver.ts) is role-
  // agnostic and fails closed live on its own re-count. Deferring to live resolution here is
  // never a fabricated technical certification (no locator/technicalTargetRef is invented) --
  // the raw combobox action still carries no false ready:true from `technicalTargetCount>0`.
  const comboboxAction = readiness.actions.find((a) => a.technicalTargetCount === 0);
  assert.ok(comboboxAction, "the unresolved combobox click must still be present and flagged, not dropped");
  assert.equal(comboboxAction!.runtimeResolutionRequired, true, "deferred to the live field-scoped resolver, not silently certified");
  assert.equal(comboboxAction!.ready, true);
  assert.equal(readiness.promotionReady, false, "runtime-resolution-required actions still block PROMOTION (spec generation/publication) -- only recording replay may attempt them");
});

test("6/stateSequence. a functional select plus its two real technical source clicks never produce a false state-sequence incompatibility (no double-transition accounting)", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, { optionDomId: "cuenta-a" });
  const { canonical } = buildContract(events);
  // Three canonical interactions exist (two real clicks + the display-only projection), but
  // `validateInteractionStateSequence` is only ever run against `!technicalOnly` interactions in
  // production (see trace-to-scenario.ts) -- this asserts it stays valid on that same admitted
  // subset, never treating the covered clicks and their display summary as three independent
  // transitions.
  const admitted = canonical.filter((interaction) => !interaction.technicalOnly);
  assert.deepEqual(validateInteractionStateSequence(admitted), { stateSequenceValid: true, stateSequenceIssues: [] });
});

test("9/unresolvedOption. an unresolved option click (no technical id AND no accessible name at all) fails closed -- executionReady=false, never picks a positional/first option", async () => {
  const { recorder, events } = newRecorder();
  const comboboxRecord = technicalRecord(comboboxClick("tipo-cuenta"));
  recorder.onV2TechnicalAction(comboboxRecord);
  // No label, no technicalRefs -- a genuinely unresolvable option (a real label alone, like
  // "Cuenta A", would already be legitimate role+name technical identity, per the earlier
  // "control identity" ticket -- this fixture must have neither).
  const optionRecord = technicalRecord({ actionType: "click", identity: { tagName: "li", role: "option" }, owner: { tag: "li", role: "option" } });
  recorder.onV2TechnicalAction(optionRecord);
  recorder.onV2FunctionalAction(functionalRecord(selectFunctionalAction([comboboxRecord.seq, optionRecord.seq], "Cuenta A")));
  await recorder.v2IngestionQueue;
  const { enriched } = buildContract(events);
  const readiness = evaluateRecordedScenarioExecutionReadiness(enriched);
  assert.equal(readiness.executionReady, false);
});

test("7/missingSource. a functional select whose sourceTechnicalActionSeqs reference no real event never becomes an executable action itself", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, { optionDomId: "cuenta-a", missingLineage: true });
  const { contract, enriched } = buildContract(events);
  // The two real clicks are still fully executable (they exist regardless of the functional
  // action's lineage referencing them correctly or not). The orphaned display-only select
  // projection -- still identified as a projection by FIELD PRESENCE, even though its lineage
  // array came up empty -- is excluded from execution entirely, never leaking in as a fake,
  // target-less "select" action.
  const actions = contract.recordingExecutionContract?.actions ?? [];
  assert.equal(actions.length, 2, "only the two real clicks reach the execution contract -- the orphaned projection never does");
  assert.ok(actions.every((a) => a.actionType === "click"), "never a target-less 'select' action leaking into the contract");
  const readiness = evaluateRecordedScenarioExecutionReadiness(enriched);
  assert.equal(readiness.executionReady, true, "both real, fully-resolved clicks remain executable on their own even though the functional lineage metadata was broken");
});

test("10/noSelectOption. no custom-combobox is ever converted to a native selectOption() action -- both actions stay plain clicks", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, { optionDomId: "cuenta-a" });
  const { contract } = buildContract(events);
  const actions = contract.recordingExecutionContract?.actions ?? [];
  assert.ok(actions.every((a) => a.actionType === "click"), "never 'select' -- the technical replay authority is always the two raw clicks");
});

test("11/unrelated. an unrelated, ordinary technicalOnly interaction (a navigation bridge) is still excluded from execution -- the new override is opt-in, not a blanket change", () => {
  const events: RecordedEvent[] = [
    { seq: 1, t: 1, kind: "navigate", screenKey: "inicio", url: "/inicio" } as RecordedEvent,
    { seq: 2, t: 2, kind: "tap", screenKey: "inicio", target: { label: "Aceptar", role: "button", locators: [{ strategy: "id", value: "aceptar-btn" }] } } as RecordedEvent,
  ];
  const canonical = buildCanonicalInteractions(events);
  const navigation = canonical.find((c) => c.action === "navigation");
  assert.equal(navigation?.technicalOnly, true);
  assert.equal(navigation?.executionAuthority, undefined, "a navigation bridge never opts into executionAuthority -- default behavior (excluded) is preserved");
});

test("12. no app/project/value hardcode: the mechanism generalizes to an arbitrary field/value pair", async () => {
  const { recorder, events } = newRecorder();
  const comboboxRecord = technicalRecord({ actionType: "click", identity: { tagName: "span", role: "combobox" }, owner: { tag: "span", role: "combobox", technicalRefs: ["id:cualquier-campo"], associatedField: "Cualquier Campo" } });
  recorder.onV2TechnicalAction(comboboxRecord);
  const optionRecord = technicalRecord({ actionType: "click", identity: { label: "Cualquier Valor", tagName: "li", role: "option" }, owner: { tag: "li", role: "option", technicalRefs: ["id:cualquier-valor"] } });
  recorder.onV2TechnicalAction(optionRecord);
  recorder.onV2FunctionalAction(functionalRecord({
    functionalActionType: "select",
    identity: {},
    owner: { tag: "span", role: "combobox", technicalRefs: ["id:cualquier-campo"], associatedField: "Cualquier Campo" },
    sourceTechnicalActionSeqs: [comboboxRecord.seq, optionRecord.seq],
    selectionEvidence: { selectedValue: "Cualquier Valor", selectedDisplay: "Cualquier Valor" },
  }));
  await recorder.v2IngestionQueue;

  const { contract } = buildContract(events);
  const refs = (contract.recordingExecutionContract?.actions ?? []).map((a) => a.technicalTargetRef);
  assert.deepEqual(refs, ["css:#cualquier-campo", "role:option|Cualquier Valor"]);
});
