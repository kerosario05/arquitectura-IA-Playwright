import assert from "node:assert";
import {
  decideAutomationRoute,
  destinationsMatch,
  partitionScenariosForExecution,
  resolveScenarioAutomationPlan,
  resolveScenarioAutomationPlans,
  resolveTestRailForScenario,
  resolveSpecForScenario,
  type SpecFilesystemAdapter,
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

function freshAdapter(overrides: Partial<SpecFilesystemAdapter> = {}): SpecFilesystemAdapter {
  return {
    readFile: async () => "spec-text",
    readAutomationEntry: async () => ({ status: "active", specVerificationStatus: "passed" }),
    ...overrides,
  };
}

function scenario(overrides: Partial<RecordedScenario> = {}): Pick<RecordedScenario, "scenarioId" | "testRailCaseId" | "testRailDestination" | "promotedSpec"> {
  return {
    scenarioId: "REC-A1DCF6A5-01",
    ...overrides,
  };
}

const DEST: TestRailDestination = { projectId: "10", suiteId: "37", sectionId: "250" };
const OTHER_SECTION: TestRailDestination = { projectId: "10", suiteId: "37", sectionId: "999" };
const OTHER_PROJECT: TestRailDestination = { projectId: "20", suiteId: "37", sectionId: "250" };

// A deterministic stand-in for sha256("spec-text") so tests don't need to import node:crypto
// just to agree with the module's own hashing. Computed once via the module itself below.
async function hashOf(adapter: SpecFilesystemAdapter, specPath: string): Promise<string> {
  const result = await resolveSpecForScenario(
    { promotedSpec: { appSlug: "kiosko", specPath, specHash: "placeholder", automationId: "x", generatedAt: "now" } },
    adapter,
  );
  return result.hash!;
}

async function main(): Promise<void> {
  console.log("\nrecording automation reuse-before-regenerate matrix (destination-scoped)");

  const specPath = "automations/apps/kiosko/sections/default-section/cases/preview-001-kiosko2/case.spec.ts";
  const trueHash = await hashOf(freshAdapter(), specPath);
  const freshSpec = (automationId = "x") => ({ appSlug: "kiosko", specPath, specHash: trueHash, automationId, generatedAt: "t" });

  // CASE A: scenario mapped to a case that belongs to the SELECTED project/suite/section ->
  // existing, publish=false.
  await test("CASE A: case belongs to the selected destination -> existing, no publish", async () => {
    const s = scenario({ testRailCaseId: 12345, testRailDestination: DEST, promotedSpec: freshSpec() });
    const plan = await resolveScenarioAutomationPlan(s, DEST, freshAdapter());
    assert.strictEqual(plan.testRail.status, "existing");
    assert.strictEqual((plan.testRail as { caseId: number }).caseId, 12345);
    assert.strictEqual((plan.testRail as { source: string }).source, "persisted_mapping");
    assert.strictEqual(plan.decision, "reuse_existing");
  });

  // CASE B: scenario mapped to a case, but that case belongs to a DIFFERENT section (or
  // project) than the one selected -> must NOT be treated as existing in the current
  // destination; it needs its own case created there.
  await test("CASE B: case belongs to a different section -> not existing in this destination", async () => {
    const s = scenario({ testRailCaseId: 12345, testRailDestination: DEST, promotedSpec: freshSpec() });
    const plan = await resolveScenarioAutomationPlan(s, OTHER_SECTION, freshAdapter());
    assert.strictEqual(plan.testRail.status, "missing");
    assert.strictEqual(plan.testRail.destinationMatched, false);
  });

  await test("CASE B variant: case belongs to a different project -> not existing in this destination", async () => {
    const s = scenario({ testRailCaseId: 12345, testRailDestination: DEST, promotedSpec: freshSpec() });
    const plan = await resolveScenarioAutomationPlan(s, OTHER_PROJECT, freshAdapter());
    assert.strictEqual(plan.testRail.status, "missing");
  });

  // CASE C / missing-case path: scenario has no persisted case at all.
  await test("CASE C: scenario missing -> status=missing, decision requires a case", async () => {
    const plan = await resolveScenarioAutomationPlan(scenario(), DEST, freshAdapter());
    assert.strictEqual(plan.testRail.status, "missing");
    assert.strictEqual(plan.decision, "create_case_and_generate_spec");
  });

  // CASE D: same scenario, second execution against the SAME destination -> same caseId,
  // resolves as existing again (idempotent — the resolver only reads persisted state).
  await test("CASE D: second execution against the same destination reuses the same caseId", async () => {
    const s = scenario({ testRailCaseId: 12345, testRailDestination: DEST, promotedSpec: freshSpec() });
    const first = await resolveScenarioAutomationPlan(s, DEST, freshAdapter());
    const second = await resolveScenarioAutomationPlan(s, DEST, freshAdapter());
    assert.deepStrictEqual(first, second);
    assert.strictEqual(first.decision, "reuse_existing");
    assert.strictEqual((first.testRail as { caseId: number }).caseId, 12345);
  });

  // CASE E: A existing, B missing, C existing — mixed within one destination, decided
  // independently (partitionScenariosForExecution proves only B needs a case).
  await test("CASE E: mixed batch — only the missing scenario needs a case", async () => {
    const scenarios = [
      scenario({ scenarioId: "A", testRailCaseId: 1, testRailDestination: DEST, promotedSpec: freshSpec() }),
      scenario({ scenarioId: "B" }),
      scenario({ scenarioId: "C", testRailCaseId: 3, testRailDestination: DEST, promotedSpec: freshSpec() }),
    ];
    const plans = await resolveScenarioAutomationPlans(scenarios, DEST, freshAdapter());
    const byId = Object.fromEntries(plans.map((p) => [p.scenarioId, p.testRail.status]));
    assert.strictEqual(byId.A, "existing");
    assert.strictEqual(byId.B, "missing");
    assert.strictEqual(byId.C, "existing");
  });

  // CASE F: same section id reused under a different project — membership must not be
  // fooled by the section id alone matching.
  await test("CASE F: multiproject isolation — same section id under a different project never matches", () => {
    const persisted: TestRailDestination = { projectId: "10", suiteId: "37", sectionId: "250" };
    const selected: TestRailDestination = { projectId: "99", suiteId: "37", sectionId: "250" };
    assert.strictEqual(destinationsMatch(persisted, selected), false);
  });

  // CASE G: legacy caseId with no persisted destination — resolved via the structured
  // TestRail lookup (never fuzzy title matching), and correctly rejected when it belongs
  // elsewhere.
  await test("CASE G: no persisted destination — falls back to a structured TestRail lookup", async () => {
    const s = scenario({ testRailCaseId: 777, promotedSpec: freshSpec() }); // no testRailDestination
    const lookupMatching: TestRailCaseLookup = async (caseId) => (caseId === 777 ? { projectId: "10", sectionId: "250" } : null);
    const planMatch = await resolveScenarioAutomationPlan(s, DEST, freshAdapter(), lookupMatching);
    assert.strictEqual(planMatch.testRail.status, "existing");
    assert.strictEqual((planMatch.testRail as { source: string }).source, "testrail_structured_lookup");

    const lookupElsewhere: TestRailCaseLookup = async () => ({ projectId: "999", sectionId: "111" });
    const planMiss = await resolveScenarioAutomationPlan(s, DEST, freshAdapter(), lookupElsewhere);
    assert.strictEqual(planMiss.testRail.status, "missing");
  });

  await test("CASE H: no fuzzy title matching — the resolver never receives a title field at all", async () => {
    // Two scenarios with the "same title" conceptually are distinguished purely by
    // scenarioId/testRailCaseId/testRailDestination — the resolver's input type doesn't even
    // carry a title, so nothing could be matched against it.
    const a = scenario({ scenarioId: "REC-AAAAAAAA-01", testRailCaseId: 1, testRailDestination: DEST, promotedSpec: freshSpec() });
    const b = scenario({ scenarioId: "REC-BBBBBBBB-01" });
    const planA = await resolveScenarioAutomationPlan(a, DEST, freshAdapter());
    const planB = await resolveScenarioAutomationPlan(b, DEST, freshAdapter());
    assert.strictEqual(planA.decision, "reuse_existing");
    assert.strictEqual(planB.decision, "create_case_and_generate_spec");
  });

  await test("resolveTestRailForScenario ignores non-positive/non-integer caseId values", async () => {
    assert.strictEqual((await resolveTestRailForScenario({ testRailCaseId: 0 }, DEST)).status, "missing");
    assert.strictEqual((await resolveTestRailForScenario({ testRailCaseId: undefined }, DEST)).status, "missing");
    assert.strictEqual((await resolveTestRailForScenario({ testRailCaseId: 501, testRailDestination: DEST }, DEST)).status, "existing");
  });

  await test("destinationsMatch compares project+section strictly, suite only when both present", () => {
    assert.strictEqual(destinationsMatch(DEST, DEST), true);
    assert.strictEqual(destinationsMatch(DEST, { ...DEST, suiteId: undefined }), true);
    assert.strictEqual(destinationsMatch(DEST, { ...DEST, suiteId: "999" }), false);
    assert.strictEqual(destinationsMatch(DEST, { ...DEST, sectionId: "1" }), false);
    assert.strictEqual(destinationsMatch(DEST, { ...DEST, projectId: "1" }), false);
  });

  // Spec freshness matrix (unchanged behavior — still hash + automation-status, not
  // timestamp-only).
  await test("spec resolution: fresh, missing, and stale are still distinguished correctly", async () => {
    const missing = await resolveSpecForScenario({}, freshAdapter());
    assert.strictEqual(missing.status, "missing");

    const stale = await resolveSpecForScenario(
      { promotedSpec: { appSlug: "kiosko", specPath, specHash: "not-the-real-hash", automationId: "x", generatedAt: "t" } },
      freshAdapter(),
    );
    assert.strictEqual(stale.status, "stale");

    const fresh = await resolveSpecForScenario({ promotedSpec: freshSpec() }, freshAdapter());
    assert.strictEqual(fresh.status, "fresh");
  });

  await test("partitionScenariosForExecution routes any scenario with a fresh promoted spec to the fast path, regardless of TestRail case state", async () => {
    const scenarios = [
      scenario({ scenarioId: "REC-A1DCF6A5-01", testRailCaseId: 501, testRailDestination: DEST, promotedSpec: freshSpec() }),
      scenario({ scenarioId: "REC-A1DCF6A5-02", testRailCaseId: 502, testRailDestination: DEST }), // generate_spec (spec missing/stale)
      scenario({ scenarioId: "REC-A1DCF6A5-03" }), // create_case_and_generate_spec (spec missing)
      scenario({ scenarioId: "REC-A1DCF6A5-04", promotedSpec: freshSpec() }), // create_testrail_case: testRail missing, but spec IS fresh — must still reuse
    ];
    const plans = await resolveScenarioAutomationPlans(scenarios, DEST, freshAdapter());
    const partition = partitionScenariosForExecution(plans);
    assert.deepStrictEqual(partition.reuseScenarioIds, ["REC-A1DCF6A5-01", "REC-A1DCF6A5-04"]);
    assert.deepStrictEqual(partition.remainingScenarioIds, ["REC-A1DCF6A5-02", "REC-A1DCF6A5-03"]);
  });

  // REC-D8DBD8F9-01 reproduction: a persisted destination match is a hint, never proof by
  // itself. When a live lookup is available and TestRail no longer confirms the case (it was
  // deleted directly in TestRail after being persisted), the mapping is stale and must resolve
  // as missing — never blindly "existing" from local metadata alone.
  await test("BUG D8DBD8F9-01: persisted caseId+destination match, but TestRail confirms the case no longer exists -> stale mapping, missing", async () => {
    const s = scenario({ testRailCaseId: 46760, testRailDestination: { projectId: "30", suiteId: "37", sectionId: "5794" }, promotedSpec: freshSpec() });
    const destination: TestRailDestination = { projectId: "30", suiteId: "37", sectionId: "5794" };
    const lookupNotFound: TestRailCaseLookup = async () => null; // 404 / deleted case
    const plan = await resolveScenarioAutomationPlan(s, destination, freshAdapter(), lookupNotFound);
    assert.strictEqual(plan.testRail.status, "missing");
    // A fresh promoted spec already exists for this scenario, so only the TestRail case needs
    // to be (re)created — the stale-mapping fix is proven by testRail.status alone.
    assert.strictEqual(plan.decision, "create_testrail_case");
  });

  await test("1. no local mapping + no remote match -> missing / create_case_and_generate_spec", async () => {
    const lookupNever: TestRailCaseLookup = async () => null;
    const plan = await resolveScenarioAutomationPlan(scenario(), DEST, freshAdapter(), lookupNever);
    assert.strictEqual(plan.testRail.status, "missing");
    assert.strictEqual(plan.decision, "create_case_and_generate_spec");
  });

  await test("2. stale local caseId + remote 404/not found -> missing / create_testrail_case (spec already fresh)", async () => {
    const s = scenario({ testRailCaseId: 999, testRailDestination: DEST, promotedSpec: freshSpec() });
    const lookupNotFound: TestRailCaseLookup = async () => null;
    const plan = await resolveScenarioAutomationPlan(s, DEST, freshAdapter(), lookupNotFound);
    assert.strictEqual(plan.testRail.status, "missing");
    assert.strictEqual(plan.decision, "create_testrail_case");
  });

  await test("3. local caseId + verified remote existing at the correct destination -> existing", async () => {
    const s = scenario({ testRailCaseId: 12345, testRailDestination: DEST, promotedSpec: freshSpec() });
    const lookupConfirms: TestRailCaseLookup = async (caseId) => (caseId === 12345 ? { projectId: DEST.projectId, sectionId: DEST.sectionId } : null);
    const plan = await resolveScenarioAutomationPlan(s, DEST, freshAdapter(), lookupConfirms);
    assert.strictEqual(plan.testRail.status, "existing");
    assert.strictEqual((plan.testRail as { caseId: number }).caseId, 12345);
    assert.strictEqual((plan.testRail as { source: string }).source, "persisted_mapping");
  });

  await test("4. a title-only similar case is never a match — the resolver receives no title at all", async () => {
    // Distinguished purely by scenarioId/caseId, never by comparing titles: a second scenario
    // with a "similar" title cannot resolve to the first one's case.
    const similarTitled = scenario({ scenarioId: "REC-SIMILAR-01" }); // no persisted mapping
    const lookupNever: TestRailCaseLookup = async () => null;
    const plan = await resolveScenarioAutomationPlan(similarTitled, DEST, freshAdapter(), lookupNever);
    assert.strictEqual(plan.testRail.status, "missing");
  });

  await test("5. wrong section case -> NOT existing", async () => {
    const s = scenario({ testRailCaseId: 12345, testRailDestination: DEST, promotedSpec: freshSpec() });
    const lookupWrongSection: TestRailCaseLookup = async () => ({ projectId: DEST.projectId, sectionId: "OTHER" });
    const plan = await resolveScenarioAutomationPlan(s, DEST, freshAdapter(), lookupWrongSection);
    assert.strictEqual(plan.testRail.status, "missing");
  });

  await test("6. wrong recording ref (different scenarioId) never inherits another scenario's mapping -> NOT existing", async () => {
    const mapped = scenario({ scenarioId: "REC-AAAAAAAA-01", testRailCaseId: 1, testRailDestination: DEST, promotedSpec: freshSpec() });
    const unrelated = scenario({ scenarioId: "REC-BBBBBBBB-01" }); // distinct scenarioId, no mapping of its own
    const lookupConfirmsMapped: TestRailCaseLookup = async (caseId) => (caseId === 1 ? { projectId: DEST.projectId, sectionId: DEST.sectionId } : null);
    const [planMapped, planUnrelated] = await resolveScenarioAutomationPlans([mapped, unrelated], DEST, freshAdapter(), lookupConfirmsMapped);
    assert.strictEqual(planMapped.testRail.status, "existing");
    assert.strictEqual(planUnrelated.testRail.status, "missing");
  });

  await test("7. exact authoritative caseId+destination match confirmed by TestRail -> existing", async () => {
    const s = scenario({ testRailCaseId: 777, testRailDestination: DEST, promotedSpec: freshSpec() });
    const lookupExact: TestRailCaseLookup = async (caseId) => (caseId === 777 ? { projectId: DEST.projectId, sectionId: DEST.sectionId } : null);
    const plan = await resolveScenarioAutomationPlan(s, DEST, freshAdapter(), lookupExact);
    assert.strictEqual(plan.testRail.status, "existing");
    assert.strictEqual((plan.testRail as { caseId: number }).caseId, 777);
  });

  await test("8. ambiguous/incomplete remote match never silently resolves to existing", async () => {
    const s = scenario({ testRailCaseId: 12345, testRailDestination: DEST, promotedSpec: freshSpec() });
    // TestRail returned a record but it does not carry enough structured identity
    // (no sectionId) to positively confirm the destination — must never be treated as a match.
    const lookupAmbiguous: TestRailCaseLookup = async () => ({ projectId: DEST.projectId, sectionId: undefined });
    const plan = await resolveScenarioAutomationPlan(s, DEST, freshAdapter(), lookupAmbiguous);
    assert.strictEqual(plan.testRail.status, "missing");
  });

  await test("legacy caseId with no persisted destination is also verified remotely, not just structurally", async () => {
    const s = scenario({ testRailCaseId: 777, promotedSpec: freshSpec() }); // no testRailDestination
    const lookupDeleted: TestRailCaseLookup = async () => null;
    const plan = await resolveScenarioAutomationPlan(s, DEST, freshAdapter(), lookupDeleted);
    assert.strictEqual(plan.testRail.status, "missing");
  });

  await test("no lookup available at all: persisted destination match is trusted as the only available signal (unchanged legacy behavior)", async () => {
    const s = scenario({ testRailCaseId: 12345, testRailDestination: DEST, promotedSpec: freshSpec() });
    const plan = await resolveScenarioAutomationPlan(s, DEST, freshAdapter()); // no lookupCase
    assert.strictEqual(plan.testRail.status, "existing");
    assert.strictEqual((plan.testRail as { source: string }).source, "persisted_mapping");
  });

  await test("decideAutomationRoute covers all four matrix cells directly", () => {
    assert.strictEqual(decideAutomationRoute({ status: "existing", caseId: 1, destinationMatched: true, source: "persisted_mapping" }, { status: "fresh" }), "reuse_existing");
    assert.strictEqual(decideAutomationRoute({ status: "existing", caseId: 1, destinationMatched: true, source: "persisted_mapping" }, { status: "missing" }), "generate_spec");
    assert.strictEqual(decideAutomationRoute({ status: "missing", destinationMatched: false, source: "none" }, { status: "fresh" }), "create_testrail_case");
    assert.strictEqual(decideAutomationRoute({ status: "missing", destinationMatched: false, source: "none" }, { status: "missing" }), "create_case_and_generate_spec");
  });

  if (process.exitCode === 1) {
    console.error("\nrecording automation resolution tests FAILED");
  } else {
    console.log("\nrecording automation resolution tests PASSED");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
