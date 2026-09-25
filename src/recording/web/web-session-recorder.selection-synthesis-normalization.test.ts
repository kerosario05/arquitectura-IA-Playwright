import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSessionRecorder } from "./web-session-recorder";
import { normalizeEvents } from "../trace-normalizer";
import { buildHappyPathScenario } from "../trace-to-scenario";
import { saveTrace, saveScenarios, loadScenarios, recordingDir } from "../recording-store";
import type { CaptureAction, CaptureFunctionalAction } from "../capture-engine-v2.types";
import type { ShadowActionRecord, ShadowFunctionalActionRecord } from "../capture-engine-v2.shadow-bridge";
import type { RecordedEvent, SessionTrace } from "../session-trace.types";

/**
 * FIRST_LOSS (recordingId 29699822-5b84-456a-ab87-4e82914e758f): the synthesized selection event
 * `onV2FunctionalAction` pushes (compoundRole:"selection", locators:[]) survived a direct
 * `buildHappyPathScenario(trace, trace.events)` call, but the REAL production path -- both
 * `deriveScenarios` (session-recording-runner.ts) and the live preview projection -- always runs
 * `normalizeEvents(trace.events)` FIRST. `normalizeEvents` demotes any locator-less `tap` to
 * `kind:"note"` unless a carve-out applies; its existing `compoundRole==="selection"` carve-out
 * (trace-normalizer.ts) additionally requires `observationType==="pointer"` (or
 * `afterState.selected`/`dynamicLifecycle.committedState`), none of which the synthesized event
 * ever set -- so it fell through, was demoted to a `note`, and `buildCanonicalInteractions` drops
 * every `note` unconditionally. A script exercising the direct (non-normalized) path never saw
 * this; the live pipeline always did.
 *
 * This is a CROSS-BOUNDARY test, not another unit test of buildCanonicalInteractions: it drives
 * V2 technical + functional action ingestion (the real recorder), through normalizeEvents (the
 * real production pre-processing step), through buildHappyPathScenario, through a real
 * saveScenarios/loadScenarios disk round-trip -- using the sanitized real shape of the 5
 * combobox+option pairs from that recording (Oficial, Promotor, Estado civil, Sexo, País de
 * nacimiento), never hardcoding option VALUES.
 */

type RecorderInternals = {
  onV2TechnicalAction(record: ShadowActionRecord): void;
  onV2FunctionalAction(record: ShadowFunctionalActionRecord): void;
  v2IngestionQueue: Promise<void>;
};

function newRecorder() {
  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://selection-synthesis-normalization-fixture.test",
    framesDir: path.join(os.tmpdir(), "selection-synthesis-normalization-test-frames"),
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

function comboboxClick(fieldLabel: string, fieldId: string): CaptureAction {
  return {
    actionType: "click",
    identity: { label: undefined, tagName: "span", role: "combobox" },
    owner: { tag: "span", role: "combobox", technicalRefs: [`id:${fieldId}`], associatedField: fieldLabel },
  };
}
function optionClick(selectedValue: string): CaptureAction {
  return { actionType: "click", identity: { label: selectedValue, tagName: "li", role: "option" }, owner: { tag: "li", role: "option" } };
}
function selectFunctionalAction(fieldLabel: string, fieldId: string, sourceTechnicalActionSeqs: number[], selectedValue: string): CaptureFunctionalAction {
  return {
    functionalActionType: "select",
    identity: { label: undefined },
    owner: { tag: "span", role: "combobox", technicalRefs: [`id:${fieldId}`], associatedField: fieldLabel },
    sourceTechnicalActionSeqs,
    selectionEvidence: { selectedValue, selectedDisplay: selectedValue },
  };
}

async function fireSelection(recorder: RecorderInternals, fieldLabel: string, fieldId: string, selectedValue: string) {
  const comboboxRecord = technicalRecord(comboboxClick(fieldLabel, fieldId));
  recorder.onV2TechnicalAction(comboboxRecord);
  const optionRecord = technicalRecord(optionClick(selectedValue));
  recorder.onV2TechnicalAction(optionRecord);
  recorder.onV2FunctionalAction(functionalRecord(selectFunctionalAction(fieldLabel, fieldId, [comboboxRecord.seq, optionRecord.seq], selectedValue)));
  await recorder.v2IngestionQueue;
}

// The 5 real fields from the physical recording -- values kept generic/synthetic.
const FIELD_PAIRS: Array<{ label: string; id: string; value: string }> = [
  { label: "Oficial", id: "oficial", value: "Opcion Oficial 1" },
  { label: "Promotor", id: "promotor", value: "Opcion Promotor 1" },
  { label: "Estado civil", id: "estado-civil", value: "Opcion EstadoCivil 1" },
  { label: "Sexo", id: "sexo", value: "Opcion Sexo 1" },
  { label: "País de nacimiento", id: "pais-nacimiento", value: "Opcion Pais 1" },
];

function trace(appSlug: string, recordingId: string, events: RecordedEvent[]): SessionTrace {
  return {
    recordingId,
    projectSlug: "cross-boundary-fixture",
    appSlug,
    platform: "web",
    baseUrl: "http://selection-synthesis-normalization-fixture.test",
    startedAt: new Date().toISOString(),
    status: "completed",
    events,
    screens: [{ screenKey: "inicio", url: "/inicio" } as any],
  } as unknown as SessionTrace;
}

test("cross-boundary: V2 ingestion -> selection synthesis -> normalizeEvents -> buildHappyPathScenario -> save/load, matches the physical recording's 5 selections", async () => {
  const APP_SLUG = "crossboundaryfixtureapp";
  const RECORDING_ID = "crossboundaryfixturerecording";
  const { recorder, events } = newRecorder();

  // 4 non-selection raw technical actions (setup/other), matching the real recording's shape.
  // All use actionType "click" (fill/press actions require a fuller CaptureValueState shape not
  // relevant to this ticket's scope -- selection synthesis/normalization -- and a click reliably
  // produces a RecordedEvent, which is what matters for the counts under test here).
  const usuario = technicalRecord({ actionType: "click", identity: { label: "Usuario", tagName: "input" }, owner: { tag: "input", role: "textbox", technicalRefs: ["id:usuario"] } });
  recorder.onV2TechnicalAction(usuario);
  const contrasena = technicalRecord({ actionType: "click", identity: { label: "Contraseña", tagName: "input" }, owner: { tag: "input", role: "textbox", technicalRefs: ["id:contrasena"] } });
  recorder.onV2TechnicalAction(contrasena);
  const enter = technicalRecord({ actionType: "click", identity: { label: "Enter", tagName: "button" }, owner: { tag: "button", role: "button", technicalRefs: ["id:enter-btn"] } });
  recorder.onV2TechnicalAction(enter);
  const multiproducto = technicalRecord({ actionType: "click", identity: { label: "Solicitud multiproducto", tagName: "a" }, owner: { tag: "a", role: "link", technicalRefs: ["id:solicitud-multiproducto"] } });
  recorder.onV2TechnicalAction(multiproducto);
  await recorder.v2IngestionQueue;

  // 5 combobox+option selection pairs (10 raw technical actions -> 5 synthesized selects).
  for (const pair of FIELD_PAIRS) {
    await fireSelection(recorder, pair.label, pair.id, pair.value);
  }

  const rawTechnicalEventCount = events.filter((e) => e.target?.compoundRole !== "selection").length;
  const syntheticSelectEvents = events.filter((e) => e.target?.compoundRole === "selection");
  assert.equal(rawTechnicalEventCount, 14, "4 setup/other + 10 owner/option clicks");
  assert.equal(syntheticSelectEvents.length, 5, "one synthesized select per pair, never duplicated");
  assert.ok(syntheticSelectEvents.every((e) => e.observationType === "pointer"), "FIX: the synthesized event must carry the marker normalizeEvents' compoundRole=selection carve-out requires");

  // Coverage invariant: every owner+option pair marked covered must have exactly one replacement.
  const coveredRawCount = events.filter((e) => e.target?.compoundRole !== "selection" && e.target?.coveredByFunctionalSelection === true).length;
  assert.equal(coveredRawCount, 10, "all 5 owner+option pairs (10 raw events) covered");
  assert.equal(coveredRawCount / 2, syntheticSelectEvents.length, "never covered-without-replacement: covered pairs == replacement selects");

  const sessionTrace = trace(APP_SLUG, RECORDING_ID, [...events]);
  const originalEventCount = sessionTrace.events.length;

  try {
    saveTrace(sessionTrace);

    // LIVE production path (mirrors deriveScenarios): normalizeEvents runs BEFORE materialization.
    const normalized = normalizeEvents(sessionTrace.events);
    const demotedToNote = normalized.filter((e) => e.kind === "note" && e.target?.compoundRole === "selection");
    assert.equal(demotedToNote.length, 0, "FIX: no synthesized selection event is demoted to a dropped note");

    const happyPathLive = buildHappyPathScenario(sessionTrace, normalized, {});
    const liveSelects = (happyPathLive.canonicalInteractions ?? []).filter((i) => i.action === "select");
    assert.equal(liveSelects.length, 5, "all 5 selections survive the LIVE (normalized) path");

    // DIRECT rebuild path (un-normalized) -- the path that always looked correct in isolation.
    const happyPathDirect = buildHappyPathScenario(sessionTrace, sessionTrace.events, {});
    const directSelects = (happyPathDirect.canonicalInteractions ?? []).filter((i) => i.action === "select");
    assert.equal(directSelects.length, 5);

    // Direct-vs-live parity: the fix closes the gap between the two paths.
    assert.equal(liveSelects.length, directSelects.length, "direct rebuild and live materialization now agree on selection count");

    // Order preserved: selections appear in the same order they were performed, one per field.
    const liveSelectLabels = liveSelects.map((i) => i.semanticField ?? i.description ?? "");
    assert.deepEqual(
      liveSelectLabels.map((label) => FIELD_PAIRS.find((p) => label.includes(p.label))?.label),
      FIELD_PAIRS.map((p) => p.label),
      "each of the 5 fields appears exactly once, in the order the user actually selected them",
    );

    // Raw technical authority untouched: normalizeEvents/materialization never mutates the trace.
    assert.equal(sessionTrace.events.length, originalEventCount, "trace.events is never mutated by normalizeEvents/buildHappyPathScenario");

    // Persistence roundtrip: save/load matches what was materialized.
    const functionalFromRaw = happyPathLive.functionalActionCount
      ?? happyPathLive.testRailSteps.filter((s) => s.classification === "FUNCTIONAL_ACTION" && !s.isSetup).length;
    assert.equal(functionalFromRaw, 9, "4 non-selection functional actions + 5 synthesized selects, per the physical recording's ratio");

    saveScenarios(APP_SLUG, RECORDING_ID, [happyPathLive]);
    const loaded = loadScenarios(APP_SLUG, RECORDING_ID);
    assert.equal(loaded.length, 1);
    const persistedSelects = (loaded[0].canonicalInteractions ?? []).filter((i) => i.action === "select");
    assert.equal(persistedSelects.length, 5, "all 5 selections survive the full save/load disk roundtrip");

    // Fail-safe: a plain, unrelated click (never part of a selection) is still preserved on its own.
    const unrelatedInteraction = (loaded[0].canonicalInteractions ?? []).find((i) => i.controlIdentity?.includes("solicitud-multiproducto"));
    assert.ok(unrelatedInteraction, "an ordinary click, uninvolved in any selection, is never affected by this fix");
  } finally {
    fs.rmSync(recordingDir(APP_SLUG, RECORDING_ID), { recursive: true, force: true });
  }
});
