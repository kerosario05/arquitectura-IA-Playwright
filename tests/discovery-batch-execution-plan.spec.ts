import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  buildCaseSchedule,
  buildDiscoveryBatchArgs,
  buildDiscoveryPreviewArgs,
  buildMixedExecutionPlan,
  buildPromotedExecutionEnv,
  buildDiscoveryBatchChecklistIdentity,
  buildDiscoveryBatchDefectDedupeKey,
  buildTestPromotedArgs,
  buildDiscoveryBatchExecutionPlan,
  computeFunctionalExecutionSnapshot,
  parsePromotedFunctionalFailure,
  parseEvidenceInitializationResult,
  resolveDiscoveryBatchIssueKeyMetadata,
  resolveRediscoveryIntent,
  supportsTargetedDiscoveryPreview,
  validatePromotedEntryForExecution,
  resolveRouteFromValidation,
  isPersistedDiscoveryPromotionSuccessful,
  resolvePostDiscoveryExecutionAdmission,
} from "../src/server/jobs/discovery-batch-runner";
import { resolvePromotionOutcome } from "../src/discovery/case-discovery-workflow";

test("execution plan: all requested cases are executable", () => {
  const plan = buildDiscoveryBatchExecutionPlan(
    [42868, 42869, 42870],
    new Set([42868, 42869, 42870]),
    new Set([42868, 42869, 42870]),
  );
  expect(plan.requestedCaseIds).toEqual([42868, 42869, 42870]);
  expect(plan.executableCaseIds).toEqual([42868, 42869, 42870]);
  expect(plan.notExecutableCaseIds).toEqual([]);
  expect(plan.requiresDiscoveryCaseIds).toEqual([]);
});

test("execution plan: one promoted and two discovered_partial stay non-executable", () => {
  const plan = buildDiscoveryBatchExecutionPlan(
    [5001, 5002, 5003],
    new Set([5001]),
    new Set([5001]),
  );
  expect(plan.alreadyPromotedCaseIds).toEqual([5001]);
  expect(plan.executableCaseIds).toEqual([5001]);
  expect(plan.notExecutableCaseIds).toEqual([5002, 5003]);
  expect(plan.requiresDiscoveryCaseIds).toEqual([5002, 5003]);
});

test("execution plan: no promoted cases yields empty executable list", () => {
  const plan = buildDiscoveryBatchExecutionPlan(
    [7001, 7002],
    new Set<number>(),
    new Set<number>(),
  );
  expect(plan.executableCaseIds).toEqual([]);
  expect(plan.notExecutableCaseIds).toEqual([7001, 7002]);
});

test("functional snapshot: progress and pass rate are separated", () => {
  const snapshot = computeFunctionalExecutionSnapshot({
    requested: 3,
    completed: 1,
    executed: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
  });
  expect(snapshot.progressPercent).toBe(33.33);
  expect(snapshot.passRate).toBe(100);
});

test("functional snapshot: pass rate is null when no cases were executed", () => {
  const snapshot = computeFunctionalExecutionSnapshot({
    requested: 3,
    completed: 1,
    executed: 0,
    passed: 0,
    failed: 0,
    skipped: 1,
  });
  expect(snapshot.progressPercent).toBe(33.33);
  expect(snapshot.passRate).toBeNull();
});

test("functional snapshot: non-executable failures reduce pass rate", () => {
  const snapshot = computeFunctionalExecutionSnapshot({
    requested: 3,
    completed: 2,
    executed: 1,
    passed: 1,
    failed: 1,
    skipped: 0,
  });
  expect(snapshot.progressPercent).toBe(66.67);
  expect(snapshot.passRate).toBe(50);
});

test("test:promoted args include headed only when explicitly requested", () => {
  const defaultArgs = buildTestPromotedArgs({ caseIds: [42868] }, 42868);
  expect(defaultArgs).not.toContain("--headed");

  const headedArgs = buildTestPromotedArgs({ caseIds: [42868], headed: true }, 42868);
  expect(headedArgs).toContain("--headed");
});

test("automatic promoted execution forces headless contract env", () => {
  const env = buildPromotedExecutionEnv(
    { caseIds: [42868], appSlug: "app-a", sectionSlug: "detalle-kiosko" },
    "job-123",
    { HEADLESS: "false", PWDEBUG: "1" } as NodeJS.ProcessEnv,
  );
  expect(env.EVIDENCE_RUN_ID).toBe("job-123");
  expect(env.APP_SLUG).toBe("app-a");
  expect(env.SECTION_SLUG).toBe("detalle-kiosko");
  expect(env.EVIDENCE_APP_SLUG).toBe("app-a");
  expect(env.EVIDENCE_SECTION_SLUG).toBe("detalle-kiosko");
  expect(env.AUTOMATION_HEADLESS).toBe("true");
  expect(env.AUTOMATION_SOURCE).toBe("qa_lab_automatic");
});

test("explicit headed promoted execution does not force automation headless", () => {
  const env = buildPromotedExecutionEnv(
    { caseIds: [42868], headed: true },
    "job-123",
    {} as NodeJS.ProcessEnv,
  );
  expect(env.AUTOMATION_HEADLESS).toBeUndefined();
  expect(env.AUTOMATION_SOURCE).toBeUndefined();
});

test("checklist identity prefers launchId and falls back to jobId", () => {
  expect(buildDiscoveryBatchChecklistIdentity({ jobId: "job-123", launchId: "launch-abc" })).toBe("launch:launch-abc");
  expect(buildDiscoveryBatchChecklistIdentity({ jobId: "job-123" })).toBe("job:job-123");
});

test("issueKey metadata stays optional and only resolves unique source key", () => {
  expect(
    resolveDiscoveryBatchIssueKeyMetadata({
      jiraKey: "QA-101",
      publishedCases: [{ sourceIssueKey: "QA-999" }],
    }),
  ).toBe("QA-101");
  expect(
    resolveDiscoveryBatchIssueKeyMetadata({
      publishedCases: [{ sourceIssueKey: "QA-1" }, { sourceIssueKey: "QA-2" }],
    }),
  ).toBeUndefined();
  expect(
    resolveDiscoveryBatchIssueKeyMetadata({
      publishedCases: [{ sourceIssueKey: "QA-1" }, { sourceIssueKey: "QA-1" }],
    }),
  ).toBe("QA-1");
});

test("promoted failure parser captures failed step and locator target", () => {
  const parsed = parsePromotedFunctionalFailure([
    '[functional] Promoted click failed at step 4 target="Información de productos" currentUrl="https://app.local/success" matchedLocatorStrategy="unknown"',
  ]);
  expect(parsed.failureReason).toBe("promoted_click_failed");
  expect(parsed.failedAtStep).toBe(4);
  expect(parsed.failedTarget).toBe("Información de productos");
  expect(parsed.currentUrl).toBe("https://app.local/success");
  expect(parsed.matchedLocatorStrategy).toBe("unknown");
});

test("defect dedupe key is stable per job and case", () => {
  const keyA = buildDiscoveryBatchDefectDedupeKey({ jobId: "job-1", caseId: 42958, scenarioId: "PREVIEW-001" });
  const keyB = buildDiscoveryBatchDefectDedupeKey({ jobId: "job-1", caseId: 42958, scenarioId: "PREVIEW-001" });
  const keyC = buildDiscoveryBatchDefectDedupeKey({ jobId: "job-2", caseId: 42958, scenarioId: "PREVIEW-001" });
  expect(keyA).toBe(keyB);
  expect(keyA).not.toBe(keyC);
});

test("discovery args do not include overwrite/rerun-active by default", () => {
  const args = buildDiscoveryBatchArgs(
    { caseIds: [42868], appSlug: "app-a" },
    [42868],
  );
  expect(args).toContain("--auto-promote");
  expect(args).toContain("--auto-pom");
  expect(args).not.toContain("--overwrite");
  expect(args).not.toContain("--rerun-active");
});

test("discovery args include overwrite/rerun-active only when explicitly requested", () => {
  const args = buildDiscoveryBatchArgs(
    { caseIds: [42868], appSlug: "app-a", overwrite: true, rerunActive: true },
    [42868],
  );
  expect(args).toContain("--overwrite");
  expect(args).toContain("--rerun-active");
});

test("resolved rediscovery intent is propagated to the child discovery command", () => {
  const intent = resolveRediscoveryIntent({
    forceRediscovery: false,
    overwrite: true,
    rerunActive: true,
    executePromotedSpecs: false,
  });
  const args = buildDiscoveryBatchArgs({
    caseIds: [],
    appSlug: "app-a",
    overwrite: intent.overwrite,
    rerunActive: intent.rerunActive,
  }, [42868]);

  expect(intent.explicit).toBe(false);
  expect(args).toContain("--overwrite");
  expect(args).toContain("--rerun-active");
});

test("mixed execution planner prioritizes jira preview while preserving relative order per group", () => {
  const plan = buildMixedExecutionPlan({
    caseIds: [1001, 2001, 1002, 2002],
    publishedCases: [
      { caseId: 1001, scenarioId: "TR-CASE-1001", sourceType: "testrail_case" } as any,
      { caseId: 2001, scenarioId: "L-a-001", sourceType: "jira_preview", executionScenarioId: "PREVIEW-001" } as any,
      { caseId: 1002, scenarioId: "TR-CASE-1002", sourceType: "testrail_case" } as any,
      { caseId: 2002, scenarioId: "L-a-002", sourceType: "jira_preview", executionScenarioId: "PREVIEW-002" } as any,
    ],
  });
  expect(plan.mode).toBe("mixed");
  expect(plan.jiraPreviewCases.map((entry) => entry.caseId)).toEqual([2001, 2002]);
  expect(plan.testRailCases.map((entry) => entry.caseId)).toEqual([1001, 1002]);
  expect(plan.orderedCases.map((entry) => entry.caseId)).toEqual([2001, 2002, 1001, 1002]);
});

test("mixed execution schedule preserves per-group sequence and computed indexes", () => {
  const schedule = buildCaseSchedule(buildMixedExecutionPlan({
    caseIds: [1001, 2001, 1002, 2002],
    publishedCases: [
      { caseId: 1001, scenarioId: "TR-CASE-1001", sourceType: "testrail_case" } as any,
      { caseId: 2001, scenarioId: "L-a-001", sourceType: "jira_preview", executionScenarioId: "PREVIEW-001" } as any,
      { caseId: 1002, scenarioId: "TR-CASE-1002", sourceType: "testrail_case" } as any,
      { caseId: 2002, scenarioId: "L-a-002", sourceType: "jira_preview", executionScenarioId: "PREVIEW-002" } as any,
    ],
  }));
  expect(schedule.map((entry) => `${entry.caseId}:${entry.sourceGroup}:${entry.groupIndex}:${entry.overallIndex}`)).toEqual([
    "2001:jira_preview:1:1",
    "2002:jira_preview:2:2",
    "1001:testrail_case:1:3",
    "1002:testrail_case:2:4",
  ]);
});

test("mixed execution plan keeps jira-only and testrail-only selections stable", () => {
  const jiraOnly = buildMixedExecutionPlan({
    caseIds: [3001, 3002],
    publishedCases: [
      { caseId: 3001, scenarioId: "L-j-001", sourceType: "jira_preview", executionScenarioId: "PREVIEW-001" } as any,
      { caseId: 3002, scenarioId: "L-j-002", sourceType: "jira_preview", executionScenarioId: "PREVIEW-002" } as any,
    ],
  });
  expect(jiraOnly.mode).toBe("jira_only");
  expect(jiraOnly.orderedCases.map((entry) => entry.caseId)).toEqual([3001, 3002]);

  const trOnly = buildMixedExecutionPlan({
    caseIds: [4001, 4002],
    publishedCases: [
      { caseId: 4001, scenarioId: "TR-CASE-4001", sourceType: "testrail_case" } as any,
      { caseId: 4002, scenarioId: "TR-CASE-4002", sourceType: "testrail_case" } as any,
    ],
  });
  expect(trOnly.mode).toBe("testrail_only");
  expect(trOnly.orderedCases.map((entry) => entry.caseId)).toEqual([4001, 4002]);
});

test("mixed execution plan preserves case identity without duplicates", () => {
  const plan = buildMixedExecutionPlan({
    caseIds: [5001, 5001, 5002],
    publishedCases: [
      { caseId: 5002, scenarioId: "TR-CASE-5002", sourceType: "testrail_case" } as any,
      { caseId: 5003, scenarioId: "L-z-001", sourceType: "jira_preview", executionScenarioId: "PREVIEW-003" } as any,
    ],
  });
  expect(plan.orderedCases.map((entry) => entry.caseId)).toEqual([5003, 5001, 5002]);
  expect(new Set(plan.orderedCases.map((entry) => entry.caseId)).size).toBe(plan.orderedCases.length);
});

test("mixed execution planner infers jira preview source from official launch metadata when sourceType is absent", () => {
  const plan = buildMixedExecutionPlan({
    caseIds: [6101, 6102],
    publishedCases: [
      { caseId: 6101, scenarioId: "legacy-preview", executionScenarioId: "PREVIEW-010" } as any,
      { caseId: 6102, scenarioId: "TR-CASE-6102" } as any,
    ],
  });
  expect(plan.jiraPreviewCases.map((entry) => entry.caseId)).toEqual([6101]);
  expect(plan.testRailCases.map((entry) => entry.caseId)).toEqual([6102]);
});

test("explicit testrail source is preserved even if executionScenarioId looks like PREVIEW-*", () => {
  const plan = buildMixedExecutionPlan({
    caseIds: [42983],
    publishedCases: [
      { caseId: 42983, scenarioId: "TR-CASE-42983", sourceType: "testrail_case", executionScenarioId: "PREVIEW-001" } as any,
    ],
  });
  expect(plan.mode).toBe("testrail_only");
  expect(plan.jiraPreviewCases).toHaveLength(0);
  expect(plan.testRailCases.map((entry) => entry.caseId)).toEqual([42983]);
});

test("route decision prefers promoted reuse when validation is reusable", () => {
  const route = resolveRouteFromValidation({
    caseId: 42868,
    appSlug: "app-a",
    forceRediscovery: false,
    validation: {
      reusable: true,
      blocked: false,
      reason: "promoted_spec_valid",
      specPath: "automations/apps/app-a/sections/sec/cases/c42868/case.spec.ts",
    },
  });
  expect(route.route).toBe("promoted_reuse");
  expect(route.reason).toBe("promoted_spec_valid");
});

test("persisted promotion requires both a reusable entry and promoted child state", () => {
  expect(isPersistedDiscoveryPromotionSuccessful({ discoveredState: "discovered_passed", reusable: true })).toBe(false);
  expect(isPersistedDiscoveryPromotionSuccessful({ discoveredState: "promoted", reusable: true })).toBe(true);
  expect(isPersistedDiscoveryPromotionSuccessful({ discoveredState: "promoted", reusable: false })).toBe(false);
});

function postDiscoveryEntry(overrides: Record<string, unknown> = {}): any {
  return {
    id: "automation-post-discovery",
    caseId: 5010,
    title: "post discovery case",
    appSlug: "app-a",
    appProfile: "app-a",
    specPath: "automations/apps/app-a/sections/section-a/cases/c5010/case.spec.ts",
    planPath: "automations/apps/app-a/sections/section-a/cases/c5010/plan.json",
    appConfigPath: "automations/apps/app-a/app.config.json",
    status: "active",
    pomStatus: "promoted",
    specVerificationStatus: "passed",
    ...overrides,
  };
}

test("T1: promoted child with persisted valid entry admits functional execution", () => {
  const result = resolvePostDiscoveryExecutionAdmission({
    caseId: 5010,
    appSlug: "app-a",
    sectionSlug: "section-a",
    childStatus: "promoted",
    promotionPersisted: true,
    entries: [postDiscoveryEntry()],
    fileExists: () => true,
  });
  expect(result.admitted).toBe(true);
  expect(result.specPath).toMatch(/case\.spec\.ts$/);
});

test("T2: promoted child with invalid persisted entry fails closed", () => {
  const result = resolvePostDiscoveryExecutionAdmission({
    caseId: 5010,
    appSlug: "app-a",
    childStatus: "promoted",
    promotionPersisted: true,
    entries: [postDiscoveryEntry({ specVerificationStatus: "failed" })],
    fileExists: () => true,
  });
  expect(result.admitted).toBe(false);
  expect(result.specPath).toBeUndefined();
});

test("T3: discovered_passed without persisted promotion is not admitted", () => {
  const result = resolvePostDiscoveryExecutionAdmission({
    caseId: 5010,
    appSlug: "app-a",
    childStatus: "discovered_passed",
    promotionPersisted: false,
    entries: [postDiscoveryEntry()],
    fileExists: () => true,
  });
  expect(result).toMatchObject({ admitted: false, reason: "child_status_discovered_passed" });
});

test("T4: discovered_partial is not admitted", () => {
  const result = resolvePostDiscoveryExecutionAdmission({
    caseId: 5010,
    appSlug: "app-a",
    childStatus: "discovered_partial",
    promotionPersisted: true,
    entries: [postDiscoveryEntry()],
    fileExists: () => true,
  });
  expect(result.admitted).toBe(false);
});

test("T5: promoted is preparation success, not a failed full-discovery result", () => {
  const result = resolvePostDiscoveryExecutionAdmission({
    caseId: 5010,
    appSlug: "app-a",
    childStatus: "promoted",
    promotionPersisted: true,
    entries: [postDiscoveryEntry()],
    fileExists: () => true,
  });
  expect(result.reason).not.toBe("full_discovery_promoted");
});

test("T6: admitted promoted result carries the exact spec for functional execution", () => {
  const result = resolvePostDiscoveryExecutionAdmission({
    caseId: 5010,
    appSlug: "app-a",
    sectionSlug: "section-a",
    childStatus: "promoted",
    promotionPersisted: true,
    entries: [postDiscoveryEntry()],
    fileExists: () => true,
  });
  expect(result.admitted).toBe(true);
  expect(result.specPath?.replace(/\\/g, "/")).toContain("/c5010/");
});

test("T7: post-discovery admission uses the promoted spec resolver", () => {
  const result = resolvePostDiscoveryExecutionAdmission({
    caseId: 5010,
    appSlug: "app-a",
    sectionSlug: "wrong-section",
    childStatus: "promoted",
    promotionPersisted: true,
    entries: [postDiscoveryEntry()],
    fileExists: () => true,
  });
  expect(result.admitted).toBe(false);
});

test("T8: direct promoted reuse semantics remain unchanged", () => {
  expect(isPersistedDiscoveryPromotionSuccessful({ discoveredState: "promoted", reusable: true })).toBe(true);
  expect(isPersistedDiscoveryPromotionSuccessful({ discoveredState: "discovered_passed", reusable: true })).toBe(false);
});

test("workflow does not label a failed spec-generation gate as promoted", () => {
  expect(resolvePromotionOutcome({ promotionAllowed: false, promotionStatus: "promoted" })).toEqual({
    promoted: false,
    promotionStatus: "promotion_failed",
    promotionReason: "spec_generation_promotion_not_allowed",
  });
  expect(resolvePromotionOutcome({ promotionAllowed: true, promotionStatus: "promoted" })).toEqual({
    promoted: true,
    promotionStatus: "promoted",
  });
  expect(resolvePromotionOutcome({ promotionAllowed: true, promotionStatus: "promotion_failed" }).promoted).toBe(false);
});

test("route decision forces discovery when explicit rediscovery is requested", () => {
  const route = resolveRouteFromValidation({
    caseId: 42868,
    appSlug: "app-a",
    forceRediscovery: true,
    validation: {
      reusable: true,
      blocked: false,
      reason: "promoted_spec_valid",
    },
  });
  expect(route.route).toBe("full_discovery");
  expect(route.reason).toBe("explicit_rediscovery_requested");
});

test("route decision marks blocked when validation says blocked", () => {
  const route = resolveRouteFromValidation({
    caseId: 42868,
    appSlug: "app-a",
    forceRediscovery: false,
    validation: {
      reusable: false,
      blocked: true,
      reason: "blocked_status_needs_page_method",
    },
  });
  expect(route.route).toBe("blocked");
  expect(route.reason).toBe("blocked_status_needs_page_method");
});

test("route decision uses contract recommendation when promoted entry is not reusable", () => {
  const route = resolveRouteFromValidation({
    caseId: 42868,
    appSlug: "app-a",
    forceRediscovery: false,
    validation: {
      reusable: false,
      blocked: false,
      reason: "missing_spec_file",
    },
    contractEvaluation: {
      sufficient: true,
      gaps: [],
      recommendedRoute: "automation_from_case_contract",
      reasonCode: "contract_sufficient",
    },
  });
  expect(route.route).toBe("automation_from_case_contract");
  expect(route.reason).toBe("contract_sufficient");
});

test("legacy overwrite/rerun defaults do not force explicit rediscovery in execution flow", () => {
  const intent = resolveRediscoveryIntent({
    executePromotedSpecs: true,
    overwrite: true,
    rerunActive: true,
  });
  expect(intent).toEqual({
    explicit: false,
    source: "legacy_default",
    overwrite: true,
    rerunActive: true,
  });

  const route = resolveRouteFromValidation({
    caseId: 42868,
    appSlug: "app-a",
    forceRediscovery: intent.explicit,
    targetedDiscoverySupported: supportsTargetedDiscoveryPreview(),
    validation: {
      reusable: false,
      blocked: false,
      reason: "missing_spec_file",
    },
    contractEvaluation: {
      sufficient: true,
      gaps: [],
      recommendedRoute: "automation_from_case_contract",
      reasonCode: "contract_sufficient",
    },
  });
  expect(route.route).toBe("automation_from_case_contract");
});

test("explicit rediscovery intent forces full_discovery even with promoted or contract-ready inputs", () => {
  const intent = resolveRediscoveryIntent({
    executePromotedSpecs: true,
    forceRediscovery: true,
    overwrite: true,
    rerunActive: true,
  });
  expect(intent.explicit).toBe(true);
  expect(intent.source).toBe("user_request");

  const route = resolveRouteFromValidation({
    caseId: 42868,
    appSlug: "app-a",
    forceRediscovery: intent.explicit,
    validation: {
      reusable: true,
      blocked: false,
      reason: "promoted_spec_valid",
    },
    contractEvaluation: {
      sufficient: true,
      gaps: [],
      recommendedRoute: "automation_from_case_contract",
      reasonCode: "contract_sufficient",
    },
  });
  expect(route.route).toBe("full_discovery");
  expect(route.reason).toBe("explicit_rediscovery_requested");
});

test("promoted reusable case stays promoted_reuse when rediscovery intent is not explicit", () => {
  const intent = resolveRediscoveryIntent({
    executePromotedSpecs: true,
    overwrite: true,
    rerunActive: true,
  });
  const route = resolveRouteFromValidation({
    caseId: 42868,
    appSlug: "app-a",
    forceRediscovery: intent.explicit,
    validation: {
      reusable: true,
      blocked: false,
      reason: "promoted_spec_valid",
      specPath: "automations/apps/app-a/sections/sec/cases/c42868/case.spec.ts",
    },
  });
  expect(route.route).toBe("promoted_reuse");
});

test("targeted contract recommendation is downgraded to full_discovery when gap-scoped preview is unsupported", () => {
  expect(supportsTargetedDiscoveryPreview()).toBe(false);
  const route = resolveRouteFromValidation({
    caseId: 42868,
    appSlug: "app-a",
    forceRediscovery: false,
    targetedDiscoverySupported: false,
    validation: {
      reusable: false,
      blocked: false,
      reason: "missing_spec_file",
    },
    contractEvaluation: {
      sufficient: false,
      gaps: [{ type: "missing_locator", stepNumber: 1, target: "boton" }],
      recommendedRoute: "targeted_discovery",
      reasonCode: "targeted_gap_resolution_required",
    },
  });
  expect(route.route).toBe("full_discovery");
  expect(route.reason).toBe("targeted_discovery_not_supported");
});

test("discovery preview args omit overwrite/rerun-active by design", () => {
  const args = buildDiscoveryPreviewArgs({
    previewPath: "C:\\temp\\preview.json",
    appSlug: "app-a",
    autoPromote: true,
    autoPom: true,
    headed: false,
  });
  expect(args).toContain("discovery:preview");
  expect(args).toContain("--auto-promote");
  expect(args).toContain("--auto-pom");
  expect(args).not.toContain("--overwrite");
  expect(args).not.toContain("--rerun-active");
});

test("discovery preview args can defer evidence consolidation for mixed execution lifecycle", () => {
  const args = buildDiscoveryPreviewArgs({
    previewPath: "C:\\temp\\preview.json",
    appSlug: "app-a",
    autoPromote: true,
    autoPom: true,
    deferEvidenceConsolidation: true,
  });
  expect(args).toContain("--defer-evidence-consolidation");
});

test("promoted spec validation accepts reusable promoted case in app and section scope", () => {
  const caseId = 990001;
  const appSlug = `tmp-route-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const sectionSlug = "seccion-kiosko";
  const appRoot = path.join(process.cwd(), "automations", "apps", appSlug);
  const caseDir = path.join(appRoot, "sections", sectionSlug, "cases", `c${caseId}-sample`);
  const specPath = path.join(caseDir, "case.spec.ts");
  const planPath = path.join(caseDir, "plan.json");
  const appConfigPath = path.join(appRoot, "app.config.json");

  fs.mkdirSync(caseDir, { recursive: true });
  fs.writeFileSync(specPath, "test('sample', async () => {});", "utf-8");
  fs.writeFileSync(planPath, "{\"steps\":[]}", "utf-8");
  fs.writeFileSync(appConfigPath, "{}", "utf-8");

  try {
    const validation = validatePromotedEntryForExecution({
      caseId,
      appSlug,
      sectionSlug,
      entry: {
        id: "entry-1",
        caseId,
        title: "sample",
        planPath,
        specPath,
        appSlug,
        appConfigPath,
        status: "active",
        source: "manual",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    expect(validation.reusable).toBe(true);
    expect(validation.blocked).toBe(false);
    expect(validation.reason).toBe("promoted_spec_valid");
  } finally {
    fs.rmSync(appRoot, { recursive: true, force: true });
  }
});

test("promoted spec validation rejects section mismatch", () => {
  const caseId = 990002;
  const appSlug = `tmp-route-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const appRoot = path.join(process.cwd(), "automations", "apps", appSlug);
  const caseDir = path.join(appRoot, "sections", "section-real", "cases", `c${caseId}-sample`);
  const specPath = path.join(caseDir, "case.spec.ts");
  const planPath = path.join(caseDir, "plan.json");

  fs.mkdirSync(caseDir, { recursive: true });
  fs.writeFileSync(specPath, "test('sample', async () => {});", "utf-8");
  fs.writeFileSync(planPath, "{\"steps\":[]}", "utf-8");

  try {
    const validation = validatePromotedEntryForExecution({
      caseId,
      appSlug,
      sectionSlug: "section-expected",
      entry: {
        id: "entry-2",
        caseId,
        title: "sample",
        planPath,
        specPath,
        appSlug,
        status: "active",
        source: "manual",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    expect(validation.reusable).toBe(false);
    expect(validation.reason).toBe("section_slug_mismatch");
  } finally {
    fs.rmSync(appRoot, { recursive: true, force: true });
  }
});

test("promoted spec validation keeps legacy non-sectioned specs reusable when case/app are valid", () => {
  const caseId = 990006;
  const appSlug = `tmp-route-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const appRoot = path.join(process.cwd(), "automations", "apps", appSlug);
  const caseDir = path.join(appRoot, "cases", `c${caseId}-sample`);
  const specPath = path.join(caseDir, "case.spec.ts");
  const planPath = path.join(caseDir, "plan.json");
  const appConfigPath = path.join(appRoot, "app.config.json");

  fs.mkdirSync(caseDir, { recursive: true });
  fs.writeFileSync(specPath, "test('sample', async () => {});", "utf-8");
  fs.writeFileSync(planPath, "{\"steps\":[]}", "utf-8");
  fs.writeFileSync(appConfigPath, "{}", "utf-8");

  try {
    const validation = validatePromotedEntryForExecution({
      caseId,
      appSlug,
      sectionSlug: "detalle-kiosko",
      entry: {
        id: "entry-legacy-no-section",
        caseId,
        title: "legacy",
        planPath,
        specPath,
        appSlug,
        appConfigPath,
        status: "active",
        source: "manual",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    expect(validation.reusable).toBe(true);
    expect(validation.reason).toBe("promoted_spec_valid");
  } finally {
    fs.rmSync(appRoot, { recursive: true, force: true });
  }
});

test("promoted spec validation rejects reusable candidate from a different appSlug", () => {
  const validation = validatePromotedEntryForExecution({
    caseId: 990007,
    appSlug: "default",
    sectionSlug: "any-section",
    entry: {
      id: "entry-other-app",
      caseId: 990007,
      title: "other app",
      planPath: "automations/apps/app-b/sections/any-section/cases/c990007/plan.json",
      specPath: "automations/apps/app-b/sections/any-section/cases/c990007/case.spec.ts",
      appSlug: "app-b",
      status: "active",
      source: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
  expect(validation.reusable).toBe(false);
  expect(validation.reason).toBe("app_slug_mismatch");
});

test("promoted spec validation marks blocked statuses as blocked route candidates", () => {
  const validation = validatePromotedEntryForExecution({
    caseId: 990003,
    appSlug: "app-a",
    sectionSlug: "any-section",
    entry: {
      id: "entry-3",
      caseId: 990003,
      title: "blocked",
      planPath: "automations/apps/app-a/sections/any-section/cases/c990003/plan.json",
      specPath: "automations/apps/app-a/sections/any-section/cases/c990003/case.spec.ts",
      appSlug: "app-a",
      status: "needs_page_method",
      source: "manual",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
  expect(validation.reusable).toBe(false);
  expect(validation.blocked).toBe(true);
  expect(validation.reason).toBe("blocked_status_needs_page_method");
});

test("promoted spec validation accepts draft status when files are executable", () => {
  const caseId = 990004;
  const appSlug = `tmp-route-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const sectionSlug = "seccion-kiosko";
  const appRoot = path.join(process.cwd(), "automations", "apps", appSlug);
  const caseDir = path.join(appRoot, "sections", sectionSlug, "cases", `c${caseId}-sample`);
  const specPath = path.join(caseDir, "case.spec.ts");
  const planPath = path.join(caseDir, "plan.json");

  fs.mkdirSync(caseDir, { recursive: true });
  fs.writeFileSync(specPath, "test('sample', async () => {});", "utf-8");
  fs.writeFileSync(planPath, "{\"steps\":[]}", "utf-8");

  try {
    const validation = validatePromotedEntryForExecution({
      caseId,
      appSlug,
      sectionSlug,
      entry: {
        id: "entry-4",
        caseId,
        title: "draft",
        planPath,
        specPath,
        appSlug,
        status: "draft",
        source: "manual",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    expect(validation.reusable).toBe(true);
  } finally {
    fs.rmSync(appRoot, { recursive: true, force: true });
  }
});

test("promoted spec validation accepts inline_debug_only status when files are executable", () => {
  const caseId = 990005;
  const appSlug = `tmp-route-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const sectionSlug = "seccion-kiosko";
  const appRoot = path.join(process.cwd(), "automations", "apps", appSlug);
  const caseDir = path.join(appRoot, "sections", sectionSlug, "cases", `c${caseId}-sample`);
  const specPath = path.join(caseDir, "case.spec.ts");
  const planPath = path.join(caseDir, "plan.json");

  fs.mkdirSync(caseDir, { recursive: true });
  fs.writeFileSync(specPath, "test('sample', async () => {});", "utf-8");
  fs.writeFileSync(planPath, "{\"steps\":[]}", "utf-8");

  try {
    const validation = validatePromotedEntryForExecution({
      caseId,
      appSlug,
      sectionSlug,
      entry: {
        id: "entry-5",
        caseId,
        title: "inline",
        planPath,
        specPath,
        appSlug,
        status: "inline_debug_only",
        source: "manual",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
    expect(validation.reusable).toBe(true);
  } finally {
    fs.rmSync(appRoot, { recursive: true, force: true });
  }
});

test("functional snapshot: emits partial progression across cases", () => {
  const start = computeFunctionalExecutionSnapshot({
    requested: 3,
    completed: 0,
    executed: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
  });
  expect(start.progressPercent).toBe(0);
  expect(start.passRate).toBeNull();

  const afterFirst = computeFunctionalExecutionSnapshot({
    requested: 3,
    completed: 1,
    executed: 1,
    passed: 1,
    failed: 0,
    skipped: 0,
  });
  expect(afterFirst.progressPercent).toBe(33.33);
  expect(afterFirst.passRate).toBe(100);

  const afterSecond = computeFunctionalExecutionSnapshot({
    requested: 3,
    completed: 2,
    executed: 2,
    passed: 1,
    failed: 1,
    skipped: 0,
  });
  expect(afterSecond.progressPercent).toBe(66.67);
  expect(afterSecond.passRate).toBe(50);

  const afterThird = computeFunctionalExecutionSnapshot({
    requested: 3,
    completed: 3,
    executed: 3,
    passed: 2,
    failed: 1,
    skipped: 0,
  });
  expect(afterThird.progressPercent).toBe(100);
  expect(afterThird.passRate).toBe(66.67);
});

test("evidence parser: detects initialized recorder", () => {
  const parsed = parseEvidenceInitializationResult([
    "[evidence] initialized scenario=TR-CASE-42868",
  ]);
  expect(parsed).toEqual({
    initialized: true,
    reason: "none",
  });
});

test("evidence parser: detects esm/cjs initialization error", () => {
  const parsed = parseEvidenceInitializationResult([
    "Warning: Failed to load the ES module: src\\evidence\\evidence-recorder.ts",
    "[evidence] init failed: Cannot use import statement outside a module",
  ]);
  expect(parsed).toEqual({
    initialized: false,
    reason: "esm_cjs_boundary_violation",
  });
});
