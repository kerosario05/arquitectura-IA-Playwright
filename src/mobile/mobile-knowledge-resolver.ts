import * as fs from "node:fs";
import * as path from "node:path";
import type { MobileKnowledgeItem } from "./mobile-knowledge-persister";

export type MobileLearnedScreen = {
  screenKey: string;
  title: string;
  clickTargets: string[];
  assertionTargets: string[];
  runCount: number;
};

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Loads mobile.knowledge.json for an app (empty if absent/corrupt). */
export function loadMobileKnowledge(appSlug: string): { items: MobileKnowledgeItem[] } {
  const kp = path.join(process.cwd(), "automations", "apps", appSlug, "mobile.knowledge.json");
  try {
    if (fs.existsSync(kp)) return JSON.parse(fs.readFileSync(kp, "utf-8"));
  } catch {
    /* ignore */
  }
  return { items: [] };
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
    .filter(
      (i) =>
        i.knowledgeKind === "screen_observed" &&
        i.trustedForReuse === true &&
        i.validationStatus === "validated" &&
        Array.isArray(i.clickTargets)
    )
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
    runCount: (item.runCount as number) ?? 1
  }));
}
