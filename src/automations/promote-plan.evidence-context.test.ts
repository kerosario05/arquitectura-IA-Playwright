import assert from "node:assert/strict";
import test from "node:test";
import { buildVerifyPromotedSpecExecEnv } from "./promote-plan";

/**
 * verifyPromotedSpec's spawned Playwright process never received the reuse run's evidence
 * context (EVIDENCE_RUN_ID/SCENARIO_ID/etc.), so promoted-spec-runtime.ts's evidence recorder
 * captured evidence under an unaddressable runId=undefined path. buildVerifyPromotedSpecExecEnv
 * is the pure function that decides the child process env; tested here in isolation so the
 * exact keys injected — and the guarantee that process.env itself is never mutated — are
 * provable without spawning a real process.
 */

test("1. evidenceContext present -> child exec env carries exactly the reuse jobId/scenario context", () => {
  const env = buildVerifyPromotedSpecExecEnv({
    evidenceContext: {
      runId: "reuse-job-123",
      scenarioId: "REC-D8DBD8F9-01",
      scenarioTitle: "Tarjeta",
      appSlug: "kiosko",
      sectionSlug: "pagos",
    },
  });
  assert.equal(env.EVIDENCE_RUN_ID, "reuse-job-123");
  assert.equal(env.SCENARIO_ID, "REC-D8DBD8F9-01");
  assert.equal(env.SCENARIO_TITLE, "Tarjeta");
  assert.equal(env.EVIDENCE_APP_SLUG, "kiosko");
  assert.equal(env.EVIDENCE_SECTION_SLUG, "pagos");
});

test("2. no evidenceContext -> previous behavior preserved (process.env itself returned unchanged, no evidence keys injected)", () => {
  const env = buildVerifyPromotedSpecExecEnv({});
  assert.equal(env, process.env, "with no headless and no evidenceContext, the exact same process.env reference must be returned, matching prior behavior");
  assert.equal(env.EVIDENCE_RUN_ID, undefined);

  const envWithHeadless = buildVerifyPromotedSpecExecEnv({ headless: true });
  assert.notEqual(envWithHeadless, process.env, "headless still forces a copy, as before");
  assert.equal(envWithHeadless.HEADLESS, "true");
  assert.equal(envWithHeadless.EVIDENCE_RUN_ID, undefined);
});

test("3. process.env global is never mutated by building an evidence-scoped exec env", () => {
  const before = { ...process.env };
  buildVerifyPromotedSpecExecEnv({
    headless: true,
    evidenceContext: {
      runId: "job-A",
      scenarioId: "SCN-A",
      scenarioTitle: "A",
      appSlug: "app-a",
      sectionSlug: "section-a",
    },
  });
  assert.equal(process.env.EVIDENCE_RUN_ID, before.EVIDENCE_RUN_ID, "process.env.EVIDENCE_RUN_ID must remain whatever it was before (undefined here)");
  assert.deepEqual({ ...process.env }, before, "process.env must be bit-for-bit unchanged after building a scoped exec env");
});

test("4. two scenarios with distinct evidenceContexts never contaminate each other", () => {
  const envA = buildVerifyPromotedSpecExecEnv({
    evidenceContext: { runId: "job-1", scenarioId: "SCN-1", scenarioTitle: "Uno", appSlug: "app-1", sectionSlug: "sec-1" },
  });
  const envB = buildVerifyPromotedSpecExecEnv({
    evidenceContext: { runId: "job-2", scenarioId: "SCN-2", scenarioTitle: "Dos", appSlug: "app-2", sectionSlug: "sec-2" },
  });
  assert.notEqual(envA, envB, "each call must produce its own independent object");
  assert.equal(envA.SCENARIO_ID, "SCN-1");
  assert.equal(envB.SCENARIO_ID, "SCN-2");
  // Mutating one copy must never leak into the other or into process.env.
  envA.SCENARIO_ID = "MUTATED";
  assert.equal(envB.SCENARIO_ID, "SCN-2", "envB must be unaffected by mutating envA's copy");
  assert.equal(process.env.SCENARIO_ID, undefined, "mutating a returned copy must never reach process.env");
});
