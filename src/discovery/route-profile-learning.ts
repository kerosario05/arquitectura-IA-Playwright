/**
 * Route Profile Learning
 * 
 * Observes real UI routes during discovery, proposes updates to routeProfile,
 * and reuses them for Route Completion, skill generation, and future discoveries.
 * 
 * Generic multi-project capability - no hardcoded routes, products, or labels.
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { AppRouteProfile } from "../types/env.types";

export type RouteProfileLearningConfig = {
  enabled: boolean;
  autoApproveThreshold: number;
  autoApply: boolean;
  minOccurrences: number;
  blockSensitive: boolean;
};

export type RouteProfileSuggestion = {
  appSlug: string;
  from: string;
  to: string;
  relation: "child_route" | "sibling_route" | "intermediate_step" | "entry_point" | "alias_candidate" | "domain_term_candidate";
  source: "discovery_snapshot" | "successful_transition" | "route_completion" | "assertion_context" | "successful_resolution";
  confidence: number;
  evidence?: {
    beforeUrl?: string;
    afterUrl?: string;
    beforeSnapshotPath?: string;
    afterSnapshotPath?: string;
    candidateId?: string;
    candidateText?: string;
    locatorSummary?: string;
  };
  safety?: {
    clickable?: boolean;
    visible?: boolean;
    sensitive?: boolean;
    submitLike?: boolean;
    riskyAction?: boolean;
  };
  status: "pending" | "auto_approved" | "rejected";
  createdAt?: string;
};

export type RouteObservation = {
  from: string;
  to: string;
  beforeUrl: string;
  afterUrl: string;
  beforeSnapshotPath?: string;
  afterSnapshotPath?: string;
  candidateId?: string;
  candidateText?: string;
  locatorSummary?: string;
  clickable?: boolean;
  visible?: boolean;
  sensitive?: boolean;
  submitLike?: boolean;
  riskyAction?: boolean;
  transitionDetected?: boolean;
};

export type LearningResult = {
  suggestion?: RouteProfileSuggestion;
  status: "learned" | "skipped" | "blocked";
  reason?: string;
};

const DEFAULT_SUBMIT_LIKE_PATTERNS = [
  /continuar/i,
  /confirmar/i,
  /enviar/i,
  /solicitar/i,
  /finalizar/i,
  /continue/i,
  /confirm/i,
  /send/i,
  /submit/i,
  /finish/i,
  /volver/i,
  /salir/i,
  /cancel/i,
  /back/i,
  /exit/i
];

const RISKY_ACTION_PATTERNS = [
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
  /cancelar producto/i,
  /débito/i,
  /crédito final/i,
  /aceptar contrato/i,
  /irreversible/i,
  /payment/i,
  /transfer/i
];

function normalizeText(text: string): string {
  return text.toLowerCase().trim();
}

function isSubmitLike(text: string): boolean {
  const normalized = normalizeText(text);
  return DEFAULT_SUBMIT_LIKE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isRiskyAction(text: string): boolean {
  const normalized = normalizeText(text);
  return RISKY_ACTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isNavigationCandidate(text: string): boolean {
  const normalized = normalizeText(text);
  
  // Navigation candidates are typically nouns (categories, products, sections)
  // not verbs (actions, submissions)
  if (isSubmitLike(normalized)) return false;
  if (isRiskyAction(normalized)) return false;
  
  // Common navigation patterns
  const navPatterns = [
    /tarjetas/i,
    /cuentas/i,
    /préstamos/i,
    /productos/i,
    /servicios/i,
    /reportes/i,
    /configuración/i,
    /perfil/i,
    /beneficiarios/i,
    /pagos/i,
    /transferencias/i,
    /inversiones/i,
    /seguros/i,
    /créditos/i,
    /cards/i,
    /accounts/i,
    /loans/i,
    /products/i,
    /services/i
  ];
  
  return navPatterns.some((pattern) => pattern.test(normalized));
}

function computeConfidence(observation: RouteObservation): number {
  let confidence = 0.5;
  
  if (observation.visible) confidence += 0.1;
  if (observation.clickable) confidence += 0.1;
  if (observation.transitionDetected) confidence += 0.2;
  if (observation.candidateText && isNavigationCandidate(observation.candidateText)) confidence += 0.1;
  
  // Reduce confidence for risky indicators
  if (observation.sensitive) confidence -= 0.3;
  if (observation.submitLike) confidence -= 0.3;
  if (observation.riskyAction) confidence -= 0.3;
  
  return Math.max(0, Math.min(1, confidence));
}

export function observeRouteTransition(
  observation: RouteObservation,
  appSlug: string,
  config: RouteProfileLearningConfig
): LearningResult {
  if (!config.enabled) {
    return { status: "skipped", reason: "Route profile learning is disabled" };
  }
  
  // Block self-edges (from === to)
  if (observation.from.toLowerCase() === observation.to.toLowerCase()) {
    return { status: "blocked", reason: "Self-edge blocked" };
  }
  
  // Safety checks
  if (config.blockSensitive) {
    if (observation.sensitive) {
      return { status: "blocked", reason: "Sensitive candidate blocked" };
    }
  }
  
  if (observation.submitLike) {
    return { status: "blocked", reason: "Submit-like candidate blocked" };
  }
  
  if (observation.riskyAction) {
    return { status: "blocked", reason: "Risky action blocked" };
  }
  
  if (!observation.clickable || !observation.visible) {
    return { status: "blocked", reason: "Candidate not visible/clickable" };
  }
  
  const confidence = computeConfidence(observation);
  
  const relation: RouteProfileSuggestion["relation"] = "child_route";
  
  const suggestion: RouteProfileSuggestion = {
    appSlug,
    from: observation.from,
    to: observation.to,
    relation,
    source: "successful_transition",
    confidence,
    evidence: {
      beforeUrl: observation.beforeUrl,
      afterUrl: observation.afterUrl,
      beforeSnapshotPath: observation.beforeSnapshotPath,
      afterSnapshotPath: observation.afterSnapshotPath,
      candidateId: observation.candidateId,
      candidateText: observation.candidateText,
      locatorSummary: observation.locatorSummary
    },
    safety: {
      clickable: observation.clickable,
      visible: observation.visible,
      sensitive: observation.sensitive ?? false,
      submitLike: observation.submitLike ?? false,
      riskyAction: observation.riskyAction ?? false
    },
    status: confidence >= config.autoApproveThreshold ? "auto_approved" : "pending",
    createdAt: new Date().toISOString()
  };
  
  return { suggestion, status: "learned" };
}

export function observeRouteCompletionSuccess(
  insertedStep: {
    target?: string;
    candidateId?: string;
    source?: string;
  },
  lastSuccessfulTarget: string,
  appSlug: string,
  config: RouteProfileLearningConfig
): LearningResult {
  if (!config.enabled) {
    return { status: "skipped", reason: "Route profile learning is disabled" };
  }
  
  if (!insertedStep.target) {
    return { status: "skipped", reason: "No inserted step target" };
  }
  
  const suggestion: RouteProfileSuggestion = {
    appSlug,
    from: lastSuccessfulTarget,
    to: insertedStep.target,
    relation: "intermediate_step",
    source: "route_completion",
    confidence: 0.85,
    safety: {
      clickable: true,
      visible: true,
      sensitive: false,
      submitLike: false,
      riskyAction: false
    },
    status: "auto_approved",
    createdAt: new Date().toISOString()
  };
  
  return { suggestion, status: "learned" };
}

export function observeAliasCandidate(
  requirementLabel: string,
  visibleLabel: string,
  confidence: number,
  appSlug: string,
  config: RouteProfileLearningConfig
): LearningResult {
  if (!config.enabled) {
    return { status: "skipped", reason: "Route profile learning is disabled" };
  }
  
  const normalizedReq = normalizeText(requirementLabel);
  const normalizedVisible = normalizeText(visibleLabel);
  
  if (normalizedReq === normalizedVisible) {
    return { status: "skipped", reason: "Labels match exactly, no alias needed" };
  }
  
  const suggestion: RouteProfileSuggestion = {
    appSlug,
    from: requirementLabel,
    to: visibleLabel,
    relation: "alias_candidate",
    source: "successful_resolution",
    confidence,
    status: confidence >= config.autoApproveThreshold ? "auto_approved" : "pending",
    createdAt: new Date().toISOString()
  };
  
  return { suggestion, status: "learned" };
}

export async function saveRouteProfileSuggestions(
  suggestions: RouteProfileSuggestion[],
  evidenceDir: string,
  appSlug: string,
  caseId?: number
): Promise<string> {
  // Filter out self-edges (from === to)
  const validSuggestions = suggestions.filter((s) => {
    if (s.from.toLowerCase() === s.to.toLowerCase()) {
      console.log(`[route-learning] skipped self_edge from="${s.from}" to="${s.to}"`);
      return false;
    }
    return true;
  });
  
  if (validSuggestions.length === 0) {
    console.log(`[route-learning] wrote 0 suggestions reason="no valid suggestions after filtering"`);
    return "";
  }
  
  // Build clean artifacts path outside evidence directory
  // evidenceDir is typically: .artifacts/discovery/case-<caseId>/<timestamp>/evidence
  // We want to write to: .artifacts/discovery/case-<caseId>/<timestamp>/route-profile-suggestions.json
  const evidenceParent = path.dirname(evidenceDir); // .artifacts/discovery/case-<caseId>/<timestamp>
  
  // Check if we're in the standard discovery output structure
  // Structure: .artifacts/discovery/case-<caseId>/<timestamp>/evidence
  const timestampDir = path.basename(evidenceParent); // <timestamp>
  const caseDir = path.basename(path.dirname(evidenceParent)); // case-<caseId>
  const discoveryDir = path.basename(path.dirname(path.dirname(evidenceParent))); // discovery
  const artifactsDirParent = path.basename(path.dirname(path.dirname(path.dirname(evidenceParent)))); // .artifacts
  
  let artifactsDir: string;
  if (artifactsDirParent === ".artifacts" && discoveryDir === "discovery" && caseDir.startsWith("case-")) {
    // Standard structure: write to the timestamp directory (sibling of evidence)
    artifactsDir = evidenceParent;
  } else {
    // Fallback for other structures
    const caseIdStr = caseId ? `case-${caseId}` : caseDir;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
    artifactsDir = path.join(path.dirname(path.dirname(evidenceParent)), ".artifacts", "discovery", caseIdStr, timestamp);
  }
  
  await fsp.mkdir(artifactsDir, { recursive: true });
  
  const suggestionsPath = path.join(artifactsDir, "route-profile-suggestions.json");
  
  await fsp.writeFile(suggestionsPath, JSON.stringify(validSuggestions, null, 2), "utf-8");
  
  console.log(`[route-learning] wrote ${validSuggestions.length} suggestions to ${suggestionsPath}`);
  
  return suggestionsPath;
}

export async function consolidatePendingSuggestions(
  appSlug: string,
  suggestionsPath: string
): Promise<{
  approved: RouteProfileSuggestion[];
  pending: RouteProfileSuggestion[];
  rejected: RouteProfileSuggestion[];
}> {
  let suggestions: RouteProfileSuggestion[] = [];
  try {
    const raw = await fsp.readFile(suggestionsPath, "utf-8");
    suggestions = JSON.parse(raw) as RouteProfileSuggestion[];
  } catch {
    return { approved: [], pending: [], rejected: [] };
  }
  
  const filtered = suggestions.filter((s) => s.appSlug === appSlug);
  
  return {
    approved: filtered.filter((s) => s.status === "auto_approved"),
    pending: filtered.filter((s) => s.status === "pending"),
    rejected: filtered.filter((s) => s.status === "rejected")
  };
}

export async function applyRouteProfileSuggestions(
  appSlug: string,
  suggestions: RouteProfileSuggestion[],
  automationsRoot: string
): Promise<{
  applied: boolean;
  backupPath?: string;
  changes?: string[];
  error?: string;
}> {
  const appConfigPath = path.join(automationsRoot, "apps", appSlug, "app.config.json");
  
  let appConfig: Record<string, unknown>;
  try {
    const raw = await fsp.readFile(appConfigPath, "utf-8");
    appConfig = JSON.parse(raw);
  } catch (err) {
    return { applied: false, error: `Failed to read app.config.json: ${err}` };
  }
  
  // Create backup
  const backupPath = `${appConfigPath}.backup.${Date.now()}`;
  try {
    await fsp.writeFile(backupPath, JSON.stringify(appConfig, null, 2), "utf-8");
  } catch (err) {
    return { applied: false, error: `Failed to create backup: ${err}` };
  }
  
  const changes: string[] = [];
  
  // Get or create routeProfile
  let routeProfile = appConfig.routeProfile as AppRouteProfile | undefined;
  if (!routeProfile) {
    routeProfile = {};
    appConfig.routeProfile = routeProfile;
  }
  
  // Apply routes
  const approvedRoutes = suggestions.filter(
    (s) => s.relation === "child_route" || s.relation === "intermediate_step"
  );
  
  if (approvedRoutes.length > 0) {
    if (!routeProfile.routes) {
      routeProfile.routes = [];
    }
    
    for (const suggestion of approvedRoutes) {
      const existingRoute = routeProfile.routes.find((r) => r.from === suggestion.from);
      
      if (existingRoute) {
        if (!existingRoute.intermediates.includes(suggestion.to)) {
          existingRoute.intermediates.push(suggestion.to);
          changes.push(`Added intermediate "${suggestion.to}" to route "${suggestion.from}"`);
        }
      } else {
        routeProfile.routes.push({
          from: suggestion.from,
          intermediates: [suggestion.to],
          domain: undefined
        });
        changes.push(`Added new route "${suggestion.from}" with intermediate "${suggestion.to}"`);
      }
    }
  }
  
  // Apply aliases
  const approvedAliases = suggestions.filter((s) => s.relation === "alias_candidate");
  
  if (approvedAliases.length > 0) {
    if (!routeProfile.aliases) {
      routeProfile.aliases = {};
    }
    
    for (const suggestion of approvedAliases) {
      if (!routeProfile.aliases[suggestion.from]) {
        routeProfile.aliases[suggestion.from] = suggestion.to;
        changes.push(`Added alias "${suggestion.from}" -> "${suggestion.to}"`);
      }
    }
  }
  
  // Apply domain terms
  const approvedDomainTerms = suggestions.filter((s) => s.relation === "domain_term_candidate");
  
  if (approvedDomainTerms.length > 0) {
    if (!routeProfile.domainTerms) {
      routeProfile.domainTerms = [];
    }
    
    for (const suggestion of approvedDomainTerms) {
      if (!routeProfile.domainTerms.includes(suggestion.to)) {
        routeProfile.domainTerms.push(suggestion.to);
        changes.push(`Added domain term "${suggestion.to}"`);
      }
    }
  }
  
  // Write updated config
  try {
    await fsp.writeFile(appConfigPath, JSON.stringify(appConfig, null, 2), "utf-8");
    return { applied: true, backupPath, changes };
  } catch (err) {
    // Restore backup
    try {
      await fsp.copyFile(backupPath, appConfigPath);
    } catch {}
    return { applied: false, error: `Failed to write app.config.json: ${err}`, backupPath };
  }
}

export function getRouteProfileLearningConfig(env: Record<string, string | undefined>): RouteProfileLearningConfig {
  return {
    enabled: (env.ROUTE_PROFILE_LEARNING_ENABLED ?? "false").toLowerCase() === "true",
    autoApproveThreshold: parseFloat(env.ROUTE_PROFILE_LEARNING_AUTO_APPROVE_THRESHOLD ?? "0.90") || 0.90,
    autoApply: (env.ROUTE_PROFILE_LEARNING_AUTO_APPLY ?? "false").toLowerCase() === "true",
    minOccurrences: parseInt(env.ROUTE_PROFILE_LEARNING_MIN_OCCURRENCES ?? "1") || 1,
    blockSensitive: (env.ROUTE_PROFILE_LEARNING_BLOCK_SENSITIVE ?? "true").toLowerCase() === "true"
  };
}
