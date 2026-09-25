import type { DbConnection } from "../db/db-connection";
import {
  recordRouteObservation,
  deriveRouteAuthority,
  isUniqueLineage,
  type LearnedRouteAuthority,
} from "../db/recording-route-observation-repository";

/**
 * Extracted from case-discovery.ts's `postActionCompletionProbe` so the wiring (gates + write +
 * same-invocation re-derive) has its own focal coverage, independent of Playwright/Page mocking.
 * Callers still own the actual causality signals (watcher-armed-before-click, technical target
 * resolved, this action's own routeChanged/applicationErrorVisible) -- this module never infers
 * them, it only enforces the (recordingId, controlIdentity, actionKind) lineage/eligibility rules
 * and talks to the repository.
 */

export type RouteObservationIdentity = {
  recordingId: string;
  controlIdentity: string;
  actionKind: string;
};

/** True only when this action's lineage is unique in the recording AND recordingId/controlIdentity/
 *  actionKind are all present -- a repeated control (e.g. two identical confirmation dialogs) or a
 *  non-recording-replay action (no recordingActionType) is never eligible. */
export function isRouteObservationEligible(input: {
  recordingId?: string;
  controlIdentity?: string;
  actionKind?: string;
  interactions: readonly { controlIdentity?: string; action?: string }[];
}): input is { recordingId: string; controlIdentity: string; actionKind: string; interactions: typeof input.interactions } {
  return Boolean(
    input.recordingId && input.controlIdentity && input.actionKind
    && isUniqueLineage(input.interactions, input.controlIdentity, input.actionKind),
  );
}

export function parseRouteForObservation(urlLike: string, baseUrl: string):
  { origin: string; pathname: string; search: string; hash: string } | undefined {
  try {
    const u = new URL(urlLike, baseUrl);
    return { origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash };
  } catch {
    return undefined;
  }
}

/** Lazy capture seed: the recording's OWN already-recorded transition (routeAfter), not a fresh
 *  capture run. Idempotent via the repository's own UNIQUE(recordingId, controlIdentity,
 *  actionKind, "capture", recordingId). Never touches Capture V2/session-recording-runner.ts. */
export async function seedCaptureObservation(
  identity: RouteObservationIdentity,
  recordedPostActionExpected: string,
  baseUrl: string,
  conn?: DbConnection,
): Promise<void> {
  const route = parseRouteForObservation(recordedPostActionExpected, baseUrl);
  if (!route) return;
  await recordRouteObservation(
    { ...identity, ...route, sourceKind: "capture", sourceExecutionId: identity.recordingId },
    conn,
  ).catch(() => {});
}

export type ReplayObservationGates = {
  eligible: boolean;
  runId?: string;
  recordedPostActionExpected?: string;
  /** THIS action's own observed transition -- caller-owned causality, never inferred here. */
  routeChanged: boolean;
  applicationErrorVisible: boolean;
  /** Set once already written this action -- prevents a redundant DB round-trip per poll tick
   *  (the repository is idempotent regardless; this is a fast-path guard, not the source of truth). */
  alreadyWritten: boolean;
};

/**
 * Writes a replay-kind observation for THIS action's causal transition (when all gates hold) and,
 * in the SAME call, re-derives authority immediately -- the caller re-evaluates
 * `recordedPostActionSurfaceReached` against the returned authority before resolving generic
 * post-action synchronization, so a 3rd sample landing mid-run never has to wait for another poll
 * tick, job, or 4th sample.
 */
export async function recordReplayObservationAndReevaluate(
  gates: ReplayObservationGates,
  identity: RouteObservationIdentity,
  currentUrl: string,
  conn?: DbConnection,
): Promise<{ written: boolean; authority: LearnedRouteAuthority | null }> {
  if (!gates.eligible || !gates.runId || !gates.recordedPostActionExpected
    || !gates.routeChanged || gates.applicationErrorVisible || gates.alreadyWritten) {
    return { written: false, authority: null };
  }
  const route = parseRouteForObservation(currentUrl, currentUrl);
  if (!route) return { written: false, authority: null };
  await recordRouteObservation(
    { ...identity, ...route, sourceKind: "replay", sourceExecutionId: gates.runId },
    conn,
  ).catch(() => {});
  const authority = await deriveRouteAuthority(
    identity.recordingId, identity.controlIdentity, identity.actionKind, conn,
  ).catch(() => null);
  return { written: true, authority };
}
