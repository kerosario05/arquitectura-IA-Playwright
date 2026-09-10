import * as fs from "node:fs";
import * as path from "node:path";
import type { MobileKnowledgeItem } from "./mobile-knowledge-persister";

export type MobileLearnedScreen = {
  screenKey: string;
  title: string;
  clickTargets: string[];
  assertionTargets: string[];
  runCount: number;
  /** Tappables observed as disabled on this state — the preconditions the screen still gates on. */
  disabledTargets: string[];
};

/**
 * Screen-observation kinds the generator can read.
 *
 * `persistRuntimeSnapshot` writes these as "route_menu_snapshot"; "screen_observed" only ever
 * existed in a log line and in this filter, so no item ever matched, the prompt's learned-screen
 * block was always empty, and the generator reported having no screen evidence at all. Both names
 * are accepted so files written before the fix still read.
 */
export const GENERATOR_READABLE_SCREEN_KINDS = ["route_menu_snapshot", "screen_observed"] as const;

/**
 * The single gate deciding whether a learned screen reaches the generator. Exported so the
 * knowledge health check asks the exact same question the prompt does \u2014 a check that answered it
 * separately could go green while the generator saw nothing, which is precisely how the mismatch
 * above survived unnoticed.
 */
export function isGeneratorReadableScreenItem(item: MobileKnowledgeItem): boolean {
  return (
    GENERATOR_READABLE_SCREEN_KINDS.includes(item.knowledgeKind as (typeof GENERATOR_READABLE_SCREEN_KINDS)[number]) &&
    item.trustedForReuse === true &&
    item.validationStatus === "validated" &&
    Array.isArray(item.clickTargets)
  );
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function readKnowledgeFile(filePath: string): MobileKnowledgeItem[] {
  try {
    if (!fs.existsSync(filePath)) return [];
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return Array.isArray(parsed?.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

/**
 * Loads an app's mobile knowledge from `app.knowledge.json`.
 *
 * That is where every runtime observation lands — route learning, test runs, and the SQL
 * materialization all write it. This resolver had regressed to reading `mobile.knowledge.json`
 * instead, a legacy file most projects do not even have, so it returned an empty item list:
 * the locator authority gate then had no evidence to check against and marked every generated
 * locator unbacked, no matter how thoroughly the app had actually been walked, leaving every
 * story permanently stuck on route learning. The tests in this module already asserted the
 * correct source (and the legacy file's deliberate isolation) before the regression.
 */
export function loadMobileKnowledge(appSlug: string): { items: MobileKnowledgeItem[] } {
  const kp = path.join(process.cwd(), "automations", "apps", appSlug, "app.knowledge.json");
  return { items: readKnowledgeFile(kp) };
}

/**
 * Selects the trusted screen observations most relevant to a story, so the generator
 * can ground steps in real screens that were never hand-declared in mobile.config.json.
 * Only validated + trusted items are eligible (same gate as the web resolver). Scored by
 * keyword overlap of the story text against each screen's texts, plus trust signals.
 */
export function selectRelevantMobileKnowledge(
  knowledge: { items: MobileKnowledgeItem[] },
  huText: string,
  limit = 5
): MobileLearnedScreen[] {
  const huTokens = new Set(normalize(huText).split(/[^a-z0-9]+/).filter((t) => t.length >= 4));

  const scored = knowledge.items
    .filter((i) => isGeneratorReadableScreenItem(i))
    .map((i) => {
      const texts = [...((i.clickTargets as string[]) ?? []), ...((i.assertionTargets as string[]) ?? [])];
      const bag = normalize(texts.join(" "));
      let overlap = 0;
      for (const tok of huTokens) if (bag.includes(tok)) overlap++;
      const trust = (i.trustedForReuse ? 10 : 0) + Math.min((i.runCount as number) ?? 0, 5) - ((i.failureCount as number) ?? 0) * 3;
      return { item: i, score: overlap * 10 + trust };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored.map(({ item }) => ({
    screenKey: item.screenKey as string,
    title: (item.title as string) ?? (item.screenKey as string),
    clickTargets: (item.clickTargets as string[]) ?? [],
    assertionTargets: (item.assertionTargets as string[]) ?? [],
    runCount: (item.runCount as number) ?? 1,
    disabledTargets: Array.isArray(item.observedControls)
      ? Array.from(new Set((item.observedControls as Array<Record<string, unknown>>)
          .filter((c) => c.enabled === false)
          .map((c) => String(c.label ?? ""))
          .filter(Boolean)))
      : []
  }));
}
