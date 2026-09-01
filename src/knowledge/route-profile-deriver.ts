import * as fs from "node:fs";
import * as path from "node:path";
import type { McpRouteProfile, TargetPathDefinition } from "../scenarios/scenario-types";
import { getProjectConfigurationBySlug } from "../db/project-reader";

export type KnowledgeItem = Record<string, unknown>;

export type RouteKnowledge = {
  items: KnowledgeItem[];
  projectType: 0 | 1 | 2;
};

function knowledgePath(appSlug: string): string {
  return path.join(process.cwd(), "automations", "apps", appSlug, "app.knowledge.json");
}

/**
 * Read knowledge items for an app. SQL ProjectKnowledge is the source of truth;
 * materialized app.knowledge.json is only a legacy fallback when SQL is unavailable.
 */
export async function loadRouteKnowledge(appSlug: string): Promise<RouteKnowledge> {
  try {
    const cfg = await getProjectConfigurationBySlug(appSlug);
    if (cfg) {
      const raw = cfg.knowledge?.knowledgeJson;
      if (raw) {
        const parsed = JSON.parse(raw);
        const items = parsed && Array.isArray(parsed.items) ? (parsed.items as KnowledgeItem[]) : [];
      return { items, projectType: cfg.projectType as 0 | 1 | 2 };
    }
    return { items: [], projectType: cfg.projectType as 0 | 1 | 2 };
    }
  } catch (err) {
    console.warn(`[route-bootstrap] sqlKnowledgeUnavailable appSlug=${appSlug} err=${(err as Error).message}`);
  }

  try {
    const p = knowledgePath(appSlug);
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
      const items = parsed && Array.isArray(parsed.items) ? (parsed.items as KnowledgeItem[]) : [];
      return { items, projectType: 0 };
    }
  } catch {
    /* ignore corrupted fallback */
  }

  return { items: [], projectType: 0 };
}

function urlDepth(u: unknown): number {
  const s = String(u ?? "");
  if (!/^https?:\/\//.test(s)) return 999;
  return s.replace(/^https?:\/\//, "").split("/").filter(Boolean).length;
}

/**
 * Derive a minimal McpRouteProfile strictly from route_menu_snapshot evidence.
 * Never invents routes: entry/visibleControls come from observed clickTargets,
 * domainTerms from observed assertionTargets, intermediates per screenKey only
 * when that screen has click targets. Returns null when evidence is insufficient.
 */
export function deriveRouteProfileFromKnowledge(items: KnowledgeItem[]): McpRouteProfile | null {
  const snapshots = items.filter(
    (i) =>
      i.knowledgeKind === "route_menu_snapshot" &&
      Array.isArray(i.clickTargets) &&
      (i.clickTargets as string[]).length > 0,
  );
  if (snapshots.length === 0) return null;

  const visibleControls: string[] = [];
  const seen = new Set<string>();
  const assertionTerms: string[] = [];
  const intermediates: Record<string, string[]> = {};

  // Observed transition graph: sourceScreenKey → { action label → destScreenKey }.
  // Only runtime observation creates transitions (route_transition items); the
  // graph is the ONLY basis for coherent navigation paths.
  const transitions = items.filter(
    (i) =>
      i.knowledgeKind === "route_transition" &&
      i.validationStatus === "validated" &&
      i.trustedForReuse === true &&
      i.sourceScreenKey &&
      i.destinationScreenKey &&
      String(i.actionBusinessLabel ?? "").trim(),
  );
  const graph = new Map<string, Array<{ action: string; dest: string }>>();
  const transitionScreens = new Set<string>();
  for (const tr of transitions) {
    const src = String(tr.sourceScreenKey);
    const dest = String(tr.destinationScreenKey);
    const action = String(tr.actionBusinessLabel).trim();
    if (!graph.has(src)) graph.set(src, []);
    graph.get(src)!.push({ action, dest });
    transitionScreens.add(src);
    transitionScreens.add(dest);
  }

  const screenTargets = new Map<string, string[]>();
  for (const s of snapshots) {
    const sk = s.screenKey as string | undefined;
    if (!sk) continue;
    const clicks = (s.clickTargets as string[]) ?? [];
    const business = ((s.businessLabels as string[]) ?? []).length === clicks.length
      ? (s.businessLabels as string[])
      : clicks;
    screenTargets.set(sk, business);
  }

  for (const s of snapshots) {
    const clicks = (s.clickTargets as string[]) ?? [];
    // Prefer business labels (clean primary) for semantic/generation surfaces;
    // fall back to the observed locator identity when not recorded.
    const business = ((s.businessLabels as string[]) ?? []).length === clicks.length
      ? (s.businessLabels as string[])
      : clicks;
    for (const t of business) {
      const k = String(t).trim();
      if (k && !seen.has(k)) {
        seen.add(k);
        visibleControls.push(k);
      }
    }
    const at = s.assertionTargets;
    if (Array.isArray(at)) {
      for (const a of at) {
        const v = String(a).trim();
        if (v && !assertionTerms.includes(v)) assertionTerms.push(v);
      }
    }
    const sk = s.screenKey as string | undefined;
    // Legacy flat fallback ONLY for screens never reached via observed
    // transitions — it is never used to fabricate a navigation chain.
    if (sk && !transitionScreens.has(sk) && Array.isArray(clicks) && clicks.length > 0) {
      intermediates[sk] = business.slice(0, 10);
    }
  }

  if (visibleControls.length === 0) return null;

  const sorted = [...snapshots].sort((a, b) => urlDepth(a.url) - urlDepth(b.url));
  const firstSnapshot = sorted[0] as KnowledgeItem | undefined;
  const firstClicks = (firstSnapshot?.clickTargets as string[]) ?? [];
  const firstBusiness = ((firstSnapshot?.businessLabels as string[]) ?? []).length === firstClicks.length
    ? (firstSnapshot?.businessLabels as string[])
    : firstClicks;
  const landingTargets = firstBusiness.slice(0, 8);

  const entry = landingTargets.map((t) => ({ businessLabel: t, visibleLabel: t }));

  // Evidence-backed aliases: bridge the clean business label (used in scenarios
  // and prompt) and the full locator identity (used to resolve the DOM). A
  // required branch action or route step is MCP-executable ONLY when its label
  // is linked to an observed clickTarget through this map — never from Jira.
  const aliases: Record<string, string> = {};
  for (const s of snapshots) {
    const clicks = (s.clickTargets as string[]) ?? [];
    const business = ((s.businessLabels as string[]) ?? []).length === clicks.length
      ? (s.businessLabels as string[])
      : clicks;
    for (let i = 0; i < clicks.length; i++) {
      const locator = String(clicks[i]).trim();
      const label = String(business[i] ?? clicks[i]).trim();
      if (!locator || !label || label === locator) continue;
      aliases[label] = locator;
      aliases[locator] = label;
    }
  }

  // Derive REAL navigation paths from the observed transition graph (D/E). A
  // target on a screen reachable from the entry screen via observed transitions
  // gets an explicit path (entry → … → screen) with confidence high. Assertions
  // never act as navigation intermediates — only clicks recorded as transitions.
  const targetPaths: Record<string, TargetPathDefinition> = {};
  const derivedIntermediates: Record<string, string[]> = {};
  const entryScreen = firstSnapshot?.screenKey ? String(firstSnapshot.screenKey) : "";
  const pathToScreen = new Map<string, string[]>();
  if (entryScreen) {
    pathToScreen.set(entryScreen, []);
    const queue = [entryScreen];
    const visited = new Set<string>([entryScreen]);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of graph.get(current) ?? []) {
        if (visited.has(edge.dest)) continue;
        visited.add(edge.dest);
        pathToScreen.set(edge.dest, [...(pathToScreen.get(current) ?? []), edge.action]);
        queue.push(edge.dest);
      }
    }
  }
  for (const [screenKey, business] of screenTargets) {
    const path = pathToScreen.get(screenKey);
    if (!path) continue;
    for (const label of business) {
      const l = String(label).trim();
      if (!l) continue;
      derivedIntermediates[l] = [...path, l];
      targetPaths[l] = {
        target: l,
        requiredIntermediates: path,
        confidence: "high",
        source: "runtime_transitions",
      };
      console.log(
        `[route-path] branch="${l}" screens=${path.length + 1} actions=[${path.join(",")}] coherent=true reason=runtime_transitions`,
      );
    }
  }

  const profile: McpRouteProfile = {
    name: "derived_runtime",
    entry,
    aliases,
    intermediates: { ...intermediates, ...derivedIntermediates },
    targetPaths,
    domainTerms: Object.fromEntries(assertionTerms.map((t) => [t, t])),
    visibleControls: visibleControls.slice(0, 20),
    representativeFixture: {},
    notes: ["Derived at runtime from ProjectKnowledge route_menu_snapshot + route_transition evidence"],
    entrySteps: landingTargets.map((t) => ({ action: "click", target: t, when: "start" })),
  };
  return profile;
}
