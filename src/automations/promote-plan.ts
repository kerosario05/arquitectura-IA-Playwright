import fs from "node:fs/promises";
import path from "node:path";
import { validateExecutionPlan } from "../plans/execution-plan-validator";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { FullConfig } from "../types/env.types";
import type { PromotedAutomationIndexEntry } from "../types/automation-promotion.types";
import {
  buildAutomationId,
  determineAutomationStatus
} from "./automation-naming";
import {
  loadAutomationIndex,
  saveAutomationIndex,
  upsertAutomationIndexEntry
} from "./automation-index";
import { generateSpecFromPlan } from "./spec-generator";
import {
  deriveAppProfile,
  serializeRuntimeConfigForPromotion,
  savePromotedAppConfig,
  buildAppAutomationPaths
} from "./app-profile";

interface PromoteInput {
  plan: ExecutionPlan;
  sourcePlanPath?: string;
  lastExecutionResultPath?: string;
  outputRoot?: string;
  source?: "agent_handoff" | "manual" | "rule_based" | "discovery";
  overwrite?: boolean;
  appProfile?: string;
  appName?: string;
  baseUrl?: string;
  fullConfig?: FullConfig;
}

function assertPromotable(status: string, allowDraft: boolean): void {
  if (status === "needs_data" || status === "needs_discovery" || status === "unsupported") {
    throw new Error(
      `Plan status '${status}' is not eligible for promotion. Only 'validated' plans can be promoted.`
    );
  }
  if (status === "draft" && !allowDraft) {
    throw new Error(
      `Plan status is 'draft'. Use --allow-draft to promote draft plans or resolve required data first.`
    );
  }
}

async function ensureDirectories(planDir: string, specDir: string): Promise<void> {
  await fs.mkdir(planDir, { recursive: true });
  await fs.mkdir(specDir, { recursive: true });
}

export async function promoteExecutionPlan(
  input: PromoteInput,
  allowDraft = false,
  metadata?: PromotedAutomationIndexEntry["metadata"]
): Promise<PromotedAutomationIndexEntry> {
  const plan = input.plan;

  const validation = validateExecutionPlan(plan);

  if (!validation.valid) {
    const errors = validation.issues
      .filter((issue) => issue.level === "error")
      .map((issue) => `${issue.code}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid execution plan: ${errors || "unknown validation errors"}`);
  }

  const status = plan.status;

  if (status !== "validated") {
    assertPromotable(status, allowDraft);
  }

  const automationId = buildAutomationId({
    externalId: plan.scenario.externalId,
    caseId: plan.scenario.caseId,
    title: plan.scenario.title
  });

  const runtimeConfig = input.fullConfig;
  const appProfile = deriveAppProfile({
    appProfile: input.appProfile ?? runtimeConfig?.app.appProfile,
    appName: input.appName ?? runtimeConfig?.app.name,
    baseUrl: input.baseUrl ?? runtimeConfig?.app.baseUrl
  });
  const appPaths = buildAppAutomationPaths(appProfile, automationId, input.outputRoot);
  if (!appPaths.planPath || !appPaths.specPath) {
    throw new Error("Unable to resolve promoted automation paths.");
  }

  try {
    await fs.access(appPaths.planPath);
    if (!input.overwrite) {
      throw new Error(
        `Automation '${automationId}' already exists at '${appPaths.planPath}'. Use --overwrite to replace.`
      );
    }
  } catch (err) {
    if (!(err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT")) {
      throw err;
    }
  }

  await ensureDirectories(appPaths.plansDir, appPaths.specsDir);

  const planContent = JSON.stringify(plan, null, 2);
  await fs.writeFile(appPaths.planPath, planContent, "utf-8");

  const specContent = generateSpecFromPlan(plan, automationId, appProfile, appPaths);
  await fs.writeFile(appPaths.specPath, specContent, "utf-8");

  const { config: envConfig } = await import("../config/env");
  const appConfig = serializeRuntimeConfigForPromotion(input.fullConfig ?? envConfig);
  appConfig.appProfile = {
    ...appConfig.appProfile,
    appSlug: appProfile.appSlug,
    name: appProfile.name ?? appConfig.appProfile.name,
    baseUrl: appProfile.baseUrl ?? appConfig.appProfile.baseUrl,
    baseUrlHash: appProfile.baseUrlHash ?? appConfig.appProfile.baseUrlHash,
    updatedAt: new Date().toISOString()
  };
  await savePromotedAppConfig(appConfig);

  const appDirPaths = buildAppAutomationPaths(appProfile, undefined, input.outputRoot);
  const appIndexPath = appDirPaths.indexPath;
  const appIndex = await loadAutomationIndex(appIndexPath);
  const source: "agent_handoff" | "manual" | "rule_based" | "discovery" =
    input.source ?? "manual";
  const automationStatus = determineAutomationStatus(plan.status, source);
  const now = new Date().toISOString();

  const appIndexEntry: PromotedAutomationIndexEntry = {
    id: automationId,
    externalId: plan.scenario.externalId,
    caseId: plan.scenario.caseId,
    title: plan.scenario.title,
    planPath: appPaths.planPath,
    specPath: appPaths.specPath,
    appSlug: appProfile.appSlug,
    appConfigPath: appDirPaths.configPath,
    status: automationStatus,
    source,
    appProfile: appProfile.appSlug,
    baseUrlHash: appProfile.baseUrlHash,
    createdAt: now,
    updatedAt: now,
    lastPromotedFrom: input.sourcePlanPath,
    lastExecutionResultPath: input.lastExecutionResultPath,
    metadata
  };

  const updatedAppIndex = upsertAutomationIndexEntry(appIndex, appIndexEntry);
  await saveAutomationIndex(updatedAppIndex, appIndexPath);

  // --- Update global index too ---
  const globalIndexPath =
    input.outputRoot !== undefined
      ? path.join(input.outputRoot, "automations/index.json")
      : undefined;

  const globalIndex = await loadAutomationIndex(globalIndexPath);
  const updatedGlobalIndex = upsertAutomationIndexEntry(globalIndex, appIndexEntry);
  await saveAutomationIndex(updatedGlobalIndex, globalIndexPath);

  return appIndexEntry;
}
