import type { RouteRecoveryPack, PlanningBudget, SemanticGoal, RouteRecoveryPackStats } from "../types/codex-auto-repair.types";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { PageSnapshot } from "../types/page-snapshot.types";
import type { AgentContextPack } from "./agent-context-pack";
import { DEFAULT_PLANNING_BUDGET } from "../types/codex-auto-repair.types";

// --- Scoring helpers (no external text/domain hardcoding) ---

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stemToken(token: string): string {
  // Remove trailing 's', 'es' for basic singular/plural normalization
  if (token.length <= 3) return token;
  if (token.endsWith("es") && token.length > 4) return token.slice(0, -2);
  if (token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function tokenize(text: string): string[] {
  const stop = new Set(["de", "la", "el", "los", "las", "y", "o", "en", "por", "para", "con", "sin", "al", "del", "the", "a", "an", "to", "for", "on", "in", "at", "by"]);
  return normalizeText(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !stop.has(t))
    .map(stemToken);
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

// --- Semantic goal derivation ---

export function deriveSemanticGoal(
  scenario?: { title?: string; steps?: Array<{ action: string; target?: string }> },
  pendingSteps?: Array<{ action: string; target?: string }>,
  finalAssertions?: Array<{ target?: string; expected?: string }>,
  failedTarget?: string
): SemanticGoal {
  const intentParts: string[] = [];
  let targetConcept: string | undefined;
  let sensitive = false;

  const allSteps = [
    ...(scenario?.steps?.map((s) => ({ action: s.action, target: s.target })) ?? []),
    ...(pendingSteps ?? [])
  ];

  for (const step of allSteps) {
    const action = step.action?.toLowerCase() ?? "";
    if (!intentParts.includes(action)) intentParts.push(action);
    if (!targetConcept && step.target) targetConcept = step.target;
    if (action.includes("login") || action.includes("authenticate") || action.includes("otp") || action.includes("pay") || action.includes("submit")) {
      sensitive = true;
    }
  }

  const assertionTargets = finalAssertions?.map((a) => a.target ?? a.expected ?? "").filter(Boolean) ?? [];

  return {
    intent: intentParts.slice(0, 4).join("_") || "unknown",
    targetConcept: failedTarget ?? targetConcept,
    expectedOutcome: assertionTargets.slice(0, 3).join("; ") || undefined,
    requiredCapabilities: [...new Set(intentParts.slice(0, 6))],
    sensitive
  };
}

// --- Semantic relation computation ---

type SemanticRelation = "exact_match" | "near_match" | "parent_category" | "broader_candidate" | "related_action" | "unrelated";

function computeSemanticRelation(candidateText: string, failedTarget?: string): { relation: SemanticRelation; score: number } {
  if (!failedTarget) return { relation: "unrelated", score: 0 };
  const ct = normalizeText(candidateText);
  if (!ct) return { relation: "unrelated", score: 0 };
  const ft = normalizeText(failedTarget);
  if (ct === ft) return { relation: "exact_match", score: 1.0 };
  if (ct.includes(ft) || ft.includes(ct)) return { relation: "near_match", score: 0.85 };
  const cTokens = tokenize(candidateText);
  const fTokens = tokenize(failedTarget);
  if (cTokens.length === 0 || fTokens.length === 0) return { relation: "unrelated", score: 0 };
  const overlap = cTokens.filter((t) => fTokens.includes(t)).length;
  if (overlap === 0) return { relation: "unrelated", score: 0 };
  // All tokens of the shorter set match → parent/child relation
  if (overlap >= Math.min(cTokens.length, fTokens.length)) return { relation: "parent_category", score: 0.8 };
  if (overlap >= Math.min(cTokens.length, fTokens.length) * 0.5) return { relation: "near_match", score: 0.7 };
  return { relation: "broader_candidate", score: 0.5 };
}

// --- Actionability classification ---

type Actionability = "clickable" | "fillable" | "selectable" | "readable" | "static";

function classifyActionability(candidate: { role?: string; type?: string; tagName?: string; disabled?: boolean }): Actionability {
  if (candidate.disabled) return "static";
  const role = (candidate.role ?? "").toLowerCase();
  const type = (candidate.type ?? "").toLowerCase();
  const tag = (candidate.tagName ?? "").toLowerCase();
  if (["button", "link", "menuitem", "tab", "checkbox", "radio"].includes(role) || type === "clickable" || ["a", "button"].includes(tag)) return "clickable";
  if (["textbox", "input", "combobox"].includes(role) || type === "input" || ["input", "textarea", "select"].includes(tag)) return "fillable";
  if (["listbox", "option", "select"].includes(role) || type === "select") return "selectable";
  if (["heading", "paragraph", "cell", "gridcell"].includes(role) || type === "text") return "readable";
  return "static";
}

function isActionable(actionability: Actionability): boolean {
  return actionability === "clickable" || actionability === "fillable" || actionability === "selectable";
}

// --- Candidate scoring ---

function scoreCandidate(
  candidate: {
    id: string; type: string; text?: string; label?: string; name?: string;
    ariaLabel?: string; role?: string; title?: string; nearbyText?: string;
    disabled?: boolean; tagName?: string; placeholder?: string;
  },
  failedTarget?: string,
  semanticGoal?: SemanticGoal,
  pendingStepTexts?: string[]
): { score: number; actionability: Actionability; semanticRelation: SemanticRelation } {
  const text = [candidate.text, candidate.label, candidate.name, candidate.ariaLabel, candidate.title, candidate.placeholder].filter(Boolean).join(" ");
  const actionability = classifyActionability(candidate);
  const { relation } = computeSemanticRelation(text, failedTarget);

  let score = 0;

  // Semantic overlap with failedTarget (primary signal)
  if (failedTarget) score += computeTokenOverlapScore(failedTarget, text) * 0.4;
  // Semantic overlap with targetConcept
  if (semanticGoal?.targetConcept) score += computeTokenOverlapScore(semanticGoal.targetConcept, text) * 0.2;
  // Semantic overlap with intent
  if (semanticGoal?.intent) score += computeTokenOverlapScore(semanticGoal.intent, text) * 0.1;

  // Semantic relation boost
  if (relation === "exact_match") score += 0.3;
  else if (relation === "parent_category") score += 0.25;
  else if (relation === "near_match") score += 0.2;
  else if (relation === "broader_candidate") score += 0.1;

  // Actionability bonus
  if (actionability === "clickable") score += 0.2;
  else if (actionability === "fillable") score += 0.15;
  else if (actionability === "selectable") score += 0.1;
  else score -= 0.15; // static/readable penalty

  // Nearby text / parent heading match with pending steps
  if (candidate.nearbyText && pendingStepTexts) {
    const nearbyNorm = normalizeText(candidate.nearbyText);
    const maxStepOverlap = Math.max(...pendingStepTexts.map((s) => computeTokenOverlapScore(s, nearbyNorm)));
    if (maxStepOverlap > 0.3) score += maxStepOverlap * 0.15;
  }

  return { score: Math.round(Math.max(score, -0.5) * 100) / 100, actionability, semanticRelation: relation };
}

function scoreObject(
  obj: { key?: string; name?: string; type?: string; confidence?: number },
  failedTarget?: string,
  semanticGoal?: SemanticGoal
): number {
  const text = [obj.key, obj.name].filter(Boolean).join(" ");
  let score = 0;
  if (failedTarget) score += computeTokenOverlapScore(failedTarget, text) * 0.5;
  if (semanticGoal?.targetConcept) score += computeTokenOverlapScore(semanticGoal.targetConcept, text) * 0.3;
  if (obj.confidence) score += obj.confidence * 0.1;
  return Math.round(score * 100) / 100;
}

function scoreRoute(
  route: string[],
  failedTarget?: string,
  semanticGoal?: SemanticGoal
): number {
  const text = route.join(" ");
  let score = 0;
  if (failedTarget) score += computeTokenOverlapScore(failedTarget, text) * 0.4;
  if (semanticGoal?.targetConcept) score += computeTokenOverlapScore(semanticGoal.targetConcept, text) * 0.3;
  if (semanticGoal?.intent) score += computeTokenOverlapScore(semanticGoal.intent, text) * 0.2;
  return Math.round(score * 100) / 100;
}

function scorePlan(
  plan: { id?: string; title?: string; route?: string[] },
  failedTarget?: string,
  semanticGoal?: SemanticGoal
): number {
  const text = [plan.title, ...(plan.route ?? [])].filter(Boolean).join(" ");
  let score = 0;
  if (failedTarget) score += computeTokenOverlapScore(failedTarget, text) * 0.4;
  if (semanticGoal?.targetConcept) score += computeTokenOverlapScore(semanticGoal.targetConcept, text) * 0.3;
  if (semanticGoal?.intent) score += computeTokenOverlapScore(semanticGoal.intent, text) * 0.2;
  return Math.round(score * 100) / 100;
}

// --- Dedup helpers ---

function dedupById<T extends { id?: string; key?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const id = item.id ?? item.key;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

// --- Build route recovery pack ---

export type BuildRouteRecoveryPackInput = {
  failedReason?: string;
  failedTarget?: string;
  failedAtStep?: number;
  currentPlan?: ExecutionPlan;
  snapshot?: PageSnapshot;
  contextPack?: AgentContextPack;
  scenario?: { title?: string; steps?: Array<{ action: string; target?: string }> };
  budget?: Partial<PlanningBudget>;
  failedRoutePaths?: string[];
};

export function buildRouteRecoveryPack(input: BuildRouteRecoveryPackInput): RouteRecoveryPack {
  const budget: PlanningBudget = { ...DEFAULT_PLANNING_BUDGET, ...(input.budget ?? {}) };
  const allSteps = input.currentPlan?.steps ?? [];
  const failedStepIndex = input.failedAtStep;

  // --- helper to extract target text ---
  function stepTarget(s: { target?: unknown }): string | undefined {
    if (typeof s.target === "object" && s.target !== null) {
      return (s.target as { name?: string; value?: string }).name ?? (s.target as { value?: string }).value ?? undefined;
    }
    return undefined;
  }

  // --- pending steps (failed step onward) ---
  const pendingSteps = allSteps
    .filter((s) => failedStepIndex === undefined || s.index >= failedStepIndex)
    .slice(0, 8)
    .map((s) => ({
      index: s.index,
      action: s.action,
      target: stepTarget(s),
      failureReason: s.index === failedStepIndex ? input.failedReason : undefined
    }));

  const isAssertAction = (a: string): boolean => a === "assertVisible" || a === "assertText" || a === "assertUrl";

  const semanticGoal = deriveSemanticGoal(
    input.scenario,
    allSteps.map((s) => ({ action: s.action, target: stepTarget(s) })),
    allSteps.filter((s) => isAssertAction(s.action)).map((s) => ({ target: stepTarget(s) })),
    input.failedTarget
  );

  // --- prior successful steps (before failed step) ---
  const priorSuccessfulSteps = allSteps
    .filter((s) => failedStepIndex === undefined || s.index < failedStepIndex)
    .slice(0, 10)
    .map((s) => ({
      index: s.index,
      action: s.action,
      target: stepTarget(s)
    }));

  // --- final assertions ---
  const finalAssertions = allSteps
    .filter((s) => isAssertAction(s.action))
    .slice(0, 8)
    .map((s) => ({
      target: stepTarget(s),
      expected: stepTarget(s)
    }));

  // --- action history ---
  const actionHistorySummary = allSteps
    .slice(0, 15)
    .map((s) => ({
      action: s.action,
      target: stepTarget(s),
      status: "unknown"
    }));

  // --- collect pending step texts for nearby-text matching ---
  const pendingStepTexts = pendingSteps.map((s) => s.target ?? s.action).filter(Boolean) as string[];

  // --- score and rank visible candidates (visible-first strategy) ---
  const rawCandidates = (input.snapshot?.elements ?? [])
    .filter((el) => el.visible)
    .map((el) => {
      const { score, actionability, semanticRelation } = scoreCandidate(el, input.failedTarget, semanticGoal, pendingStepTexts);
      return {
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
        nearbyText: el.nearbyText,
        disabled: el.disabled,
        candidateLocatorsCount: Array.isArray(el.candidateLocators) ? el.candidateLocators.length : 0,
        score,
        actionability,
        semanticRelation,
        source: "current_snapshot" as const
      };
    })
    .filter((c) => c.score > -0.1 || budget.maxCandidates > 0);

  rawCandidates.sort((a, b) => b.score - a.score);
  const topVisibleCandidates = dedupById(rawCandidates).slice(0, budget.maxCandidates).map((c) => ({
    id: c.id,
    type: c.type,
    text: c.text,
    role: c.role,
    score: c.score,
    actionability: c.actionability,
    semanticRelation: c.semanticRelation,
    source: c.source,
    nearbyText: c.nearbyText,
    disabled: c.disabled
  }));

  // --- score and rank known objects ---
  const rawObjects = (input.contextPack?.knownObjects ?? []).map((obj) => ({
    key: obj.key,
    name: obj.name,
    type: obj.type,
    score: scoreObject(obj, input.failedTarget, semanticGoal)
  }));
  rawObjects.sort((a, b) => b.score - a.score);
  const topKnownObjects = dedupById(rawObjects).slice(0, budget.maxKnownObjects).map((o) => ({
    key: o.key, name: o.name, type: o.type, score: o.score
  }));

  // --- score and rank known routes ---
  const rawRoutes = (input.contextPack?.knownRoutes ?? []).map((route) => ({
    route: route.route,
    sourcePlanId: route.sourcePlanId,
    score: scoreRoute(route.route, input.failedTarget, semanticGoal)
  }));
  rawRoutes.sort((a, b) => b.score - a.score);
  const topKnownRoutes = rawRoutes.slice(0, budget.maxKnownRoutes);

  // --- score and rank known plans ---
  const rawPlans = (input.contextPack?.knownPlans ?? []).map((plan) => ({
    id: plan.id,
    title: plan.title,
    score: scorePlan(plan, input.failedTarget, semanticGoal)
  }));
  rawPlans.sort((a, b) => b.score - a.score);
  const topKnownPlans = rawPlans.slice(0, budget.maxKnownPlans);

  // --- failed route paths ---
  const failedRoutePaths = input.failedRoutePaths ?? [];

  return {
    version: "1.0",
    createdAt: new Date().toISOString(),
    failedAction: {
      stepIndex: input.failedAtStep,
      actionType: input.currentPlan?.steps?.find((s) => s.index === input.failedAtStep)?.action,
      target: input.failedTarget,
      failureReason: input.failedReason
    },
    semanticGoal,
    currentScreen: {
      url: undefined,
      title: undefined,
      visibleElementCount: input.snapshot?.elements?.filter((e) => e.visible).length ?? 0
    },
    topVisibleCandidates,
    topKnownObjects,
    topKnownRoutes,
    topKnownPlans,
    priorSuccessfulSteps,
    pendingSteps,
    finalAssertions,
    actionHistorySummary,
    failedRoutePaths,
    budget: {
      preferredResponseSeconds: budget.preferredResponseSeconds,
      maxPromptBudgetSeconds: budget.maxPromptBudgetSeconds,
      maxCandidates: budget.maxCandidates,
      maxKnownObjects: budget.maxKnownObjects,
      maxKnownRoutes: budget.maxKnownRoutes,
      maxKnownPlans: budget.maxKnownPlans,
      maxProposedActions: budget.maxProposedActions,
      maxRationaleChars: budget.maxRationaleChars,
      maxUnresolvedQuestions: budget.maxUnresolvedQuestions
    },
    constraints: {
      codexMustOnlyWriteAgentResponseJson: true,
      doNotRunPlaywright: true,
      doNotModifyStableRegistry: true,
      doNotApproveObjectsAutomatically: true,
      doNotInventData: true,
      useOnlyIdsPresentInThisPack: true
    }
  };
}

export function computeRouteRecoveryPackStats(pack: RouteRecoveryPack): RouteRecoveryPackStats {
  return {
    visibleCandidates: pack.topVisibleCandidates.length,
    knownObjects: pack.topKnownObjects.length,
    knownRoutes: pack.topKnownRoutes.length,
    knownPlans: pack.topKnownPlans.length,
    pendingSteps: pack.pendingSteps.length,
    finalAssertions: pack.finalAssertions.length
  };
}
