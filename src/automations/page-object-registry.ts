import fs from "node:fs/promises";
import path from "node:path";
import type {
  PageObjectRegistry,
  PageObjectEntry,
  PageObjectMethod,
  PageObjectCandidate,
  PageMethodCandidate,
  ComponentObjectCandidate,
  PageObjectCandidateStatus,
  PageMethodCandidateStatus
} from "../types/page-object.types";
import { buildAppAutomationPaths } from "./app-profile";
import type { AppProfile } from "./app-profile";

const REGISTRY_VERSION = "1.0";

function createEmptyRegistry(appSlug: string): PageObjectRegistry {
  return {
    version: REGISTRY_VERSION,
    appSlug,
    pageObjects: [],
    componentCandidates: [],
    updatedAt: new Date().toISOString()
  };
}

export function getPageObjectRegistryPath(appProfile: AppProfile, outputRoot?: string): string {
  const paths = buildAppAutomationPaths(appProfile, undefined, outputRoot);
  return paths.pageObjectsIndexPath;
}

export async function loadPageObjectRegistry(appProfile: AppProfile, outputRoot?: string): Promise<PageObjectRegistry> {
  const registryPath = getPageObjectRegistryPath(appProfile, outputRoot);
  try {
    const raw = await fs.readFile(registryPath, "utf-8");
    return JSON.parse(raw) as PageObjectRegistry;
  } catch {
    return createEmptyRegistry(appProfile.appSlug);
  }
}

export async function savePageObjectRegistry(registry: PageObjectRegistry, appProfile: AppProfile, outputRoot?: string): Promise<void> {
  const registryPath = getPageObjectRegistryPath(appProfile, outputRoot);
  registry.updatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), "utf-8");
}

export async function ensurePageObjectRegistry(appProfile: AppProfile, outputRoot?: string): Promise<PageObjectRegistry> {
  const registryPath = getPageObjectRegistryPath(appProfile, outputRoot);
  try {
    await fs.access(registryPath);
    return loadPageObjectRegistry(appProfile, outputRoot);
  } catch {
    const empty = createEmptyRegistry(appProfile.appSlug);
    await savePageObjectRegistry(empty, appProfile, outputRoot);
    return empty;
  }
}

export function findPageObjectByScreenSignature(registry: PageObjectRegistry, screenSignature: string): PageObjectEntry | undefined {
  return registry.pageObjects.find(
    (po) => po.screenSignature === screenSignature && po.status === "active"
  );
}

export function findMethodForIntent(pageObject: PageObjectEntry | undefined, intent: string): PageObjectMethod | undefined {
  if (!pageObject) return undefined;
  return pageObject.methods.find(
    (m) => m.intent === intent && m.available
  );
}

export function findCandidatePageObjectByScreenSignature(registry: PageObjectRegistry, screenSignature: string): PageObjectEntry | undefined {
  return registry.pageObjects.find(
    (po) => po.screenSignature === screenSignature
  );
}

export function findReusableMethod(
  registry: PageObjectRegistry,
  intent: string,
  screenSignature?: string
): { pageObject: PageObjectEntry; method: PageObjectMethod } | undefined {
  if (screenSignature) {
    const po = findPageObjectByScreenSignature(registry, screenSignature);
    const method = findMethodForIntent(po, intent);
    if (po && method) return { pageObject: po, method };
  }
  for (const po of registry.pageObjects.filter((p) => p.status === "active")) {
    const method = po.methods.find((m) => m.intent === intent && m.available);
    if (method) return { pageObject: po, method };
  }
  return undefined;
}

export function registerPageObjectCandidate(
  registry: PageObjectRegistry,
  candidate: {
    name: string;
    className: string;
    screenSignature: string;
    confidence: number;
    sourcePlanId: string;
    methods?: Array<{ name: string; intent: string; parameters?: string[] }>;
  }
): { registry: PageObjectRegistry; created: boolean } {
  const now = new Date().toISOString();
  const existing = registry.pageObjects.find(
    (po) => po.screenSignature === candidate.screenSignature
  );

  if (existing) {
    if (!existing.sourcePlanIds.includes(candidate.sourcePlanId)) {
      existing.sourcePlanIds.push(candidate.sourcePlanId);
    }
    return { registry, created: false };
  }

  const entry: PageObjectEntry = {
    id: `po_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    className: candidate.className,
    filePath: path.join("pages", `${candidate.className.replace(/Page$/, "").toLowerCase().replace(/-/g, "")}.page.ts`),
    screenSignature: candidate.screenSignature,
    methods: (candidate.methods ?? []).map((m) => ({
      name: m.name,
      intent: m.intent,
      parameters: m.parameters ?? [],
      available: false,
      source: "candidate",
      sensitive: false,
      confidence: candidate.confidence,
      status: "candidate" as PageMethodCandidateStatus
    })),
    confidence: candidate.confidence,
    status: "candidate" as PageObjectCandidateStatus,
    sourcePlanIds: [candidate.sourcePlanId],
    caseIds: [],
    createdAt: now,
    updatedAt: now
  };

  registry.pageObjects.push(entry);
  return { registry, created: true };
}

export function registerMethodCandidate(
  registry: PageObjectRegistry,
  pageObjectId: string,
  candidate: {
    name: string;
    intent: string;
    parameters?: string[];
    sensitive?: boolean;
    confidence?: number;
    sourceActionId: string;
  }
): { registry: PageObjectRegistry; created: boolean } {
  const po = registry.pageObjects.find((p) => p.id === pageObjectId);
  if (!po) return { registry, created: false };

  const existing = po.methods.find((m) => m.intent === candidate.intent);
  if (existing) {
    if (!existing.source.includes(candidate.sourceActionId)) {
      existing.source += `,${candidate.sourceActionId}`;
    }
    if (candidate.parameters && candidate.parameters.length > 0 && existing.parameters.length === 0) {
      existing.parameters = [...candidate.parameters];
    }
    return { registry, created: false };
  }

  const now = new Date().toISOString();
  const method: PageObjectMethod = {
    name: candidate.name,
    intent: candidate.intent,
    parameters: candidate.parameters ?? [],
    available: false,
    source: candidate.sourceActionId,
    sensitive: candidate.sensitive ?? false,
    confidence: candidate.confidence ?? 0.5,
    status: "candidate" as PageMethodCandidateStatus
  };

  po.methods.push(method);
  po.updatedAt = now;
  return { registry, created: true };
}

export function markPageObjectActive(
  registry: PageObjectRegistry,
  pageObjectId: string
): boolean {
  const po = registry.pageObjects.find((p) => p.id === pageObjectId);
  if (!po || po.status === "active") return false;
  po.status = "active";
  po.updatedAt = new Date().toISOString();
  return true;
}

export function markMethodActive(
  registry: PageObjectRegistry,
  pageObjectId: string,
  methodName: string
): boolean {
  const po = registry.pageObjects.find((p) => p.id === pageObjectId);
  if (!po) return false;
  const method = po.methods.find((m) => m.name === methodName);
  if (!method || method.status === "active") return false;
  method.status = "active";
  method.available = true;
  po.updatedAt = new Date().toISOString();
  return true;
}

export function registerComponentCandidate(
  registry: PageObjectRegistry,
  candidate: {
    name: string;
    className: string;
    componentSignature: string;
    confidence: number;
  }
): { registry: PageObjectRegistry; created: boolean } {
  const existing = registry.componentCandidates.find(
    (cc) => cc.componentSignature === candidate.componentSignature
  );
  if (existing) return { registry, created: false };

  const now = new Date().toISOString();
  registry.componentCandidates.push({
    id: `comp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: candidate.name,
    className: candidate.className,
    filePath: path.join("components", `${candidate.className.replace(/Component$/, "").toLowerCase()}.component.ts`),
    componentSignature: candidate.componentSignature,
    methods: [],
    confidence: candidate.confidence,
    status: "candidate",
    createdAt: now,
    updatedAt: now
  });

  return { registry, created: true };
}
