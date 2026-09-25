"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const express_1 = __importDefault(require("express"));
const runs_1 = require("./runs");
const job_store_1 = require("../jobs/job-store");
const ROOT = process.cwd();
const EVIDENCE_ROOT = node_path_1.default.join(ROOT, ".artifacts", "evidence");
const PREVIEW_ROOT = node_path_1.default.join(ROOT, ".artifacts", "scenario-preview-runs");
async function test(label, fn) {
    try {
        await fn();
        console.log(`  PASS  ${label}`);
    }
    catch (err) {
        console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
}
function removeIfExists(targetPath) {
    if (node_fs_1.default.existsSync(targetPath)) {
        node_fs_1.default.rmSync(targetPath, { recursive: true, force: true });
    }
}
function writeEvidenceDocx(jobId, appSlug, sectionSlug, content) {
    const docPath = node_path_1.default.join(EVIDENCE_ROOT, appSlug, sectionSlug, "runs", jobId, "evidencia.docx");
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(docPath), { recursive: true });
    node_fs_1.default.writeFileSync(docPath, content, "utf-8");
    return docPath;
}
function writePreviewJobMetadata(jobId, metadata) {
    const previewDir = node_path_1.default.join(PREVIEW_ROOT, jobId);
    node_fs_1.default.mkdirSync(previewDir, { recursive: true });
    node_fs_1.default.writeFileSync(node_path_1.default.join(previewDir, "job.json"), JSON.stringify(metadata, null, 2), "utf-8");
    return previewDir;
}
async function withServer(fn) {
    const app = (0, express_1.default)();
    app.use("/api/runs", runs_1.runsRouter);
    let server;
    await new Promise((resolve) => {
        server = app.listen(0, () => resolve());
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const baseUrl = `http://localhost:${port}`;
    try {
        await fn(baseUrl);
    }
    finally {
        await new Promise((resolve) => server.close(() => resolve()));
    }
}
async function main() {
    console.log("\nruns evidence docx");
    await test("registers /:jobId/evidence-docx/status route", () => {
        const hasRoute = runs_1.runsRouter.stack.some((layer) => (layer?.route?.path === "/:jobId/evidence-docx/status"
            && layer?.route?.methods?.get === true));
        node_assert_1.default.strictEqual(hasRoute, true);
    });
    const readyJobId = `docx-ready-${Date.now()}`;
    const appSlug = `test-app-${Date.now()}`;
    const sectionSlug = "test-section";
    const previewDir = writePreviewJobMetadata(readyJobId, {
        appSlug,
        sectionSlug,
        status: "done",
    });
    const readyDocPath = writeEvidenceDocx(readyJobId, appSlug, sectionSlug, "DOCX READY");
    await test("resolver finds structured path from appSlug + sectionSlug + jobId", () => {
        const resolved = (0, runs_1.resolveEvidenceDocxForJob)(readyJobId);
        node_assert_1.default.strictEqual(resolved.status, "ready");
        node_assert_1.default.strictEqual(resolved.documentReady, true);
        node_assert_1.default.strictEqual(resolved.documentPath, readyDocPath);
        node_assert_1.default.strictEqual(resolved.appSlug, appSlug);
        node_assert_1.default.strictEqual(resolved.sectionSlug, sectionSlug);
    });
    await test("status and download resolve the same ready document", async () => {
        await withServer(async (baseUrl) => {
            const statusRes = await fetch(`${baseUrl}/api/runs/${readyJobId}/evidence-docx/status`);
            node_assert_1.default.strictEqual(statusRes.status, 200);
            const statusBody = await statusRes.json();
            node_assert_1.default.strictEqual(statusBody.status, "ready");
            node_assert_1.default.strictEqual(statusBody.documentReady, true);
            const downloadRes = await fetch(`${baseUrl}/api/runs/${readyJobId}/evidence-docx`);
            node_assert_1.default.strictEqual(downloadRes.status, 200);
            const text = await downloadRes.text();
            node_assert_1.default.strictEqual(text, "DOCX READY");
        });
    });
    const runningJob = job_store_1.jobStore.create("scenario-preview", {
        appSlug: `run-app-${Date.now()}`,
        sectionSlug: "run-section",
    });
    job_store_1.jobStore.update(runningJob.id, { status: "running" });
    await test("existing running job without docx returns preparing", async () => {
        await withServer(async (baseUrl) => {
            const res = await fetch(`${baseUrl}/api/runs/${runningJob.id}/evidence-docx/status`);
            node_assert_1.default.strictEqual(res.status, 202);
            const body = await res.json();
            node_assert_1.default.strictEqual(body.status, "preparing");
            node_assert_1.default.strictEqual(body.documentReady, false);
            node_assert_1.default.strictEqual(body.reasonCode, "document_preparing");
        });
    });
    const doneJob = job_store_1.jobStore.create("scenario-preview", {
        appSlug: `done-app-${Date.now()}`,
        sectionSlug: "done-section",
    });
    job_store_1.jobStore.update(doneJob.id, { status: "done" });
    await test("existing terminal done job without docx returns unavailable", async () => {
        await withServer(async (baseUrl) => {
            const res = await fetch(`${baseUrl}/api/runs/${doneJob.id}/evidence-docx/status`);
            node_assert_1.default.strictEqual(res.status, 200);
            const body = await res.json();
            node_assert_1.default.strictEqual(body.status, "unavailable");
            node_assert_1.default.strictEqual(body.documentReady, false);
        });
    });
    const nonExecutableJob = job_store_1.jobStore.create("discovery-batch", {
        appSlug: `none-app-${Date.now()}`,
        sectionSlug: "none-section",
    });
    job_store_1.jobStore.update(nonExecutableJob.id, {
        status: "done",
        summary: {
            totalStories: 3,
            synced: 0,
            passed: 0,
            failed: 0,
            reasonCode: "cases_not_executable",
        },
    });
    await test("done job with cases_not_executable reports explicit unavailable reason", async () => {
        await withServer(async (baseUrl) => {
            const res = await fetch(`${baseUrl}/api/runs/${nonExecutableJob.id}/evidence-docx/status`);
            node_assert_1.default.strictEqual(res.status, 200);
            const body = await res.json();
            node_assert_1.default.strictEqual(body.status, "unavailable");
            node_assert_1.default.strictEqual(body.documentReady, false);
            node_assert_1.default.strictEqual(body.reasonCode, "cases_not_executable");
        });
    });
    const docFailedJob = job_store_1.jobStore.create("discovery-batch", {
        appSlug: `docfail-app-${Date.now()}`,
        sectionSlug: "docfail-section",
    });
    job_store_1.jobStore.update(docFailedJob.id, {
        status: "done",
        summary: {
            totalStories: 2,
            synced: 2,
            passed: 1,
            failed: 1,
            documentAttempted: true,
            documentGenerated: false,
            documentPathPresent: false,
        },
    });
    await test("done job with failed document generation reports document_generation_failed", async () => {
        await withServer(async (baseUrl) => {
            const res = await fetch(`${baseUrl}/api/runs/${docFailedJob.id}/evidence-docx/status`);
            node_assert_1.default.strictEqual(res.status, 200);
            const body = await res.json();
            node_assert_1.default.strictEqual(body.status, "unavailable");
            node_assert_1.default.strictEqual(body.documentReady, false);
            node_assert_1.default.strictEqual(body.reasonCode, "document_generation_failed");
        });
    });
    const evidenceInitFailedJob = job_store_1.jobStore.create("discovery-batch", {
        appSlug: `evfail-app-${Date.now()}`,
        sectionSlug: "evfail-section",
    });
    job_store_1.jobStore.update(evidenceInitFailedJob.id, {
        status: "done",
        summary: {
            totalStories: 2,
            synced: 0,
            passed: 0,
            failed: 0,
            reasonCode: "evidence_initialization_failed",
            documentAttempted: true,
            documentGenerated: false,
            documentPathPresent: false,
        },
    });
    await test("done job with recorder init failure reports evidence_initialization_failed", async () => {
        await withServer(async (baseUrl) => {
            const res = await fetch(`${baseUrl}/api/runs/${evidenceInitFailedJob.id}/evidence-docx/status`);
            node_assert_1.default.strictEqual(res.status, 200);
            const body = await res.json();
            node_assert_1.default.strictEqual(body.status, "unavailable");
            node_assert_1.default.strictEqual(body.documentReady, false);
            node_assert_1.default.strictEqual(body.reasonCode, "evidence_initialization_failed");
        });
    });
    const failedJob = job_store_1.jobStore.create("scenario-preview", {
        appSlug: `failed-app-${Date.now()}`,
        sectionSlug: "failed-section",
    });
    job_store_1.jobStore.update(failedJob.id, { status: "failed" });
    await test("existing terminal failed job without docx returns failed", async () => {
        await withServer(async (baseUrl) => {
            const res = await fetch(`${baseUrl}/api/runs/${failedJob.id}/evidence-docx/status`);
            node_assert_1.default.strictEqual(res.status, 200);
            const body = await res.json();
            node_assert_1.default.strictEqual(body.status, "failed");
            node_assert_1.default.strictEqual(body.documentReady, false);
            node_assert_1.default.strictEqual(body.reasonCode, "document_generation_failed");
        });
    });
    await test("missing job returns 404 with job_not_found", async () => {
        await withServer(async (baseUrl) => {
            const missingId = `missing-${Date.now()}`;
            const res = await fetch(`${baseUrl}/api/runs/${missingId}/evidence-docx/status`);
            node_assert_1.default.strictEqual(res.status, 404);
            const body = await res.json();
            node_assert_1.default.strictEqual(body.reasonCode, "job_not_found");
            node_assert_1.default.strictEqual(body.documentReady, false);
        });
    });
    removeIfExists(previewDir);
    removeIfExists(node_path_1.default.join(EVIDENCE_ROOT, appSlug));
}
void main();
