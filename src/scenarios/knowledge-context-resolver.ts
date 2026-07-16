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
 * Extract semantic concepts from any text (generic — no hardcoded domains).
 * Returns significant words (>3 chars), quoted phrases, and compound terms.
 */
function extractSemanticConcepts(text: string): Set<string> {
  const t = normalize(text);
  const concepts = new Set<string>();

  // Quoted phrases (high signal)
  for (const m of t.matchAll(/"(.*?)"/g)) {
    const phrase = m[1].trim();
    if (phrase.length >= 3) concepts.add(phrase);
  }

  // Compound multi-word phrases (2-4 consecutive words >3 chars)
  const words = t.split(/\s+/).filter(w => w.length >= 3);
  for (let i = 0; i < words.length; i++) {
    concepts.add(words[i]);
    if (i + 1 < words.length) concepts.add(`${words[i]} ${words[i + 1]}`);
    if (i + 2 < words.length) concepts.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }

  return concepts;
}

/**
 * Extract concepts from HU text including explicit route path.
 */
function extractHuConcepts(huText: string): Set<string> {
  return extractSemanticConcepts(huText);
}

/**
 * Extract concepts from a knowledge item's combined fields.
 */
function extractItemConcepts(item: any): Set<string> {
  const text = [
    ...(item.clickTargets ?? []),
    ...(item.optionLabels ?? []),
    ...(item.assertionTargets ?? []),
    item.scenarioTitle ?? "",
    ...(item.steps ?? []),
  ].join(" ");
  return extractSemanticConcepts(text);
}

/**
 * Score a knowledge item for compatibility with the current HU context.
 * Uses generic semantic overlap with route-aware weighting.
 * No hardcoded domains, routes, or labels — works for any HU/project.
 */
function scoreKnowledgeItem(
  item: any,
  huNorm: string,
  huIntent: string,
  huSubIntent: string | undefined,
  huConcepts: Set<string> | undefined,
  huRouteTokens: string[] | undefined,
): { score: number; reason: string } {
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
  if (kind === "route_menu_snapshot" && item.validationStatus === "validated") { score += 40; reasons.push("kind=route_menu_snapshot_validated"); }
  else if (kind === "route_functional_observed" && item.validationStatus === "validated") { score += 35; reasons.push("kind=route_functional_observed_validated"); }
  else if (kind === "route_functional") { score += 25; reasons.push("kind=route_functional"); }
  else if (kind === "scenario_validated") { score += 15; reasons.push("kind=scenario_validated"); }
  else if (kind === "route_prefix") { score += 10; reasons.push("kind=route_prefix"); }
  else if (kind === "scenario_candidate") { score += 5; reasons.push("kind=scenario_candidate"); }
  else if (kind === "route_menu_snapshot") { score += 8; reasons.push("kind=route_menu_snapshot"); }
  else if (kind === "route_functional_observed") { score += 8; reasons.push("kind=route_functional_observed"); }
  else if (kind === "runtime_click_target") { score += 6; reasons.push("kind=runtime_click_target"); }
  else if (kind === "runtime_screen_snapshot") { score += 6; reasons.push("kind=runtime_screen_snapshot"); }

  // ── Extract item concepts and combined text ──
  const itemConcepts = huConcepts ? extractItemConcepts(item) : new Set<string>();
  const targets = (item.clickTargets ?? []).map(normalize).join(" ");
  const asserts = (item.assertionTargets ?? []).map(normalize).join(" ");
  const optionsText = (item.optionLabels ?? []).map(normalize).join(" ");
  const combinedText = [targets, asserts, optionsText].filter(Boolean).join(" ");

  // ── Route overlap: explicit HU route vs item text ──
  let routeOverlapCount = 0;
  if (huRouteTokens && huRouteTokens.length > 0) {
    for (const rt of huRouteTokens) {
      if (combinedText.includes(rt)) routeOverlapCount++;
    }
  }

  if (routeOverlapCount >= 2) {
    score += 50; reasons.push(`route_overlap=${routeOverlapCount}`);
  } else if (routeOverlapCount >= 1) {
    score += 35; reasons.push(`route_segment_match=${routeOverlapCount}`);
  }

  // ── Generic semantic overlap (absolute + ratio) ──
  let overlapCount = 0;
  let foreignCount = 0;
  if (huConcepts && huConcepts.size > 0 && itemConcepts.size > 0) {
    overlapCount = [...huConcepts].filter(c => itemConcepts.has(c)).length;
    foreignCount = [...itemConcepts].filter(c => !huConcepts.has(c)).length;

    // Absolute overlap bonus: reward items that share concepts with HU, regardless of HU size
    if (overlapCount >= 8) { score += 35; reasons.push(`overlap_strong=${overlapCount}`); }
    else if (overlapCount >= 4) { score += 20; reasons.push(`overlap_good=${overlapCount}`); }
    else if (overlapCount >= 2) { score += 10; reasons.push(`overlap_ok=${overlapCount}`); }

    // Ratio-based bonus (capped to avoid punishing long HUs)
    const effectiveRatio = overlapCount / Math.min(itemConcepts.size, huConcepts.size);
    if (effectiveRatio >= 0.3) {
      score += Math.round(Math.min(effectiveRatio, 0.6) * 40);
      reasons.push(`overlap_ratio=${effectiveRatio.toFixed(2)}`);
    }

    // Foreign concept penalty — only if NO route overlap (route-compatible items may have navigation parents)
    if (routeOverlapCount === 0) {
      const foreignRatio = foreignCount / Math.max(itemConcepts.size, 1);
      if (foreignRatio > 0.7) {
        score -= 50; reasons.push(`foreign_dominant=${foreignRatio.toFixed(2)}`);
        console.log(`[knowledge-context] rejected reason=foreign_dominant_concepts foreignRatio=${foreignRatio.toFixed(2)} itemConcepts=${[...new Set([...itemConcepts].filter(c => !huConcepts!.has(c)))].slice(0,5).join(",")}`);
      } else if (foreignRatio > 0.5) {
        score -= 20; reasons.push(`foreign_significant=${foreignRatio.toFixed(2)}`);
      }
    } else {
      // With route overlap, only penalize if foreign concepts are VERY dominant
      const foreignRatio = foreignCount / Math.max(itemConcepts.size, 1);
      if (foreignRatio > 0.85 && overlapCount < 3) {
        score -= 30; reasons.push(`foreign_despite_route=${foreignRatio.toFixed(2)}`);
        console.log(`[knowledge-context] weak_rejection reason=foreign_despite_route foreignRatio=${foreignRatio.toFixed(2)} routeOverlap=${routeOverlapCount} overlapCount=${overlapCount}`);
      }
    }
  }

  // ── Textual similarity (token-level) ──
  if (combinedText) {
    const huTokens = huNorm.split(/\s+/).filter((t: string) => t.length > 3);
    const matchCount = huTokens.filter((t: string) => combinedText.includes(t)).length;
    if (matchCount > 0) {
      const sim = matchCount / Math.max(huTokens.length, 1);
      score += Math.round(sim * 25);
      if (sim > 0.3) reasons.push(`text_sim=${sim.toFixed(2)}`);
    }
  }

  // ── Coverage refs / routeSignature alignment ──
  const refs = (item.coverageRefs ?? []).join(" ").toLowerCase();
  if (/accessLevel:private|accessLevel:authenticated/.test(refs)) { score += 15; reasons.push("access_private"); }
  if (/startsFrom:public_initial|startsFrom:authenticated_state/.test(refs)) { score += 5; reasons.push("starts_from_known"); }
  if (/endsAt:auth_gate/.test(refs)) { score += 5; reasons.push("ends_at_auth"); }

  if (Array.isArray(item.authTerms) && item.authTerms.length > 0) { score += 10; reasons.push("has_auth_terms"); }

  // ── Intent alignment (generic) ──
  const intentTermCount = huIntent.split(/[_\-\s]+/).filter((t: string) => t.length > 2 && combinedText.includes(normalize(t))).length;
  if (intentTermCount > 0) {
    score += intentTermCount * 10;
    reasons.push(`intent_term_match=${intentTermCount}`);
  }

  // ── SubIntent low overlap penalty ──
  if (huSubIntent && huSubIntent !== "standard" && routeOverlapCount === 0) {
    if (itemConcepts.size > 0 && overlapCount < 3) {
      score -= 60; reasons.push("subintent_low_overlap");
      console.log(`[knowledge-context] rejected reason=subintent_mismatch no_route_overlap overlapCount=${overlapCount} huSubIntent=${huSubIntent}`);
    }
  }

  // ── Generic penalties ──
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
  huSubIntent?: string,
  huExplicitRoutePath?: string[],
): KnowledgeContext {
  const raw = loadKnowledgeRaw(appSlug);
  const allItems: any[] = raw && Array.isArray(raw.items) ? raw.items : [];
  const scanned = allItems.length;

  if (scanned === 0) {
    console.log(`[knowledge-context] empty history appSlug=${appSlug}`);
    return { available: false, source: "app.knowledge", itemsScanned: 0, itemsSelected: 0, itemsRejected: 0, navigationHints: [], functionalHints: [], termsSeenBefore: [] };
  }

  const huNorm = normalize(huText);
  const huConcepts = extractHuConcepts(huText);
  // Route tokens: normalize segments of explicit route path for matching
  const huRouteTokens = (huExplicitRoutePath ?? []).map(s => normalize(s)).filter(s => s.length >= 3);
  const MIN_SCORE = 20;

  // Score all items
  const scored = allItems
    .map((item: any) => {
      const { score, reason } = scoreKnowledgeItem(item, huNorm, huIntent, huSubIntent, huConcepts, huRouteTokens);
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

  console.log(`[knowledge-context] candidates scanned=${scanned} eligible=${eligibleCount} selected=${Math.min(eligibleCount, 5)} rejected=${rejectedCount} huIntent=${huIntent} huSubIntent=${huSubIntent ?? "none"} routeTokens=${huRouteTokens.join("|") || "none"}`);

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
