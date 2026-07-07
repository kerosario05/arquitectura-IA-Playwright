import type { Page } from "@playwright/test";
import type { PageSnapshot } from "../types/page-snapshot.types";
import type { McpRouteProfile } from "../scenarios/scenario-types";
import { writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

export type IntermediateRecoveryResult = {
  recovered: boolean;
  selectedCandidate?: {
    text: string;
    score: number;
    reason: string;
  };
  detailTargetVisible: boolean;
  urlBefore: string;
  urlAfter?: string;
  visibleCandidatesCount: number;
  debugPath?: string;
  scanStats?: {
    totalElements: number;
    visible: number;
    textBearing: number;
    clickableLike: number;
    candidates: number;
  };
  error?: string;
};

type ScannedElement = {
  text: string;
  tagName: string;
  className: string;
  cursor: string;
  role: string;
  ariaLabel: string;
  bbox: { x: number; y: number; width: number; height: number } | null;
  isVisible: boolean;
  isClickableLike: boolean;
};

type ScoredCandidate = {
  text: string;
  tagName: string;
  className: string;
  cursor: string;
  role: string;
  bbox: { x: number; y: number; width: number; height: number } | null;
  score: number;
  reason: string;
  matchedTokens: string[];
};

/**
 * Normalize text for comparison (remove accents, lowercase, alphanumeric only)
 */
function normalizeToken(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Extract significant tokens from target text.
 * Splits by whitespace BEFORE normalization to preserve word boundaries.
 */
function extractSignificantTokens(text: string): string[] {
  const commonWords = new Set(["de", "del", "la", "el", "en", "y", "a", "para", "con", "por", "los", "las", "un", "una"]);

  return text
    .split(/\s+/)
    .map(word => normalizeToken(word))
    .filter(token => token.length > 2 && !commonWords.has(token));
}

/**
 * Calculate token-overlap score between target tokens and candidate text.
 */
function calculateTokenOverlapScore(
  targetTokens: string[],
  candidateText: string
): { score: number; matchedTokens: string[] } {
  const candidateTokens = extractSignificantTokens(candidateText);
  const candidateNormalized = normalizeToken(candidateText);

  const matchedTokens: string[] = [];

  for (const token of targetTokens) {
    // Check token appears in candidate tokens or full normalized string
    if (candidateTokens.includes(token) || candidateNormalized.includes(token)) {
      matchedTokens.push(token);
    }
  }

  if (matchedTokens.length === 0) {
    return { score: 0, matchedTokens: [] };
  }

  // Base score: proportion of target tokens matched
  const matchRatio = matchedTokens.length / targetTokens.length;

  // Bonus for candidate being concise (subcategory names are typically short)
  const lengthBonus = candidateText.length < 30 ? 0.1 : 0;

  // Bonus for matching multiple tokens (stronger signal)
  const multiTokenBonus = matchedTokens.length >= 2 ? 0.15 : 0;

  const score = Math.min(1.0, matchRatio * 0.7 + lengthBonus + multiTokenBonus);

  return { score, matchedTokens };
}

const CLICKABLE_CLASS_PATTERNS = /cursor-pointer|rounded|shadow|card|item|tile|product|category|option|hover:scale|hover:shadow|hover:bg|border-primary|border-\[/i;

const NAVIGATION_CONTROLS = /^(volver|atras|atrás|finalizar|cerrar|salir|menu|menú|inicio|cancelar|logout|finalizar sesión|finalizar sesion)$/i;

const GIANT_CONTAINER_TAGS = new Set(["html", "body", "main", "header", "footer", "nav"]);

/**
 * Attempt to recover by clicking a parent intermediate when target is not directly visible.
 *
 * Scans the live DOM for clickable elements that are semantic parents of the target
 * (e.g., "Depósito" is parent of "Depósitos a plazos"). If found, clicks the parent
 * and retries the target.
 */
export async function recoverWithParentIntermediate(
  page: Page,
  detailTarget: string,
  currentSnapshot: PageSnapshot,
  evidenceDir?: string
): Promise<IntermediateRecoveryResult> {
  console.log(`[intermediate-recovery] started target="${detailTarget}" reason=target_not_visible`);
  const urlBefore = page.url();

  // First check if target is already visible
  const targetLocator = page.getByText(detailTarget, { exact: false }).first();
  const alreadyVisible = await targetLocator.isVisible({ timeout: 500 }).catch(() => false);
  if (alreadyVisible) {
    console.log(`[intermediate-recovery] targetAlreadyVisible target="${detailTarget}"`);
    return { recovered: false, detailTargetVisible: true, urlBefore, visibleCandidatesCount: 0 };
  }

  // Scan page for clickable elements
  const allElements = await page.locator("*").all().catch(() => []);
  const scannedElements: ScannedElement[] = [];
  const targetTokens = extractSignificantTokens(detailTarget);
  const rejectedElements: Array<{ text: string; reason: string }> = [];
  let totalElements = 0;
  let visibleCount = 0;
  let textBearingCount = 0;
  let clickableLikeCount = 0;
  const parentCandidates: Array<{ element: ScannedElement; score: number; reason: string }> = [];

  for (const element of allElements) {
    totalElements++;
    try {
      const effectiveText = await element.textContent({ timeout: 200 }).catch(() => "");
      if (!effectiveText || effectiveText.trim().length < 2) continue;
      const isVisible = await element.isVisible({ timeout: 200 }).catch(() => false);
      if (!isVisible) continue;
      visibleCount++;
      textBearingCount++;

      const bbox = await element.boundingBox().catch(() => null);
      if (bbox && (bbox.width > 800 || bbox.height > 600)) continue;
      if (bbox && (bbox.width < 30 || bbox.height < 20)) continue;

      const tagName = await element.evaluate((el: Element) => el.tagName.toLowerCase()).catch(() => "");
      const className = await element.getAttribute("class").catch(() => "") || "";
      const cursor = await element.evaluate((el: Element) => window.getComputedStyle(el).cursor).catch(() => "auto");
      const role = await element.getAttribute("role").catch(() => "") || "";

      if (GIANT_CONTAINER_TAGS.has(tagName)) continue;

      const isButton = tagName === "button" || role === "button";
      const isLink = tagName === "a";
      const hasPointer = cursor === "pointer";
      const hasClickClass = CLICKABLE_CLASS_PATTERNS.test(className);
      const hasTabIndex = await element.getAttribute("tabindex").catch(() => null) !== null;
      const isClickableLike = isButton || isLink || hasPointer || hasClickClass || hasTabIndex;
      if (!isClickableLike) continue;
      clickableLikeCount++;

      let primaryText = effectiveText.trim();
      if (primaryText.length > 50) {
        const inner = await element.locator("h1, h2, h3, h4, h5, h6").first().textContent({ timeout: 200 }).catch(() => "");
        if (inner && inner.trim().length > 3 && inner.trim().length < 50) primaryText = inner.trim();
        else primaryText = primaryText.split("\n")[0].trim();
      }

      if (NAVIGATION_CONTROLS.test(primaryText)) { rejectedElements.push({ text: primaryText, reason: "navigation_control" }); continue; }
      if (primaryText.length > 80) { rejectedElements.push({ text: primaryText.substring(0, 40) + "...", reason: "text_too_long" }); continue; }

      const scanned: ScannedElement = { text: primaryText, tagName, className: className.substring(0, 100), cursor, role, ariaLabel: "", bbox, isVisible, isClickableLike };
      scannedElements.push(scanned);

      // Score as PARENT candidate: candidate's normalized text should be a prefix/stem of target tokens
      const candNorm = normalizeToken(primaryText);
      const isEntryLike = /^(iniciar|start|login|home|volver|atras|salir|menu|finalizar)/i.test(candNorm);
      if (isEntryLike) { rejectedElements.push({ text: primaryText, reason: "entry_or_navigation_control" }); continue; }

      // Check semantic parent relationship: candidate text is prefix/stem of target
      const targetNorm = normalizeToken(detailTarget);
      const isParent = targetNorm.startsWith(candNorm) || candNorm.startsWith(targetNorm);
      const tokenOverlap = targetTokens.filter(t => candNorm.includes(t) || t.includes(candNorm)).length;
      const parentScore = tokenOverlap / Math.max(targetTokens.length, 1);
      const isGoodParent = isParent || parentScore >= 0.4;

      if (isGoodParent) {
        const reason = isParent ? "semantic_parent_prefix" : "token_overlap_parent";
        parentCandidates.push({ element: scanned, score: Math.min(1, parentScore + 0.3), reason });
        console.log(`[intermediate-recovery] candidate parent="${primaryText}" target="${detailTarget}" score=${(Math.min(1, parentScore + 0.3)).toFixed(2)} reason=${reason}`);
      } else if (tokenOverlap > 0) {
        console.log(`[intermediate-recovery] candidateRejected parent="${primaryText}" target="${detailTarget}" reason=semantic_mismatch`);
        rejectedElements.push({ text: primaryText, reason: "semantic_mismatch" });
      }
    } catch { continue; }
  }

  // Deduplicate by normalized text
  const seen = new Set<string>();
  const uniqueParents = parentCandidates.filter(c => { const k = normalizeToken(c.element.text); if (seen.has(k)) return false; seen.add(k); return true; });
  uniqueParents.sort((a, b) => b.score - a.score);

  console.log(`[intermediate-recovery] scan total=${totalElements} visible=${visibleCount} clickable=${clickableLikeCount} parentCandidates=${uniqueParents.length}`);

  if (uniqueParents.length === 0) {
    console.log(`[intermediate-recovery] failed reason=no_parent_candidate target="${detailTarget}"`);
    return { recovered: false, detailTargetVisible: false, urlBefore, visibleCandidatesCount: 0 };
  }

  const selected = uniqueParents[0];
  console.log(`[intermediate-recovery] clicked parent="${selected.element.text}" forTarget="${detailTarget}"`);

  try {
    const candidateLocator = page.getByText(selected.element.text, { exact: false }).first();
    await candidateLocator.click({ timeout: 5000 });
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);

    const urlAfter = page.url();
    console.log(`[intermediate-recovery] retryTarget target="${detailTarget}"`);

    let targetNowVisible = false;
    for (let retry = 0; retry < 5; retry++) {
      targetNowVisible = await targetLocator.isVisible({ timeout: 1000 }).catch(() => false);
      if (targetNowVisible) break;
      await page.waitForTimeout(500);
    }

    if (targetNowVisible) {
      console.log(`[intermediate-recovery] targetResolvedAfterParent target="${detailTarget}" parent="${selected.element.text}"`);
      console.log(`[route-learning] observed intermediate parent="${selected.element.text}" target="${detailTarget}" status=pending`);
      return { recovered: true, selectedCandidate: { text: selected.element.text, score: selected.score, reason: selected.reason }, detailTargetVisible: true, urlBefore, urlAfter, visibleCandidatesCount: uniqueParents.length };
    } else {
      console.log(`[intermediate-recovery] failed reason=target_not_found_after_parent_click target="${detailTarget}" parent="${selected.element.text}"`);
      return { recovered: false, detailTargetVisible: false, urlBefore, urlAfter, visibleCandidatesCount: uniqueParents.length };
    }
  } catch (err: any) {
    console.log(`[intermediate-recovery] click failed error="${err.message}"`);
    return { recovered: false, detailTargetVisible: false, urlBefore, visibleCandidatesCount: uniqueParents.length, error: err.message };
  }
}
export async function recoverMissingIntermediateForFinalTarget(
  page: Page,
  detailTarget: string,
  currentSnapshot: PageSnapshot,
  routeProfile?: McpRouteProfile | null,
  evidenceDir?: string
): Promise<IntermediateRecoveryResult> {
  const urlBefore = page.url();

  console.log(
    `[intermediate-recovery] started detailTarget="${detailTarget}" ` +
    `currentUrl="${urlBefore}"`
  );

  // Check if target is already visible
  const targetLocator = page.getByText(detailTarget, { exact: false }).first();
  const targetVisible = await targetLocator.isVisible({ timeout: 1000 }).catch(() => false);

  console.log(`[intermediate-recovery] targetVisible=${targetVisible}`);

  if (targetVisible) {
    return {
      recovered: false,
      detailTargetVisible: true,
      urlBefore,
      visibleCandidatesCount: 0
    };
  }

  // Extract significant tokens from detail target
  const targetTokens = extractSignificantTokens(detailTarget);

  console.log(
    `[intermediate-recovery] targetTokens=[${targetTokens.join(", ")}] ` +
    `count=${targetTokens.length}`
  );

  // Broad DOM scan using Locator API
  const allElements = await page.locator("body *").all();
  const maxScan = Math.min(allElements.length, 500);

  let visibleCount = 0;
  let textBearingCount = 0;
  let clickableLikeCount = 0;

  const scannedElements: ScannedElement[] = [];
  const scoredCandidates: ScoredCandidate[] = [];
  const rejectedElements: Array<{ text: string; reason: string }> = [];

  for (let i = 0; i < maxScan; i++) {
    const element = allElements[i];

    try {
      // Get text content
      let text = await element.textContent({ timeout: 200 }).catch(() => "");
      text = (text || "").trim();

      // Try aria-label if no text
      const ariaLabel = await element.getAttribute("aria-label").catch(() => "") || "";
      const title = await element.getAttribute("title").catch(() => "") || "";

      // Use best available text
      const effectiveText = text.length > 0 && text.length < 100
        ? text
        : ariaLabel.length > 0
          ? ariaLabel
          : title;

      if (!effectiveText || effectiveText.length < 3) {
        continue;
      }

      // Get visibility
      const isVisible = await element.isVisible({ timeout: 200 }).catch(() => false);
      if (!isVisible) continue;
      visibleCount++;

      textBearingCount++;

      // Get bbox
      const bbox = await element.boundingBox().catch(() => null);

      // Skip giant containers
      if (bbox && (bbox.width > 800 || bbox.height > 600)) {
        continue;
      }

      // Skip very small elements
      if (bbox && (bbox.width < 30 || bbox.height < 20)) {
        continue;
      }

      // Get tag, class, cursor, role
      const tagName = await element.evaluate(el => el.tagName.toLowerCase()).catch(() => "");
      const className = await element.getAttribute("class").catch(() => "") || "";
      const cursor = await element.evaluate(el => window.getComputedStyle(el).cursor).catch(() => "auto");
      const role = await element.getAttribute("role").catch(() => "") || "";

      // Skip giant container tags
      if (GIANT_CONTAINER_TAGS.has(tagName)) continue;

      // Determine if clickable-like
      const isButton = tagName === "button" || role === "button";
      const isLink = tagName === "a";
      const hasCursorPointer = cursor === "pointer";
      const hasClickableClass = CLICKABLE_CLASS_PATTERNS.test(className);
      const hasTabIndex = await element.getAttribute("tabindex").catch(() => null) !== null;

      const isClickableLike = isButton || isLink || hasCursorPointer || hasClickableClass || hasTabIndex;

      if (!isClickableLike) {
        continue;
      }
      clickableLikeCount++;

      // Extract primary text (first line or heading within)
      let primaryText = effectiveText;
      if (primaryText.length > 50) {
        // Try to find shorter inner heading
        const innerHeading = await element.locator("h1, h2, h3, h4, h5, h6, [class*='title'], [class*='heading']").first().textContent({ timeout: 200 }).catch(() => "");
        if (innerHeading && innerHeading.trim().length > 3 && innerHeading.trim().length < 50) {
          primaryText = innerHeading.trim();
        } else {
          // Take first line
          primaryText = effectiveText.split("\n")[0].trim();
        }
      }

      // Skip navigation controls
      if (NAVIGATION_CONTROLS.test(primaryText)) {
        rejectedElements.push({ text: primaryText, reason: "navigation_control" });
        continue;
      }

      // Skip if text is too long even after extraction
      if (primaryText.length > 80) {
        rejectedElements.push({ text: primaryText.substring(0, 40) + "...", reason: "text_too_long" });
        continue;
      }

      const scanned: ScannedElement = {
        text: primaryText,
        tagName,
        className: className.substring(0, 100),
        cursor,
        role,
        ariaLabel,
        bbox,
        isVisible,
        isClickableLike
      };
      scannedElements.push(scanned);

      // Calculate token overlap score
      const { score, matchedTokens } = calculateTokenOverlapScore(targetTokens, primaryText);

      if (score > 0.15) {
        let reason = "token_overlap";
        if (matchedTokens.length >= 2) reason = "multi_token_match";
        if (matchedTokens.some(t => t.length > 5)) reason = "contains_key_token";

        scoredCandidates.push({
          text: primaryText,
          tagName,
          className: className.substring(0, 80),
          cursor,
          role,
          bbox,
          score,
          reason,
          matchedTokens
        });

        console.log(
          `[intermediate-recovery] candidate text="${primaryText}" tag=${tagName} ` +
          `role=${role} cursor=${cursor} bbox=${bbox ? `{w:${bbox.width},h:${bbox.height}}` : "null"} ` +
          `score=${score.toFixed(2)} matched=[${matchedTokens.join(",")}]`
        );
      }
    } catch {
      continue;
    }
  }

  // Sort candidates by score descending
  scoredCandidates.sort((a, b) => b.score - a.score);

  // Deduplicate by normalized text
  const seenTexts = new Set<string>();
  const uniqueCandidates = scoredCandidates.filter(c => {
    const key = normalizeToken(c.text);
    if (seenTexts.has(key)) return false;
    seenTexts.add(key);
    return true;
  });

  const scanStats = {
    totalElements: allElements.length,
    visible: visibleCount,
    textBearing: textBearingCount,
    clickableLike: clickableLikeCount,
    candidates: uniqueCandidates.length
  };

  console.log(
    `[intermediate-recovery] scan totalElements=${scanStats.totalElements} ` +
    `visible=${scanStats.visible} textBearing=${scanStats.textBearing} ` +
    `clickableLike=${scanStats.clickableLike} candidates=${scanStats.candidates}`
  );

  // Write debug dump if no candidates found or if evidence dir exists
  let debugPath: string | undefined;
  if (evidenceDir) {
    try {
      const slugTarget = normalizeToken(detailTarget).substring(0, 40);
      const debugFilename = `intermediate-recovery-debug-${slugTarget}.json`;
      debugPath = join(evidenceDir, debugFilename);
      await mkdir(dirname(debugPath), { recursive: true }).catch(() => {});

      const debugPayload = {
        currentUrl: urlBefore,
        detailTarget,
        targetTokens,
        targetVisible: false,
        scanStats,
        candidates: uniqueCandidates.slice(0, 10),
        rejectedElements: rejectedElements.slice(0, 20),
        topVisibleElements: scannedElements.slice(0, 20).map(e => ({
          text: e.text,
          tagName: e.tagName,
          cursor: e.cursor,
          role: e.role,
          bbox: e.bbox,
          className: e.className.substring(0, 60)
        })),
        timestamp: new Date().toISOString()
      };

      await writeFile(debugPath, JSON.stringify(debugPayload, null, 2));
      console.log(`[intermediate-recovery-debug] wrote path=${debugPath}`);
    } catch (err: any) {
      console.log(`[intermediate-recovery-debug] write failed: ${err.message}`);
    }
  }

  if (uniqueCandidates.length === 0) {
    const errorDetail = `No candidates found; scanned=${scanStats.totalElements} visible=${scanStats.visible} textBearing=${scanStats.textBearing} clickableLike=${scanStats.clickableLike}${debugPath ? ` debugPath=${debugPath}` : ""}`;
    console.log(`[intermediate-recovery] failed reason=no_matching_candidates ${errorDetail}`);
    return {
      recovered: false,
      detailTargetVisible: false,
      urlBefore,
      visibleCandidatesCount: 0,
      debugPath,
      scanStats,
      error: errorDetail
    };
  }

  // Select best candidate
  const selected = uniqueCandidates[0];

  console.log(
    `[intermediate-recovery] selected text="${selected.text}" ` +
    `score=${selected.score.toFixed(2)} reason=${selected.reason} ` +
    `matched=[${selected.matchedTokens.join(",")}]`
  );

  try {
    // Click the selected intermediate candidate
    const candidateLocator = page.getByText(selected.text, { exact: false }).first();

    console.log(`[intermediate-recovery] clicking selected target="${selected.text}"`);

    await candidateLocator.click({ timeout: 5000 });

    // Wait for navigation/page update
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

    // Additional wait for SPA transitions
    await page.waitForTimeout(500);

    const urlAfter = page.url();

    console.log(`[intermediate-recovery] afterClick url="${urlAfter}"`);

    // Check if detail target is now visible (with retries for SPA)
    let detailTargetNowVisible = false;
    for (let retry = 0; retry < 5; retry++) {
      detailTargetNowVisible = await targetLocator.isVisible({ timeout: 1000 }).catch(() => false);
      if (detailTargetNowVisible) break;
      await page.waitForTimeout(500);
    }

    console.log(
      `[intermediate-recovery] detailTargetVisible=${detailTargetNowVisible} ` +
      `recovered=${detailTargetNowVisible}`
    );

    return {
      recovered: detailTargetNowVisible,
      selectedCandidate: {
        text: selected.text,
        score: selected.score,
        reason: selected.reason
      },
      detailTargetVisible: detailTargetNowVisible,
      urlBefore,
      urlAfter,
      visibleCandidatesCount: uniqueCandidates.length,
      debugPath,
      scanStats
    };
  } catch (err: any) {
    console.log(`[intermediate-recovery] click failed error="${err.message}"`);
    return {
      recovered: false,
      detailTargetVisible: false,
      urlBefore,
      visibleCandidatesCount: uniqueCandidates.length,
      debugPath,
      scanStats,
      error: err.message
    };
  }
}
