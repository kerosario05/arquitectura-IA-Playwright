import path from "node:path";
import fs from "node:fs/promises";
import type { FullConfig } from "../types/env.types";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { PageSnapshot } from "../types/page-snapshot.types";
import type { DiscoveredObject } from "../types/discovery.types";
import { deriveAppProfile, buildAppAutomationPaths, loadPromotedAppConfigSync, redactPromotedAppConfigForLogs } from "../automations/app-profile";
import { loadAutomationIndex } from "../automations/automation-index";
import { buildSafeDataContextSummary } from "./safe-data-context";
import { buildDataContext } from "../data/data-context";

type AgentContextPackOptions = {
  maxObjects?: number;
  maxPlans?: number;
  maxRoutes?: number;
  maxSnapshotCandidates?: number;
  includePending?: boolean;
  includePromoted?: boolean;
  includeOtherApps?: boolean;
};

export type AgentContextPack = {
  version: "1.0";
  createdAt: string;
  app: {
    appSlug: string;
    profileName?: string;
    baseUrl?: string;
    baseUrlHash?: string;
  };
  appConfig?: Record<string, unknown>;
  case?: {
    caseId?: number;
    title?: string;
    source?: string;
  };
  failure: {
    failedReason?: string;
    failedTarget?: string;
    failedAtStep?: number;
    diagnostics?: unknown;
  };
  currentRun: {
    outputDir: string;
    evidenceDir?: string;
    snapshotPath?: string;
    candidatePlanPath?: string;
    pendingObjectsPath?: string;
    pendingPlansPath?: string;
  };
  knownObjects: Array<{
    key?: string;
    name?: string;
    type?: string;
    aliases?: string[];
    locator?: unknown;
    confidence?: number;
    source?: string;
    score?: number;
  }>;
  knownPlans: Array<{
    id?: string;
    caseId?: number;
    externalId?: string;
    title?: string;
    status?: string;
    source?: string;
    planPath?: string;
    createdAt?: string;
    updatedAt?: string;
    score?: number;
    route?: string[];
  }>;
  knownRoutes: Array<{
    route: string[];
    sourcePlanId?: string;
    score?: number;
  }>;
  snapshotCandidates: Array<{
    id: string;
    type: string;
    text?: string;
    label?: string;
    placeholder?: string;
    name?: string;
    role?: string;
    tagName?: string;
    dataTestid?: string;
    domId?: string;
    href?: string;
    ariaLabel?: string;
    title?: string;
    className?: string;
    candidateLocatorsCount: number;
  }>;
  supportedActions: string[];
  safeData: {
    availableKeys: Array<string | { key: string; sensitive?: boolean }>;
    redacted: true;
  };
  constraints: {
    codexMustOnlyWriteAgentResponseJson: true;
    doNotRunPlaywright: true;
    doNotModifyStableRegistry: true;
    doNotApproveObjectsAutomatically: true;
    doNotInventData: true;
  };
  warnings: string[];
};

const DEFAULTS: Required<AgentContextPackOptions> = {
  maxObjects: 50,
  maxPlans: 10,
  maxRoutes: 10,
  maxSnapshotCandidates: 50,
  includePending: true,
  includePromoted: true,
  includeOtherApps: false
};

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  const stop = new Set(["de", "la", "el", "los", "las", "y", "o", "en", "por", "para", "con", "sin", "al", "del", "the", "a", "an", "to", "for", "on", "in", "at", "by"]);
  return normalizeText(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !stop.has(t));
}

function computeTokenOverlapScore(query: string, candidate: string): number {
  const q = new Set(tokenize(query));
  const c = new Set(tokenize(candidate));
  if (q.size === 0 || c.size === 0) return 0;
  let overlap = 0;
  for (const t of q) {
    if (c.has(t)) overlap += 1;
  }
  return overlap / Math.max(q.size, 1);
}

async function readJsonIfExists<T>(filePath: string): Promise<{ value?: T; warning?: string }> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return { value: JSON.parse(content) as T };
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return { warning: `Context file not found: ${filePath}` };
    }
    return { warning: `Failed to read context file: ${filePath}. ${err instanceof Error ? err.message : String(err)}` };
  }
}

function extractRouteFromPlan(plan: ExecutionPlan): string[] {
  const route: string[] = [];
  for (const step of plan.steps) {
    if (step.action !== "click" && step.action !== "navigate") continue;
    if (!step.target || step.target === "APP_BASE_URL") continue;
    if (typeof step.target !== "object") continue;
    const val = (step.target.name ?? step.target.value ?? "").trim();
    if (val) route.push(val.slice(0, 80));
  }
  return route.slice(0, 12);
}

export async function buildAgentContextPack(input: {
  fullConfig: FullConfig;
  outputDir: string;
  evidenceDir?: string;
  snapshotPath?: string;
  snapshot?: PageSnapshot;
  candidatePlanPath?: string;
  currentPlan?: ExecutionPlan;
  pendingObjectsPath?: string;
  pendingPlansPath?: string;
  failedReason?: string;
  failedTarget?: string;
  failedAtStep?: number;
  supportedActions: string[];
  options?: AgentContextPackOptions;
}): Promise<{ pack: AgentContextPack; appSlug: string }> {
  const options = { ...DEFAULTS, ...(input.options ?? {}) };
  const warnings: string[] = [];

  const appProfile = deriveAppProfile({
    appProfile: input.fullConfig.app.appProfile,
    appName: input.fullConfig.app.name,
    baseUrl: input.fullConfig.app.baseUrl
  });
  const appSlug = appProfile.appSlug;

  const repoAppPaths = buildAppAutomationPaths(appProfile);

  const promotedAppConfig = loadPromotedAppConfigSync({ appSlug });
  const redactedAppConfig = promotedAppConfig ? redactPromotedAppConfigForLogs(promotedAppConfig) : undefined;
  if (!promotedAppConfig) {
    warnings.push(`No promoted app.config.json found for appSlug '${appSlug}'. Expected at ${repoAppPaths.configPath}`);
  }

  const safeData = buildSafeDataContextSummary(buildDataContext(input.fullConfig));

  const knownObjects: AgentContextPack["knownObjects"] = [];
  if (options.includePending && input.pendingObjectsPath) {
    const { value, warning } = await readJsonIfExists<DiscoveredObject[]>(input.pendingObjectsPath);
    if (warning) warnings.push(warning);
    if (Array.isArray(value)) {
      for (const obj of value) {
        const text = [obj.name, ...(obj.aliases ?? [])].filter(Boolean).join(" ");
        const score = input.failedTarget ? computeTokenOverlapScore(input.failedTarget, text) : 0;
        knownObjects.push({
          key: obj.key,
          name: obj.name,
          type: obj.type,
          aliases: obj.aliases,
          locator: obj.locator,
          confidence: obj.confidence,
          source: "current_run_pending",
          score
        });
      }
    }
  }

  knownObjects.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.confidence ?? 0) - (a.confidence ?? 0));
  if (knownObjects.length > options.maxObjects) {
    warnings.push(`knownObjects limited to ${options.maxObjects} (had ${knownObjects.length}).`);
    knownObjects.length = options.maxObjects;
  }

  const knownPlans: AgentContextPack["knownPlans"] = [];
  const knownRoutes: AgentContextPack["knownRoutes"] = [];
  if (options.includePromoted) {
    const appIndexPath = repoAppPaths.indexPath;
    const appIndex = await loadAutomationIndex(appIndexPath).catch((err) => {
      warnings.push(`Failed to load app automation index at ${appIndexPath}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    });

    if (appIndex) {
      for (const entry of appIndex.automations) {
        const planPath = entry.planPath;
        const score = input.failedTarget ? computeTokenOverlapScore(input.failedTarget, `${entry.title ?? ""}`) : 0;
        knownPlans.push({
          id: entry.id,
          caseId: entry.caseId,
          externalId: entry.externalId,
          title: entry.title,
          status: entry.status,
          source: entry.source,
          planPath,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          score
        });
      }
    }
  }

  // Rank: same caseId/externalId first, then status, then similarity score.
  const currentCaseId = input.currentPlan?.scenario.caseId;
  const currentExternalId = input.currentPlan?.scenario.externalId;
  knownPlans.sort((a, b) => {
    const aSame = (currentCaseId && a.caseId === currentCaseId) || (currentExternalId && a.externalId === currentExternalId);
    const bSame = (currentCaseId && b.caseId === currentCaseId) || (currentExternalId && b.externalId === currentExternalId);
    if (aSame !== bSame) return aSame ? -1 : 1;
    const aActive = a.status === "active";
    const bActive = b.status === "active";
    if (aActive !== bActive) return aActive ? -1 : 1;
    return (b.score ?? 0) - (a.score ?? 0);
  });

  if (knownPlans.length > options.maxPlans) {
    warnings.push(`knownPlans limited to ${options.maxPlans} (had ${knownPlans.length}).`);
    knownPlans.length = options.maxPlans;
  }

  // Build knownRoutes from top plans (load only those plan files).
  for (const planMeta of knownPlans.slice(0, options.maxRoutes)) {
    if (!planMeta.planPath) continue;
    const { value, warning } = await readJsonIfExists<ExecutionPlan>(planMeta.planPath);
    if (warning) {
      warnings.push(warning);
      continue;
    }
    if (!value) continue;
    const route = extractRouteFromPlan(value);
    if (route.length === 0) continue;
    knownRoutes.push({
      route,
      sourcePlanId: planMeta.id,
      score: input.failedTarget ? computeTokenOverlapScore(input.failedTarget, route.join(" ")) : 0
    });
    planMeta.route = route;
  }

  knownRoutes.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (knownRoutes.length > options.maxRoutes) {
    knownRoutes.length = options.maxRoutes;
  }

  const snapshotCandidates: AgentContextPack["snapshotCandidates"] = [];
  const snapshot = input.snapshot;
  if (snapshot) {
    for (const el of snapshot.elements) {
      if (!el.visible) continue;
      snapshotCandidates.push({
        id: el.id,
        type: el.type,
        text: el.text,
        label: el.label,
        placeholder: el.placeholder,
        name: el.name,
        role: el.role,
        tagName: el.tagName,
        dataTestid: el.dataTestid,
        domId: el.domId,
        href: el.href,
        ariaLabel: el.ariaLabel,
        title: el.title,
        className: el.className,
        candidateLocatorsCount: Array.isArray(el.candidateLocators) ? el.candidateLocators.length : 0
      });
    }
  }

  // Rank snapshot candidates by failedTarget similarity, then locator richness.
  if (input.failedTarget) {
    snapshotCandidates.sort((a, b) => {
      const aText = [a.text, a.label, a.placeholder, a.name, a.ariaLabel, a.title].filter(Boolean).join(" ");
      const bText = [b.text, b.label, b.placeholder, b.name, b.ariaLabel, b.title].filter(Boolean).join(" ");
      const sa = computeTokenOverlapScore(input.failedTarget!, aText);
      const sb = computeTokenOverlapScore(input.failedTarget!, bText);
      return sb - sa || (b.candidateLocatorsCount - a.candidateLocatorsCount);
    });
  }
  if (snapshotCandidates.length > options.maxSnapshotCandidates) {
    warnings.push(`snapshotCandidates limited to ${options.maxSnapshotCandidates} (had ${snapshotCandidates.length}).`);
    snapshotCandidates.length = options.maxSnapshotCandidates;
  }

  const pack: AgentContextPack = {
    version: "1.0",
    createdAt: new Date().toISOString(),
    app: {
      appSlug,
      profileName: input.fullConfig.app.appProfile,
      baseUrl: input.fullConfig.app.baseUrl,
      baseUrlHash: appProfile.baseUrlHash
    },
    case: input.currentPlan?.scenario
      ? { caseId: input.currentPlan.scenario.caseId, title: input.currentPlan.scenario.title, source: input.currentPlan.scenario.source }
      : undefined,
    failure: {
      failedReason: input.failedReason,
      failedTarget: input.failedTarget,
      failedAtStep: input.failedAtStep
    },
    currentRun: {
      outputDir: path.resolve(input.outputDir),
      evidenceDir: input.evidenceDir ? path.resolve(input.evidenceDir) : undefined,
      snapshotPath: input.snapshotPath ? path.resolve(input.snapshotPath) : undefined,
      candidatePlanPath: input.candidatePlanPath ? path.resolve(input.candidatePlanPath) : undefined,
      pendingObjectsPath: input.pendingObjectsPath ? path.resolve(input.pendingObjectsPath) : undefined,
      pendingPlansPath: input.pendingPlansPath ? path.resolve(input.pendingPlansPath) : undefined
    },
    knownObjects,
    knownPlans,
    knownRoutes,
    snapshotCandidates,
    supportedActions: input.supportedActions,
    safeData: {
      availableKeys: safeData.availableKeys ?? [],
      redacted: true
    },
    constraints: {
      codexMustOnlyWriteAgentResponseJson: true,
      doNotRunPlaywright: true,
      doNotModifyStableRegistry: true,
      doNotApproveObjectsAutomatically: true,
      doNotInventData: true
    },
    warnings
  };

  // Attach a redacted app config snapshot as a warningless hint (kept out of safeData).
  if (redactedAppConfig) {
    pack.appConfig = redactedAppConfig;
  }

  return { pack, appSlug };
}
