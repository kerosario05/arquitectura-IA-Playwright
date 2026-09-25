import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { prepareRerun } from "./rerun-runner";
import type { VirtualCase } from "../../types/scenario-preview.types";

/**
 * FIRST_LOSS (jobId 662dad69-f0e5-480b-ba94-c23301713d72, sourceJobId
 * 9facf427-f2c5-4208-896e-f60b842b8794): a canonicalization fix (jobId
 * 73e597f1-1312-48ba-b422-66ffdf9b091d) corrected a transient dropdown option's
 * `associatedField` for any FUTURE derivation -- but a rerun never re-derives from raw events, it
 * reuses the source job's OWN previously-materialized `canonicalInteractions`/
 * `recordingExecutionContract` (deliberately, per `rerun-runner.recording-execution-contract.test.ts`
 * -- that reuse itself is correct and unchanged). A `VirtualCase` persisted BEFORE the
 * canonicalization fix existed therefore carries the OLD, wrong lineage forever. Fixed by
 * re-applying `reconcileOptionOwnerLineage` (a pure function over already-captured evidence --
 * no raw events, no Discovery, no data loss) inside `virtualCaseToScenario`, and mirroring the
 * same correction onto `recordingExecutionContract.actions` via the stable `interactionId` join.
 */

const ROOT = path.resolve(__dirname, "..", "..", "..");
const JOBS_ROOT = path.join(ROOT, ".artifacts", "scenario-preview-runs");
const APP_SLUG = "test-option-lineage-app";
const RECORDING_ID = "hermetic-option-lineage-recording";

function staleCanonicalInteractions() {
  return [
    { id: "interaction-owner", action: "click", semanticField: "Categoría de producto", technicalTargetRefs: [], screenBeforeRef: "s1" },
    // STALE: still carries the option's own display text, exactly the pre-fix writer defect.
    { id: "interaction-option", action: "click", semanticField: "Cuentas de Efectivo", technicalTargetRefs: ["role:option|Cuentas de Efectivo", "css:#opt-1"], screenBeforeRef: "s1" },
    { id: "interaction-select", action: "select", semanticField: "Categoría de producto", recordedValue: "Cuentas de Efectivo", screenBeforeRef: "s1" },
  ];
}

function staleContractActions() {
  return [
    { actionType: "click" as const, interactionId: "interaction-owner", semanticField: "Categoría de producto", associatedField: "Categoría de producto", stepIndex: 1 },
    { actionType: "click" as const, interactionId: "interaction-option", semanticField: "Cuentas de Efectivo", associatedField: "Cuentas de Efectivo", technicalTargetRef: "role:option|Cuentas de Efectivo", technicalTargetRefs: ["role:option|Cuentas de Efectivo", "css:#opt-1"], stepIndex: 2 },
  ];
}

function baseVirtualCase(overrides: Partial<VirtualCase> = {}): VirtualCase {
  return {
    id: "preview-001",
    displayId: "PREVIEW-001",
    title: "Escenario con selección",
    sourceIssueKey: "REC-OPTLINEAGE-01",
    steps: ["Presionar \"Categoría de producto\".", "Seleccionar \"Cuentas de Efectivo\" en \"Categoría de producto\"."],
    expectedResult: "Resultado esperado",
    preconditions: [],
    appSlug: APP_SLUG,
    routeProfile: "",
    dataRequirements: "",
    mcpExecutable: true,
    type: "Functional",
    automationType: "recorded_session",
    setupStrategy: "recorded_walkthrough",
    executionReadiness: "ready",
    publicationClassification: "executable",
    nonAutomatable: false,
    recordingId: RECORDING_ID,
    recordedScenarioId: "REC-OPTLINEAGE-01",
    canonicalInteractions: staleCanonicalInteractions(),
    runtimeInputRequirements: [],
    technicalKnowledgeRefs: [],
    recordingExecutionContract: { actions: staleContractActions(), runtimeInputRequirements: [] },
    ...overrides,
  } as unknown as VirtualCase;
}

function writePreviewJob(jobId: string, cases: VirtualCase[]): void {
  const dir = path.join(JOBS_ROOT, jobId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "preview-scenarios.json"), JSON.stringify(cases, null, 2), "utf-8");
  fs.writeFileSync(path.join(dir, "job.json"), JSON.stringify({ appSlug: APP_SLUG }, null, 2), "utf-8");
}

async function cleanup(jobIds: string[]): Promise<void> {
  for (const jobId of jobIds) fs.rmSync(path.join(JOBS_ROOT, jobId), { recursive: true, force: true });
}

test("1/rerunMaterializesFreshOwnerLineage. a rerun of a pre-fix VirtualCase resolves the option's associatedField to the OWNER field, not the option's own value", async () => {
  const jobId = "hermetic-option-lineage-fresh";
  try {
    writePreviewJob(jobId, [baseVirtualCase()]);
    const result = await prepareRerun(jobId, "all", undefined);
    assert.equal(result.ok, true);
    if (!result.ok || result.jobType !== "scenario-preview") throw new Error("unexpected result shape");
    const optionInteraction = result.scenarios[0].canonicalInteractions!.find((i: any) => i.id === "interaction-option");
    assert.equal(optionInteraction!.semanticField, "Categoría de producto");
    const optionAction = result.scenarios[0].recordingExecutionContract!.actions.find((a) => a.interactionId === "interaction-option");
    assert.equal(optionAction!.associatedField, "Categoría de producto");
    assert.equal(optionAction!.semanticField, "Categoría de producto");
  } finally {
    await cleanup([jobId]);
  }
});

test("2/technicalTargetRefsPreserved. the option's technicalTargetRefs/technicalTargetRef survive reconciliation byte-for-byte", async () => {
  const jobId = "hermetic-option-lineage-target-preserved";
  try {
    writePreviewJob(jobId, [baseVirtualCase()]);
    const result = await prepareRerun(jobId, "all", undefined);
    if (!result.ok || result.jobType !== "scenario-preview") throw new Error("unexpected result shape");
    const optionAction = result.scenarios[0].recordingExecutionContract!.actions.find((a) => a.interactionId === "interaction-option");
    assert.deepEqual(optionAction!.technicalTargetRefs, ["role:option|Cuentas de Efectivo", "css:#opt-1"]);
    assert.equal(optionAction!.technicalTargetRef, "role:option|Cuentas de Efectivo");
  } finally {
    await cleanup([jobId]);
  }
});

test("3/ownerUnaffected. the owner action's own semanticField/associatedField are unchanged (already correct)", async () => {
  const jobId = "hermetic-option-lineage-owner-unaffected";
  try {
    writePreviewJob(jobId, [baseVirtualCase()]);
    const result = await prepareRerun(jobId, "all", undefined);
    if (!result.ok || result.jobType !== "scenario-preview") throw new Error("unexpected result shape");
    const ownerAction = result.scenarios[0].recordingExecutionContract!.actions.find((a) => a.interactionId === "interaction-owner");
    assert.equal(ownerAction!.associatedField, "Categoría de producto");
  } finally {
    await cleanup([jobId]);
  }
});

test("4/noSelectSiblingNoFabrication. an option with no corroborating select sibling keeps its own (unreconciled) semanticField -- never fabricated", async () => {
  const jobId = "hermetic-option-lineage-no-sibling";
  try {
    const interactions = staleCanonicalInteractions().filter((i) => i.action !== "select");
    const actions = staleContractActions();
    writePreviewJob(jobId, [baseVirtualCase({ canonicalInteractions: interactions, recordingExecutionContract: { actions, runtimeInputRequirements: [] } })]);
    const result = await prepareRerun(jobId, "all", undefined);
    if (!result.ok || result.jobType !== "scenario-preview") throw new Error("unexpected result shape");
    const optionAction = result.scenarios[0].recordingExecutionContract!.actions.find((a) => a.interactionId === "interaction-option");
    assert.equal(optionAction!.associatedField, "Cuentas de Efectivo", "without a select sibling, nothing to reconcile against -- left as-is, fails closed downstream");
  } finally {
    await cleanup([jobId]);
  }
});

test("5/alreadyCorrectContractUnchanged. a VirtualCase already carrying correct lineage is not altered", async () => {
  const jobId = "hermetic-option-lineage-already-correct";
  try {
    const interactions = staleCanonicalInteractions().map((i) => i.id === "interaction-option" ? { ...i, semanticField: "Categoría de producto" } : i);
    const actions = staleContractActions().map((a) => a.interactionId === "interaction-option" ? { ...a, semanticField: "Categoría de producto", associatedField: "Categoría de producto" } : a);
    writePreviewJob(jobId, [baseVirtualCase({ canonicalInteractions: interactions, recordingExecutionContract: { actions, runtimeInputRequirements: [] } })]);
    const result = await prepareRerun(jobId, "all", undefined);
    if (!result.ok || result.jobType !== "scenario-preview") throw new Error("unexpected result shape");
    const optionAction = result.scenarios[0].recordingExecutionContract!.actions.find((a) => a.interactionId === "interaction-option");
    assert.equal(optionAction!.associatedField, "Categoría de producto");
  } finally {
    await cleanup([jobId]);
  }
});

test("6/ambiguousSelectSiblingsNotReconciled. two same-screen select siblings recording the same value: reconciliation is skipped, not guessed", async () => {
  const jobId = "hermetic-option-lineage-ambiguous";
  try {
    const interactions = [
      ...staleCanonicalInteractions(),
      { id: "interaction-select-2", action: "select", semanticField: "Otro Campo", recordedValue: "Cuentas de Efectivo", screenBeforeRef: "s1" },
    ];
    writePreviewJob(jobId, [baseVirtualCase({ canonicalInteractions: interactions })]);
    const result = await prepareRerun(jobId, "all", undefined);
    if (!result.ok || result.jobType !== "scenario-preview") throw new Error("unexpected result shape");
    const optionAction = result.scenarios[0].recordingExecutionContract!.actions.find((a) => a.interactionId === "interaction-option");
    assert.equal(optionAction!.associatedField, "Cuentas de Efectivo", "ambiguous owner candidates must never be resolved by guessing either one");
  } finally {
    await cleanup([jobId]);
  }
});
