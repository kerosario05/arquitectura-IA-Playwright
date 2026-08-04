import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import type { Server } from "node:http";
import { runsRouter, resolveEvidenceDocxForJob } from "./runs";
import { jobStore } from "../jobs/job-store";

const ROOT = process.cwd();
const EVIDENCE_ROOT = path.join(ROOT, ".artifacts", "evidence");
const PREVIEW_ROOT = path.join(ROOT, ".artifacts", "scenario-preview-runs");

type AsyncTestFn = () => void | Promise<void>;

async function test(label: string, fn: AsyncTestFn): Promise<void> {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function removeIfExists(targetPath: string): void {
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

function writeEvidenceDocx(jobId: string, appSlug: string, sectionSlug: string, content: string): string {
  const docPath = path.join(EVIDENCE_ROOT, appSlug, sectionSlug, "runs", jobId, "evidencia.docx");
  fs.mkdirSync(path.dirname(docPath), { recursive: true });
  fs.writeFileSync(docPath, content, "utf-8");
  return docPath;
}

function writePreviewJobMetadata(
  jobId: string,
  metadata: { appSlug?: string; sectionSlug?: string; status?: string },
): string {
  const previewDir = path.join(PREVIEW_ROOT, jobId);
  fs.mkdirSync(previewDir, { recursive: true });
  fs.writeFileSync(path.join(previewDir, "job.json"), JSON.stringify(metadata, null, 2), "utf-8");
  return previewDir;
}

async function withServer(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = express();
  app.use("/api/runs", runsRouter);
  let server: Server | undefined;
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const address = server!.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const baseUrl = `http://localhost:${port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  }
}

async function main(): Promise<void> {
  console.log("\nruns evidence docx");

  await test("registers /:jobId/evidence-docx/status route", () => {
    const hasRoute = (runsRouter as any).stack.some((layer: any) => (
      layer?.route?.path === "/:jobId/evidence-docx/status"
      && layer?.route?.methods?.get === true
    ));
    assert.strictEqual(hasRoute, true);
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
    const resolved = resolveEvidenceDocxForJob(readyJobId);
    assert.strictEqual(resolved.status, "ready");
    assert.strictEqual(resolved.documentReady, true);
    assert.strictEqual(resolved.documentPath, readyDocPath);
    assert.strictEqual(resolved.appSlug, appSlug);
    assert.strictEqual(resolved.sectionSlug, sectionSlug);
  });

  await test("status and download resolve the same ready document", async () => {
    await withServer(async (baseUrl) => {
      const statusRes = await fetch(`${baseUrl}/api/runs/${readyJobId}/evidence-docx/status`);
      assert.strictEqual(statusRes.status, 200);
      const statusBody = await statusRes.json() as any;
      assert.strictEqual(statusBody.status, "ready");
      assert.strictEqual(statusBody.documentReady, true);

      const downloadRes = await fetch(`${baseUrl}/api/runs/${readyJobId}/evidence-docx`);
      assert.strictEqual(downloadRes.status, 200);
      const text = await downloadRes.text();
      assert.strictEqual(text, "DOCX READY");
    });
  });

  const runningJob = jobStore.create("scenario-preview", {
    appSlug: `run-app-${Date.now()}`,
    sectionSlug: "run-section",
  });
  jobStore.update(runningJob.id, { status: "running" });

  await test("existing running job without docx returns preparing", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/runs/${runningJob.id}/evidence-docx/status`);
      assert.strictEqual(res.status, 202);
      const body = await res.json() as any;
      assert.strictEqual(body.status, "preparing");
      assert.strictEqual(body.documentReady, false);
      assert.strictEqual(body.reasonCode, "document_preparing");
    });
  });

  const doneJob = jobStore.create("scenario-preview", {
    appSlug: `done-app-${Date.now()}`,
    sectionSlug: "done-section",
  });
  jobStore.update(doneJob.id, { status: "done" });

  await test("existing terminal done job without docx returns unavailable", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/runs/${doneJob.id}/evidence-docx/status`);
      assert.strictEqual(res.status, 200);
      const body = await res.json() as any;
      assert.strictEqual(body.status, "unavailable");
      assert.strictEqual(body.documentReady, false);
    });
  });

  const failedJob = jobStore.create("scenario-preview", {
    appSlug: `failed-app-${Date.now()}`,
    sectionSlug: "failed-section",
  });
  jobStore.update(failedJob.id, { status: "failed" });

  await test("existing terminal failed job without docx returns failed", async () => {
    await withServer(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/runs/${failedJob.id}/evidence-docx/status`);
      assert.strictEqual(res.status, 200);
      const body = await res.json() as any;
      assert.strictEqual(body.status, "failed");
      assert.strictEqual(body.documentReady, false);
      assert.strictEqual(body.reasonCode, "document_generation_failed");
    });
  });

  await test("missing job returns 404 with job_not_found", async () => {
    await withServer(async (baseUrl) => {
      const missingId = `missing-${Date.now()}`;
      const res = await fetch(`${baseUrl}/api/runs/${missingId}/evidence-docx/status`);
      assert.strictEqual(res.status, 404);
      const body = await res.json() as any;
      assert.strictEqual(body.reasonCode, "job_not_found");
      assert.strictEqual(body.documentReady, false);
    });
  });

  removeIfExists(previewDir);
  removeIfExists(path.join(EVIDENCE_ROOT, appSlug));
}

void main();
