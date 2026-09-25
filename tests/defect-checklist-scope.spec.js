"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const defect_checklist_store_1 = require("../src/server/services/defect-checklist-store");
const discovery_batch_runner_1 = require("../src/server/jobs/discovery-batch-runner");
function checklist(defects) {
    return {
        id: "checklist",
        issueKey: "launch:same-launch",
        urlSlug: "launch:same-launch",
        defects,
        createdAt: "now",
        updatedAt: "now",
    };
}
function defect(jobId, caseId, id = `${jobId}-${caseId}`) {
    return {
        id,
        jobId,
        description: "failure",
        severity: "medium",
        status: "pending_review",
        createdAt: "now",
        updatedAt: "now",
        technicalContext: { caseId, dedupeKey: (0, discovery_batch_runner_1.buildDiscoveryBatchDefectDedupeKey)({ jobId, caseId }) },
    };
}
(0, node_test_1.default)("T1-T4/T6 checklist response is isolated by job while preserving history", () => {
    const list = checklist([
        defect("job-a", 44649),
        defect("job-a", 44650),
        defect("job-a", 44651),
        defect("job-b", 44651),
    ]);
    strict_1.default.equal(defect_checklist_store_1.defectChecklistStore.toResponse(list, { jobId: "job-a" }).total, 3);
    strict_1.default.equal(defect_checklist_store_1.defectChecklistStore.toResponse(list, { jobId: "job-b" }).total, 1);
    strict_1.default.equal(defect_checklist_store_1.defectChecklistStore.toResponse(list, { jobId: "job-b" }).defects[0].jobId, "job-b");
    strict_1.default.equal(defect_checklist_store_1.defectChecklistStore.toResponse(list).total, 4);
});
(0, node_test_1.default)("T5 dedupe identity is stable within a job and distinct across jobs", () => {
    const sameJob = (0, discovery_batch_runner_1.buildDiscoveryBatchDefectDedupeKey)({ jobId: "job-a", caseId: 44651 });
    const sameFailure = (0, discovery_batch_runner_1.buildDiscoveryBatchDefectDedupeKey)({ jobId: "job-a", caseId: 44651 });
    const otherJob = (0, discovery_batch_runner_1.buildDiscoveryBatchDefectDedupeKey)({ jobId: "job-b", caseId: 44651 });
    strict_1.default.equal(sameJob, sameFailure);
    strict_1.default.notEqual(sameJob, otherJob);
});
(0, node_test_1.default)("focal job 84e1 returns only its current defect without deleting history", () => {
    const list = defect_checklist_store_1.defectChecklistStore.get("launch:9f1181a6-827e-4b25-817c-602e4129b571");
    strict_1.default.ok(list);
    strict_1.default.equal(list.defects.length, 3);
    const response = defect_checklist_store_1.defectChecklistStore.toResponse(list, { jobId: "84e1a685-b1ad-478c-8493-ac7a04b158bc" });
    strict_1.default.equal(response.total, 1);
    strict_1.default.equal(response.defects[0].jobId, "84e1a685-b1ad-478c-8493-ac7a04b158bc");
});
