import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildBatchResultPath,
  buildDiscoveryChildEnv,
  readStructuredChildResult,
} from "../src/server/jobs/discovery-batch-runner";

test("reads contextMaterialized from the job-scoped structured child result", async () => {
  const jobId = "carrier-test";
  const resultPath = buildBatchResultPath(jobId);
  await fs.mkdir(path.dirname(resultPath), { recursive: true });
  await fs.writeFile(resultPath, JSON.stringify({
    cases: [{ caseId: 123, status: "discovered_passed", contextMaterialized: true }],
  }), "utf8");

  try {
    const result = await readStructuredChildResult(resultPath, 123);
    expect(result).toEqual({ status: "discovered_passed", contextMaterialized: true });
  } finally {
    await fs.rm(resultPath, { force: true });
  }
});

test("keeps legacy child results compatible and does not infer the signal", async () => {
  const jobId = "carrier-legacy-test";
  const resultPath = buildBatchResultPath(jobId);
  await fs.mkdir(path.dirname(resultPath), { recursive: true });
  await fs.writeFile(resultPath, JSON.stringify({
    cases: [{ caseId: 123, status: "discovered_passed" }],
  }), "utf8");

  try {
    const result = await readStructuredChildResult(resultPath, 123);
    expect(result).toEqual({ status: "discovered_passed", contextMaterialized: false });
  } finally {
    await fs.rm(resultPath, { force: true });
  }
});

test("forwards the deterministic batch result path through child environment", () => {
  const env = buildDiscoveryChildEnv({}, undefined, buildBatchResultPath("carrier-env-test"));
  expect(env.DISCOVERY_BATCH_RESULT_PATH).toContain("carrier-env-test.json");
});
