import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { RuntimeUiSnapshot } from "./runtime-knowledge-extractor";
import { withTransaction } from "../db/sql-connection";
import { materializeProjectRuntime } from "../db/project-materializer";
import type { MobileObservedDestination } from "../mobile/mobile-observed-destination";
import type { MobileDestinationBindingCandidate } from "../mobile/mobile-destination-binding";

export type KnowledgeItem = Record<string, unknown>;

function knowledgePath(appSlug: string): string {
  return path.join(process.cwd(), "automations", "apps", appSlug, "app.knowledge.json");
}

/** Canonical SQL-first persistence for a route_transition knowledge item.
 *  Writes to ProjectKnowledge.knowledgeJson via upsert with merge,
 *  then materializes app.knowledge.json from SQL.
 *  Returns true on success, false on SQL failure (fail-closed). */
async function persistTransitionToSql(appSlug: string, item: KnowledgeItem): Promise<boolean> {
  try {
    const result = await withTransaction(async (conn) => {
      const rows = await conn.query<{ id: string }>("SELECT id FROM dbo.Projects WHERE slug = ?", [appSlug]);
      if (rows.length === 0) return false;
      const projectId = rows[0].id;
      const kRows = await conn.query<{ knowledgeJson: string }>(
        "SELECT knowledgeJson FROM dbo.ProjectKnowledge WITH (UPDLOCK, ROWLOCK) WHERE projectId = ?",
        [projectId]
      );
      let data: { items: KnowledgeItem[] } = { items: [] };
      if (kRows.length > 0 && kRows[0].knowledgeJson) {
        try {
          const parsed = JSON.parse(kRows[0].knowledgeJson);
          data = parsed && Array.isArray(parsed.items) ? parsed : { items: [] };
        } catch { data = { items: [] }; }
      }
      const idx = data.items.findIndex((i) => i.id === item.id);
      if (idx >= 0) {
        const existing = data.items[idx] as any;
        data.items[idx] = {
          ...existing,
          ...item,
          createdAt: existing.createdAt,
          runCount: ((existing.runCount as number) ?? 0) + 1,
        };
        console.log(`[runtime-transition:sql] updated id=${item.id} runCount=${data.items[idx].runCount}`);
      } else {
        data.items.push(item);
        console.log(`[runtime-transition:sql] persisted id=${item.id}`);
      }
      // Legacy remediation: demote route_transition items that have trustedForReuse=true
      // but do not meet the composite trust conditions. Idempotent: re-running on already-
      // demoted items is a no-op because they already have trustedForReuse=false.
      let remediatedCount = 0;
      for (const existingItem of data.items) {
        if (existingItem.knowledgeKind !== "route_transition") continue;
        if (existingItem.trustedForReuse !== true) continue;
        // Check all four composite conditions via pure helper.
        const stillTrusted = isMobileRouteTransitionTrustedForReuse({
          transitionValidated: existingItem.transitionValidated as boolean | undefined,
          executionBacked: existingItem.executionBacked as boolean | undefined,
          actionSemanticAuthority: existingItem.actionSemanticAuthority as string | undefined,
          destinationSemanticAuthority: existingItem.destinationSemanticAuthority as string | undefined,
        });
        if (!stillTrusted) {
          existingItem.trustedForReuse = false;
          existingItem.validationStatus = "validated_technical";
          remediatedCount++;
        }
      }
      if (remediatedCount > 0) {
        console.log(`[runtime-transition:sql] legacy_remediation demoted=${remediatedCount} items not meeting composite trust`);
      }
      await conn.query(
        "UPDATE dbo.ProjectKnowledge SET knowledgeJson = ?, updatedAt = SYSUTCDATETIME() WHERE projectId = ?",
        [Buffer.from(JSON.stringify(data), "utf16le"), projectId]
      );
      return true;
    });
    return result;
  } catch (e: any) {
    console.log(`[runtime-transition:sql] FAILED reason=${e.message}`);
    return false;
  }
}

/** Derive a merge key from a structured control: prefer technical identity (locatorIdentity,
 *  resourceId, contentDesc) over label to avoid collapsing distinct controls with the same label. */
function controlMergeKey(ctrl: Record<string, unknown>): string {
  const locId = typeof ctrl.locatorIdentity === "string" ? ctrl.locatorIdentity.trim() : "";
  if (locId) return `loc:${locId}`;
  const resId = typeof ctrl.resourceId === "string" ? ctrl.resourceId.trim() : "";
  if (resId) return `res:${resId}`;
  const cd = typeof ctrl.contentDesc === "string" ? ctrl.contentDesc.trim() : "";
  if (cd) return `cd:${cd}`;
  return `lbl:${String(ctrl.label ?? "").trim()}`;
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
    observedControls: snapshot.observedControls,
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
    // Refresh observable content from the latest observation.
    existing.clickTargets = newItem.clickTargets;
    existing.assertionTargets = newItem.assertionTargets;
    // observedControls: upgrade legacy strings to structured objects; never degrade rich evidence.
    const existingObserved = existing.observedControls as unknown;
    const incomingObserved = newItem.observedControls as unknown;
    const incomingIsStructured =
      Array.isArray(incomingObserved) && incomingObserved.length > 0 && typeof incomingObserved[0] === "object";
    const existingIsStructured =
      Array.isArray(existingObserved) && existingObserved.length > 0 && typeof existingObserved[0] === "object";
    if (incomingIsStructured && existingIsStructured) {
      // Structured→structured: merge per-control using technical identity as key, never label alone.
      const merged = new Map<string, Record<string, unknown>>();
      for (const ctrl of existingObserved as Record<string, unknown>[]) {
        merged.set(controlMergeKey(ctrl), { ...ctrl });
      }
      for (const ctrl of incomingObserved as Record<string, unknown>[]) {
        const key = controlMergeKey(ctrl);
        const prev = merged.get(key);
        if (prev) {
          for (const [k, v] of Object.entries(ctrl)) {
            if (v !== undefined && v !== null && v !== "") prev[k] = v;
          }
          merged.set(key, prev);
        } else {
          merged.set(key, { ...ctrl });
        }
      }
      existing.observedControls = Array.from(merged.values());
    } else if (incomingIsStructured) {
      // Legacy→structured: upgrade.
      existing.observedControls = incomingObserved;
    } else if (!existingIsStructured && Array.isArray(incomingObserved)) {
      // Legacy→legacy: refresh.
      existing.observedControls = incomingObserved;
    }
    // Keep existing businessLabels if incoming has them.
    if (newItem.businessLabels) existing.businessLabels = newItem.businessLabels;
    if (newItem.transitions) existing.transitions = newItem.transitions;
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

export type RuntimeTransitionInput = {
  sourceScreenKey?: string;
  destinationScreenKey?: string;
  actionBusinessLabel?: string;
  actionLocatorIdentity?: string;
  /** Package that owns the control that triggered this transition. */
  controlPackage?: string;
  /** Resource-id of the control, if observed. */
  controlResourceId?: string;
  /** content-desc of the control, if observed. */
  controlContentDesc?: string;
  /** Structured intent metadata from the scenario step, if available. */
  actionIntent?: string;
  /** Mechanical action description (e.g. "click"), preserved as evidence, NOT as business label. */
  actionDescription?: string;
  sourceTechnicalScreenKey?: string;
  destinationTechnicalScreenKey?: string;
  transitionValidated?: boolean;
  /** True when the action was actually executed by Appium (real runtime evidence). */
  executionBacked?: boolean;
  /** Canonical requirement IDs associated with the executed step, from stepRequirementRefs. */
  requirementIds?: string[];
  /** Action semantic authority: "validated" only when all promotion conditions are met. */
  actionSemanticAuthority?: string;
  /** Destination semantic authority: "validated" when the destination screen is semantically confirmed. */
  destinationSemanticAuthority?: string;
  /** @deprecated Use destinationSemanticAuthority instead. Kept for backward compatibility. */
  semanticDestinationValidated?: boolean;
  branchId?: string;
  sourceIssueKey?: string;
  scenarioId?: string;
  observedRouteIdentity?: string;
  /** Observed destination evidence from the Appium snapshot after the transition. Observation-only, no authority. */
  observedDestinationEvidence?: MobileObservedDestination;
  /** Binding candidate created from this transition. Observation-only, pending validation. */
  bindingCandidate?: MobileDestinationBindingCandidate;
};

/**
 * Pure helper: determines if a MOBILE route_transition should be trusted for reuse.
 *
 * Composite trust requires ALL FOUR conditions with explicit comparisons:
 *   1. transitionValidated === true  (not undefined, not null, not false)
 *   2. executionBacked === true     (action was actually executed by Appium)
 *   3. actionSemanticAuthority === "validated"
 *   4. destinationSemanticAuthority === "validated"
 *
 * Any other combination → false.
 * Action and destination authorities are independent: both must be validated for trust.
 */
export function isMobileRouteTransitionTrustedForReuse(item: {
  transitionValidated?: boolean;
  executionBacked?: boolean;
  actionSemanticAuthority?: string;
  destinationSemanticAuthority?: string;
}): boolean {
  return (
    item.transitionValidated === true
    && item.executionBacked === true
    && item.actionSemanticAuthority === "validated"
    && item.destinationSemanticAuthority === "validated"
  );
}

/**
 * Determine the effective destinationSemanticAuthority from a RuntimeTransitionInput,
 * resolving the deprecated boolean field when the explicit string field is absent.
 */
function resolveDestinationSemanticAuthority(input: RuntimeTransitionInput): string | undefined {
  return input.destinationSemanticAuthority?.trim()
    || (input.semanticDestinationValidated === true ? "validated" : undefined);
}

/**
 * Persist a runtime-observed transition (source screen → control → destination screen).
 * Only persists when:
 *   - beforeScreenKey !== destinationScreenKey (screen actually changed)
 *   - controlPackage matches expectedAppPackage (app-owned control)
 *   - technical identity exists (locatorIdentity or resourceId)
 *
 * Deduplication: same (sourceScreenKey + control identity + destinationScreenKey) → update runCount.
 */
export async function persistRuntimeTransition(
  appSlug: string,
  transition: RuntimeTransitionInput,
  expectedAppPackage?: string,
): Promise<boolean> {
  const source = transition.sourceScreenKey?.trim();
  const dest = transition.destinationScreenKey?.trim();
  const sourceTechnical = transition.sourceTechnicalScreenKey?.trim();
  const destinationTechnical = transition.destinationTechnicalScreenKey?.trim();
  const technicalOnly = !source && !dest && Boolean(sourceTechnical && destinationTechnical && transition.transitionValidated === true);
  if ((!source || !dest || source === dest) && !technicalOnly) return false;

  const pkg = transition.controlPackage?.trim();
  if (!technicalOnly && (!pkg || pkg !== expectedAppPackage)) {
    console.log(`[runtime-transition] skipped source=${source} dest=${dest} reason=package_mismatch controlPkg=${pkg ?? "unknown"} expected=${expectedAppPackage}`);
    return false;
  }

  const techIdentity = transition.actionLocatorIdentity?.trim() || transition.controlResourceId?.trim() || "";
  if (!techIdentity) {
    console.log(`[runtime-transition] skipped source=${source} dest=${dest} reason=no_technical_identity`);
    return false;
  }

  const id = createHash("sha256")
    .update(`runtime_transition:${source ?? sourceTechnical}:${techIdentity}:${dest ?? destinationTechnical}`)
    .digest("hex")
    .slice(0, 12);
  const now = new Date().toISOString();

  // Resolve destination semantic authority (explicit string > deprecated boolean).
  const destSemanticAuth = resolveDestinationSemanticAuthority(transition);

  // Composite trust decision via pure helper: ALL FOUR conditions must hold.
  const trusted = isMobileRouteTransitionTrustedForReuse({
    transitionValidated: transition.transitionValidated,
    executionBacked: transition.executionBacked,
    actionSemanticAuthority: transition.actionSemanticAuthority,
    destinationSemanticAuthority: destSemanticAuth,
  });

  const item: KnowledgeItem = {
    id,
    knowledgeKind: "route_transition",
    source: "mcp_runtime_observation",
    ...(source ? { sourceScreenKey: source } : {}),
    ...(dest ? { destinationScreenKey: dest } : {}),
    actionBusinessLabel: transition.actionBusinessLabel,
    actionDescription: transition.actionDescription,
    actionLocatorIdentity: techIdentity,
    controlPackage: pkg,
    controlResourceId: transition.controlResourceId,
    controlContentDesc: transition.controlContentDesc,
    actionIntent: transition.actionIntent,
    ...(transition.sourceTechnicalScreenKey?.trim()
      ? { sourceTechnicalScreenKey: transition.sourceTechnicalScreenKey.trim() }
      : {}),
    ...(transition.destinationTechnicalScreenKey?.trim()
      ? { destinationTechnicalScreenKey: transition.destinationTechnicalScreenKey.trim() }
      : {}),
    ...(transition.transitionValidated !== undefined ? { transitionValidated: transition.transitionValidated } : {}),
    ...(transition.executionBacked !== undefined ? { executionBacked: transition.executionBacked } : {}),
    ...(transition.requirementIds && transition.requirementIds.length > 0 ? { requirementIds: transition.requirementIds } : {}),
    ...(transition.actionSemanticAuthority ? { actionSemanticAuthority: transition.actionSemanticAuthority } : {}),
    // Destination semantic authority: only set when explicitly validated.
    ...(destSemanticAuth ? { destinationSemanticAuthority: destSemanticAuth } : {}),
    ...(transition.branchId ? { branchId: transition.branchId } : {}),
    ...(transition.sourceIssueKey ? { sourceIssueKey: transition.sourceIssueKey } : {}),
    ...(transition.scenarioId ? { scenarioId: transition.scenarioId } : {}),
    ...(transition.observedRouteIdentity ? { observedRouteIdentity: transition.observedRouteIdentity } : {}),
    // Observed destination evidence: observation-only, no authority.
    ...(transition.observedDestinationEvidence ? { observedDestinationEvidence: transition.observedDestinationEvidence } : {}),
    // Binding candidate: observation-only, pending validation. Never auto-promotes.
    ...(transition.bindingCandidate ? { bindingCandidate: transition.bindingCandidate } : {}),
    // validationStatus: "validated" for full semantic validation, "validated_technical" when only technical evidence exists.
    validationStatus: trusted ? "validated" : "validated_technical",
    // trustedForReuse: composite trust via pure helper (all four conditions).
    trustedForReuse: trusted,
    runCount: 1,
    createdAt: now,
    lastSeenAt: now,
    lastValidatedAt: now,
  };

  // SQL-first: write to ProjectKnowledge SQL first, then materialize file
  const sqlOk = await persistTransitionToSql(appSlug, item);
  if (!sqlOk) {
    console.log(`[runtime-transition] FAIL-CLOSED: SQL write failed for id=${id}, file NOT written`);
    return false;
  }
  // Materialize app.knowledge.json from SQL
  try {
    await materializeProjectRuntime({ slug: appSlug });
    console.log(`[runtime-transition] materialized id=${id}`);
  } catch (e: any) {
    console.log(`[runtime-transition] materialize warn id=${id} reason=${e.message}`);
  }
  return true;
}
