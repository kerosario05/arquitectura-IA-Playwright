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
import type { ExecutionPlanStep } from "../types/execution-plan.types";
import type { SemanticMethodIntent } from "../types/pom-ownership";
import { INTENT_PREFERRED_OWNER, INTENT_CLASS_OWNERSHIP, METHOD_INTENT_NAME_MAP } from "../types/pom-ownership";
import { buildAppAutomationPaths } from "./app-profile";
import type { AppProfile } from "./app-profile";

const REGISTRY_VERSION = "1.0";
const REGISTRY_READ_RETRIES = 3;
const REGISTRY_RETRY_DELAY_MS = 50;

function createEmptyRegistry(appSlug: string): PageObjectRegistry {
  return {
    version: REGISTRY_VERSION,
    appSlug,
    pageObjects: [],
    componentCandidates: [],
    updatedAt: new Date().toISOString()
  };
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT");
}

function isTransientFsError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
  return code === "EBUSY" || code === "EPERM" || code === "EACCES" || code === "EMFILE" || code === "ENFILE";
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readRegistryFileWithRetry(registryPath: string): Promise<string | undefined> {
  for (let attempt = 0; attempt <= REGISTRY_READ_RETRIES; attempt++) {
    try {
      return await fs.readFile(registryPath, "utf-8");
    } catch (error) {
      if (isMissingFileError(error)) {
        return undefined;
      }
      if (isTransientFsError(error) && attempt < REGISTRY_READ_RETRIES) {
        await delay(REGISTRY_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
  return undefined;
}

function parseRegistryJson(raw: string, registryPath: string): PageObjectRegistry {
  try {
    return JSON.parse(raw) as PageObjectRegistry;
  } catch (error) {
    throw new Error(
      `Invalid JSON in page object registry at "${registryPath}". ` +
      `The file exists but could not be parsed. ` +
      `Cause: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  const tempPath = path.join(
    dir,
    `${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tempPath, content, "utf-8");

  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    if (isTransientFsError(error) || (error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST")) {
      await fs.rm(filePath, { force: true });
      await fs.rename(tempPath, filePath);
    } else {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}

export function getPageObjectRegistryPath(appProfile: AppProfile, outputRoot?: string): string {
  const paths = buildAppAutomationPaths(appProfile, undefined, outputRoot);
  return paths.pageObjectsIndexPath;
}

export async function loadPageObjectRegistry(appProfile: AppProfile, outputRoot?: string): Promise<PageObjectRegistry> {
  const registryPath = getPageObjectRegistryPath(appProfile, outputRoot);
  await fs.mkdir(path.dirname(registryPath), { recursive: true });
  const raw = await readRegistryFileWithRetry(registryPath);
  if (raw === undefined) {
    return createEmptyRegistry(appProfile.appSlug);
  }
  return parseRegistryJson(raw, registryPath);
}

export async function savePageObjectRegistry(registry: PageObjectRegistry, appProfile: AppProfile, outputRoot?: string): Promise<void> {
  const registryPath = getPageObjectRegistryPath(appProfile, outputRoot);
  registry.updatedAt = new Date().toISOString();
  await writeFileAtomic(registryPath, JSON.stringify(registry, null, 2));
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

export function findMethodBySemanticIntent(
  registry: PageObjectRegistry,
  intent: SemanticMethodIntent,
  step?: ExecutionPlanStep
): { pageObject: PageObjectEntry; method: PageObjectMethod } | undefined {
  const preferredOwner = INTENT_PREFERRED_OWNER[intent];

  if (preferredOwner) {
    const ownerPO = registry.pageObjects.find(
      (po) => po.className === preferredOwner && po.status === "active"
    );
    if (ownerPO) {
      // First try to find by intent
      let method = ownerPO.methods.find(
        (m) => m.intent === intent && m.status === "active" && m.available
      );
      
      // Fallback: try to find by method name using METHOD_INTENT_NAME_MAP
      if (!method) {
        const expectedMethodName = METHOD_INTENT_NAME_MAP[intent];
        if (expectedMethodName) {
          method = ownerPO.methods.find(
            (m) => m.name === expectedMethodName && m.status === "active" && m.available
          );
        }
      }
      
      if (method) return { pageObject: ownerPO, method };
    }
  }

  const allowedClasses = INTENT_CLASS_OWNERSHIP[intent];
  for (const po of registry.pageObjects.filter((p) => p.status === "active")) {
    if (allowedClasses && !allowedClasses.includes(po.className)) continue;
    
    // First try to find by intent
    let method = po.methods.find(
      (m) => m.intent === intent && m.status === "active" && m.available
    );
    
    // Fallback: try to find by method name using METHOD_INTENT_NAME_MAP
    if (!method) {
      const expectedMethodName = METHOD_INTENT_NAME_MAP[intent];
      if (expectedMethodName) {
        method = po.methods.find(
          (m) => m.name === expectedMethodName && m.status === "active" && m.available
        );
      }
    }
    
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
    const existingSource = existing.source ?? "";
    if (!existingSource.includes(candidate.sourceActionId)) {
      existing.source = existingSource ? `${existingSource},${candidate.sourceActionId}` : candidate.sourceActionId;
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
