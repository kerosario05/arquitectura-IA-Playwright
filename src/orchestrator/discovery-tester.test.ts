import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { assertDiscoveryInputProject, extractFunctionalFailureDiagnostics, extractScopeCountDiagnostics, runDiscoveryRerun } from "./discovery-tester";
import type { QaLabReference, TaskContract } from "./types";

test("Discovery tester preserves only the non-sensitive structural scope count", () => {
  assert.deepEqual(extractScopeCountDiagnostics([
    "noise token=must-not-escape",
    "[recording-replay][structural-match] reason=scoped_scope_not_unique strategy=id scopeMatchCount=0",
    "[recording-replay][structural-match] reason=scoped_scope_not_unique strategy=css scopeMatchCount=2",
  ].join("\n")), [
    "scoped_scope_not_unique strategy=id scopeMatchCount=0",
    "scoped_scope_not_unique strategy=css scopeMatchCount=2",
  ]);
});

test("Discovery tester preserves the actionable standalone functional failure instead of a generic eligibility reason", () => {
  const line = '[functional-execution] exitCode=1 error="Error: Promoted click failed at step 6 target=role:button reason=structural_authority_not_unique_or_unresolved structuralFailureReason=action_owner_ambiguous" file="case.spec.ts:12:5"';
  assert.deepEqual(extractFunctionalFailureDiagnostics(line), ["Error: Promoted click failed at step 6 target=role:button reason=structural_authority_not_unique_or_unresolved structuralFailureReason=action_owner_ambiguous"]);
});

test("local Discovery project validation accepts the real scenario-array input only when every appSlug matches", () => {
  assert.doesNotThrow(() => assertDiscoveryInputProject([{ appSlug: "roke" }, { appSlug: "roke" }], "roke"));
  assert.throws(() => assertDiscoveryInputProject([{ appSlug: "roke" }, { appSlug: "other" }], "roke"), /project mismatch/);
  assert.throws(() => assertDiscoveryInputProject([{ title: "missing project" }], "roke"), /project mismatch/);
});

test("Discovery tester reruns the referenced job as a new job and preserves project/gate evidence", async () => {
  const server = createServer((req, res) => {
    const body = (value: unknown) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
    if (req.method === "POST" && req.url === "/api/runs/job-source/rerun") return body({ id: "job-fresh", status: "queued" });
    if (req.url === "/api/runs/job-source") return body({ id: "job-source", status: "completed_with_failures", params: { appSlug: "roke" } });
    if (req.url === "/api/runs/job-fresh") return body({ id: "job-fresh", status: "completed_with_failures", params: { appSlug: "roke" }, summary: { total: 1, passed: 0, failed: 1, failureGroups: { spec_generation_failed: 1 }, errorMessage: "generation failed" }, logs: ["spec generation failed"] });
    res.writeHead(404); res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const criterion = "Una corrida nueva confirma que el proyecto roke genera la spec; Auto-POM y promoción terminan en verde";
    const task: TaskContract = { taskId: "task-discovery-test", objective: "repair promotion", successCriteria: [criterion], physicalValidationRequired: false, currentFrontier: "spec generation", physicalGreens: [], allowedStopReasons: ["SUCCESS", "HUMAN_GATE", "EXTERNAL_BLOCKER"], qaLabBaseUrl: `http://127.0.0.1:${address.port}` };
    const reference: QaLabReference = { kind: "discovery-job", id: "job-source", projectSlug: "roke", inputPath: ".artifacts/scenario-preview-runs/job-source/preview-scenarios.json" };
    const result = await runDiscoveryRerun(task, reference, 1);
    assert.equal(result.actor, "CODEX_TESTER");
    assert.equal(result.sourceJobId, "job-source");
    assert.equal(result.jobId, "job-fresh");
    assert.notEqual(result.jobId, result.sourceJobId);
    assert.equal(result.appSlug, "roke");
    assert.equal(result.status, "failed");
    assert.deepEqual(result.failedGates, ["spec_generation_failed"]);
    assert.deepEqual(result.successCriteriaSatisfied, []);
    assert.deepEqual(result.successCriteriaOpen, [criterion]);
    assert.match(result.firstLoss?.evidence ?? "", /job-fresh/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("a stale API job id falls back to the validated saved Discovery input and still creates a fresh job", async () => {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`);
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "Job not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address === "object");
    const criterion = "Spec promoted in ROKE";
    const task: TaskContract = { taskId: "task-discovery-fallback", objective: "repair promotion", successCriteria: [criterion], physicalValidationRequired: false, currentFrontier: "spec generation", physicalGreens: [], allowedStopReasons: ["SUCCESS", "HUMAN_GATE", "EXTERNAL_BLOCKER"], qaLabBaseUrl: `http://127.0.0.1:${address.port}` };
    const reference: QaLabReference = { kind: "discovery-job", id: "job-source", projectSlug: "roke", inputPath: ".artifacts/scenario-preview-runs/job-source/preview-scenarios.json", validatedCommand: ["run", "discovery:preview", "--", "--input", ".artifacts/scenario-preview-runs/job-source/preview-scenarios.json", "--app", "roke", "--overwrite", "--auto-promote", "--auto-pom", "--rerun-active"] };
    let invokedReference: QaLabReference | undefined;
    let invokedFreshId = "";
    const result = await runDiscoveryRerun(task, reference, 1, undefined, {
      localRunner: async (receivedReference, freshId) => {
        invokedReference = receivedReference;
        invokedFreshId = freshId;
        return {
          id: freshId,
          status: "completed_with_failures",
          params: { appSlug: "roke" },
          summary: { total: 1, passed: 0, failed: 1, failureGroups: { spec_generation_failed: 1 } },
          results: { summary: { total: 1, passed: 0, failed: 1, failureGroups: { spec_generation_failed: 1 } }, cases: [{ appSlug: "roke", specWritten: false, promotionAllowed: false }] },
          logs: ["reason=scoped_scope_not_unique strategy=css scopeMatchCount=0"],
        };
      },
    });
    assert.deepEqual(requests, ["GET /api/runs/job-source"]);
    assert.equal(invokedReference, reference);
    assert.ok(invokedFreshId);
    assert.notEqual(invokedFreshId, reference.id);
    assert.equal(result.jobId, invokedFreshId);
    assert.equal(result.appSlug, "roke");
    assert.equal(result.status, "failed");
    assert.deepEqual(result.failedGates, ["spec_generation_failed"]);
    assert.match(result.firstLoss?.evidence ?? "", /scopeMatchCount=0/);
    assert.equal(result.externalBlocker, false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
