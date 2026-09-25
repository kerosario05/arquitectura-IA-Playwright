import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSessionRecorder } from "./web-session-recorder";
import type { CaptureAction, CaptureFunctionalAction } from "../capture-engine-v2.types";
import type { ShadowActionRecord, ShadowFunctionalActionRecord } from "../capture-engine-v2.shadow-bridge";
import type { RecordedEvent } from "../session-trace.types";

/**
 * FIRST_LOSS (recordingId 8022c4cb-bf2c-4f11-9e58-2a4d5921a29e): `onV2FunctionalAction`
 * unconditionally marked BOTH the combobox and option technical clicks
 * `coveredByFunctionalSelection = true` BEFORE checking whether `selectionEvidence.selectedDisplay`/
 * `selectedValue` actually had a real value -- when SelectionSessionManager's own extraction came
 * up empty (physically observed: 4 real owner+option selection pairs, all `selectionCovered=true`,
 * all `admissionStatus=accepted`/`resolutionState=certified`, yet NO compensating "Seleccionar..."
 * step and no visible step at all), the function returned early with NOTHING pushed, leaving
 * both raw clicks hidden (technicalOnly, via canonical-recording-contract.ts's existing
 * `coveredByFunctionalSelection` -> `technicalOnly` mapping) with no replacement -- a silent drop,
 * not a collapse.
 *
 * Fixed two ways:
 * 1. Before giving up, fall back to the OPTION half's own already-captured technical label (the
 *    SAME raw click event's `target.label` that independently certifies its identity elsewhere
 *    in the canonical layer) -- never the combobox/owner's own label (that is the FIELD name),
 *    never positional/invented text.
 * 2. Only mark the source clicks `coveredByFunctionalSelection` once a compensating selection
 *    event is actually about to be pushed -- if truly no display value exists anywhere (neither
 *    SelectionSessionManager's own evidence NOR the option's own captured label), the raw
 *    combobox+option clicks stay UNCOVERED (visible as their own steps) instead of vanishing.
 */

type RecorderInternals = {
  onV2TechnicalAction(record: ShadowActionRecord): void;
  onV2FunctionalAction(record: ShadowFunctionalActionRecord): void;
  v2IngestionQueue: Promise<void>;
};

function newRecorder() {
  const events: RecordedEvent[] = [];
  const recorder = new WebSessionRecorder({
    baseUrl: "http://selection-evidence-fallback-fixture.test",
    framesDir: path.join(os.tmpdir(), "selection-evidence-fallback-test-frames"),
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
  owner: { tag: "span", role: "combobox", technicalRefs: ["id:categoria-producto"], associatedField: "Categoría de producto" },
};

function optionClick(label: string | undefined): CaptureAction {
  return {
    actionType: "click",
    identity: { label, tagName: "li", role: "option" },
    owner: { tag: "li", role: "option" },
  };
}

test("1/FALLBACK_TO_OPTION_LABEL: missing selectionEvidence display value falls back to the option's own already-captured technical label -- one selection step is still produced", async () => {
  const { recorder, events } = newRecorder();
  const comboboxRecord = technicalRecord(comboboxClick);
  recorder.onV2TechnicalAction(comboboxRecord);
  const optionRecord = technicalRecord(optionClick("Cuentas de Ahorro"));
  recorder.onV2TechnicalAction(optionRecord);
  recorder.onV2FunctionalAction(functionalRecord({
    functionalActionType: "select",
    identity: { label: undefined },
    owner: { tag: "span", role: "combobox", technicalRefs: ["id:categoria-producto"], associatedField: "Categoría de producto" },
    sourceTechnicalActionSeqs: [comboboxRecord.seq, optionRecord.seq],
    // Evidence extraction came up empty -- the exact physical symptom.
    selectionEvidence: {},
  }));
  await recorder.v2IngestionQueue;

  assert.equal(events.length, 3, "a compensating selection event must still be produced, not silently dropped");
  assert.equal(events[2].target?.afterValue, "Cuentas de Ahorro", "the selected value must come from the option's own captured label, never invented");
  assert.equal(events[2].target?.associatedField, "Categoría de producto");
  assert.equal(events[0].target?.coveredByFunctionalSelection, true);
  assert.equal(events[1].target?.coveredByFunctionalSelection, true);
});

test("2/EVIDENCE_TAKES_PRECEDENCE_OVER_FALLBACK: when selectionEvidence DOES carry a real value, it is used as-is -- the option label fallback never overrides real evidence", async () => {
  const { recorder, events } = newRecorder();
  const comboboxRecord = technicalRecord(comboboxClick);
  recorder.onV2TechnicalAction(comboboxRecord);
  // Deliberately different from the evidence's own value, to prove precedence.
  const optionRecord = technicalRecord(optionClick("Option's Own Raw Label"));
  recorder.onV2TechnicalAction(optionRecord);
  recorder.onV2FunctionalAction(functionalRecord({
    functionalActionType: "select",
    identity: { label: undefined },
    owner: { tag: "span", role: "combobox", technicalRefs: ["id:categoria-producto"], associatedField: "Categoría de producto" },
    sourceTechnicalActionSeqs: [comboboxRecord.seq, optionRecord.seq],
    selectionEvidence: { selectedValue: "Real Evidence Value", selectedDisplay: "Real Evidence Value" },
  }));
  await recorder.v2IngestionQueue;

  assert.equal(events[2].target?.afterValue, "Real Evidence Value");
});

test("3/NO_SILENT_DROP_WHEN_TRULY_NO_EVIDENCE: neither selectionEvidence NOR the option's own label carries a value -- the raw clicks are never covered/hidden, and no fabricated selection event is produced", async () => {
  const { recorder, events } = newRecorder();
  const comboboxRecord = technicalRecord(comboboxClick);
  recorder.onV2TechnicalAction(comboboxRecord);
  const optionRecord = technicalRecord(optionClick(undefined)); // option itself has no label either
  recorder.onV2TechnicalAction(optionRecord);
  recorder.onV2FunctionalAction(functionalRecord({
    functionalActionType: "select",
    identity: { label: undefined },
    owner: { tag: "span", role: "combobox", technicalRefs: ["id:categoria-producto"], associatedField: "Categoría de producto" },
    sourceTechnicalActionSeqs: [comboboxRecord.seq, optionRecord.seq],
    selectionEvidence: {},
  }));
  await recorder.v2IngestionQueue;

  assert.equal(events.length, 2, "no fabricated third event when no real display value exists anywhere");
  assert.equal(events[0].target?.coveredByFunctionalSelection, undefined, "the combobox click must stay visible (uncovered) rather than silently vanish with nothing to replace it");
  assert.equal(events[1].target?.coveredByFunctionalSelection, undefined, "the option click must stay visible (uncovered) rather than silently vanish with nothing to replace it");
});

test("4/OPTION_ROLE_ONLY_NEVER_OWNER_LABEL: the fallback only reads the OPTION-role source event's label, never the combobox owner's own label (field name != selected value)", async () => {
  const { recorder, events } = newRecorder();
  const comboboxWithLabel: CaptureAction = {
    actionType: "click",
    // The combobox's OWN identity carries a label too (e.g. a visible placeholder) -- this must
    // never be mistaken for the selected VALUE.
    identity: { label: "Categoría de producto", tagName: "span", role: "combobox" },
    owner: { tag: "span", role: "combobox", technicalRefs: ["id:categoria-producto"], associatedField: "Categoría de producto" },
  };
  const comboboxRecord = technicalRecord(comboboxWithLabel);
  recorder.onV2TechnicalAction(comboboxRecord);
  const optionRecord = technicalRecord(optionClick("Cuentas de Ahorro"));
  recorder.onV2TechnicalAction(optionRecord);
  recorder.onV2FunctionalAction(functionalRecord({
    functionalActionType: "select",
    identity: { label: undefined },
    owner: { tag: "span", role: "combobox", technicalRefs: ["id:categoria-producto"], associatedField: "Categoría de producto" },
    sourceTechnicalActionSeqs: [comboboxRecord.seq, optionRecord.seq],
    selectionEvidence: {},
  }));
  await recorder.v2IngestionQueue;

  assert.equal(events[2].target?.afterValue, "Cuentas de Ahorro", "must use the OPTION's label, never the combobox owner's own label");
  assert.notEqual(events[2].target?.afterValue, "Categoría de producto");
});
