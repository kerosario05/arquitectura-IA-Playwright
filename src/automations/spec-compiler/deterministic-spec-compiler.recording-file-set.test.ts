import assert from "node:assert/strict";
import test from "node:test";
import { compileDeterministicSpec } from "./deterministic-spec-compiler";

test("promoted Recording upload compiles the runtime file-set key without fixed assets", () => {
  const result = compileDeterministicSpec({
    version: "1", scenarioId: "REC-test", title: "Attach documents", appSlug: "synthetic-app",
    steps: [{
      contractStepIndex: 0, scenarioStepIndex: 1, originalText: "Attach documents", operation: "upload",
      target: { strategy: "label", value: "Supporting documents" }, technicalTargetRefs: ["label:Supporting documents"],
      fileAssets: [], fileSetValueKey: "recorded_upload_8", required: true, executionStatus: "executed", evidenceRefs: [],
    }],
    unresolvedRequiredOracles: [], diagnostics: { requiredScenarioSteps: 1, representedScenarioSteps: 1, missingScenarioSteps: [] },
  } as any, { targetSpecPath: "C:/synthetic/case.spec.ts" });
  assert.match(result.source, /fileSetValueKey: 'recorded_upload_8'/);
  assert.equal(result.unsupportedCapabilities.some((value) => value.includes("recorded_upload_missing_project_assets_or_target")), false);
});

test("recorded native file-picker click is delegated only to the immediately following upload on the same field and tab", () => {
  const matchingInputEvidence = {
    kind: "text",
    normalizedName: "Supporting documents",
    targetTag: "input",
    scopeIdentity: { strategy: "id", value: "supporting-documents" },
    captureMatchCount: 1,
    runtimeResolutionRequired: true,
  } as const;
  const upload = {
    contractStepIndex: 1, scenarioStepIndex: 7, originalText: "Attach supporting documents", operation: "upload",
    target: { strategy: "semantic", value: "Supporting documents" },
    associatedField: "Supporting documents", technicalTargetRefs: ["id:supporting-documents"],
    fileAssets: [{ fileRef: "synthetic-file-ref", filename: "document.pdf", contentType: "application/pdf", size: 1, sha256: "0".repeat(64) }],
    fileSetValueKey: "recorded_upload_7", pageKey: "tab-1", required: true, executionStatus: "executed", evidenceRefs: [],
  };
  const click = {
    contractStepIndex: 0, scenarioStepIndex: 6, originalText: "Select supporting documents", operation: "click",
    target: { strategy: "text", value: "Supporting documents" },
    semanticRuntimeEvidence: { source: "accessible_name", normalizedValue: "Supporting documents", targetTag: "input", scopeAlternatives: [], captureUniqueTarget: true },
    playwrightRecorderEvidence: matchingInputEvidence,
    recordingActionType: "click", pageKey: "tab-1", required: true, executionStatus: "executed", evidenceRefs: [],
  };
  const contract = {
    version: "1", scenarioId: "REC-upload", title: "Attach documents", appSlug: "synthetic-app",
    steps: [click, upload], unresolvedRequiredOracles: [],
    diagnostics: { requiredScenarioSteps: 2, representedScenarioSteps: 2, missingScenarioSteps: [] },
  };

  const paired = compileDeterministicSpec(contract as any, { targetSpecPath: "C:/synthetic/case.spec.ts" });
  assert.match(paired.source, /completeRecordedFilePickerClick/);
  assert.match(paired.source, /uploadStepIndex: 7/);
  assert.doesNotMatch(paired.source, /target: 'text:Supporting documents',[\s\S]*?action: async \(\) => \{ await page\.getByText/);
  assert.ok(paired.bindings.some((binding) => binding.scenarioStepIndex === 6 && binding.operation === "click" && binding.runtimeMethod === "completeRecordedFilePickerClick"));
  assert.ok(paired.bindings.some((binding) => binding.scenarioStepIndex === 7 && binding.operation === "upload"));

  const otherTab = compileDeterministicSpec({ ...contract, steps: [click, { ...upload, pageKey: "tab-2" }] } as any, { targetSpecPath: "C:/synthetic/case.spec.ts" });
  assert.doesNotMatch(otherTab.source, /completeRecordedFilePickerClick/);

  const otherField = compileDeterministicSpec({
    ...contract,
    steps: [click, { ...upload, target: { strategy: "semantic", value: "Different field" }, associatedField: "Different field" }],
  } as any, { targetSpecPath: "C:/synthetic/case.spec.ts" });
  assert.doesNotMatch(otherField.source, /completeRecordedFilePickerClick/);
});
