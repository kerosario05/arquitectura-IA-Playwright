import assert from "node:assert/strict";
import test from "node:test";
import { defectChecklistStore } from "../src/server/services/defect-checklist-store";
import { buildDiscoveryBatchDefectDedupeKey } from "../src/server/jobs/discovery-batch-runner";

function checklist(defects: any[]) {
  return {
    id: "checklist",
    issueKey: "launch:same-launch",
    urlSlug: "launch:same-launch",
    defects,
    createdAt: "now",
    updatedAt: "now",
  } as any;
}

function defect(jobId: string, caseId: number, id = `${jobId}-${caseId}`) {
  return {
    id,
    jobId,
    description: "failure",
    severity: "medium",
    status: "pending_review",
    createdAt: "now",
    updatedAt: "now",
    technicalContext: { caseId, dedupeKey: buildDiscoveryBatchDefectDedupeKey({ jobId, caseId }) },
  };
}

test("T1-T4/T6 checklist response is isolated by job while preserving history", () => {
  const list = checklist([
    defect("job-a", 44649),
    defect("job-a", 44650),
    defect("job-a", 44651),
    defect("job-b", 44651),
  ]);
  assert.equal(defectChecklistStore.toResponse(list, { jobId: "job-a" }).total, 3);
  assert.equal(defectChecklistStore.toResponse(list, { jobId: "job-b" }).total, 1);
  assert.equal(defectChecklistStore.toResponse(list, { jobId: "job-b" }).defects[0].jobId, "job-b");
  assert.equal(defectChecklistStore.toResponse(list).total, 4);
});

test("T5 dedupe identity is stable within a job and distinct across jobs", () => {
  const sameJob = buildDiscoveryBatchDefectDedupeKey({ jobId: "job-a", caseId: 44651 });
  const sameFailure = buildDiscoveryBatchDefectDedupeKey({ jobId: "job-a", caseId: 44651 });
  const otherJob = buildDiscoveryBatchDefectDedupeKey({ jobId: "job-b", caseId: 44651 });
  assert.equal(sameJob, sameFailure);
  assert.notEqual(sameJob, otherJob);
});

test("focal job 84e1 returns only its current defect without deleting history", () => {
  const list = defectChecklistStore.get("launch:9f1181a6-827e-4b25-817c-602e4129b571");
  assert.ok(list);
  assert.equal(list.defects.length, 3);
  const response = defectChecklistStore.toResponse(list, { jobId: "84e1a685-b1ad-478c-8493-ac7a04b158bc" });
  assert.equal(response.total, 1);
  assert.equal(response.defects[0].jobId, "84e1a685-b1ad-478c-8493-ac7a04b158bc");
});
