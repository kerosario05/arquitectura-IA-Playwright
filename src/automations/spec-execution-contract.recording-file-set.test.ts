import assert from "node:assert/strict";
import test from "node:test";
import { buildSpecExecutionContract } from "./spec-execution-contract";

test("Recording file-set key survives the validated-plan execution contract", () => {
  const plan = {
    version: "1.0", source: "discovery_generated", status: "validated",
    scenario: { source: "manual", title: "upload" }, requiredData: [],
    steps: [{ index: 1, action: "uploadFile", description: "Attach documents", recordingActionType: "upload", fileSetValueKey: "recorded_upload_8", technicalTargetRefs: ["label:Supporting documents"] }],
    createdAt: new Date().toISOString(),
  } as any;
  const scenario = { steps: [{ index: 1, action: "Attach one or more documents", recordingActionType: "upload", fileSetValueKey: "recorded_upload_8" }] } as any;
  const step = buildSpecExecutionContract(plan, scenario).steps[0];
  assert.equal(step.operation, "upload");
  assert.equal(step.fileSetValueKey, "recorded_upload_8");
});
