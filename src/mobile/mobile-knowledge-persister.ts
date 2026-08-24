import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { MobileScreenSnapshot } from "./mobile-knowledge-extractor";

export type MobileKnowledgeItem = Record<string, unknown>;
export type MobileKnowledgeStatus = "passed" | "failed" | "partial";

/**
 * A structured per-step navigation transition: the screen observed before an executed
 * action, the effective action target, and the screen observed after. screenBefore/
 * screenAfter are structured fingerprints (screenKey) — never visible text/titles.
 */
export type MobileObservedTransition = {
  stepIndex?: number;
  action: string;
  actionTarget: {
    strategy: string;
    value: string;
  };
  screenBefore: string;
  screenAfter: string;
};

function knowledgePath(appSlug: string): string {
  return path.join(process.cwd(), "automations", "apps", appSlug, "mobile.knowledge.json");
}

function readKnowledge(appSlug: string): { items: MobileKnowledgeItem[] } {
  const kp = knowledgePath(appSlug);
  try {
    if (fs.existsSync(kp)) return JSON.parse(fs.readFileSync(kp, "utf-8"));
  } catch {
    /* corrupt file → start fresh */
  }
  return { items: [] };
}

function writeKnowledge(appSlug: string, data: { items: MobileKnowledgeItem[] }): void {
  const kp = knowledgePath(appSlug);
  try {
    const dir = path.dirname(kp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = kp + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, kp);
  } catch {
    fs.writeFileSync(kp, JSON.stringify(data, null, 2), "utf-8");
  }
}

/**
 * Upserts a knowledge item, matching by (knowledgeKind + matchKey). On re-observation it
 * increments runCount/successCount and, on repeated failure (>2), demotes trustedForReuse.
 * Same trust/decay logic as the web runtime-knowledge-persister.
 */
function persistItem(appSlug: string, newItem: MobileKnowledgeItem, matchKey: string): void {
  const data = readKnowledge(appSlug);
  const idx = data.items.findIndex(
    (i) => (i.knowledgeKind as string) === (newItem.knowledgeKind as string) && (i.matchKey as string) === matchKey
  );

  if (idx >= 0) {
    const existing = data.items[idx];
    const isSuccess = newItem.validationStatus === "validated";
    existing.lastSeenAt = new Date().toISOString();
    existing.runCount = ((existing.runCount as number) ?? 0) + 1;
    // Refresh the observed content with the latest snapshot.
    existing.clickTargets = newItem.clickTargets;
    existing.assertionTargets = newItem.assertionTargets;
    if (newItem.transitions) existing.transitions = newItem.transitions;
    if (newItem.title) existing.title = newItem.title;
    if (isSuccess) {
      existing.successCount = ((existing.successCount as number) ?? 0) + 1;
      existing.validationStatus = "validated";
      existing.trustedForReuse = true;
      existing.lastValidatedAt = new Date().toISOString();
    } else {
      existing.failureCount = ((existing.failureCount as number) ?? 0) + 1;
      if ((existing.failureCount as number) > 2) existing.trustedForReuse = false;
    }
    data.items[idx] = existing;
    console.log(`[mobile:knowledge] updated ${existing.id} runCount=${existing.runCount} trusted=${existing.trustedForReuse}`);
  } else {
    data.items.push(newItem);
    console.log(`[mobile:knowledge] persisted kind=${newItem.knowledgeKind} matchKey=${matchKey} trusted=${newItem.trustedForReuse}`);
  }

  writeKnowledge(appSlug, data);
}

/** Persists a screen observation (the real elements seen on a visited screen). */
export function persistMobileScreen(
  appSlug: string,
  snapshot: MobileScreenSnapshot,
  meta: { issueKey?: string; scenarioTitle?: string; status: MobileKnowledgeStatus }
): void {
  if (snapshot.clickTargets.length === 0 && snapshot.assertionTargets.length === 0) return;
  const now = new Date().toISOString();
  const isSuccess = meta.status === "passed" || meta.status === "partial";
  const item: MobileKnowledgeItem = {
    id: `mob_screen_${createHash("sha256").update(snapshot.screenKey).digest("hex").slice(0, 12)}`,
    knowledgeKind: "screen_observed",
    matchKey: snapshot.screenKey,
    screenKey: snapshot.screenKey,
    title: snapshot.title,
    clickTargets: snapshot.clickTargets,
    assertionTargets: snapshot.assertionTargets,
    issueKey: meta.issueKey ?? "",
    scenarioTitle: meta.scenarioTitle ?? "",
    validationStatus: isSuccess ? "validated" : "pending",
    trustedForReuse: isSuccess,
    failureCount: isSuccess ? 0 : 1,
    successCount: isSuccess ? 1 : 0,
    runCount: 1,
    createdAt: now,
    lastSeenAt: now,
    lastValidatedAt: isSuccess ? now : undefined
  };
  persistItem(appSlug, item, snapshot.screenKey);
}

/** Persists a functional route (the sequence of tap targets that a scenario executed). */
export function persistMobileRoute(
  appSlug: string,
  clickTargets: string[],
  meta: { issueKey?: string; scenarioTitle?: string; status: MobileKnowledgeStatus },
  transitions?: MobileObservedTransition[]
): void {
  if (clickTargets.length < 1) return;
  const now = new Date().toISOString();
  const isSuccess = meta.status === "passed";
  const matchKey = createHash("sha256").update(clickTargets.join("|")).digest("hex").slice(0, 12);
  const item: MobileKnowledgeItem = {
    id: `mob_route_${matchKey}`,
    knowledgeKind: "route_observed",
    matchKey,
    clickTargets,
    assertionTargets: [],
    issueKey: meta.issueKey ?? "",
    scenarioTitle: meta.scenarioTitle ?? "",
    validationStatus: isSuccess ? "validated" : "pending",
    trustedForReuse: isSuccess,
    failureCount: isSuccess ? 0 : 1,
    successCount: isSuccess ? 1 : 0,
    runCount: 1,
    createdAt: now,
    lastSeenAt: now,
    lastValidatedAt: isSuccess ? now : undefined
  };
  if (transitions && transitions.length > 0) {
    item.transitions = transitions;
  }
  persistItem(appSlug, item, matchKey);
}
