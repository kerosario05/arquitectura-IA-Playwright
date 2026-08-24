import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { config, requireTestRailConfig } from "../../config/env";
import { TestRailClient } from "../../clients/testrail.client";
import { publishScenariosToTestRail } from "../services/testrail-case-publisher";
import { buildScenarioPreviewScenarioId } from "../services/testrail-sync-types";
import type { McpScenario } from "../../scenarios/scenario-types";
import { defectChecklistStore } from "../services/defect-checklist-store";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const LAUNCH_ARTIFACTS_DIR = path.join(ROOT, ".artifacts", "scenario-launch-runs");

export type LaunchScenario = {
  scenarioId: string;
  title: string;
  steps: string[];
  expectedResult: string;
  preconditions: string[];
  sourceIssueKey?: string;
  testRailCaseId?: number;
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
  jiraTitle?: string;
  sprintName?: string;
  selectedScenarios: LaunchScenario[];
  existingTestRailCaseIds?: number[];
  adaptiveScenarios?: LaunchScenario[];
  publishStrategy?: "always_create" | "use_existing";
};

export type PublishedCaseEntry = {
  scenarioId: string; // TestRail custom_scenario_id (same as testrailCustomScenarioId)
  caseId: number;
  title: string;
  sourceType?: "jira_preview" | "testrail_case";
  sourceIssueKey?: string;
  launchScenarioId?: string; // Frontend-provided ID (e.g., LAUNCH-001) - NOT globally unique, visual only
  executionScenarioId?: string; // Discovery execution ID (e.g., PREVIEW-001) - what case_finished emits
  testrailCustomScenarioId?: string; // Globally unique ID for TestRail (e.g., L-abe094d6-001)
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

function scenarioToMcpFormat(scenario: LaunchScenario, index: number, appSlug: string): McpScenario & { launchScenarioId?: string } {
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
    launchScenarioId: scenario.scenarioId, // Pass through for unique TestRail ID generation
  };
}

type PlannedLaunchScenario = LaunchScenario & {
  originalIndex: number;
  resolvedCaseId?: number;
};

type LaunchSelectionPlan = {
  normalizedScenarios: PlannedLaunchScenario[];
  scenariosToPublish: PlannedLaunchScenario[];
  existingScenarios: PlannedLaunchScenario[];
  existingTestRailCaseIds: number[];
  invalidScenarioTitles: string[];
};

function toPositiveCaseId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return undefined;
    const parsed = Number(trimmed);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

export function extractLaunchScenarioCaseId(scenario: LaunchScenario): number | undefined {
  const asAny = scenario as any;
  const metadata = (asAny.metadata && typeof asAny.metadata === "object") ? asAny.metadata : undefined;
  const candidates = [
    scenario.testRailCaseId,
    asAny.testRailCaseId,
    asAny.caseId,
    metadata?.testRailCaseId,
    metadata?.caseId,
  ];
  for (const value of candidates) {
    const parsed = toPositiveCaseId(value);
    if (parsed) return parsed;
  }
  return undefined;
}

export function buildLaunchSelectionPlan(input: Pick<LaunchExecutionInput, "selectedScenarios" | "existingTestRailCaseIds">): LaunchSelectionPlan {
  const normalizedScenarios: PlannedLaunchScenario[] = [];
  const invalidScenarioTitles: string[] = [];
  const selected = input.selectedScenarios ?? [];

  for (let i = 0; i < selected.length; i++) {
    const scenario = selected[i];
    const resolvedCaseId = extractLaunchScenarioCaseId(scenario);
    const scenarioId = typeof scenario.scenarioId === "string" ? scenario.scenarioId.trim() : "";
    const resolvedScenarioId = scenarioId || (resolvedCaseId ? `TR-CASE-${resolvedCaseId}` : "");

    if (!resolvedScenarioId) {
      invalidScenarioTitles.push(scenario.title || `scenario_index_${i}`);
      continue;
    }

    normalizedScenarios.push({
      ...scenario,
      scenarioId: resolvedScenarioId,
      originalIndex: i,
      resolvedCaseId,
    });
  }

  const existingCaseIdSet = new Set<number>();
  for (const caseId of input.existingTestRailCaseIds ?? []) {
    const parsed = toPositiveCaseId(caseId);
    if (parsed) existingCaseIdSet.add(parsed);
  }

  const existingScenarios: PlannedLaunchScenario[] = [];
  const scenariosToPublish: PlannedLaunchScenario[] = [];

  for (const scenario of normalizedScenarios) {
    if (scenario.resolvedCaseId) {
      existingCaseIdSet.add(scenario.resolvedCaseId);
      existingScenarios.push(scenario);
      continue;
    }
    scenariosToPublish.push(scenario);
  }

  return {
    normalizedScenarios,
    scenariosToPublish,
    existingScenarios,
    existingTestRailCaseIds: Array.from(existingCaseIdSet),
    invalidScenarioTitles,
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

  const selectionPlan = buildLaunchSelectionPlan({
    selectedScenarios: input.selectedScenarios ?? [],
    existingTestRailCaseIds: input.existingTestRailCaseIds ?? [],
  });

  if (selectionPlan.invalidScenarioTitles.length > 0) {
    return {
      ok: false,
      error: "missing_scenario_id",
      message: `Scenario "${selectionPlan.invalidScenarioTitles[0]}" has no scenarioId.`,
    };
  }

  const standardCount = selectionPlan.normalizedScenarios.length;
  const existingCaseCount = selectionPlan.existingTestRailCaseIds.length;
  const adaptiveCount = input.adaptiveScenarios?.length ?? 0;
  const launchableSelectionCount = selectionPlan.scenariosToPublish.length + existingCaseCount;
  if (launchableSelectionCount === 0 && adaptiveCount === 0) {
    return {
      ok: false,
      error: "missing_selected_scenarios",
      message: "At least one selected generated scenario, existing TestRail case, or adaptive scenario must be selected.",
    };
  }
  console.log(
    `[runs:launch] standard=${standardCount} publishable=${selectionPlan.scenariosToPublish.length} existingCases=${existingCaseCount} adaptive=${adaptiveCount} mode=${adaptiveCount > 0 ? "automatic_mixed_execution" : "standard"}`,
  );

  // Validate adaptive scenarios have required metadata
  const validAdaptive: LaunchScenario[] = [];
  const blockedAdaptive: Array<{ sourceIssueKey?: string; title?: string; reasonCode: string; reason: string }> = [];
  for (const sc of input.adaptiveScenarios ?? []) {
    const asAny = sc as any;
    if (!asAny.targetScreen || !asAny.actualChain || !asAny.requiredChain) {
      blockedAdaptive.push({
        sourceIssueKey: asAny.sourceIssueKey ?? "",
        title: asAny.title ?? "",
        reasonCode: "adaptive_metadata_incomplete",
        reason: `Missing: ${!asAny.targetScreen ? "targetScreen " : ""}${!asAny.actualChain ? "actualChain " : ""}${!asAny.requiredChain ? "requiredChain " : ""}`,
      });
    } else {
      validAdaptive.push(sc);
    }
  }
  if (blockedAdaptive.length > 0) {
    console.log(`[runs:launch] blockedAdaptive count=${blockedAdaptive.length} reason=adaptive_metadata_incomplete`);
  }

  // Validate unique scenarioIds
  const seenIds = new Set<string>();
  for (const sc of selectionPlan.normalizedScenarios) {
    if (seenIds.has(sc.scenarioId)) {
      return { ok: false, error: "duplicate_scenario_ids", message: `Duplicate scenarioId: "${sc.scenarioId}". Each scenario must have a unique execution ID.` };
    }
    seenIds.add(sc.scenarioId);
  }

  const launchId = randomUUID();
  const artifactDir = path.join(LAUNCH_ARTIFACTS_DIR, launchId);
  fs.mkdirSync(artifactDir, { recursive: true });

  const effectiveSectionId = Number(input.testrailSectionId ?? input.sectionId);

  const scenarioIds = selectionPlan.normalizedScenarios.map((_, i) => `PREVIEW-${String(i + 1).padStart(3, "0")}`).join(",");
  console.log(`[launch-execution] starting launchId=${launchId} appSlug=${input.appSlug} scenarios=${selectionPlan.normalizedScenarios.length} ids=${scenarioIds}`);

  // ── 2. Publish scenarios to TestRail ──
  let caseIdsForRun: number[] = [...selectionPlan.existingTestRailCaseIds];
  type PublishMapping = {
    scenarioId: string; // TestRail custom_scenario_id
    testRailCaseId: number;
    title?: string;
    sourceIssueKey?: string;
    launchScenarioId?: string; // Frontend ID (LAUNCH-001) - visual only
    executionScenarioId?: string; // Discovery execution ID (PREVIEW-001)
    testrailCustomScenarioId?: string; // Globally unique TestRail ID (L-xxx-001)
  };
  let publishMappings: PublishMapping[] = [];

  if (selectionPlan.scenariosToPublish.length > 0) {
    try {
      const trConfig = requireTestRailConfig(config);
      const trClient = new TestRailClient(trConfig);

      const mcpScenarios = selectionPlan.scenariosToPublish.map((s, i) => scenarioToMcpFormat(s, i, input.appSlug));
      const publishResult = await publishScenariosToTestRail(trClient, {
        projectId: input.projectId,
        suiteId: input.suiteId,
        sectionId: effectiveSectionId,
        scenarios: mcpScenarios,
        appSlug: input.appSlug,
        cacheKey: `launch-${launchId}`,
        publishStrategy: input.publishStrategy ?? "always_create",
        launchId, // Pass launchId for unique ID generation
      } as any);

      caseIdsForRun.push(...publishResult.caseIds);
      publishMappings = publishResult.mappings.map((m: any, mi: number) => {
        const inputSc = selectionPlan.scenariosToPublish[mi];

        // executionScenarioId: what discovery will emit (PREVIEW-001)
        const executionScenarioId = buildScenarioPreviewScenarioId(
          scenarioToMcpFormat(inputSc, inputSc.originalIndex, input.appSlug),
          inputSc.originalIndex,
        );

        // testrailCustomScenarioId: globally unique ID stored in TestRail (L-abe094d6-001)
        const testrailCustomScenarioId = m.scenarioId;

        // launchScenarioId: frontend-provided ID (LAUNCH-001) - visual only, NOT globally unique
        const launchScenarioId = inputSc.scenarioId;

        const mapping: PublishMapping = {
          scenarioId: testrailCustomScenarioId, // TestRail custom_scenario_id
          testRailCaseId: m.testRailCaseId,
          title: m.title ?? inputSc.title,
          sourceIssueKey: inputSc.sourceIssueKey,
          launchScenarioId,
          executionScenarioId,
          testrailCustomScenarioId,
        };

        console.log(`[launch-execution] id mapping source=${inputSc.sourceIssueKey ?? "?"} launch=${launchScenarioId ?? "—"} testrailCustom=${testrailCustomScenarioId} execution=${executionScenarioId} caseId=${m.testRailCaseId}`);
        return mapping;
      });

      console.log(`[launch-execution] published cases count=${publishResult.caseIds.length} created=${publishResult.created} updated=${publishResult.updated} reused=${publishResult.reused}`);

      // Validate count match
      if (publishResult.caseIds.length !== selectionPlan.scenariosToPublish.length) {
        const msg = `Publish count mismatch: expected ${selectionPlan.scenariosToPublish.length} but got ${publishResult.caseIds.length}. Aborting TestRun creation.`;
        console.error(`[launch-execution] ${msg}`);
        return { ok: false, error: "publish_count_mismatch", message: msg };
      }
    } catch (err: any) {
      const message = `Failed to publish scenarios to TestRail: ${err.message ?? String(err)}`;
      console.error(`[launch-execution] ${message}`);
      return { ok: false, error: "publish_failed", message };
    }
  }

  caseIdsForRun = Array.from(new Set(caseIdsForRun));

  if (caseIdsForRun.length === 0) {
    return { ok: false, error: "publish_failed", message: "No case IDs were selected or returned after publishing. Cannot create TestRun." };
  }

  // ── 3. Create TestRun ──
  let testRunId: number | undefined;
  const runRefs = (input.jiraKey || "").trim();

  try {
    const trConfig = requireTestRailConfig(config);
    const trClient = new TestRailClient(trConfig);

    const runName = buildLaunchRunName(input.jiraKey, input.sprintName);
    console.log(`[launch-execution] creating TestRail run include_all=false caseIds=${caseIdsForRun.length} ids=${JSON.stringify(caseIdsForRun)} refs=${runRefs || "(none)"}`);
    const run = await trClient.addRun({
      projectId: String(input.projectId),
      suiteId: input.suiteId ? String(input.suiteId) : undefined,
      name: runName,
      description: `QA Lab launch for ${input.appSlug} | section=${effectiveSectionId} | ${selectionPlan.normalizedScenarios.length} scenarios | launchId=${launchId}`,
      caseIds: caseIdsForRun,
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
  const publishedCases: PublishedCaseEntry[] = publishMappings.map((m) => ({
    scenarioId: m.scenarioId,
    caseId: m.testRailCaseId,
    title: m.title ?? "unknown",
    sourceType: "jira_preview",
    sourceIssueKey: m.sourceIssueKey,
    launchScenarioId: m.launchScenarioId,
    executionScenarioId: m.executionScenarioId,
    testrailCustomScenarioId: m.testrailCustomScenarioId,
  }));

  const publishedCaseIdSet = new Set(publishedCases.map((pc) => pc.caseId));

  for (const scenario of selectionPlan.existingScenarios) {
    if (!scenario.resolvedCaseId || publishedCaseIdSet.has(scenario.resolvedCaseId)) continue;
    const executionScenarioId = buildScenarioPreviewScenarioId(
      scenarioToMcpFormat(scenario, scenario.originalIndex, input.appSlug),
      scenario.originalIndex,
    );
    publishedCaseIdSet.add(scenario.resolvedCaseId);
    publishedCases.push({
      scenarioId: scenario.scenarioId,
      caseId: scenario.resolvedCaseId,
      title: scenario.title ?? `TestRail Case ${scenario.resolvedCaseId}`,
      sourceType: "jira_preview",
      sourceIssueKey: scenario.sourceIssueKey,
      launchScenarioId: scenario.scenarioId,
      executionScenarioId,
    });
  }

  for (const caseId of selectionPlan.existingTestRailCaseIds) {
    if (publishedCaseIdSet.has(caseId)) continue;
    publishedCaseIdSet.add(caseId);
    publishedCases.push({
      scenarioId: `TR-CASE-${caseId}`,
      caseId,
      title: `TestRail Case ${caseId}`,
      sourceType: "testrail_case",
    });
  }

  // Log mapping validation
  console.log(`[launch-execution] publishedCases count=${publishedCases.length}`);
  for (const pc of publishedCases) {
    const executionId = pc.executionScenarioId ?? "MISSING";
    const launchId = pc.launchScenarioId ?? "—";
    const testrailCustomId = pc.testrailCustomScenarioId ?? "MISSING";
    console.log(`[launch-execution] publishedCase execution=${executionId} launch=${launchId} testrailCustom=${testrailCustomId} caseId=${pc.caseId}`);
  }

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
    jira: input.jiraKey ? { key: input.jiraKey, ...(input.jiraTitle ? { title: input.jiraTitle } : {}) } : undefined,
    sprintName: input.sprintName,
    publishStrategy: input.publishStrategy ?? "always_create",
    selectedScenarioCount: selectionPlan.normalizedScenarios.length,
    selectedExistingTestRailCaseCount: selectionPlan.existingTestRailCaseIds.length,
    adaptiveScenarioCount: input.adaptiveScenarios?.length ?? 0,
    executionMode: (input.adaptiveScenarios?.length ?? 0) > 0 ? "automatic_mixed_execution" : "standard",
    publishedCases,
    status: "test_run_created",
    executionPlan: {
      standardScenarios: selectionPlan.normalizedScenarios.map(({ originalIndex: _originalIndex, resolvedCaseId: _resolvedCaseId, ...scenario }) => scenario),
      adaptiveScenarios: input.adaptiveScenarios ?? [],
    },
  };

  const manifestPath = path.join(artifactDir, "launch-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`[launch-execution] manifest written path=${manifestPath}`);

  const issueKey = input.jiraKey || (selectionPlan.normalizedScenarios[0] as any)?.sourceIssueKey || "";

  let checklistUrl: string | undefined;
  if (issueKey) {
    const list = defectChecklistStore.getOrCreate(issueKey);
    checklistUrl = `/checklist/${list.urlSlug}`;
  }
  if (issueKey) {
    const list = defectChecklistStore.getOrCreate(issueKey);
    checklistUrl = `/checklist/${list.urlSlug}`;
  }

  return {
    ok: true,
    launchId,
    status: "test_run_created",
    issueKey: issueKey || undefined,
    checklistUrl,
    publishedCases,
    testRunId,
    manifestPath,
  };
}
