import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ExecutionPlan, ExecutionPlanScenarioRef } from "../types/execution-plan.types";
import type { PromotedAutomationIndexEntry } from "../types/automation-promotion.types";
import { loadAutomationIndex } from "./automation-index";
import { validateExecutionPlan } from "../plans/execution-plan-validator";

const FUNCTIONAL_CODE_RE = /\bC(\d{4,6})\b/;

export function extractFunctionalCode(title: string): string | undefined {
  const match = title.match(FUNCTIONAL_CODE_RE);
  return match ? `C${match[1]}` : undefined;
}

export function normalizeTitle(title: string): string {
  return title
    .replace(/\bC\d{4,6}\b\s*[-–—]?\s*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export type ReuseMatch = {
  entry: PromotedAutomationIndexEntry;
  matchType: "same_case" | "functional_code" | "normalized_title";
  confidence: number;
};

export type PromotedArtifactPhysicalContext = {
  specPath: string;
  specExists: boolean;
  specText?: string;
  appSlug: string;
  sectionSlug: string;
  caseId: number;
};

export type PromotedArtifactReuseValidation = {
  valid: boolean;
  reason?: "not_active" | "verification_not_passed" | "promotion_not_persisted" | "promoted_spec_missing" | "promoted_spec_hash_missing" | "promoted_spec_hash_mismatch" | "identity_mismatch";
};

export function validatePromotedArtifactForReuse(
  entry: PromotedAutomationIndexEntry,
  physical: PromotedArtifactPhysicalContext
): PromotedArtifactReuseValidation {
  if (entry.status !== "active") return { valid: false, reason: "not_active" };
  if (entry.specVerificationStatus !== "passed") return { valid: false, reason: "verification_not_passed" };

  const rawEntry = entry as PromotedAutomationIndexEntry & {
    promotionPersisted?: boolean;
    promotedSpecPath?: string;
    promotedSpecHash?: string;
  };
  const promotion = (rawEntry as any).promotion ?? rawEntry;
  if (promotion.promotionPersisted !== true) return { valid: false, reason: "promotion_not_persisted" };
  if (!physical.specExists) return { valid: false, reason: "promoted_spec_missing" };
  if (typeof promotion.promotedSpecHash !== "string" || !promotion.promotedSpecHash) {
    return { valid: false, reason: "promoted_spec_hash_missing" };
  }
  if (typeof promotion.promotedSpecPath !== "string" || !promotion.promotedSpecPath) {
    return { valid: false, reason: "promoted_spec_missing" };
  }

  const entrySpecPath = path.resolve(entry.specPath);
  const physicalSpecPath = path.resolve(physical.specPath);
  if (entry.appSlug !== physical.appSlug
    || entry.caseId !== physical.caseId
    || entrySpecPath !== physicalSpecPath
    || path.resolve(promotion.promotedSpecPath) !== physicalSpecPath
    || !physical.sectionSlug
    || !path.normalize(physicalSpecPath).toLowerCase().includes(`${path.sep}sections${path.sep}${physical.sectionSlug.toLowerCase()}${path.sep}`)
    || !path.basename(path.dirname(physicalSpecPath)).toLowerCase().startsWith("c")) {
    return { valid: false, reason: "identity_mismatch" };
  }

  const physicalHash = createHash("sha256").update(physical.specText ?? "", "utf8").digest("hex");
  if (physicalHash !== promotion.promotedSpecHash) return { valid: false, reason: "promoted_spec_hash_mismatch" };
  return { valid: true };
}

export function findReusableAutomation(
  targetCaseId: number,
  targetTitle: string,
  automations: PromotedAutomationIndexEntry[],
  physicalContexts?: ReadonlyMap<string, PromotedArtifactPhysicalContext>
): ReuseMatch | undefined {
  const targetCode = extractFunctionalCode(targetTitle);
  const targetNormalized = normalizeTitle(targetTitle);

  const sameCaseMatch = automations.find((entry) =>
    entry.caseId === targetCaseId && entry.status === "active"
      && (!physicalContexts || (() => {
        const physical = physicalContexts.get(entry.id);
        return physical !== undefined && validatePromotedArtifactForReuse(entry, physical).valid;
      })())
  );

  if (sameCaseMatch) {
    return {
      entry: sameCaseMatch,
      matchType: "same_case",
      confidence: 1
    };
  }

  let bestMatch: ReuseMatch | undefined;

  for (const entry of automations) {
    if (entry.caseId === targetCaseId) {
      continue;
    }

    if (entry.status !== "active") {
      continue;
    }
    if (physicalContexts) {
      const physical = physicalContexts.get(entry.id);
      if (!physical || !validatePromotedArtifactForReuse(entry, physical).valid) continue;
    }

    const entryCode = extractFunctionalCode(entry.title);
    const entryNormalized = normalizeTitle(entry.title);

    if (targetCode && entryCode && targetCode === entryCode) {
      const match: ReuseMatch = { entry, matchType: "functional_code", confidence: 0.95 };
      if (!bestMatch || match.confidence > bestMatch.confidence) {
        bestMatch = match;
      }
      continue;
    }

    if (targetNormalized && entryNormalized && targetNormalized === entryNormalized && targetNormalized.length > 5) {
      const match: ReuseMatch = { entry, matchType: "normalized_title", confidence: 0.8 };
      if (!bestMatch || match.confidence > bestMatch.confidence) {
        bestMatch = match;
      }
    }
  }

  return bestMatch;
}

export async function loadAutomationPlan(planPath: string): Promise<ExecutionPlan> {
  const content = await fs.readFile(planPath, "utf-8");
  return JSON.parse(content) as ExecutionPlan;
}

export function cloneExecutionPlan(
  plan: ExecutionPlan,
  newCaseId: number,
  newTitle: string,
  sourceAutomationId: string
): ExecutionPlan {
  const clonedScenario: ExecutionPlanScenarioRef = {
    ...plan.scenario,
    caseId: newCaseId,
    title: newTitle
  };

  return {
    ...plan,
    scenario: clonedScenario,
    notes: [
      ...(plan.notes ?? []),
      `Reused from automation: ${sourceAutomationId}`
    ]
  };
}

export async function findAndCloneReusablePlan(
  targetCaseId: number,
  targetTitle: string,
  indexPath?: string
): Promise<{ plan: ExecutionPlan; match: ReuseMatch } | undefined> {
  const index = await loadAutomationIndex(indexPath);

  if (index.automations.length === 0) {
    return undefined;
  }

  const physicalContexts = new Map<string, PromotedArtifactPhysicalContext>();
  await Promise.all(index.automations.filter((entry) => entry.status === "active").map(async (entry) => {
    const specPath = path.resolve(entry.specPath);
    try {
      physicalContexts.set(entry.id, {
        specPath,
        specExists: true,
        specText: await fs.readFile(specPath, "utf8"),
        appSlug: entry.appSlug ?? "",
        sectionSlug: specPath.match(/[\\/]sections[\\/]([^\\/]+)[\\/]cases[\\/]/i)?.[1] ?? "",
        caseId: entry.caseId ?? 0,
      });
    } catch {
      physicalContexts.set(entry.id, { specPath, specExists: false, appSlug: entry.appSlug ?? "", sectionSlug: "", caseId: entry.caseId ?? 0 });
    }
  }));
  const match = findReusableAutomation(targetCaseId, targetTitle, index.automations, physicalContexts);

  if (!match) {
    return undefined;
  }

  const plan = await loadAutomationPlan(match.entry.planPath);

  const validation = validateExecutionPlan(plan);
  if (!validation.valid) {
    return undefined;
  }

  const clonedPlan = cloneExecutionPlan(plan, targetCaseId, targetTitle, match.entry.id);

  return { plan: clonedPlan, match };
}
