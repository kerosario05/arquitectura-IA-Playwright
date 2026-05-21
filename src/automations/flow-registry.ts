import fs from "node:fs/promises";
import path from "node:path";
import type {
  FlowRegistry,
  FlowCandidate,
  FlowStep
} from "../types/page-object.types";
import { buildAppAutomationPaths } from "./app-profile";
import type { AppProfile } from "./app-profile";

const REGISTRY_VERSION = "1.0";

function createEmptyRegistry(appSlug: string): FlowRegistry {
  return {
    version: REGISTRY_VERSION,
    appSlug,
    flows: [],
    updatedAt: new Date().toISOString()
  };
}

export function getFlowRegistryPath(appProfile: AppProfile, outputRoot?: string): string {
  const paths = buildAppAutomationPaths(appProfile, undefined, outputRoot);
  return paths.flowsIndexPath;
}

export async function loadFlowRegistry(appProfile: AppProfile, outputRoot?: string): Promise<FlowRegistry> {
  const registryPath = getFlowRegistryPath(appProfile, outputRoot);
  try {
    const raw = await fs.readFile(registryPath, "utf-8");
    return JSON.parse(raw) as FlowRegistry;
  } catch {
    return createEmptyRegistry(appProfile.appSlug);
  }
}

export async function saveFlowRegistry(registry: FlowRegistry, appProfile: AppProfile, outputRoot?: string): Promise<void> {
  const registryPath = getFlowRegistryPath(appProfile, outputRoot);
  registry.updatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), "utf-8");
}

export async function ensureFlowRegistry(appProfile: AppProfile, outputRoot?: string): Promise<FlowRegistry> {
  const registryPath = getFlowRegistryPath(appProfile, outputRoot);
  try {
    await fs.access(registryPath);
    return loadFlowRegistry(appProfile, outputRoot);
  } catch {
    const empty = createEmptyRegistry(appProfile.appSlug);
    await saveFlowRegistry(empty, appProfile, outputRoot);
    return empty;
  }
}

export function findFlowByIntent(registry: FlowRegistry, intent: string): FlowCandidate | undefined {
  return registry.flows.find((f) => f.name.toLowerCase().includes(intent.toLowerCase()) && f.status === "active");
}

export async function registerFlowCandidate(
  registry: FlowRegistry,
  candidate: {
    name: string;
    steps: FlowStep[];
    requiredDataKeys?: string[];
    sensitiveActions?: string[];
    confidence?: number;
  }
): Promise<{ registry: FlowRegistry; created: boolean }> {
  const existing = registry.flows.find(
    (f) => f.name === candidate.name && f.status !== "active"
  );
  if (existing) return { registry, created: false };

  const now = new Date().toISOString();
  const flow: FlowCandidate = {
    id: `flow_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: candidate.name,
    filePath: path.join("flows", `${candidate.name.replace(/\s+/g, "-").toLowerCase()}.flow.ts`),
    steps: candidate.steps,
    requiredDataKeys: candidate.requiredDataKeys ?? [],
    sensitiveActions: candidate.sensitiveActions ?? [],
    reusableAcrossCases: false,
    confidence: candidate.confidence ?? 0.5,
    status: "candidate",
    createdAt: now,
    updatedAt: now
  };

  registry.flows.push(flow);
  return { registry, created: true };
}
