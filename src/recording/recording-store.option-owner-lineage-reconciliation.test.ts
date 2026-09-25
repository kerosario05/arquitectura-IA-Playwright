import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadScenarios, saveScenarios } from "./recording-store";
import type { RecordedScenario } from "./trace-to-scenario";

/**
 * FIRST_LOSS (jobId 60a1f392-ffb9-4b0b-bc91-96ad63bac82d): a genuinely FRESH scenario-preview job
 * (no `sourceJobId`, never touches `rerun-runner.ts`) still read a STALE, pre-fix
 * `canonicalInteractions` lineage, because `loadScenarios` returns whatever was persisted to
 * `scenarios.json` the one time this recording was originally derived -- before
 * `reconcileOptionOwnerLineage` existed. Fixed by re-applying that same reconciliation at this
 * single read boundary every consumer of `loadScenarios` shares.
 */

const appSlug = `test-recording-store-lineage-${Date.now()}`;
const recordingId = "22222222-2222-2222-2222-222222222222";

function staleScenario(scenarioId: string): RecordedScenario {
  return {
    scenarioId,
    title: scenarioId,
    description: "test",
    preconditions: [],
    kind: "happy_path",
    provenance: "observed",
    mobileSteps: [],
    webSteps: [],
    testRailSteps: [{ content: "Continuar", expected: "" }],
    requiredData: [],
    stepTargets: [],
    sourceRecordingId: recordingId,
    hasUncertainSteps: false,
    canonicalInteractions: [
      { id: "interaction-owner", action: "click", semanticField: "Categoría de producto", screenBeforeRef: "s1" },
      // STALE: still the option's own display text, the pre-fix writer defect.
      { id: "interaction-option", action: "click", semanticField: "Cuentas de Efectivo", technicalTargetRefs: ["role:option|Cuentas de Efectivo"], screenBeforeRef: "s1" },
      { id: "interaction-select", action: "select", semanticField: "Categoría de producto", recordedValue: "Cuentas de Efectivo", screenBeforeRef: "s1" },
    ],
  } as unknown as RecordedScenario;
}

test.after(() => {
  fs.rmSync(path.join("automations", "apps", appSlug), { recursive: true, force: true });
});

test("1/freshLoadReconcilesStaleLineage. a scenario persisted with the pre-fix option lineage is reconciled on load", () => {
  saveScenarios(appSlug, recordingId, [staleScenario("a")]);
  const loaded = loadScenarios(appSlug, recordingId);
  const interactions = loaded[0].canonicalInteractions as any[];
  const option = interactions.find((i) => i.id === "interaction-option");
  assert.equal(option.semanticField, "Categoría de producto", "loadScenarios must reconcile the stale lineage at read time");
});

test("2/technicalTargetRefsUnchanged. reconciliation never touches the option's own technical identity", () => {
  saveScenarios(appSlug, recordingId, [staleScenario("b")]);
  const loaded = loadScenarios(appSlug, recordingId);
  const interactions = loaded[0].canonicalInteractions as any[];
  const option = interactions.find((i) => i.id === "interaction-option");
  assert.deepEqual(option.technicalTargetRefs, ["role:option|Cuentas de Efectivo"]);
});

test("3/ownerUnaffected. the owner's own semanticField is unchanged (already correct)", () => {
  saveScenarios(appSlug, recordingId, [staleScenario("c")]);
  const loaded = loadScenarios(appSlug, recordingId);
  const interactions = loaded[0].canonicalInteractions as any[];
  const owner = interactions.find((i) => i.id === "interaction-owner");
  assert.equal(owner.semanticField, "Categoría de producto");
});

test("4/noScenariosFileStillEmpty. loading a recording with no scenarios.json is unaffected -- still an empty array, no crash", () => {
  const result = loadScenarios(appSlug, "never-derived-lineage-recording");
  assert.deepEqual(result, []);
});
