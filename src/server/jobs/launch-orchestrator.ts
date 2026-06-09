import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { config, requireTestRailConfig } from "../../config/env";
import { TestRailClient } from "../../clients/testrail.client";
import { publishScenariosToTestRail } from "../services/testrail-case-publisher";
import type { McpScenario } from "../../scenarios/scenario-types";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const LAUNCH_ARTIFACTS_DIR = path.join(ROOT, ".artifacts", "scenario-launch-runs");

export type LaunchScenario = {
  scenarioId: string;
  title: string;
  steps: string[];
  expectedResult: string;
  preconditions: string[];
  sourceIssueKey?: string;
  metadata?: Record<string, unknown>;
};

export type LaunchExecutionInput = {
  appSlug: string;
  sectionSlug?: string;
  sectionName?: string;
  sectionId?: string | number;
  projectId?: number;
  suiteId?: number;
  testrailSectionId?: number;
  jiraKey?: string;
  sprintName?: string;
  selectedScenarios: LaunchScenario[];
  publishStrategy?: "always_create" | "use_existing";
};

export type PublishedCaseEntry = {
  scenarioId: string;
  caseId: number;
  title: string;
  sourceIssueKey?: string;
  launchScenarioId?: string;
};

export type LaunchExecutionResult = {
  ok: true;
  launchId: string;
  status: string;
  publishedCases: PublishedCaseEntry[];
  testRunId?: number;
  manifestPath: string;
} | {
  ok: false;
  error: string;
  message: string;
};

function buildLaunchRunName(jiraKey?: string, sprintName?: string): string {
  const parts: string[] = [];
  if (jiraKey) parts.push(jiraKey);
  if (sprintName) parts.push(sprintName);
  parts.push("QA Lab Automation Run");
  parts.push(new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
  return parts.join(" - ");
}

function scenarioToMcpFormat(scenario: LaunchScenario, index: number, appSlug: string): McpScenario {
  return {
    sourceIssueKey: scenario.sourceIssueKey ?? `launch-${index + 1}`,
    title: scenario.title,
    steps: scenario.steps,
    preconditions: scenario.preconditions ?? [],
    expectedResult: scenario.expectedResult ?? "",
    type: "Functional",
    database: "QA",
    isConverted: 0,
    automationType: "ui_with_auth_gate",
    setupStrategy: "auth_gate",
    appSlug,
    routeProfile: "",
    dataRequirements: "",
    nonExecutableCriteria: "",
    mcpExecutable: true,
  };
}

export async function launchExecution(input: LaunchExecutionInput): Promise<LaunchExecutionResult> {
  // ── 1. Validate payload ──
  console.log(`[launch-execution] validating payload`);
  if (!input.projectId || input.projectId <= 0) {
    return { ok: false, error: "missing_project_id", message: "TestRail projectId is required." };
  }
  if (!input.testrailSectionId && !input.sectionId) {
    return { ok: false, error: "missing_section_id", message: "TestRail sectionId is required." };
  }
  if (!input.selectedScenarios || input.selectedScenarios.length === 0) {
    return { ok: false, error: "missing_selected_scenarios", message: "At least one scenario must be selected." };
  }

  // Validate unique scenarioIds
  const seenIds = new Set<string>();
  for (const sc of input.selectedScenarios) {
    if (!sc.scenarioId) {
      return { ok: false, error: "missing_scenario_id", message: `Scenario "${sc.title}" has no scenarioId.` };
    }
    if (seenIds.has(sc.scenarioId)) {
      return { ok: false, error: "duplicate_scenario_ids", message: `Duplicate scenarioId: "${sc.scenarioId}". Each scenario must have a unique execution ID.` };
    }
    seenIds.add(sc.scenarioId);
  }

  const launchId = randomUUID();
  const artifactDir = path.join(LAUNCH_ARTIFACTS_DIR, launchId);
  fs.mkdirSync(artifactDir, { recursive: true });

  const effectiveSectionId = Number(input.testrailSectionId ?? input.sectionId);

  const scenarioIds = input.selectedScenarios.map((_, i) => `PREVIEW-${String(i + 1).padStart(3, "0")}`).join(",");
  console.log(`[launch-execution] starting launchId=${launchId} appSlug=${input.appSlug} scenarios=${input.selectedScenarios.length} ids=${scenarioIds}`);

  // ── 2. Publish scenarios to TestRail ──
  let publishedCaseIds: number[] = [];
  let publishMappings: Array<{ scenarioId: string; testRailCaseId: number; title?: string }> = [];

  try {
    const trConfig = requireTestRailConfig(config);
    const trClient = new TestRailClient(trConfig);

    const mcpScenarios = input.selectedScenarios.map((s, i) => scenarioToMcpFormat(s, i, input.appSlug));
    const publishResult = await publishScenariosToTestRail(trClient, {
      projectId: input.projectId,
      suiteId: input.suiteId,
      sectionId: effectiveSectionId,
      scenarios: mcpScenarios,
      appSlug: input.appSlug,
      cacheKey: `launch-${launchId}`,
      publishStrategy: input.publishStrategy ?? "always_create",
    } as any);

    publishedCaseIds = publishResult.caseIds;
    publishMappings = publishResult.mappings.map((m: any, mi: number) => {
      const inputSc = input.selectedScenarios[mi];
      const mapping = {
        scenarioId: m.scenarioId,
        testRailCaseId: m.testRailCaseId,
        title: m.title ?? inputSc?.title,
        sourceIssueKey: inputSc?.sourceIssueKey,
        launchScenarioId: inputSc?.scenarioId,
      };
      console.log(`[launch-execution] id mapping source=${inputSc?.sourceIssueKey ?? "?"} launch=${inputSc?.scenarioId ?? "?"} execution=${m.scenarioId} caseId=${m.testRailCaseId}`);
      return mapping;
    });

    console.log(`[launch-execution] published cases count=${publishedCaseIds.length} created=${publishResult.created} updated=${publishResult.updated} reused=${publishResult.reused}`);

    // Validate count match
    if (publishedCaseIds.length !== input.selectedScenarios.length) {
      const msg = `Publish count mismatch: expected ${input.selectedScenarios.length} but got ${publishedCaseIds.length}. Aborting TestRun creation.`;
      console.error(`[launch-execution] ${msg}`);
      return { ok: false, error: "publish_count_mismatch", message: msg };
    }

    const uniqueIds = new Set(publishedCaseIds);
    if (uniqueIds.size !== publishedCaseIds.length) {
      const msg = `Duplicate case IDs detected: ${publishedCaseIds.length} entries but only ${uniqueIds.size} unique. Aborting.`;
      console.error(`[launch-execution] ${msg}`);
      return { ok: false, error: "duplicate_case_ids_for_run", message: msg };
    }
  } catch (err: any) {
    const message = `Failed to publish scenarios to TestRail: ${err.message ?? String(err)}`;
    console.error(`[launch-execution] ${message}`);
    return { ok: false, error: "publish_failed", message };
  }

  if (publishedCaseIds.length === 0) {
    return { ok: false, error: "publish_failed", message: "No case IDs were returned after publishing. Cannot create TestRun." };
  }

  // ── 3. Create TestRun ──
  let testRunId: number | undefined;
  const runRefs = (input.jiraKey || "").trim();

  try {
    const trConfig = requireTestRailConfig(config);
    const trClient = new TestRailClient(trConfig);

    const runName = buildLaunchRunName(input.jiraKey, input.sprintName);
    console.log(`[launch-execution] creating TestRail run include_all=false caseIds=${publishedCaseIds.length} ids=${JSON.stringify(publishedCaseIds)} refs=${runRefs || "(none)"}`);
    const run = await trClient.addRun({
      projectId: String(input.projectId),
      suiteId: input.suiteId ? String(input.suiteId) : undefined,
      name: runName,
      description: `QA Lab launch for ${input.appSlug} | section=${effectiveSectionId} | ${input.selectedScenarios.length} scenarios | launchId=${launchId}`,
      caseIds: publishedCaseIds,
      refs: runRefs || undefined,
    });

    testRunId = run.id;
    console.log(`[launch-execution] testRun created runId=${run.id}`);
  } catch (err: any) {
    const message = `Failed to create TestRun: ${err.message ?? String(err)}`;
    console.error(`[launch-execution] ${message}`);
    return { ok: false, error: "test_run_create_failed", message };
  }

  // ── 4. Save launch manifest ──
  const publishedCases: PublishedCaseEntry[] = publishMappings.map((m, i) => ({
    scenarioId: m.scenarioId,
    caseId: m.testRailCaseId,
    title: m.title ?? input.selectedScenarios[i]?.title ?? "unknown",
    sourceIssueKey: (m as any).sourceIssueKey,
    launchScenarioId: (m as any).launchScenarioId,
  }));

  const manifest = {
    launchId,
    createdAt: new Date().toISOString(),
    appSlug: input.appSlug,
    sectionSlug: input.sectionSlug ?? "default-section",
    sectionName: input.sectionName,
    sectionId: effectiveSectionId,
    testRail: {
      projectId: input.projectId,
      suiteId: input.suiteId,
      sectionId: effectiveSectionId,
      runId: testRunId,
      refs: runRefs || undefined,
    },
    jira: input.jiraKey ? { key: input.jiraKey } : undefined,
    sprintName: input.sprintName,
    publishStrategy: input.publishStrategy ?? "always_create",
    selectedScenarioCount: input.selectedScenarios.length,
    publishedCases,
    status: "test_run_created",
  };

  const manifestPath = path.join(artifactDir, "launch-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`[launch-execution] manifest written path=${manifestPath}`);

  return {
    ok: true,
    launchId,
    status: "test_run_created",
    publishedCases,
    testRunId,
    manifestPath,
  };
}
