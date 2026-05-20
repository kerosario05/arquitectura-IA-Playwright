import fs from "node:fs/promises";
import path from "node:path";
import { buildAutomationId } from "../automations/automation-naming";
import { classifyAssertion } from "../discovery/assertion-resolver";
import { validateExecutionPlan } from "../plans/execution-plan-validator";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { ObjectRegistry, RegistryLocator, RegistryObject } from "../types/object-registry.types";
import type {
  PendingDiscoveredObject,
  RegistryPromotionConflict,
  RegistryPromotionDecision,
  RegistryPromotionOptions,
  RegistryPromotionReport
} from "../types/registry-promotion.types";
import { loadObjectRegistry, saveObjectRegistry, validateObjectRegistry } from "./index";

const DEFAULT_REGISTRY_PATH = path.resolve("src/registry/object-registry.json");
const GLOBAL_NAVIGATION_TOKENS = new Set([
  "back",
  "cancel",
  "close",
  "exit",
  "home",
  "logout",
  "menu",
  "return",
  "salir",
  "volver",
  "cerrar",
  "cancelar",
  "inicio",
  "menu"
]);

function normalizeText(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normalizeAliases(aliases: string[] | undefined): string[] {
  return [...new Set((aliases ?? []).map((alias) => normalizeText(alias)).filter(Boolean))].sort();
}

function normalizeLocator(locator: RegistryLocator): string {
  return JSON.stringify({
    strategy: locator.strategy,
    value: normalizeText(locator.value),
    role: normalizeText(locator.role),
    name: normalizeText(locator.name),
    exact: locator.exact ?? false
  });
}

function isActionableObject(object: PendingDiscoveredObject): boolean {
  return ["button", "link", "input", "select", "checkbox", "radio"].includes(object.type)
    || object.locator.strategy === "role" && ["button", "link"].includes(normalizeText(object.locator.role));
}

function isSectionLike(object: PendingDiscoveredObject): boolean {
  return object.type === "section" || object.type === "card" || object.type === "text" || object.type === "table";
}

function isGlobalNavigationObject(object: PendingDiscoveredObject): boolean {
  const tokens = new Set([
    ...normalizeText(object.key).split(/[\s_\-]+/).filter(Boolean),
    ...normalizeText(object.name).split(/\s+/).filter(Boolean),
    ...normalizeAliases(object.aliases).flatMap((alias) => alias.split(/\s+/).filter(Boolean))
  ]);

  for (const token of tokens) {
    if (GLOBAL_NAVIGATION_TOKENS.has(token)) {
      return true;
    }
  }

  return false;
}

function planUsesObject(plan: ExecutionPlan, object: PendingDiscoveredObject): boolean {
  const targetTexts = new Set<string>();
  for (const step of plan.steps) {
    if (step.target && typeof step.target === "object") {
      if (step.target.value) targetTexts.add(normalizeText(step.target.value));
      if (step.target.name) targetTexts.add(normalizeText(step.target.name));
      if (step.target.hint) targetTexts.add(normalizeText(step.target.hint));
    }
    if (step.expected) targetTexts.add(normalizeText(step.expected));
  }

  const candidates = new Set<string>([
    normalizeText(object.key),
    normalizeText(object.name),
    normalizeText(object.locator.value),
    normalizeText(object.locator.name),
    ...normalizeAliases(object.aliases)
  ]);

  for (const candidate of candidates) {
    if (candidate && targetTexts.has(candidate)) {
      return true;
    }
  }

  return false;
}

function validatePromotablePlan(plan: ExecutionPlan): string[] {
  const warnings: string[] = [];
  const validation = validateExecutionPlan(plan);
  if (!validation.valid || plan.status !== "validated") {
    throw new Error("Discovered plan is not eligible for promotion because it is not validated.");
  }
  if (!plan.scenario.caseId || !plan.scenario.title) {
    throw new Error("Discovered plan must include scenario.caseId and scenario.title.");
  }
  if (!plan.steps.length) {
    throw new Error("Discovered plan must include executable steps.");
  }

  for (const step of plan.steps) {
    if (step.action === "assertText" && step.expected) {
      const classification = classifyAssertion(step.expected);
      if (classification === "semantic_descriptor" || classification === "composite_assertion" || classification === "ambiguous_assertion") {
        throw new Error(`Discovered plan contains weak literal assertion "${step.expected}".`);
      }
    }
  }

  if (!plan.steps.some((step) => step.action !== "noop")) {
    throw new Error("Discovered plan does not contain executable steps.");
  }

  warnings.push(...validation.issues.filter((issue) => issue.level === "warning").map((issue) => issue.message));
  return warnings;
}

function deduplicatePendingObjects(
  objects: PendingDiscoveredObject[]
): {
  deduped: PendingDiscoveredObject[];
  duplicatesMerged: RegistryPromotionReport["duplicatesMerged"];
  conflicts: RegistryPromotionConflict[];
} {
  const byKey = new Map<string, PendingDiscoveredObject>();
  const byNameAndType = new Map<string, PendingDiscoveredObject>();
  const duplicatesMerged: RegistryPromotionReport["duplicatesMerged"] = [];
  const conflicts: RegistryPromotionConflict[] = [];

  for (const object of objects) {
    const normalizedKey = normalizeText(object.key);
    const normalizedLocator = normalizeLocator(object.locator);
    const normalizedNameAndType = `${normalizeText(object.name)}::${object.type}`;
    const existing = byKey.get(normalizedKey);

    if (existing) {
      const existingLocator = normalizeLocator(existing.locator);
      if (existingLocator === normalizedLocator) {
        const preferred = (existing.confidence >= object.confidence ? existing : object);
        const dropped = preferred === existing ? object : existing;
        byKey.set(normalizedKey, preferred);
        byNameAndType.set(normalizedNameAndType, preferred);
        duplicatesMerged.push({
          keptKey: preferred.key,
          droppedKeys: [dropped.key],
          reason: "Same normalized key and locator."
        });
        continue;
      }

      conflicts.push({
        key: object.key,
        existingLocator,
        incomingLocator: normalizedLocator,
        reason: "Same normalized key with different locator."
      });
      continue;
    }

    const existingByNameAndType = byNameAndType.get(normalizedNameAndType);
    if (existingByNameAndType && normalizeText(existingByNameAndType.key) !== normalizedKey) {
      const existingByNameAndTypeLocator = normalizeLocator(existingByNameAndType.locator);
      if (existingByNameAndTypeLocator === normalizedLocator) {
        const preferred = (existingByNameAndType.confidence >= object.confidence ? existingByNameAndType : object);
        const dropped = preferred === existingByNameAndType ? object : existingByNameAndType;
        byKey.delete(normalizeText(dropped.key));
        byKey.set(normalizeText(preferred.key), preferred);
        byNameAndType.set(normalizedNameAndType, preferred);
        duplicatesMerged.push({
          keptKey: preferred.key,
          droppedKeys: [dropped.key],
          reason: "Equivalent normalized name/type and locator; kept higher confidence candidate."
        });
        continue;
      }

      const preferred = (existingByNameAndType.confidence >= object.confidence ? existingByNameAndType : object);
      const dropped = preferred === existingByNameAndType ? object : existingByNameAndType;
      byKey.delete(normalizeText(dropped.key));
      byKey.set(normalizeText(preferred.key), preferred);
      byNameAndType.set(normalizedNameAndType, preferred);
      duplicatesMerged.push({
        keptKey: preferred.key,
        droppedKeys: [dropped.key],
        reason: "Same normalized name and equivalent type; kept higher confidence candidate."
      });
      continue;
    }

    byKey.set(normalizedKey, object);
    byNameAndType.set(normalizedNameAndType, object);
  }

  return {
    deduped: Array.from(byKey.values()),
    duplicatesMerged,
    conflicts
  };
}

function filterObjectsForPromotion(
  objects: PendingDiscoveredObject[],
  plan: ExecutionPlan,
  options: RegistryPromotionOptions
): {
  objectsToPromote: RegistryObject[];
  objectsSkipped: RegistryPromotionDecision[];
} {
  const objectsToPromote: RegistryObject[] = [];
  const objectsSkipped: RegistryPromotionDecision[] = [];

  for (const object of objects) {
    if (object.confidence < options.confidenceThreshold) {
      objectsSkipped.push({ object, reason: `Below confidence threshold ${options.confidenceThreshold}.` });
      continue;
    }

    const usedByPlan = planUsesObject(plan, object);
    const actionable = isActionableObject(object);
    const globalNavigation = isGlobalNavigationObject(object);
    const sectionLike = isSectionLike(object);

    if (options.excludeGlobalNavigation && globalNavigation && !usedByPlan) {
      objectsSkipped.push({ object, reason: "Excluded global/navigation object not used by plan." });
      continue;
    }

    if (actionable && usedByPlan) {
      objectsToPromote.push({
        key: object.key,
        name: object.name,
        type: object.type,
        locator: object.locator,
        aliases: object.aliases,
        stable: true,
        tags: ["promoted", "discovery", `confidence:${object.confidence.toFixed(2)}`]
      });
      continue;
    }

    if (sectionLike && !options.includeSections) {
      objectsSkipped.push({ object, reason: "Informational/section object filtered by default." });
      continue;
    }

    if (sectionLike && options.includeSections && usedByPlan) {
      objectsToPromote.push({
        key: object.key,
        name: object.name,
        type: object.type,
        locator: object.locator,
        aliases: object.aliases,
        stable: true,
        tags: ["promoted", "discovery", "section", `confidence:${object.confidence.toFixed(2)}`]
      });
      continue;
    }

    objectsSkipped.push({ object, reason: "Object is not actionable for stable promotion or not used by the validated plan." });
  }

  return { objectsToPromote, objectsSkipped };
}

function reconcileWithStableRegistry(
  objectsToPromote: RegistryObject[],
  registry: ObjectRegistry
): {
  objectsToPromote: RegistryObject[];
  duplicatesMerged: RegistryPromotionReport["duplicatesMerged"];
  conflicts: RegistryPromotionConflict[];
} {
  const duplicatesMerged: RegistryPromotionReport["duplicatesMerged"] = [];
  const conflicts: RegistryPromotionConflict[] = [];
  const stableByKey = new Map(registry.objects.map((object) => [normalizeText(object.key), object]));
  const filtered: RegistryObject[] = [];

  for (const object of objectsToPromote) {
    const existing = stableByKey.get(normalizeText(object.key));
    if (!existing) {
      filtered.push(object);
      continue;
    }

    if (normalizeLocator(existing.locator) === normalizeLocator(object.locator)) {
      duplicatesMerged.push({
        keptKey: existing.key,
        droppedKeys: [object.key],
        reason: "Already present in stable registry with same locator."
      });
      continue;
    }

    conflicts.push({
      key: object.key,
      existingLocator: normalizeLocator(existing.locator),
      incomingLocator: normalizeLocator(object.locator),
      reason: "Stable registry already contains the same key with a different locator."
    });
  }

  return { objectsToPromote: filtered, duplicatesMerged, conflicts };
}

async function readPendingArtifacts(fromDir: string): Promise<{
  objects: PendingDiscoveredObject[];
  plan: ExecutionPlan;
}> {
  const objectsPath = path.join(fromDir, "discovered-objects.pending.json");
  const planPath = path.join(fromDir, "discovered-plans.pending.json");
  const [objectsContent, planContent] = await Promise.all([
    fs.readFile(objectsPath, "utf-8"),
    fs.readFile(planPath, "utf-8")
  ]);

  return {
    objects: JSON.parse(objectsContent) as PendingDiscoveredObject[],
    plan: JSON.parse(planContent) as ExecutionPlan
  };
}

async function writeRegistryWithBackup(registry: ObjectRegistry, registryPath: string): Promise<string> {
  const backupPath = `${registryPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await fs.copyFile(registryPath, backupPath);
  await saveObjectRegistry(registry, registryPath);
  return backupPath;
}

export async function buildRegistryPromotionReport(
  options: RegistryPromotionOptions,
  registryPath = DEFAULT_REGISTRY_PATH
): Promise<RegistryPromotionReport> {
  const fromDir = path.resolve(options.fromDir);
  const registry = await loadObjectRegistry(registryPath);
  const { objects, plan } = await readPendingArtifacts(fromDir);
  const warnings = validatePromotablePlan(plan);
  const { deduped, duplicatesMerged, conflicts } = deduplicatePendingObjects(objects);
  const filteredPromotion = filterObjectsForPromotion(deduped, plan, options);
  const reconciled = reconcileWithStableRegistry(
    options.promoteObjects ? filteredPromotion.objectsToPromote : [],
    registry
  );

  return {
    mode: options.approve ? "approved" : "dry_run",
    fromDir,
    objectsToPromote: reconciled.objectsToPromote,
    objectsSkipped: filteredPromotion.objectsSkipped,
    duplicatesMerged: [...duplicatesMerged, ...reconciled.duplicatesMerged],
    conflicts: [...conflicts, ...reconciled.conflicts],
    planToPromote: options.promotePlan || options.promoteAutomation ? plan : undefined,
    automationToCreate: options.promoteAutomation
      ? {
          id: buildAutomationId({
            externalId: plan.scenario.externalId,
            caseId: plan.scenario.caseId,
            title: plan.scenario.title
          }),
          caseId: plan.scenario.caseId,
          title: plan.scenario.title
        }
      : undefined,
    warnings,
    registryPath,
    registryWritten: false
  };
}

export async function applyRegistryPromotion(
  report: RegistryPromotionReport,
  registryPath = DEFAULT_REGISTRY_PATH
): Promise<RegistryPromotionReport> {
  if (!report.objectsToPromote.length) {
    return report;
  }

  const registry = await loadObjectRegistry(registryPath);
  const existingByKey = new Map(registry.objects.map((object) => [normalizeText(object.key), object]));
  const nextObjects = [...registry.objects];

  for (const object of report.objectsToPromote) {
    const existing = existingByKey.get(normalizeText(object.key));
    if (existing) {
      const sameLocator = normalizeLocator(existing.locator) === normalizeLocator(object.locator);
      if (!sameLocator) {
        throw new Error(`Registry conflict while promoting key "${object.key}". Existing stable registry uses a different locator.`);
      }
      continue;
    }
    nextObjects.push(object);
  }

  const nextRegistry: ObjectRegistry = {
    ...registry,
    objects: nextObjects,
    updatedAt: new Date().toISOString()
  };

  const validation = validateObjectRegistry(nextRegistry);
  if (!validation.valid) {
    const errors = validation.issues.filter((issue) => issue.level === "error").map((issue) => issue.message).join("; ");
    throw new Error(`Promoted registry is invalid: ${errors}`);
  }

  const backupPath = await writeRegistryWithBackup(nextRegistry, registryPath);
  return {
    ...report,
    registryWritten: true,
    backupPath
  };
}
