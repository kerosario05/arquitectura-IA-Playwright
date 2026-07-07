import * as fs from "node:fs";
import * as path from "node:path";

export type KnowledgeNavigationHint = {
  kind: string;
  steps: string[];
  clickTargets: string[];
  authTerms: string[];
  confidenceScore: number;
  score: number;
  reason: string;
};

export type KnowledgeFunctionalHint = {
  kind: string;
  scenarioTitle: string;
  steps: string[];
  clickTargets: string[];
  assertionTargets: string[];
  score: number;
  reason: string;
};

export type KnowledgeContext = {
  available: boolean;
  source: "app.knowledge";
  itemsScanned: number;
  itemsSelected: number;
  itemsRejected: number;
  navigationHints: KnowledgeNavigationHint[];
  functionalHints: KnowledgeFunctionalHint[];
  termsSeenBefore: string[];
};

function loadKnowledgeRaw(appSlug: string): Record<string, unknown> | null {
  try {
    const kp = path.join(process.cwd(), "automations", "apps", appSlug, "app.knowledge.json");
    if (!fs.existsSync(kp)) return null;
    return JSON.parse(fs.readFileSync(kp, "utf-8"));
  } catch {
    return null;
  }
}

export function loadOrCreateKnowledgeContext(appSlug: string): { items: any[]; created: boolean } {
  const appsDir = path.join(process.cwd(), "automations", "apps", appSlug);
  const kp = path.join(appsDir, "app.knowledge.json");

  if (fs.existsSync(kp)) {
    try {
      const raw = JSON.parse(fs.readFileSync(kp, "utf-8"));
      const items = Array.isArray(raw.items) ? raw.items : [];
      console.log(`[knowledge-context] loaded history appSlug=${appSlug} items=${items.length}`);
      return { items, created: false };
    } catch { /* corrupted — recreate */ }
  }

  try {
    if (!fs.existsSync(appsDir)) fs.mkdirSync(appsDir, { recursive: true });
    const empty = { version: 1, appSlug, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), items: [] };
    fs.writeFileSync(kp, JSON.stringify(empty, null, 2), "utf-8");
    console.log(`[knowledge-context] created empty history appSlug=${appSlug}`);
    return { items: [], created: true };
  } catch {
    console.log(`[knowledge-context] failed to create history appSlug=${appSlug}`);
    return { items: [], created: false };
  }
}

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Score a knowledge item for compatibility with the current HU context.
 * Multiproject — no hardcoded apps, modules or labels.
 */
function scoreKnowledgeItem(item: any, huNorm: string, huIntent: string): { score: number; reason: string } {
  let score = 0;
  const reasons: string[] = [];

  // ── Base trust signals ──
  if (item.trustedForReuse === true) { score += 30; reasons.push("trusted"); }
  if (item.validationStatus === "validated") { score += 20; reasons.push("validated"); }
  const failures = item.failureCount ?? 0;
  if (failures === 0) { score += 10; reasons.push("zero_failures"); }
  else { score -= failures * 5; }

  const successes = item.successCount ?? 0;
  if (successes > 0) score += Math.min(successes * 2, 10);

  // ── Knowledge kind priority ──
  const kind = item.knowledgeKind ?? "";
  // Runtime-observed validated knowledge gets highest priority
  if (kind === "route_menu_snapshot" && item.validationStatus === "validated") { score += 40; reasons.push("kind=route_menu_snapshot_validated"); }
  else if (kind === "route_functional_observed" && item.validationStatus === "validated") { score += 35; reasons.push("kind=route_functional_observed_validated"); }
  else if (kind === "route_functional") { score += 25; reasons.push("kind=route_functional"); }
  else if (kind === "scenario_validated") { score += 15; reasons.push("kind=scenario_validated"); }
  else if (kind === "route_prefix") { score += 10; reasons.push("kind=route_prefix"); }
  else if (kind === "scenario_candidate") { score += 5; reasons.push("kind=scenario_candidate"); }
  // Runtime pending items score lower than validated but still above pure preview
  else if (kind === "route_menu_snapshot") { score += 8; reasons.push("kind=route_menu_snapshot"); }
  else if (kind === "route_functional_observed") { score += 8; reasons.push("kind=route_functional_observed"); }
  else if (kind === "runtime_click_target") { score += 6; reasons.push("kind=runtime_click_target"); }
  else if (kind === "runtime_screen_snapshot") { score += 6; reasons.push("kind=runtime_screen_snapshot"); }

  // ── Textual similarity with HU ──
  const targets = (item.clickTargets ?? []).map(normalize).join(" ");
  const asserts = (item.assertionTargets ?? []).map(normalize).join(" ");
  const options = (item.optionLabels ?? []).map(normalize).join(" ");
  const combinedText = [targets, asserts, options].filter(Boolean).join(" ");

  if (combinedText) {
    const huTokens = huNorm.split(/\s+/).filter((t: string) => t.length > 3);
    const matchCount = huTokens.filter((t: string) => combinedText.includes(t)).length;
    if (matchCount > 0) {
      const sim = matchCount / Math.max(huTokens.length, 1);
      score += Math.round(sim * 30);
      if (sim > 0.3) reasons.push(`text_sim=${sim.toFixed(2)}`);
    }
  }

  // ── Coverage refs / routeSignature alignment ──
  const refs = (item.coverageRefs ?? []).join(" ").toLowerCase();
  if (/accessLevel:private|accessLevel:authenticated/.test(refs)) { score += 15; reasons.push("access_private"); }
  if (/startsFrom:public_initial|startsFrom:authenticated_state/.test(refs)) { score += 5; reasons.push("starts_from_known"); }
  if (/endsAt:auth_gate/.test(refs)) { score += 5; reasons.push("ends_at_auth"); }

  // Auth terms present
  if (Array.isArray(item.authTerms) && item.authTerms.length > 0) { score += 10; reasons.push("has_auth_terms"); }

  // ── Intent alignment via huIntent ──
  if (huIntent === "transactional_document_flow" && /document|carta|certific|constancia|comprobante/.test(combinedText)) {
    score += 20; reasons.push("intent_match_document");
  }
  if (huIntent === "catalog_listing_flow" && /productos?|tarjetas?|cuentas?|catalogo|listado/.test(combinedText)) {
    score += 20; reasons.push("intent_match_catalog");
  }
  if (huIntent === "product_detail_flow" && /detalle|informacion/.test(combinedText)) {
    score += 15; reasons.push("intent_match_detail");
  }
  // Balance/loan inquiry — favor loan/balance terms
  if ((huIntent === "balance_inquiry" || /balance|loan/.test(huIntent)) && /prestamo|balance|saldo|cuota|tasa/.test(combinedText)) {
    score += 20; reasons.push("intent_match_balance");
  }

  // ── Incompatible route penalties ──
  // For balance/loan inquiry, penalize carta/document/catalog routes
  if ((huIntent === "balance_inquiry" || /balance|loan/.test(huIntent)) && /generar\s+cartas|carta\s+de\s+referencia|carta\s+consular|informacion\s+de\s+productos|beneficios|requisitos/i.test(combinedText)) {
    score -= 80; reasons.push("incompatible_route");
    console.log(`[knowledge-context] rejected item kind=${kind} reason=intent_mismatch itemIntent=document_or_catalog huIntent=${huIntent}`);
  }
  // For document flows, penalize catalog routes
  if (huIntent === "transactional_document_flow" && /informacion de productos|catalogo|listado de productos|beneficios|requisitos|solicitar/i.test(combinedText)) {
    score -= 80; reasons.push("incompatible_catalog_route");
    console.log(`[knowledge-context] rejected item kind=${kind} reason=intent_mismatch itemIntent=catalog huIntent=${huIntent}`);
  }

  // ── Penalties ──
  // Catalog terms penalty when intent is not catalog
  if (huIntent !== "catalog_listing_flow" && /informacion de productos|catalogo|listado de productos/.test(combinedText)) {
    score -= 30; reasons.push("catalog_penalty");
  }
  if (item.rejectedReason) { score -= 20; reasons.push("rejected"); }
  if (item.manual === true) { score -= 15; reasons.push("manual"); }

  // ── ConfidenceScore boost ──
  const conf = item.confidenceScore ?? 0;
  if (conf >= 80) { score += 10; reasons.push("high_confidence"); }
  else if (conf >= 60) { score += 5; reasons.push("medium_confidence"); }

  return { score, reason: reasons.slice(0, 3).join(",") };
}

export function buildKnowledgeContextForScenarioGeneration(
  appSlug: string,
  huText: string,
  huIntent: string,
): KnowledgeContext {
  const raw = loadKnowledgeRaw(appSlug);
  const allItems: any[] = raw && Array.isArray(raw.items) ? raw.items : [];
  const scanned = allItems.length;

  if (scanned === 0) {
    console.log(`[knowledge-context] empty history appSlug=${appSlug}`);
    return { available: false, source: "app.knowledge", itemsScanned: 0, itemsSelected: 0, itemsRejected: 0, navigationHints: [], functionalHints: [], termsSeenBefore: [] };
  }

  const huNorm = normalize(huText);
  const MIN_SCORE = 20;

  // Score all items
  const scored = allItems
    .map((item: any) => {
      const { score, reason } = scoreKnowledgeItem(item, huNorm, huIntent);
      return { item, score, reason };
    })
    .sort((a: any, b: any) => b.score - a.score);

  // Filter by minimum score and basic validity
  const eligible = scored.filter(
    (s: any) =>
      s.score >= MIN_SCORE &&
      s.item.trustedForReuse === true &&
      s.item.validationStatus === "validated" &&
      Array.isArray(s.item.clickTargets) &&
      s.item.clickTargets.length > 0
  );

  const eligibleCount = eligible.length;
  const rejectedCount = scanned - eligibleCount;

  console.log(`[knowledge-context] candidates scanned=${scanned} eligible=${eligibleCount} selected=${Math.min(eligibleCount, 5)} rejected=${rejectedCount} huIntent=${huIntent}`);

  if (eligibleCount === 0) {
    console.log(`[knowledge-context] no compatible history selected reason=below_min_score_or_invalid`);
    return { available: false, source: "app.knowledge", itemsScanned: scanned, itemsSelected: 0, itemsRejected: rejectedCount, navigationHints: [], functionalHints: [], termsSeenBefore: [] };
  }

  const selected = eligible.slice(0, 5);
  const topScore = selected[0].score;
  const selectedKinds = selected.map((s: any) => s.item.knowledgeKind).join(",");
  console.log(`[knowledge-context] ranking topScore=${topScore} selectedKinds=${selectedKinds}`);

  // Build navigation hints (prefer steps over clickTargets)
  const navigationHints: KnowledgeNavigationHint[] = selected
    .filter((s: any) =>
      s.item.knowledgeKind === "route_prefix" ||
      s.item.knowledgeKind === "route_functional" ||
      s.item.knowledgeKind === "route_menu_snapshot" ||
      s.item.knowledgeKind === "route_functional_observed"
    )
    .slice(0, 3)
    .map((s: any) => {
      const item = s.item;
      const steps = Array.isArray(item.steps) && item.steps.length > 0
        ? item.steps
        : (item.clickTargets as string[]).map((t: string) => `Clic en "${t}".`);
      console.log(`[knowledge-context] selected item kind=${item.knowledgeKind} score=${s.score} reason=${s.reason}`);
      return {
        kind: item.knowledgeKind,
        steps,
        clickTargets: item.clickTargets as string[],
        authTerms: Array.isArray(item.authTerms) ? item.authTerms : [],
        confidenceScore: item.confidenceScore ?? 0,
        score: s.score,
        reason: s.reason,
      };
    });

  // Build functional hints
  const functionalHints: KnowledgeFunctionalHint[] = selected
    .filter((s: any) =>
      s.item.knowledgeKind === "scenario_validated" ||
      s.item.knowledgeKind === "scenario_candidate" ||
      s.item.knowledgeKind === "route_functional_observed"
    )
    .slice(0, 3)
    .map((s: any) => {
      const item = s.item;
      console.log(`[knowledge-context] selected item kind=${item.knowledgeKind} score=${s.score} reason=${s.reason}`);
      return {
        kind: item.knowledgeKind,
        scenarioTitle: item.scenarioTitle ?? "",
        steps: Array.isArray(item.steps) ? item.steps : [],
        clickTargets: Array.isArray(item.clickTargets) ? item.clickTargets : [],
        assertionTargets: Array.isArray(item.assertionTargets) ? item.assertionTargets : [],
        score: s.score,
        reason: s.reason,
      };
    });

  const termsSeenBefore = Array.from(new Set(selected.flatMap((s: any) => s.item.clickTargets ?? []))).slice(0, 20);

  console.log(`[knowledge-context] selected navigationHints=${navigationHints.length} functionalHints=${functionalHints.length} terms=${termsSeenBefore.length}`);

  return {
    available: selected.length > 0,
    source: "app.knowledge",
    itemsScanned: scanned,
    itemsSelected: selected.length,
    itemsRejected: rejectedCount,
    navigationHints,
    functionalHints,
    termsSeenBefore,
  };
}
