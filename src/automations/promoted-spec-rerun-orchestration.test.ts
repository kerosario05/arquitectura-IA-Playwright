import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  computeTestRailPublishCandidates,
  partitionScenariosForExecution,
  resolveScenarioAutomationPlans,
  type TestRailCaseLookup,
  type TestRailDestination,
} from "./recording-automation-resolution";
import type { RecordedScenario } from "../recording/trace-to-scenario";

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

/**
 * Recording d8dbd8f9-b353-4175-b365-e5f8957bae36, scenario REC-D8DBD8F9-01: physical logs proved
 * a re-run of an already-promoted spec ("spec=fresh") still fell through TestRail publish ->
 * recording replay -> scenario-preview discovery -> AI generation, even though the UI promised
 * "sin volver a publicar casos en TestRail" and the promoted spec needed no regeneration at all.
 * Root cause: `partitionScenariosForExecution` only routed `decision === "reuse_existing"`
 * (requiring BOTH a verified TestRail case AND a fresh spec) into the fast path. Fixed to key
 * off `spec.status === "fresh"` alone — TestRail case existence remains relevant only for
 * whether a NEW case needs filing (see `computeTestRailPublishCandidates`, keyed off
 * `testRail.status === "missing"` alone), never as a prerequisite for running an
 * already-promoted spec. The SPEC decision and the TESTRAIL decision are independent axes.
 */

const DEST: TestRailDestination = { projectId: "30", suiteId: "37", sectionId: "5795" };

function scenario(overrides: Partial<RecordedScenario> = {}): Pick<RecordedScenario, "scenarioId" | "testRailCaseId" | "testRailDestination" | "promotedSpec"> {
  return {
    scenarioId: "REC-D8DBD8F9-01",
    ...overrides,
  };
}

async function freshSpecFixture(): Promise<{ specPath: string; specHash: string; cleanup: () => Promise<void> }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "promoted-spec-rerun-"));
  const specPath = path.join(root, "case.spec.ts");
  const automationPath = path.join(root, "automation.json");
  const specText = "test('Tarjeta', async () => {});";
  await fs.writeFile(specPath, specText, "utf-8");
  await fs.writeFile(automationPath, JSON.stringify({ status: "active", specVerificationStatus: "passed" }), "utf-8");
  const crypto = await import("node:crypto");
  const specHash = crypto.createHash("sha256").update(specText, "utf8").digest("hex");
  return { specPath, specHash, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

async function main(): Promise<void> {
  console.log("\nrerun orchestration — spec=fresh must short-circuit directly to physical execution");

  let fixture: Awaited<ReturnType<typeof freshSpecFixture>> | undefined;
  try {
    fixture = await freshSpecFixture();
    const freshPromotedSpec = { appSlug: "kiosko", specPath: fixture.specPath, specHash: fixture.specHash, automationId: "x", generatedAt: "t" };

    // TestRail is unverifiable/missing this run (matches the physical incident: the case's
    // identity could not be confirmed as an exact match) — the reuse fast path must not care.
    const lookupAlwaysMissing: TestRailCaseLookup = async () => null;

    await test("1. rerun + spec=fresh -> directReuse=true (routed to the fast path)", async () => {
      const s = scenario({ promotedSpec: freshPromotedSpec }); // no testRailCaseId at all
      const [plan] = await resolveScenarioAutomationPlans([s], DEST, undefined, lookupAlwaysMissing);
      assert.strictEqual(plan.testRail.status, "missing");
      assert.strictEqual(plan.spec.status, "fresh");
      const { reuseScenarioIds } = partitionScenariosForExecution([plan]);
      assert.deepStrictEqual(reuseScenarioIds, ["REC-D8DBD8F9-01"]);
    });

    await test("2/3/4/5/6. rerun + spec=fresh -> zero recording replay / discovery / AI generation / AI repair / promotion (proven by never leaving the reuse partition — none of those pipelines are ever invoked for a reuseScenarioIds member)", async () => {
      const s = scenario({ promotedSpec: freshPromotedSpec });
      const [plan] = await resolveScenarioAutomationPlans([s], DEST, undefined, lookupAlwaysMissing);
      const { reuseScenarioIds, remainingScenarioIds } = partitionScenariosForExecution([plan]);
      assert.deepStrictEqual(reuseScenarioIds, ["REC-D8DBD8F9-01"]);
      assert.deepStrictEqual(remainingScenarioIds, [], "the scenario must not also be routed through the publish/generate/discovery pipeline");
    });

    await test("7. normal execution + spec=fresh + TestRail=missing -> spec decision (reuse) and TestRail decision (publish) are independent: reuse=true AND publish candidate=1", async () => {
      const s = scenario({ promotedSpec: freshPromotedSpec });
      const [plan] = await resolveScenarioAutomationPlans([s], DEST, undefined, lookupAlwaysMissing);
      const { reuseScenarioIds } = partitionScenariosForExecution([plan]);
      assert.deepStrictEqual(reuseScenarioIds, ["REC-D8DBD8F9-01"], "a fresh promoted spec is still reused regardless of TestRail state");
      const candidates = computeTestRailPublishCandidates([plan]);
      assert.strictEqual(candidates.size, 1, "TestRail state (missing) alone decides publish — a fresh spec does not suppress reconciling a missing case during normal execution");
    });

    await test("8. rerun + spec=fresh -> the physical persisted case.spec.ts path is what gets selected for execution", async () => {
      const s = scenario({ promotedSpec: freshPromotedSpec });
      const [plan] = await resolveScenarioAutomationPlans([s], DEST, undefined, lookupAlwaysMissing);
      assert.strictEqual(plan.spec.path, fixture!.specPath);
      const { reuseScenarioIds } = partitionScenariosForExecution([plan]);
      assert.ok(reuseScenarioIds.includes(s.scenarioId), "the scenario carrying the physical spec path must be the one dispatched to direct execution");
    });

    await test("9. spec stale -> regeneration path preserved with explicit stale reason, TestRail publish candidate only if case also missing", async () => {
      const staleSpecPath = path.join(path.dirname(fixture!.specPath), "case-stale.spec.ts");
      await fs.writeFile(staleSpecPath, "test('Tarjeta', async () => { /* different */ });", "utf-8");
      const s = scenario({
        testRailCaseId: 46779,
        testRailDestination: DEST,
        promotedSpec: { appSlug: "kiosko", specPath: staleSpecPath, specHash: "not-the-real-hash", automationId: "x", generatedAt: "t" },
      });
      const lookupConfirms: TestRailCaseLookup = async () => ({ projectId: DEST.projectId, sectionId: DEST.sectionId });
      const [plan] = await resolveScenarioAutomationPlans([s], DEST, undefined, lookupConfirms);
      assert.strictEqual(plan.spec.status, "stale");
      assert.strictEqual(plan.spec.reason, "spec_hash_changed");
      const { reuseScenarioIds, remainingScenarioIds } = partitionScenariosForExecution([plan]);
      assert.deepStrictEqual(reuseScenarioIds, []);
      assert.deepStrictEqual(remainingScenarioIds, ["REC-D8DBD8F9-01"]);
      const candidates = computeTestRailPublishCandidates([plan]);
      assert.strictEqual(candidates.size, 0, "the case already exists, so no new TestRail case is needed even though the spec is stale");
    });

    await test("10. spec missing -> generation path preserved, and TestRail publish IS a candidate (case-and-spec both needed)", async () => {
      const s = scenario({ scenarioId: "REC-D8DBD8F9-02" }); // no promotedSpec, no testRailCaseId
      const [plan] = await resolveScenarioAutomationPlans([s], DEST, undefined, lookupAlwaysMissing);
      assert.strictEqual(plan.spec.status, "missing");
      assert.strictEqual(plan.testRail.status, "missing");
      const { reuseScenarioIds, remainingScenarioIds } = partitionScenariosForExecution([plan]);
      assert.deepStrictEqual(reuseScenarioIds, []);
      assert.deepStrictEqual(remainingScenarioIds, ["REC-D8DBD8F9-02"]);
      const candidates = computeTestRailPublishCandidates([plan]);
      assert.strictEqual(candidates.size, 1, "a scenario with neither a case nor a spec still needs a TestRail case filed as part of create_case_and_generate_spec");
    });

    if (process.exitCode === 1) {
      console.error("\npromoted-spec-rerun-orchestration tests FAILED");
    } else {
      console.log("\npromoted-spec-rerun-orchestration tests PASSED");
    }
  } finally {
    if (fixture) await fixture.cleanup();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
