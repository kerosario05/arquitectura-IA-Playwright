import fs from "node:fs/promises";
import path from "node:path";
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

export function findReusableAutomation(
  targetCaseId: number,
  targetTitle: string,
  automations: PromotedAutomationIndexEntry[]
): ReuseMatch | undefined {
  const targetCode = extractFunctionalCode(targetTitle);
  const targetNormalized = normalizeTitle(targetTitle);

  const sameCaseMatch = automations.find((entry) =>
    entry.caseId === targetCaseId && entry.status === "active"
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

  const match = findReusableAutomation(targetCaseId, targetTitle, index.automations);

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
