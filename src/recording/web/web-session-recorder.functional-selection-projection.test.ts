import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSessionRecorder } from "./web-session-recorder";
import { buildCanonicalInteractions } from "../canonical-recording-contract";
import { buildHappyPathScenario } from "../trace-to-scenario";
import type { CaptureAction, CaptureFunctionalAction } from "../capture-engine-v2.types";
import type { ShadowActionRecord, ShadowFunctionalActionRecord } from "../capture-engine-v2.shadow-bridge";
import type { RecordedEvent, SessionTrace } from "../session-trace.types";

/**
 * FIRST_LOSS: `CaptureEngineV2ShadowBridge` already correctly produces a `CaptureFunctionalAction`
 * (`type: "select"`, `sourceTechnicalActionSeqs: [comboboxSeq, optionSeq]`) the moment a combobox
 * click is followed by an option click -- physically confirmed via the real
 * `[capture-v2] functional seq=... type=select` log line. But `functionalActions` was never
 * transported anywhere past the in-memory shadow bridge: `web-session-recorder.ts` only ever
 * consumed `technicalActions` (via `onV2TechnicalAction`), so QA Lab's scenario derivation only
 * ever saw the two raw technical clicks and rendered them as two independent "Presionar" steps.
 *
 * Fixed by:
 * 1. `CaptureEngineV2ShadowBridge` gains an `onFunctionalAction` callback (mirrors the existing
 *    `onTechnicalAction`), fired right after a functional projection is pushed.
 * 2. `WebSessionRecorder.onV2FunctionalAction` consumes it: flags the already-recorded technical
 *    click events (`target.coveredByFunctionalSelection = true`, found via a seq-keyed map, so
 *    ordering never matters) and appends ONE additional, locator-less, display-only event in the
 *    EXISTING `compoundRole: "selection"` shape trace-to-scenario/semantic-recording already
 *    understand (unchanged), carrying the option's real value and the combobox's real field name.
 * 3. `canonical-recording-contract.ts` marks a `coveredByFunctionalSelection` interaction
 *    `technicalOnly: true`, reusing the exact mechanism `trace-to-scenario.ts` already uses to
 *    skip an event from the human-facing step list -- no new skip mechanism invented.
 *
 * Technical authority is never touched: both raw clicks remain full RecordedEvents with their own
 * locators, fully preserved for replay; only the human-facing SCENARIO step count and the
 * canonical `technicalOnly` classification change.
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
    framesDir: path.join(os.tmpdir(), "functional-selection-projection-test-frames"),
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

const comboboxClick: CaptureAction = {
  actionType: "click",
  identity: { label: undefined, tagName: "span", role: "combobox" },
  owner: { tag: "span", role: "combobox", technicalRefs: ["id:tipo-cuenta"], associatedField: "Tipo de cuenta" },
};

function optionClick(label: string): CaptureAction {
  return {
    actionType: "click",
    identity: { label, tagName: "li", role: "option" },
    owner: { tag: "li", role: "option" },
  };
}

function selectFunctionalAction(sourceTechnicalActionSeqs: number[], selectedValue: string): CaptureFunctionalAction {
  return {
    functionalActionType: "select",
    identity: { label: undefined },
    owner: { tag: "span", role: "combobox", technicalRefs: ["id:tipo-cuenta"], associatedField: "Tipo de cuenta" },
    sourceTechnicalActionSeqs,
    selectionEvidence: { selectedValue, selectedDisplay: selectedValue },
  };
}

async function fireSelection(recorder: RecorderInternals, selectedValue: string): Promise<{ comboboxSeq: number; optionSeq: number }> {
  const comboboxRecord = technicalRecord(comboboxClick);
  recorder.onV2TechnicalAction(comboboxRecord);
  const optionRecord = technicalRecord(optionClick(selectedValue));
  recorder.onV2TechnicalAction(optionRecord);
  recorder.onV2FunctionalAction(functionalRecord(selectFunctionalAction([comboboxRecord.seq, optionRecord.seq], selectedValue)));
  await recorder.v2IngestionQueue;
  return { comboboxSeq: comboboxRecord.seq, optionSeq: optionRecord.seq };
}

test("1/2. combobox click + option click: a functional select projection produces ONE additional selection event, both technical clicks stay unremoved", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, "Cuenta A");

  assert.equal(events.length, 3, "2 technical clicks + 1 synthesized selection event -- neither raw click is removed or merged away");
  assert.equal(events[0].kind, "tap");
  assert.equal(events[1].kind, "tap");
  assert.equal(events[0].target?.coveredByFunctionalSelection, true);
  assert.equal(events[1].target?.coveredByFunctionalSelection, true);

  const selectionEvent = events[2];
  assert.equal(selectionEvent.target?.compoundRole, "selection");
  assert.equal(selectionEvent.target?.afterValue, "Cuenta A");
  assert.equal(selectionEvent.target?.locators.length, 0, "the synthesized event is display-only -- never its own executable target");
});

test("3/technicalPreserved/replayAuthority. technical action count is unaffected; both raw clicks keep their own real locators for replay", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, "Cuenta A");
  assert.ok(events[0].target?.locators?.some((l) => l.strategy === "id" && l.value === "tipo-cuenta"), "combobox click keeps its own real technical locator");
  assert.equal(events[1].target?.role, "option");
});

test("8/lineage. sourceTechnicalEventSeqs preserved on the synthesized event, traceable to the two real technical RecordedEvent.seq values", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, "Cuenta A");
  assert.deepEqual(events[2].target?.sourceTechnicalEventSeqs, [events[0].seq, events[1].seq]);
});

test("4/fieldVsValue. selected option value and combobox field label are kept separate -- the option's text never becomes the field name", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, "Cuenta A");
  const selectionEvent = events[2];
  assert.equal(selectionEvent.target?.afterValue, "Cuenta A");
  assert.equal(selectionEvent.target?.associatedField, "Tipo de cuenta");
  assert.notEqual(selectionEvent.target?.afterValue, selectionEvent.target?.associatedField);
});

test("6/unnamedField. an unnamed combobox (no accessibleName, no associatedField) still produces a valid selection event -- technical identity untouched, no name invented", async () => {
  const { recorder, events } = newRecorder();
  const comboboxRecord = technicalRecord({ actionType: "click", identity: { tagName: "span", role: "combobox" }, owner: { tag: "span", role: "combobox", technicalRefs: ["id:unnamed-combo"] } });
  recorder.onV2TechnicalAction(comboboxRecord);
  const optionRecord = technicalRecord(optionClick("Valor X"));
  recorder.onV2TechnicalAction(optionRecord);
  recorder.onV2FunctionalAction(functionalRecord({
    functionalActionType: "select",
    identity: {},
    owner: { tag: "span", role: "combobox", technicalRefs: ["id:unnamed-combo"] },
    sourceTechnicalActionSeqs: [comboboxRecord.seq, optionRecord.seq],
    selectionEvidence: { selectedValue: "Valor X", selectedDisplay: "Valor X" },
  }));
  await recorder.v2IngestionQueue;

  assert.equal(events[2].target?.afterValue, "Valor X");
  assert.equal(events[2].target?.associatedField, undefined, "no name invented when neither accessibleName nor associatedField exist");
  assert.ok(events[0].target?.locators?.some((l) => l.strategy === "id" && l.value === "unnamed-combo"), "the combobox's own real technical identity is untouched");
});

test("9/independentClick. a click unrelated to any selection is never flagged as covered", async () => {
  const { recorder, events } = newRecorder();
  const buttonRecord = technicalRecord({ actionType: "click", identity: { label: "Aceptar", tagName: "button" }, owner: { tag: "button", role: "button", technicalRefs: ["id:aceptar-btn"] } });
  recorder.onV2TechnicalAction(buttonRecord);
  await recorder.v2IngestionQueue;
  assert.equal(events[0].target?.coveredByFunctionalSelection, undefined);
});

test("11. two sequential selections produce two functional selection events; all four technical clicks preserved", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, "Cuenta A");
  await fireSelection(recorder, "Cuenta B");
  assert.equal(events.length, 6, "2 clicks + 1 selection, twice over");
  const selectionEvents = events.filter((e) => e.target?.compoundRole === "selection");
  assert.equal(selectionEvents.length, 2);
  assert.deepEqual(selectionEvents.map((e) => e.target?.afterValue), ["Cuenta A", "Cuenta B"]);
  const technicalClicks = events.filter((e) => e.target?.compoundRole !== "selection" && (e.target?.role === "combobox" || e.target?.role === "option"));
  assert.equal(technicalClicks.length, 4);
});

test("2/singleFunctionalStep/canonical. buildCanonicalInteractions marks both raw clicks technicalOnly, the synthesized selection is not", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, "Cuenta A");
  const canonical = buildCanonicalInteractions(events);
  assert.equal(canonical.length, 3);
  assert.equal(canonical[0].technicalOnly, true);
  assert.equal(canonical[1].technicalOnly, true);
  assert.notEqual(canonical[2].technicalOnly, true);
  assert.equal(canonical[2].action, "select");
});

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

test("3/singleFunctionalStep. the rendered scenario contains ONE select step, never two press steps, for a combobox+option selection", async () => {
  const { recorder, events } = newRecorder();
  await fireSelection(recorder, "Cuenta A");
  const scenario = buildHappyPathScenario(trace(events), events);
  const pressSteps = scenario.testRailSteps.filter((step) => step.content?.startsWith("Presionar"));
  const selectSteps = scenario.testRailSteps.filter((step) => step.content?.startsWith("Seleccionar"));
  assert.equal(pressSteps.length, 0, "the two raw technical clicks must never render as their own Presionar steps");
  assert.equal(selectSteps.length, 1);
  assert.match(selectSteps[0].renderedStep ?? "", /Cuenta A/);
  assert.match(selectSteps[0].renderedStep ?? "", /Tipo de cuenta/);
});

test("NO DOUBLE COUNT fixture: fill + combobox-click + option-click + button-click => exactly [Ingresar, Seleccionar, Presionar]", async () => {
  const { recorder, events } = newRecorder();
  recorder.onV2TechnicalAction(technicalRecord({
    actionType: "edit",
    identity: { label: "Ingresos", tagName: "input", domId: "ingresos" },
    owner: { tag: "input", role: "textbox", technicalRefs: ["id:ingresos"] },
    value: { present: true, changed: true, literal: "1500" },
  }));
  await recorder.v2IngestionQueue;
  await fireSelection(recorder, "USD");
  const buttonRecord = technicalRecord({ actionType: "click", identity: { label: "Aceptar", tagName: "button" }, owner: { tag: "button", role: "button", technicalRefs: ["id:aceptar-btn"] } });
  recorder.onV2TechnicalAction(buttonRecord);
  await recorder.v2IngestionQueue;

  assert.equal(events.length, 5, "1 fill + 2 covered clicks + 1 synthesized selection + 1 button click = 5 technical/derived events");
  const scenario = buildHappyPathScenario(trace(events), events);
  const functionalContents = scenario.testRailSteps
    .filter((step) => !step.isSetup)
    .map((step) => step.content?.split(" ")[0]);
  assert.deepEqual(functionalContents, ["Ingresar", "Seleccionar", "Presionar"], "exactly 3 functional steps, never 4");
});
