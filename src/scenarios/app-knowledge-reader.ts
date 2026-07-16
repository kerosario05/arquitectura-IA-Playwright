import * as fs from "fs";
import * as path from "path";
import type { AppKnowledge, AppKnowledgeItem } from "./scenario-types";
import type { JiraIssueSource } from "./scenario-types";

export type AppKnowledgeHint = {
  coverageRefs: string[];
  reason: string;
  steps: string[];
  clickTargets: string[];
  assertionTargets: string[];
  authTerms: string[];
  confidence: "hint";
  trustedForReuse?: boolean;
  confidenceScore?: number;
};

export type AppKnowledgeHintsResult = {
  hints: AppKnowledgeHint[];
  skipped: { noFile: number; wrongSlug: number; noItems: number; filtered: number };
};

const PUBLIC_INFO_INDICATORS = [
  "informaci", "requisito", "beneficio", "tasa", "producto",
  "detalle", "descripci", "condiciones", "legal", "comisión",
  "tarifas", "interés", "plazo", "monto", "contrato",
  "simulaci", "cotizaci", "compar",
];

const PRIVATE_TX_INDICATORS = [
  "balance", "saldo", "cuenta", "movimiento", "consulta personalizad",
  "transacci", "pago", "transferencia", "producto contratado",
  "estado de cuenta", "mi cuenta", "mis productos",
  "inversi", "credito", "prestamo", "tarjeta", "seguro",
  "operaci", "desembolso", "abono", "cargo", "datos propios",
  "servicio privado", "gestión autenticad",
];

const ENTRY_MENU_INDICATORS = [
  "pantalla inicial", "bienvenid", "iniciar", "seleccionar tipo",
  "opcion", "opciones principales", "que deseas realizar",
  "menu", "menu principal", "landing", "elegir opcion",
  "mostrar opciones", "no avanzar sin accion inicial",
  "pantalla de inicio", "inicio", "pantalla principal",
  "seleccion", "escoger", "tipo de gestion",
];

// Auth-only terms — not sufficient alone to classify as private_transactional
const AUTH_CANDIDATES = [
  "autenticaci", "identificaci", "login", "acceso seguro",
  "iniciar sesi", "ingresar con", "clave", "token",
];

function classifyHuScope(issue: JiraIssueSource): {
  scope: "public_info" | "private_transactional" | "entry_menu_or_landing" | "unknown";
  authenticatedPrecondition: boolean;
} {
  const corpus = [issue.summary, issue.description, issue.acceptanceCriteria]
    .filter(Boolean)
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  let publicScore = PUBLIC_INFO_INDICATORS.filter(ind => corpus.includes(ind)).length;
  let privateScore = PRIVATE_TX_INDICATORS.filter(ind => corpus.includes(ind)).length;
  let entryScore = ENTRY_MENU_INDICATORS.filter(ind => corpus.includes(ind)).length;
  const hasAuth = AUTH_CANDIDATES.some(ind => corpus.includes(ind));

  // Detect authenticatedPrecondition: HU declares valid session or authentication already completed
  const authenticatedPrecondition =
    /\b(ses[ií]on\s+(v[aá]lida|iniciada|activa|existente)|ya\s+(est[aá]|se\s+encuentra)\s+(autenticado|logueado)|autenticaci[oó]n\s+(completada|exitosa|ya\s+realizada)|precondici[oó]n\s+autenticada)\b/i.test(corpus);

  // Weight: private signals are stronger than generic informative words
  // A single private signal overrides multiple public signals unless entry is dominant
  const entryDominatesEntry = entryScore >= privateScore && entryScore >= publicScore && entryScore > 0;
  const privateDominates = privateScore > 0;
  const publicDominatesButPrivateExists = publicScore > 0 && privateScore === 0;

  // Determine scope
  if (entryDominatesEntry) {
    console.log(`[app-knowledge] huScope issue=${issue.key} scope=entry_menu_or_landing publicScore=${publicScore} privateScore=${privateScore} entryScore=${entryScore} authenticatedPrecondition=${authenticatedPrecondition}`);
    return { scope: "entry_menu_or_landing", authenticatedPrecondition };
  }
  if (privateDominates) {
    console.log(`[app-knowledge] huScope issue=${issue.key} scope=private_transactional publicScore=${publicScore} privateScore=${privateScore} entryScore=${entryScore} authenticatedPrecondition=${authenticatedPrecondition}`);
    return { scope: "private_transactional", authenticatedPrecondition };
  }
  if (publicDominatesButPrivateExists) {
    console.log(`[app-knowledge] huScope issue=${issue.key} scope=public_info publicScore=${publicScore} privateScore=${privateScore} entryScore=${entryScore} authenticatedPrecondition=${authenticatedPrecondition}`);
    return { scope: "public_info", authenticatedPrecondition };
  }
  console.log(`[app-knowledge] huScope issue=${issue.key} scope=unknown publicScore=${publicScore} privateScore=${privateScore} entryScore=${entryScore} authenticatedPrecondition=${authenticatedPrecondition}`);
  return { scope: "unknown", authenticatedPrecondition };
}

type HuScope = "public_info" | "private_transactional" | "entry_menu_or_landing" | "unknown";

function isItemRelevant(item: AppKnowledgeItem, huScope: HuScope, authenticatedPrecondition: boolean): { relevant: boolean; reason: string } {
  if (!item.steps || item.steps.length === 0) return { relevant: false, reason: "no_steps" };
  if (!item.coverageRefs || item.coverageRefs.length === 0) return { relevant: false, reason: "no_coverage_refs" };
  if (item.source !== "scenario_derived") return { relevant: false, reason: "invalid_source" };

  const itemText = [
    item.scenarioTitle,
    ...item.steps,
    ...item.clickTargets,
    ...item.assertionTargets,
    ...item.optionLabels,
  ].join(" ").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  // Entry/menu/landing: skip all hints — HU already describes the starting screen
  if (huScope === "entry_menu_or_landing") {
    return { relevant: false, reason: "entry_hu_skip_hints" };
  }

  // Public info: prefer items without auth terms
  if (huScope === "public_info") {
    const hasAuth = (item.authTerms || []).length > 0;
    if (hasAuth) return { relevant: false, reason: "public_hu_skips_auth_route" };
    const informativeIndicators = ["informaci", "requisito", "beneficio", "tasa", "detalle", "condiciones", "legal", "descripci"];
    const isInformative = informativeIndicators.some(ind => itemText.includes(ind));
    if (isInformative || item.clickTargets.some(ct => ct.toLowerCase().includes("informaci"))) {
      return { relevant: true, reason: "public_informative_route" };
    }
    if (item.coverageRefs.some(r => r.startsWith("initial_")) && item.steps.length <= 2) {
      return { relevant: true, reason: "public_initial_screen" };
    }
    return { relevant: false, reason: "not_relevant_for_public_hu" };
  }

  // Private transactional: prefer items with auth or transactional signals
  // If authenticatedPrecondition is true, auth terms are context not goal
  if (huScope === "private_transactional") {
    const hasAuth = (item.authTerms || []).length > 0;
    const hasTransactional = PRIVATE_TX_INDICATORS.some(ind => itemText.includes(ind));
    const isOptionFlow = item.coverageRefs.some(r => r.startsWith("option_"));
    const hasEntryClick = item.clickTargets.some(ct =>
      ct.toLowerCase().includes("iniciar") || ct.toLowerCase().includes("ingresar") || ct.toLowerCase().includes("acceder")
    );

    if (authenticatedPrecondition && hasAuth) {
      // Auth is a precondition, not a goal; still useful as optional navigation context
      return { relevant: true, reason: "private_authenticated_precondition_context" };
    }
    if (hasAuth || hasTransactional || (isOptionFlow && hasEntryClick)) {
      return { relevant: true, reason: "private_authenticated_route" };
    }
    if (item.coverageRefs.some(r => r.startsWith("initial_")) && !item.authTerms?.length && item.steps.length <= 3) {
      return { relevant: true, reason: "private_initial_navigation_base" };
    }
    return { relevant: false, reason: "not_relevant_for_private_hu" };
  }

  // Unknown: only very safe general navigation
  if (item.coverageRefs.some(r => r.startsWith("initial_")) || item.coverageRefs.some(r => r.startsWith("blocked_"))) {
    if (item.steps.length <= 3 && !(item.authTerms || []).length) {
      return { relevant: true, reason: "unknown_hu_general_navigation" };
    }
  }
  return { relevant: false, reason: "not_relevant_for_unknown_hu" };
}

export function readAppKnowledge(
  appSlug: string,
  primaryIssue: JiraIssueSource | null,
): AppKnowledgeHintsResult {
  const skipped = { noFile: 0, wrongSlug: 0, noItems: 0, filtered: 0 };
  const knowledgePath = path.join(process.cwd(), "automations", "apps", appSlug, "app.knowledge.json");

  if (!fs.existsSync(knowledgePath)) {
    console.log(`[app-knowledge] read skipped reason=file_not_found appSlug=${appSlug}`);
    skipped.noFile = 1;
    return { hints: [], skipped };
  }

  let knowledge: AppKnowledge;
  try {
    const raw = fs.readFileSync(knowledgePath, "utf-8");
    knowledge = JSON.parse(raw) as AppKnowledge;
  } catch {
    console.log(`[app-knowledge] read skipped reason=parse_error appSlug=${appSlug}`);
    skipped.noFile = 1;
    return { hints: [], skipped };
  }

  if (knowledge.appSlug !== appSlug) {
    console.log(`[app-knowledge] read skipped reason=wrong_appSlug file=${knowledge.appSlug} requested=${appSlug}`);
    skipped.wrongSlug = 1;
    return { hints: [], skipped };
  }

  if (!knowledge.items || knowledge.items.length === 0) {
    console.log(`[app-knowledge] read skipped reason=no_items appSlug=${appSlug}`);
    skipped.noItems = 1;
    return { hints: [], skipped };
  }

  console.log(`[app-knowledge] read appSlug=${appSlug} path=${knowledgePath} items=${knowledge.items.length}`);

  // Filter safe items
  const safeItems = knowledge.items.filter(item => {
    if (item.source !== "scenario_derived") return false;
    if (!item.coverageRefs || item.coverageRefs.length === 0) return false;
    if (!item.steps || item.steps.length === 0) return false;
    return true;
  });

  if (safeItems.length === 0) {
    console.log(`[app-knowledge] read skipped reason=no_safe_items appSlug=${appSlug}`);
    skipped.noItems = 1;
    return { hints: [], skipped };
  }

  // Classify HU scope
  const classification = primaryIssue ? classifyHuScope(primaryIssue) : { scope: "unknown" as const, authenticatedPrecondition: false };

  // Select relevant hints
  const candidates: Array<{ item: AppKnowledgeItem; reason: string; score: number }> = [];
  for (const item of safeItems) {
    const { relevant, reason } = isItemRelevant(item, classification.scope, classification.authenticatedPrecondition);
    if (!relevant) {
      skipped.filtered++;
      continue;
    }
    // Score: prefer higher runCount, more steps (complete routes), recent
    const recencyScore = item.lastSeenAt ? (new Date(item.lastSeenAt).getTime() / 10000000000) : 0;
    const stepsScore = Math.min(item.steps.length, 6) * 2;
    const runScore = Math.min(item.runCount || 1, 10);
    const score = stepsScore + runScore + recencyScore;
    candidates.push({ item, reason, score });
  }

  // Sort by score descending, take top 5, limit to 20 total steps and 4000 chars
  candidates.sort((a, b) => b.score - a.score);
  const selected: AppKnowledgeHint[] = [];
  let totalSteps = 0;
  let totalChars = 0;
  const MAX_ITEMS = 5;
  const MAX_STEPS = 20;
  const MAX_CHARS = 4000;

  for (const candidate of candidates) {
    if (selected.length >= MAX_ITEMS) break;
    if (totalSteps + candidate.item.steps.length > MAX_STEPS) continue;
    const hintChars = candidate.item.steps.join(" ").length + candidate.reason.length;
    if (totalChars + hintChars > MAX_CHARS) continue;

    selected.push({
      coverageRefs: candidate.item.coverageRefs,
      reason: candidate.reason,
      steps: candidate.item.steps,
      clickTargets: candidate.item.clickTargets,
      assertionTargets: candidate.item.assertionTargets,
      authTerms: candidate.item.authTerms || [],
      confidence: "hint",
    });
    totalSteps += candidate.item.steps.length;
    totalChars += hintChars;
  }

  console.log(`[app-knowledge] selectedHints issue=${primaryIssue?.key ?? "none"} candidates=${candidates.length} selected=${selected.length} scope=${classification.scope}`);
  return { hints: selected, skipped };
}

/**
 * Select the best compatible learned navigation path from app.knowledge for any HU type.
 * Scoring uses generic term overlap and metadata matching — no hardcoded scope filters.
 * Returns null when no compatible route is found (no file, no items, all scores below threshold).
 */
export function selectLearnedRoute(
  appSlug: string,
  huTerms: string[],
  huScope?: string,
  contractTerms?: string[],
  contractAuthPrecondition?: boolean,
): AppKnowledgeHint | null {
  const knowledgePath = path.join(process.cwd(), "automations", "apps", appSlug, "app.knowledge.json");
  if (!fs.existsSync(knowledgePath)) return null;

  let knowledge: AppKnowledge;
  try {
    const raw = fs.readFileSync(knowledgePath, "utf-8");
    knowledge = JSON.parse(raw) as AppKnowledge;
  } catch {
    return null;
  }
  if (!knowledge.items || knowledge.items.length === 0) return null;

  // Normalize for matching: lowercase, NFD strip diacritics, trim
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const huNorm = huTerms.map(norm).filter(Boolean);
  const contractNorm = (contractTerms || []).map(norm).filter(Boolean);

  const MIN_SCORE = 1;
  let bestFunctional: { item: AppKnowledgeItem; score: number; reasons: string[] } | null = null;
  let bestAuthEntry: { item: AppKnowledgeItem; score: number; reasons: string[] } | null = null;

  for (const item of knowledge.items) {
    if (item.source !== "scenario_derived") continue;
    if (!item.coverageRefs?.includes("learned_navigation_path")) continue;
    if (!item.steps || item.steps.length === 0) continue;
    // Skip non-trusted and rejected knowledge
    if (item.trustedForReuse === false) continue;
    if (item.validationStatus === "rejected") continue;
    if (item.knowledgeKind === "rejected_route" || item.knowledgeKind === "rejected_scenario") continue;
    if (item.sourceQuality === "fallback") continue;

    // Build item text corpus for matching
    const itemCorpus = [
      ...item.clickTargets,
      ...item.assertionTargets,
      ...item.optionLabels,
      ...(item.authTerms || []),
    ].map(norm).filter(Boolean);
    const itemCorpusJoined = itemCorpus.join(" ");

    let score = 0;
    const reasons: string[] = [];

    // 1) Term overlap: count huTerms found in item targets (primary signal)
    let termMatches = 0;
    for (const ht of huNorm) {
      if (itemCorpusJoined.includes(ht)) termMatches++;
    }
    if (termMatches > 0) {
      const termScore = Math.min(termMatches, 5) * 2;
      score += termScore;
      reasons.push(`huTermMatch=${termMatches}`);
    }

    // 2) Contract term match (secondary signal)
    let contractMatches = 0;
    for (const ct of contractNorm) {
      if (itemCorpusJoined.includes(ct)) contractMatches++;
    }
    if (contractMatches > 0) {
      const cScore = Math.min(contractMatches, 3);
      score += cScore;
      reasons.push(`contractMatch=${contractMatches}`);
    }

    // 3) Scope/accessLevel/intent hint (partial match, not requiring exact)
    const itemAccessLevel = item.coverageRefs.find(r => r.startsWith("accessLevel:"))?.split(":")[1] || "";
    const itemIntent = item.coverageRefs.find(r => r.startsWith("intent:"))?.split(":")[1] || "";
    if (huScope && itemAccessLevel) {
      if (huScope.includes("private") && (itemAccessLevel === "private" || itemAccessLevel === "authenticated")) {
        score += 2;
        reasons.push("scopeMatch");
      } else if (huScope.includes("public") && itemAccessLevel === "public") {
        score += 2;
        reasons.push("scopeMatch");
      } else if (huScope.includes("entry") && itemIntent === "informational") {
        score += 1;
        reasons.push("entryMatch");
      }
    }

    // 4) Auth bonus: if HU requires auth and route has authTerms
    if (contractAuthPrecondition && (item.authTerms?.length || item.coverageRefs.some(r => r === "endsAt:auth_gate"))) {
      score += 1;
      reasons.push("authBonus");
    }

    // 5) RunCount as minor tiebreaker (max 1 point)
    const runScore = Math.min((item.runCount || 1) / 10, 1);
    score += runScore;

    const endsAt = item.coverageRefs.find(r => r.startsWith("endsAt:"))?.split(":")[1] || "";
    const isFunctional = itemIntent !== "auth_entry" && itemIntent !== "none" &&
      (endsAt === "business_detail" || endsAt === "functional_area") &&
      itemAccessLevel === "private";
    const isAuthEntry = itemIntent === "auth_entry" || endsAt === "auth_gate";

    if (score > 0) {
      console.log(`[app-knowledge] routeCandidate score=${score.toFixed(1)} accessLevel=${itemAccessLevel} intent=${itemIntent} endsAt=${endsAt} reason=${reasons.join(",") || "no_reason"}`);
    }

    if (score >= MIN_SCORE) {
      if (isFunctional) {
        if (!bestFunctional || score > bestFunctional.score || (score === bestFunctional.score && (item.runCount || 1) > (bestFunctional.item.runCount || 1))) {
          bestFunctional = { item, score, reasons };
        }
      } else if (isAuthEntry) {
        if (!bestAuthEntry || score > bestAuthEntry.score || (score === bestAuthEntry.score && (item.runCount || 1) > (bestAuthEntry.item.runCount || 1))) {
          bestAuthEntry = { item, score, reasons };
        }
      } else {
        // Neither clearly functional nor auth_entry — fall back to scoring comparison
        if (!bestFunctional || score > bestFunctional.score || (score === bestFunctional.score && (item.runCount || 1) > (bestFunctional.item.runCount || 1))) {
          bestFunctional = { item, score, reasons };
        }
      }
    }
  }

  // Two-phase selection: prefer functional over auth_entry
  const winner = bestFunctional || bestAuthEntry;
  let best: AppKnowledgeHint | null = null;
  if (winner) {
    const isFunctionalRoute = winner === bestFunctional;
    best = {
      coverageRefs: winner.item.coverageRefs,
      reason: isFunctionalRoute ? "functional_route_preferred" : "auth_entry_fallback",
      steps: winner.item.steps,
      clickTargets: winner.item.clickTargets,
      assertionTargets: winner.item.assertionTargets,
      authTerms: winner.item.authTerms || [],
      confidence: "hint" as const,
      trustedForReuse: winner.item.trustedForReuse,
      confidenceScore: winner.item.confidenceScore,
    };
    if (bestAuthEntry && bestFunctional) {
      console.log(`[app-knowledge] authEntryCandidateIgnored reason=functional_route_available`);
    }
    const accessLevelRef = winner.item.coverageRefs.find(r => r.startsWith("accessLevel:"));
    const intentRef = winner.item.coverageRefs.find(r => r.startsWith("intent:"));
    const bestAccessLevel = accessLevelRef?.split(":")[1] || "none";
    const bestIntent = intentRef?.split(":")[1] || "none";
    console.log(`[app-knowledge] selectedLearnedRoute id=learned_path score=${winner.score.toFixed(1)} steps=${winner.item.steps.length} accessLevel=${bestAccessLevel} intent=${bestIntent} reason=${best.reason}`);
  }

  return best;
}
