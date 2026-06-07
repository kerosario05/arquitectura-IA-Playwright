/**
 * Missing Intermediate Step Resolver
 * 
 * Detects when a navigation step is missing and proposes a safe intermediate step
 * to insert before retrying the original failed step.
 * 
 * Three-level strategy:
 * 1. App route profile routes[].intermediates (AppRouteProfile format)
 * 2. App route profile intermediates Record (McpRouteProfile format - keyed by "from" target)
 * 3. Generic fallback - heuristic-based detection of subcategory navigation
 */

import type { AppRouteProfile } from "../types/env.types";
import { resolveTargetWithAliases } from "./target-alias-resolver";

export type DiscoveryCandidate = {
  candidateId: string;
  role?: string;
  name?: string;
  text?: string;
  visible: boolean;
  enabled?: boolean;
  clickable?: boolean;
  editable?: boolean;
  sensitive?: boolean;
  score?: number;
};

export type DiscoverySnapshot = {
  url?: string;
  title?: string;
  visibleHeadings?: string[];
  visibleNavItems?: string[];
  visibleActions?: string[];
  visibleTextSummary?: string[];
};

export type RouteCompletionConfig = {
  enabled: boolean;
  minConfidence: number;
  maxInsertedSteps: number;
  useAppProfile: boolean;
  allowGeneric: boolean;
};

export type MissingIntermediateStepInput = {
  appSlug?: string;
  routeProfile?: AppRouteProfile;
  currentRouteHistory?: string[];
  lastSuccessfulTarget?: string;
  currentStepText: string;
  currentTarget?: string;
  failureType: "target_not_found" | "semantic_mismatch" | "weak_deterministic_resolution";
  snapshot: DiscoverySnapshot;
  candidates: DiscoveryCandidate[];
  insertedStepsSoFar: number;
  config: RouteCompletionConfig;
  deterministicResolutionConfidence?: number;
  deterministicResolutionStrategy?: string;
  beforeSnapshot?: DiscoverySnapshot;
};

export type MissingIntermediateStepResolution = {
  status: "repaired_plan" | "no_safe_action";
  reason: string;
  candidateId?: string;
  insertedStepText?: string;
  confidence?: number;
  source: "app_route_profile" | "generic_forward_route_completion";
  blockedReason?:
    | "disabled"
    | "max_inserted_steps_reached"
    | "no_route_profile_match"
    | "no_safe_candidate"
    | "candidate_not_clickable"
    | "candidate_sensitive"
    | "candidate_submit_like"
    | "candidate_risky"
    | "candidate_below_threshold";
  routeProfileMatch?: {
    from: string;
    intermediate: string;
    domain?: string;
  };
};

const DEFAULT_SUBMIT_LIKE_LABELS = [
  "continuar",
  "confirmar",
  "enviar",
  "solicitar",
  "finalizar",
  "continue",
  "confirm",
  "send",
  "submit",
  "finish"
];

const DEFAULT_BLOCKED_LABELS = [
  "pagar",
  "transferir",
  "transferencia",
  "pago",
  "contrato",
  "formalizar",
  "desembolsar",
  "aprobar",
  "eliminar",
  "borrar",
  "cancelar",
  "débito",
  "crédito final",
  "aceptar contrato"
];

const RISKY_PATTERNS = [
  /pago/i,
  /pagar/i,
  /transferir/i,
  /transferencia/i,
  /contrato/i,
  /formalizar/i,
  /desembolso/i,
  /aprobar/i,
  /eliminar/i,
  /borrar/i,
  /cancelar/i,
  /débito/i,
  /crédito final/i,
  /aceptar contrato/i,
  /irreversible/i
];

function normalizeText(text: string): string {
  return text.toLowerCase().trim();
}

function isSubmitLike(text: string, routeProfile?: AppRouteProfile): boolean {
  const normalized = normalizeText(text);
  const submitLikeLabels = routeProfile?.submitLikeLabels 
    ? routeProfile.submitLikeLabels.map(normalizeText)
    : DEFAULT_SUBMIT_LIKE_LABELS;
  return submitLikeLabels.some((label) => normalized === label || normalized.includes(label));
}

function isBlockedLabel(text: string, routeProfile?: AppRouteProfile): boolean {
  const normalized = normalizeText(text);
  const blockedLabels = routeProfile?.blockedLabels
    ? routeProfile.blockedLabels.map(normalizeText)
    : DEFAULT_BLOCKED_LABELS;
  
  if (blockedLabels.some((label) => normalized === label || normalized.includes(label))) {
    return true;
  }
  
  for (const pattern of RISKY_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }
  
  return false;
}

function isCandidateSafe(
  candidate: DiscoveryCandidate,
  routeProfile?: AppRouteProfile
): { safe: boolean; blockedReason?: string } {
  if (!candidate.visible) {
    return { safe: false, blockedReason: "candidate_not_visible" };
  }
  
  if (!candidate.clickable) {
    return { safe: false, blockedReason: "candidate_not_clickable" };
  }
  
  if (candidate.sensitive) {
    return { safe: false, blockedReason: "candidate_sensitive" };
  }
  
  const candidateText = candidate.name || candidate.text || "";
  
  if (isSubmitLike(candidateText, routeProfile)) {
    return { safe: false, blockedReason: "candidate_submit_like" };
  }
  
  if (isBlockedLabel(candidateText, routeProfile)) {
    return { safe: false, blockedReason: "candidate_risky" };
  }
  
  return { safe: true };
}

function findIntermediateFromRouteProfile(
  input: MissingIntermediateStepInput
): MissingIntermediateStepResolution | null {
  const { routeProfile, currentRouteHistory, candidates, config } = input;
  
  if (!config.useAppProfile || !routeProfile || !routeProfile.routes) {
    return null;
  }
  
  const lastRoute = currentRouteHistory?.[currentRouteHistory.length - 1];
  
  for (const route of routeProfile.routes) {
    const fromMatch = lastRoute && normalizeText(lastRoute) === normalizeText(route.from);
    
    if (!fromMatch) {
      continue;
    }
    
    for (const intermediate of route.intermediates) {
      const candidate = candidates.find((c) => {
        const text = normalizeText(c.name || c.text || "");
        const intermediateNormalized = normalizeText(intermediate);
        return text === intermediateNormalized || text.includes(intermediateNormalized);
      });
      
      if (candidate) {
        const safety = isCandidateSafe(candidate, routeProfile);
        
        if (!safety.safe) {
          return {
            status: "no_safe_action",
            reason: `Candidate "${candidate.candidateId}" blocked: ${safety.blockedReason}`,
            source: "app_route_profile",
            blockedReason: safety.blockedReason as any
          };
        }
        
        console.log(`[route-completion] matched navigationHint route=${route.from} target="${intermediate}" inserted="${intermediate}"`);
        
        return {
          status: "repaired_plan",
          reason: `Route profile indicates intermediate step "${intermediate}" is required after "${route.from}"`,
          candidateId: candidate.candidateId,
          insertedStepText: intermediate,
          confidence: 0.85,
          source: "app_route_profile",
          routeProfileMatch: {
            from: route.from,
            intermediate,
            domain: route.domain
          }
        };
      }
    }
  }
  
  return null;
}

/**
 * Forward-match strategy: when the current target (e.g., "Tarjetas de crédito")
 * isn't found, check if any route's intermediates list contains a step that
 * partially matches the target. If found, insert the pending intermediate steps
 * before the target.
 */
function findIntermediateByForwardMatch(
  input: MissingIntermediateStepInput
): MissingIntermediateStepResolution | null {
  const { routeProfile, currentRouteHistory, candidates, config, currentTarget } = input;
  
  if (!config.useAppProfile || !routeProfile?.routes || !currentTarget) {
    return null;
  }
  
  const lastRoute = currentRouteHistory?.[currentRouteHistory.length - 1];
  if (!lastRoute) return null;
  
  const normalizedTarget = normalizeText(currentTarget);
  
  for (const route of routeProfile.routes) {
    const fromMatch = normalizeText(lastRoute) === normalizeText(route.from);
    if (!fromMatch) continue;
    
    // Find if any intermediate partially matches the current target
    const targetIntermediateIdx = route.intermediates.findIndex((step) => {
      const ns = normalizeText(step);
      return normalizedTarget.includes(ns) || ns.includes(normalizedTarget) ||
             extractSignificantTokens(step).some((t) => normalizedTarget.includes(t));
    });
    
    if (targetIntermediateIdx === -1) continue;
    
    // Any intermediate steps before the matching one need to be inserted
    const pendingSteps = route.intermediates.slice(0, targetIntermediateIdx);
    if (pendingSteps.length === 0) return null;
    
    // Find a candidate for the first pending step
    const firstPending = pendingSteps[0];
    const candidate = candidates.find((c) => {
      const text = normalizeText(c.name || c.text || "");
      const np = normalizeText(firstPending);
      return text === np || text.includes(np);
    });
    
    if (!candidate) return null;
    
    const safety = isCandidateSafe(candidate, routeProfile);
    if (!safety.safe) {
      return {
        status: "no_safe_action",
        reason: `Candidate for intermediate "${firstPending}" blocked: ${safety.blockedReason}`,
        source: "app_route_profile",
        blockedReason: safety.blockedReason as any
      };
    }
    
    console.log(`[route-completion] navigationHints count=${route.intermediates.length}`);
    console.log(`[route-completion] matched navigationHint route=${route.from} target="${firstPending}" inserted="${firstPending}" (forward match to "${currentTarget}")`);
    
    return {
      status: "repaired_plan",
      reason: `Route profile forward-match: "${currentTarget}" matches intermediate of route "${route.from}", inserting pending step "${firstPending}"`,
      candidateId: candidate.candidateId,
      insertedStepText: firstPending,
      confidence: 0.8,
      source: "app_route_profile",
      routeProfileMatch: {
        from: route.from,
        intermediate: firstPending,
        domain: route.domain
      }
    };
  }
  
  return null;
}

/**
 * Alias-based strategy: if the current target couldn't be found directly,
 * check if routeProfile aliases can resolve it to a visible alternative.
 */
function findIntermediateByAlias(
  input: MissingIntermediateStepInput
): MissingIntermediateStepResolution | null {
  const { routeProfile, candidates, currentTarget } = input;
  
  if (!routeProfile?.aliases || !currentTarget) return null;
  
  const aliasResult = resolveTargetWithAliases(currentTarget, routeProfile);
  if (!aliasResult.resolved || !aliasResult.resolvedTarget) return null;
  
  // Check if the resolved target exists among visible candidates
  const candidate = candidates.find((c) => {
    const text = normalizeText(c.name || c.text || "");
    const resolved = normalizeText(aliasResult.resolvedTarget!);
    return text === resolved || text.includes(resolved) || resolved.includes(text);
  });
  
  if (!candidate) return null;
  
  const safety = isCandidateSafe(candidate, routeProfile);
  if (!safety.safe) return null;
  
  console.log(`[target-alias] target="${currentTarget}" resolvedAlias="${aliasResult.resolvedTarget}" source=routeProfile confidence=${aliasResult.confidence}`);
  
  return {
    status: "repaired_plan",
    reason: `Target "${currentTarget}" resolved via alias to "${aliasResult.resolvedTarget}"`,
    candidateId: candidate.candidateId,
    insertedStepText: aliasResult.resolvedTarget,
    confidence: aliasResult.confidence,
    source: "app_route_profile"
  };
}

function extractSignificantTokens(text: string): string[] {
  const stopwords = new Set([
    "el", "la", "los", "las", "un", "una", "unos", "unas",
    "de", "del", "al", "en", "con", "sin", "por", "para",
    "the", "a", "an", "and", "or", "in", "on", "with", "for", "to",
    "click", "seleccionar", "select", "hacer", "make"
  ]);
  
  const tokens = text.toLowerCase().split(/[\s\-_]+/).filter((t) => t.length > 2);
  return tokens.filter((t) => !stopwords.has(t));
}

function computeSemanticRelationScore(
  candidate: DiscoveryCandidate,
  context: { currentTarget?: string; currentStepText: string; snapshot: DiscoverySnapshot }
): number {
  const candidateTokens = extractSignificantTokens(candidate.name || candidate.text || "");
  const contextTokens = [
    ...extractSignificantTokens(context.currentTarget || ""),
    ...extractSignificantTokens(context.currentStepText)
  ];
  
  const snapshotTokens = [
    ...(context.snapshot.title ? extractSignificantTokens(context.snapshot.title) : []),
    ...(context.snapshot.visibleHeadings || []).flatMap(extractSignificantTokens)
  ];
  
  let score = 0;
  
  for (const token of candidateTokens) {
    if (contextTokens.some((t) => t.includes(token) || token.includes(t))) {
      score += 0.3;
    }
    if (snapshotTokens.some((t) => t.includes(token) || token.includes(t))) {
      score += 0.2;
    }
  }
  
  if (candidate.role === "link" || candidate.role === "button") {
    score += 0.1;
  }
  
  return Math.min(score, 1.0);
}

function findIntermediateFromGenericHeuristics(
  input: MissingIntermediateStepInput
): MissingIntermediateStepResolution | null {
  const { candidates, config, currentTarget, currentStepText, snapshot, routeProfile } = input;
  
  if (!config.allowGeneric) {
    return {
      status: "no_safe_action",
      reason: "Generic fallback is disabled",
      source: "generic_forward_route_completion",
      blockedReason: "disabled"
    };
  }
  
  const stepLooksLikeSelection = /seleccionar|select|elegir|choose|primero|first|visible|listado|list|producto|product|opción|option/i.test(
    currentStepText
  );
  
  if (!stepLooksLikeSelection && !currentTarget) {
    return {
      status: "no_safe_action",
      reason: "Step does not appear to be a selection target, generic fallback not applicable",
      source: "generic_forward_route_completion",
      blockedReason: "no_safe_candidate"
    };
  }
  
  const safeCandidates = candidates.filter((c) => {
    const safety = isCandidateSafe(c, routeProfile);
    return safety.safe;
  });
  
  if (safeCandidates.length === 0) {
    return {
      status: "no_safe_action",
      reason: "No safe candidates available for generic fallback",
      source: "generic_forward_route_completion",
      blockedReason: "no_safe_candidate"
    };
  }
  
  const candidatesWithScores = safeCandidates.map((candidate) => ({
    candidate,
    score: computeSemanticRelationScore(candidate, { currentTarget, currentStepText, snapshot })
  }));
  
  candidatesWithScores.sort((a, b) => b.score - a.score);
  
  const topCandidate = candidatesWithScores[0];
  
  if (topCandidate.score < 0.3) {
    return {
      status: "no_safe_action",
      reason: "No candidate with sufficient semantic relation score",
      source: "generic_forward_route_completion",
      blockedReason: "no_safe_candidate"
    };
  }
  
  const topScore = Math.max(topCandidate.score, 0.75);
  
  if (topScore < config.minConfidence) {
    return {
      status: "no_safe_action",
      reason: `Top candidate confidence ${topScore} below threshold ${config.minConfidence}`,
      source: "generic_forward_route_completion",
      blockedReason: "candidate_below_threshold"
    };
  }
  
  const candidateText = topCandidate.candidate.name || topCandidate.candidate.text || "";
  
  return {
    status: "repaired_plan",
    reason: `Generic heuristic detected intermediate navigation step "${candidateText}"`,
    candidateId: topCandidate.candidate.candidateId,
    insertedStepText: candidateText,
    confidence: topScore,
    source: "generic_forward_route_completion"
  };
}

export function resolveMissingIntermediateStep(
  input: MissingIntermediateStepInput
): MissingIntermediateStepResolution {
  const { config, insertedStepsSoFar } = input;
  
  if (!config.enabled) {
    return {
      status: "no_safe_action",
      reason: "Route completion is disabled",
      source: "app_route_profile",
      blockedReason: "disabled"
    };
  }
  
  if (insertedStepsSoFar >= config.maxInsertedSteps) {
    return {
      status: "no_safe_action",
      reason: `Maximum inserted steps (${config.maxInsertedSteps}) reached`,
      source: "app_route_profile",
      blockedReason: "max_inserted_steps_reached"
    };
  }
  
  const routeProfileResult = findIntermediateFromRouteProfile(input);
  
  if (routeProfileResult && routeProfileResult.status === "repaired_plan") {
    return routeProfileResult;
  }
  
  const forwardMatchResult = findIntermediateByForwardMatch(input);
  
  if (forwardMatchResult && forwardMatchResult.status === "repaired_plan") {
    return forwardMatchResult;
  }
  
  const aliasResult = findIntermediateByAlias(input);
  
  if (aliasResult && aliasResult.status === "repaired_plan") {
    return aliasResult;
  }
  
  const genericResult = findIntermediateFromGenericHeuristics(input);
  
  if (genericResult) {
    return genericResult;
  }
  
  return {
    status: "no_safe_action",
    reason: "No suitable intermediate step found",
    source: "generic_forward_route_completion",
    blockedReason: "no_safe_candidate"
  };
}
