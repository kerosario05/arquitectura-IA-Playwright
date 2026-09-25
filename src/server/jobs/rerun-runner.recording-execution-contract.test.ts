import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { prepareRerun } from "./rerun-runner";
import type { VirtualCase } from "../../types/scenario-preview.types";
import type { RecordingExecutionAction } from "../../scenarios/scenario-types";

/**
 * FIRST_LOSS (real physical evidence: source job e134f548-e2e8-4fc6-9222-352a933bb960, rerun job
 * 90628bc0-8a66-4eae-98b6-5d0b99f79951, recording 52849d4b-bfa5-4842-850a-a43e6460dcaf, scenario
 * REC-52849D4B-01): the source job's persisted `preview-scenarios.json` correctly contained the
 * full `RecordingExecutionContract` (`recordingExecutionContract.actions.length === 7`, verified
 * directly against the real artifact) -- the loss was never in what got persisted. It was
 * `virtualCaseToScenario` (this file), the ONLY place a rerun reconstructs an `McpScenario` from
 * that persisted `VirtualCase`: it copied `steps`/`preconditions`/`expectedResult`/etc. but never
 * `recordingId`, `recordedScenarioId`, `canonicalInteractions`, `runtimeInputRequirements`,
 * `technicalKnowledgeRefs`, or `recordingExecutionContract` itself -- even though `VirtualCase`
 * (and the persisted JSON) carried every one of them, via `toVirtualCase`'s own (correct,
 * unmodified) forward mapping. `hasRecordingExecutionContract` then reported false, the runner
 * fell through to `parseScenarioStepsForDiscovery`'s legacy text-parsing branch, and recorded
 * FILL VALUES were misread as fill TARGETS -- exactly the physical `target_not_found` failure.
 *
 * Fixed by making `virtualCaseToScenario` the exact inverse of `toVirtualCase` for every
 * recording-authority field. No new contract, no rehydration-from-recording-store needed here:
 * the authority was already fully present in the artifact this function already reads.
 */

const ROOT = path.resolve(__dirname, "..", "..", "..");
const JOBS_ROOT = path.join(ROOT, ".artifacts", "scenario-preview-runs");
const APP_SLUG = "test-rerun-contract-app";
const RECORDING_ID = "hermetictestrecording02";
const TEST_SECRET_VALUE_123 = "TEST_SECRET_VALUE_123";

function realShapeRecordingExecutionContractActions(): RecordingExecutionAction[] {
  return [
    { actionType: "fill", valueKey: "usuario", semanticField: "Usuario", targetRef: "Usuario", stepIndex: 1 },
    { actionType: "fill", valueKey: "contrasena", semanticField: "Contraseña", targetRef: "Contraseña", valueRole: "secure_input", stepIndex: 2, value: TEST_SECRET_VALUE_123 },
    { actionType: "press", key: "Enter", semanticField: "Contraseña", targetRef: "role:textbox|Contraseña", stepIndex: 3 },
    { actionType: "click", semanticField: "Solicitud multiproducto", targetRef: "Solicitud multiproducto", stepIndex: 4 },
    { actionType: "fill", valueKey: "numero_de_identificacion", semanticField: "Número de identificación", targetRef: "Número de identificación", associatedField: "Número de identificación", stepIndex: 5 },
    { actionType: "click", semanticField: "Número de identificación", targetRef: "Número de identificación", associatedField: "Número de identificación", stepIndex: 6 },
    { actionType: "click", semanticField: "Depurar", targetRef: "Depurar", stepIndex: 7 },
  ];
}

function baseVirtualCase(overrides: Partial<VirtualCase> = {}): VirtualCase {
  return {
    id: "preview-001",
    displayId: "PREVIEW-001",
    title: "Escenario recorded",
    sourceIssueKey: "REC-HERMETIC02",
    steps: [
      "Ingresar [usuario] en \"Usuario\"",
      "Ingresar el valor seguro asociado a \"Contraseña\"",
      "Presionar \"Enter\" en \"Contraseña\"",
      "Presionar \"Solicitud multiproducto\"",
      "Ingresar [numero_de_identificacion] en \"Número de identificación\"",
      "Presionar botón asociado a \"Número de identificación\"",
      "Presionar \"Depurar\"",
    ],
    expectedResult: "Resultado esperado",
    preconditions: [],
    appSlug: APP_SLUG,
    routeProfile: "",
    dataRequirements: "numero_de_identificacion, contrasena",
    mcpExecutable: true,
    type: "Functional",
    automationType: "recorded_session",
    setupStrategy: "recorded_walkthrough",
    executionReadiness: "ready",
    publicationClassification: "executable",
    nonAutomatable: false,
    recordingId: RECORDING_ID,
    recordedScenarioId: "REC-HERMETIC02-01",
    canonicalInteractions: [{ id: "interaction-1", action: "fill" }],
    runtimeInputRequirements: [{ valueKey: "usuario" }],
    technicalKnowledgeRefs: ["obs-1"],
    recordingExecutionContract: {
      actions: realShapeRecordingExecutionContractActions(),
      runtimeInputRequirements: [],
    },
    ...overrides,
  } as VirtualCase;
}

function writePreviewJob(jobId: string, cases: VirtualCase[]): void {
  const dir = path.join(JOBS_ROOT, jobId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "preview-scenarios.json"), JSON.stringify(cases, null, 2), "utf-8");
  fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify({ appSlug: APP_SLUG }, null, 2), "utf-8");
}

async function cleanup(jobIds: string[]): Promise<void> {
  for (const jobId of jobIds) {
    fs.rmSync(path.join(JOBS_ROOT, jobId), { recursive: true, force: true });
  }
}

test("1/contractRerun + 2/actionCount. rerun preserves the full RecordingExecutionContract with all 7 structured actions", async () => {
  const jobId = "hermetic-rerun-contract-full";
  try {
    writePreviewJob(jobId, [baseVirtualCase()]);
    const result = await prepareRerun(jobId, "all", undefined);
    assert.equal(result.ok, true);
    if (!result.ok || result.jobType !== "scenario-preview") throw new Error("unexpected result shape");
    const scenario = result.scenarios[0];
    assert.ok(scenario.recordingExecutionContract, "recordingExecutionContract must survive the rerun conversion");
    assert.equal(scenario.recordingExecutionContract!.actions.length, 7);
  } finally {
    await cleanup([jobId]);
  }
});

test("7/associatedField + 8/technicalTargets + 9/runtimeResolutionRequired preserved through the rerun conversion", async () => {
  const jobId = "hermetic-rerun-contract-fields";
  try {
    writePreviewJob(jobId, [baseVirtualCase()]);
    const result = await prepareRerun(jobId, "all", undefined);
    if (!result.ok || result.jobType !== "scenario-preview") throw new Error("unexpected result shape");
    const actions = result.scenarios[0].recordingExecutionContract!.actions;
    const fillAction = actions.find((a) => a.valueKey === "numero_de_identificacion");
    assert.equal(fillAction?.associatedField, "Número de identificación");
    assert.equal(result.scenarios[0].recordingId, RECORDING_ID);
    assert.equal(result.scenarios[0].recordedScenarioId, "REC-HERMETIC02-01");
    assert.ok(Array.isArray(result.scenarios[0].canonicalInteractions));
    assert.ok(Array.isArray(result.scenarios[0].runtimeInputRequirements));
    assert.ok(Array.isArray(result.scenarios[0].technicalKnowledgeRefs));
  } finally {
    await cleanup([jobId]);
  }
});

test("5/valueKeyPreserved. the fill target/valueKey pair is never collapsed into a raw runtime value", async () => {
  const jobId = "hermetic-rerun-contract-valuekey";
  try {
    writePreviewJob(jobId, [baseVirtualCase()]);
    const result = await prepareRerun(jobId, "all", undefined);
    if (!result.ok || result.jobType !== "scenario-preview") throw new Error("unexpected result shape");
    const passwordAction = result.scenarios[0].recordingExecutionContract!.actions.find((a) => a.valueKey === "contrasena");
    assert.ok(passwordAction);
    assert.equal(passwordAction!.semanticField, "Contraseña");
    assert.equal(passwordAction!.targetRef, "Contraseña");
    assert.notEqual(passwordAction!.targetRef, TEST_SECRET_VALUE_123, "target must remain the field name, never the runtime value");
  } finally {
    await cleanup([jobId]);
  }
});

test("6/secretNoLeak. the rerun-reconstructed scenario never serializes the real secret anywhere outside the execution-authority action's own value field", async () => {
  const jobId = "hermetic-rerun-contract-secret";
  try {
    writePreviewJob(jobId, [baseVirtualCase()]);
    const result = await prepareRerun(jobId, "all", undefined);
    if (!result.ok || result.jobType !== "scenario-preview") throw new Error("unexpected result shape");
    const scenario = result.scenarios[0];
    const displaySurfaces = JSON.stringify({ steps: scenario.steps, title: scenario.title, dataRequirements: scenario.dataRequirements });
    assert.ok(!displaySurfaces.includes(TEST_SECRET_VALUE_123), "the secret must never appear in display/human-readable rerun fields");
  } finally {
    await cleanup([jobId]);
  }
});

test("10/normalRerunRegression. a non-recording scenario rerun is completely unaffected -- no recording fields are fabricated", async () => {
  const jobId = "hermetic-rerun-nonrecording";
  try {
    writePreviewJob(jobId, [{
      id: "p1", displayId: "PREVIEW-001", title: "Manual scenario", sourceIssueKey: "JIRA-1",
      steps: ["Presionar algo"], expectedResult: "ok", preconditions: [], appSlug: APP_SLUG,
      routeProfile: "", dataRequirements: "", mcpExecutable: true, type: "Functional",
      automationType: "ui_with_auth_gate", setupStrategy: "auth_gate",
    } as unknown as VirtualCase]);
    const result = await prepareRerun(jobId, "all", undefined);
    if (!result.ok || result.jobType !== "scenario-preview") throw new Error("unexpected result shape");
    assert.equal(result.scenarios[0].recordingExecutionContract, undefined);
    assert.equal(result.scenarios[0].recordingId, undefined);
  } finally {
    await cleanup([jobId]);
  }
});

test("14/multiproject. no appSlug/recordingId hardcode governs the fix -- an arbitrary project/recording pair round-trips identically", async () => {
  for (const [appSlug, recordingId] of [["acme", "rec-acme-1"], ["otro-proyecto", "rec-otro-2"]] as const) {
    const jobId = `hermetic-rerun-multiproject-${appSlug}`;
    try {
      writePreviewJob(jobId, [baseVirtualCase({ appSlug, recordingId, recordedScenarioId: `${recordingId}-01` })]);
      const result = await prepareRerun(jobId, "all", undefined);
      if (!result.ok || result.jobType !== "scenario-preview") throw new Error("unexpected result shape");
      assert.equal(result.scenarios[0].recordingId, recordingId);
      assert.ok(result.scenarios[0].recordingExecutionContract);
    } finally {
      await cleanup([jobId]);
    }
  }
});
