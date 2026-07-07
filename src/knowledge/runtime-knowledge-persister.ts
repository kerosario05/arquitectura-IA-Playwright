import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { RuntimeUiSnapshot } from "./runtime-knowledge-extractor";

export type KnowledgeItem = Record<string, unknown>;

function knowledgePath(appSlug: string): string {
  return path.join(process.cwd(), "automations", "apps", appSlug, "app.knowledge.json");
}

function itemSignature(item: KnowledgeItem): string {
  const kind = (item.knowledgeKind as string) ?? "";
  const targets = (item.clickTargets as string[]) ?? [];
  const screenKey = (item.screenKey as string) ?? "";
  const hash = createHash("sha256")
    .update(`${kind}:${screenKey}:${targets.slice(0, 5).join("|")}`)
    .digest("hex")
    .slice(0, 12);
  return hash;
}

/**
 * Persist a runtime-observed snapshot to app.knowledge.json.
 * Deduplicates by kind + screenKey + normalized clickTargets.
 * Only persist menu snapshots when there are multiple clickTargets.
 */
export function persistRuntimeSnapshot(
  appSlug: string,
  snapshot: RuntimeUiSnapshot,
  meta: {
    issueKey?: string;
    scenarioTitle?: string;
    accessLevel?: string;
    status: "passed" | "failed" | "partial";
  },
): void {
  if (snapshot.clickTargets.length < 1) {
    console.log(`[runtime-knowledge] skipped kind=route_menu_snapshot reason=no_click_targets screen=${snapshot.screenKey}`);
    return;
  }

  const sign = itemSignature({
    knowledgeKind: "route_menu_snapshot",
    screenKey: snapshot.screenKey,
    clickTargets: snapshot.clickTargets,
  });

  const now = new Date().toISOString();
  const isSuccess = meta.status === "passed" || meta.status === "partial";

  const newItem: KnowledgeItem = {
    id: `rt_menu_${sign}`,
    source: "mcp_runtime_observation",
    issueKey: meta.issueKey ?? "",
    scenarioTitle: meta.scenarioTitle ?? "",
    knowledgeKind: "route_menu_snapshot",
    screenKey: snapshot.screenKey,
    url: snapshot.url,
    clickTargets: snapshot.clickTargets,
    assertionTargets: snapshot.assertionTargets,
    accessLevel: meta.accessLevel ?? "authenticated",
    validationStatus: isSuccess ? "validated" : "pending",
    trustedForReuse: isSuccess,
    failureCount: isSuccess ? 0 : 1,
    successCount: isSuccess ? 1 : 0,
    runCount: 1,
    createdAt: now,
    lastSeenAt: now,
    lastValidatedAt: isSuccess ? now : undefined,
  };

  persistItem(appSlug, newItem);
}

/**
 * Persist a runtime-observed functional route to app.knowledge.json.
 */
export function persistRuntimeRoute(
  appSlug: string,
  executedSteps: string[],
  executedClickTargets: string[],
  meta: {
    issueKey?: string;
    scenarioTitle?: string;
    status: "passed" | "failed" | "partial";
    startsFrom?: string;
    endsAt?: string;
  },
): void {
  if (executedClickTargets.length < 1) return;

  const sign = createHash("sha256")
    .update(`route_functional_observed:${executedClickTargets.join("|")}`)
    .digest("hex")
    .slice(0, 12);

  const now = new Date().toISOString();
  const isSuccess = meta.status === "passed";

  const newItem: KnowledgeItem = {
    id: `rt_route_${sign}`,
    source: "mcp_runtime_observation",
    issueKey: meta.issueKey ?? "",
    scenarioTitle: meta.scenarioTitle ?? "",
    knowledgeKind: "route_functional_observed",
    steps: executedSteps,
    clickTargets: executedClickTargets,
    startsFrom: meta.startsFrom ?? "authenticated_state",
    endsAt: meta.endsAt ?? "functional_area",
    validationStatus: isSuccess ? "validated" : "pending",
    trustedForReuse: isSuccess,
    failureCount: isSuccess ? 0 : 1,
    successCount: isSuccess ? 1 : 0,
    runCount: 1,
    createdAt: now,
    lastSeenAt: now,
    lastValidatedAt: isSuccess ? now : undefined,
  };

  persistItem(appSlug, newItem);
}

function persistItem(appSlug: string, newItem: KnowledgeItem): void {
  const kp = knowledgePath(appSlug);
  let data: { items: KnowledgeItem[] } = { items: [] };

  try {
    if (fs.existsSync(kp)) {
      data = JSON.parse(fs.readFileSync(kp, "utf-8"));
    }
  } catch { data = { items: [] }; }

  const existingIdx = data.items.findIndex((i: KnowledgeItem) => {
    // Match by kind+signature
    const iKind = i.knowledgeKind as string;
    const nKind = newItem.knowledgeKind as string;
    if (iKind !== nKind) return false;
    if (nKind === "route_menu_snapshot") {
      return (i.screenKey as string) === (newItem.screenKey as string);
    }
    if (nKind === "route_functional_observed") {
      const iTargets = (i.clickTargets as string[]) ?? [];
      const nTargets = (newItem.clickTargets as string[]) ?? [];
      return iTargets.join("|") === nTargets.join("|");
    }
    return false;
  });

  if (existingIdx >= 0) {
    const existing = data.items[existingIdx];
    const isSuccess = newItem.validationStatus === "validated";
    existing.lastSeenAt = new Date().toISOString();
    existing.runCount = ((existing.runCount as number) ?? 0) + 1;
    if (isSuccess) {
      existing.successCount = ((existing.successCount as number) ?? 0) + 1;
      existing.validationStatus = "validated";
      existing.trustedForReuse = true;
      existing.lastValidatedAt = new Date().toISOString();
    } else {
      existing.failureCount = ((existing.failureCount as number) ?? 0) + 1;
      if ((existing.failureCount as number) > 2) {
        existing.trustedForReuse = false;
      }
    }
    data.items[existingIdx] = existing;
    console.log(`[runtime-knowledge] updated existing item id=${existing.id} runCount=${existing.runCount}`);
  } else {
    data.items.push(newItem);
    console.log(`[runtime-knowledge] persisted kind=${newItem.knowledgeKind} trusted=${newItem.trustedForReuse} status=${newItem.validationStatus}`);
  }

  // Atomic write: write to temp then rename
  try {
    const tmp = kp + ".tmp";
    const dir = path.dirname(kp);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(tmp, kp);
  } catch {
    // Fallback: write directly
    fs.writeFileSync(kp, JSON.stringify(data, null, 2), "utf-8");
  }
}
