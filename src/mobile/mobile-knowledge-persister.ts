import { createHash } from "node:crypto";
import type { MobileScreenSnapshot } from "./mobile-knowledge-extractor";
import {
  persistRuntimeSnapshot,
  persistRuntimeRoute,
  persistRuntimeTransition,
} from "../knowledge/runtime-knowledge-persister";
import { extractObservedDestination, type MobileObservedDestination } from "./mobile-observed-destination";
import type { MobileDestinationBindingCandidate } from "./mobile-destination-binding";

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
  controlPackage?: string;
  controlResourceId?: string;
  controlContentDesc?: string;
  actionLocatorIdentity?: string;
  /** Mechanical action description (e.g. "click"), preserved as descriptive evidence. */
  actionDescription?: string;
  /** Canonical criterion IDs that this step materializes, from the scenario's stepRequirementRefs. */
  requirementIds?: string[];
  /** Action semantic authority: "validated" when all promotion conditions are met. */
  actionSemanticAuthority?: string;
  /** True when the technical transition was validated (screen changed, different fingerprints). */
  transitionValidated?: boolean;
  /** True when the action was actually executed by Appium (real runtime evidence). */
  executionBacked?: boolean;
  /** Observed destination evidence from the Appium snapshot after this step. */
  observedDestinationEvidence?: MobileObservedDestination;
  /** Binding candidate created from this transition. Observation-only, pending validation. */
  bindingCandidate?: MobileDestinationBindingCandidate;
};

function toRuntimeSnapshot(snapshot: MobileScreenSnapshot) {
  return {
    screenKey: snapshot.screenKey,
    url: `mobile://${snapshot.screenKey}`,
    clickTargets: snapshot.clickTargets,
    businessLabels: snapshot.clickTargets,
    observedControls: (snapshot.observedControls ?? []).map((c) => ({
      ...c,
      sourceScreenKey: snapshot.screenKey,
    })),
    assertionTargets: snapshot.assertionTargets,
    headings: [] as string[],
    inputLabels: [] as string[],
    selectLabels: [] as string[],
    capturedAt: new Date().toISOString(),
  };
}

/** Persists a screen observation via shared SQL-first persister (ProjectKnowledge → app.knowledge.json). */
export async function persistMobileScreen(
  appSlug: string,
  snapshot: MobileScreenSnapshot,
  meta: { issueKey?: string; scenarioTitle?: string; status: MobileKnowledgeStatus }
): Promise<void> {
  if (snapshot.clickTargets.length === 0 && snapshot.assertionTargets.length === 0) return;
  const before = Date.now();
  await persistRuntimeSnapshot(appSlug, toRuntimeSnapshot(snapshot), {
    issueKey: meta.issueKey,
    scenarioTitle: meta.scenarioTitle,
    status: meta.status,
  });
  const isSuccess = meta.status === "passed" || meta.status === "partial";
  console.log(
    `[mobile:runtime-knowledge] appSlug=${appSlug} kind=screen_observed screenKey=${snapshot.screenKey} status=${meta.status} validationStatus=${isSuccess ? "validated" : "pending"} trustedForReuse=${isSuccess} ms=${Date.now() - before}`
  );
}

/** Persists a functional route via shared SQL-first persister; each transition becomes a route_transition. */
export async function persistMobileRoute(
  appSlug: string,
  clickTargets: string[],
  meta: { issueKey?: string; scenarioTitle?: string; status: MobileKnowledgeStatus; expectedAppPackage?: string },
  transitions?: MobileObservedTransition[]
): Promise<void> {
  if (clickTargets.length < 1) return;
  await persistRuntimeRoute(appSlug, clickTargets, clickTargets, {
    issueKey: meta.issueKey,
    scenarioTitle: meta.scenarioTitle,
    status: meta.status as "passed" | "failed" | "partial",
  });
  if (transitions && meta.expectedAppPackage) {
    for (const t of transitions) {
      if (!t.screenBefore || !t.screenAfter || !t.action) continue;
      await persistRuntimeTransition(appSlug, {
        sourceScreenKey: t.screenBefore,
        destinationScreenKey: t.screenAfter,
        actionBusinessLabel: undefined,
        actionDescription: t.action,
        actionLocatorIdentity: t.actionLocatorIdentity ?? (t.actionTarget ? `${t.actionTarget.strategy}:${t.actionTarget.value}` : undefined),
        controlPackage: t.controlPackage,
        controlResourceId: t.controlResourceId,
        controlContentDesc: t.controlContentDesc,
        requirementIds: t.requirementIds,
        actionSemanticAuthority: t.actionSemanticAuthority,
        transitionValidated: t.transitionValidated,
        executionBacked: t.executionBacked,
        observedDestinationEvidence: t.observedDestinationEvidence,
        bindingCandidate: t.bindingCandidate,
      }, meta.expectedAppPackage);
    }
  }
  const isSuccess = meta.status === "passed";
  console.log(
    `[mobile:runtime-knowledge] appSlug=${appSlug} kind=route_observed clickTargets=${clickTargets.length} transitions=${transitions?.length ?? 0} status=${meta.status} validationStatus=${isSuccess ? "validated" : "pending"} trustedForReuse=${isSuccess}`
  );
}
