import type { DbConnection } from "./db-connection";
import { getConnection } from "./sql-connection";

/**
 * Learned route-family authority for Recording Replay.
 *
 * Each row is ONE independently-observed post-action route for a structured Recording action.
 * "Authority" (which path segment positions are allowed to vary) is never persisted as its own
 * row -- it is derived, read-side, from this table's own accumulated observations. This keeps a
 * single source of truth (the observations) and avoids a second table that could drift out of
 * sync with it.
 *
 * Lineage identity is (recordingId, controlIdentity, actionKind) -- content-derived (see
 * `controlIdentity` on CanonicalInteraction), never an array/interaction index. The CALLER is
 * responsible for confirming this triple is unique within the recording before writing or
 * reading (a repeated control -- e.g. two identical confirmation dialogs -- must never be
 * silently disambiguated here); this repository does not have access to the full recording to
 * check that itself.
 */

export type RouteObservationInput = {
  recordingId: string;
  controlIdentity: string;
  actionKind: string;
  origin: string;
  pathname: string;
  search: string;
  hash: string;
  /** 'capture' | 'replay' */
  sourceKind: string;
  /** capture: the recordingId itself; replay: the jobId. Never null/empty -- capture is a real, named source, not an absence. */
  sourceExecutionId: string;
};

export type LearnedRouteAuthority = {
  origin: string;
  search: string;
  hash: string;
  segmentCount: number;
  staticSegments: Map<number, string>;
  dynamicIndices: Set<number>;
};

type ObservationRow = {
  origin: string;
  pathname: string;
  search: string;
  hash: string;
  observedAt: string;
  id: string;
};

const BASELINE_SIZE = 3;

function pathSegments(pathname: string): string[] {
  return pathname.split("/");
}

/** Idempotent by (recordingId, controlIdentity, actionKind, sourceKind, sourceExecutionId) -- a
 *  duplicate insert (e.g. re-derived from the same replay job, or the same capture processed
 *  twice) is a silent no-op, never a second row and never a thrown error the caller must handle. */
export async function recordRouteObservation(input: RouteObservationInput, conn?: DbConnection): Promise<void> {
  const run = async (c: DbConnection) => {
    try {
      await c.query(
        `INSERT INTO dbo.RecordingRouteObservation
           (recordingId, controlIdentity, actionKind, origin, pathname, search, hash, sourceKind, sourceExecutionId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.recordingId,
          input.controlIdentity,
          input.actionKind,
          input.origin,
          input.pathname,
          input.search,
          input.hash,
          input.sourceKind,
          input.sourceExecutionId,
        ],
      );
    } catch (err) {
      // UNIQUE constraint violation == this exact observation is already recorded. Any other
      // error is real and must propagate.
      const message = String((err as Error)?.message ?? err);
      if (!/unique/i.test(message)) throw err;
    }
  };
  if (conn) return run(conn);
  const c = await getConnection();
  try {
    await run(c);
  } finally {
    await c.close();
  }
}

/**
 * Derives dynamic-segment authority from the FIRST `BASELINE_SIZE` independent observations
 * (ordered observedAt ASC, id ASC -- never by insertion/array position). The mask is fixed at
 * that baseline and never broadened by later samples: every observation beyond the baseline must
 * already conform to it (same origin/search/hash/segmentCount, every baseline static segment
 * exact) or the whole authority is invalid (fail closed), never partially trusted.
 */
export async function deriveRouteAuthority(
  recordingId: string,
  controlIdentity: string,
  actionKind: string,
  conn?: DbConnection,
): Promise<LearnedRouteAuthority | null> {
  const run = async (c: DbConnection): Promise<LearnedRouteAuthority | null> => {
    const rows = await c.query<ObservationRow>(
      `SELECT origin, pathname, search, hash, observedAt, id
         FROM dbo.RecordingRouteObservation
        WHERE recordingId = ? AND controlIdentity = ? AND actionKind = ?
        ORDER BY observedAt ASC, id ASC`,
      [recordingId, controlIdentity, actionKind],
    );
    if (rows.length < BASELINE_SIZE) return null;
    const baseline = rows.slice(0, BASELINE_SIZE);
    const first = baseline[0];
    const segmentCount = pathSegments(first.pathname).length;
    const baselineConsistent = baseline.every((row) =>
      row.origin === first.origin && row.search === first.search && row.hash === first.hash
      && pathSegments(row.pathname).length === segmentCount,
    );
    if (!baselineConsistent) return null;
    const staticSegments = new Map<number, string>();
    const dynamicIndices = new Set<number>();
    for (let index = 0; index < segmentCount; index += 1) {
      const values = new Set(baseline.map((row) => pathSegments(row.pathname)[index]));
      if (values.size === 1) staticSegments.set(index, [...values][0]);
      else dynamicIndices.add(index);
    }
    // A route with no observed variability at all has nothing to learn; a route with no
    // remaining non-empty static segment carries no real family identity (would accept almost
    // anything) -- both fail closed rather than producing a degenerate authority.
    if (dynamicIndices.size === 0) return null;
    if (![...staticSegments.values()].some((value) => value.trim().length > 0)) return null;
    const authority: LearnedRouteAuthority = { origin: first.origin, search: first.search, hash: first.hash, segmentCount, staticSegments, dynamicIndices };
    for (const row of rows.slice(BASELINE_SIZE)) {
      if (row.origin !== authority.origin || row.search !== authority.search || row.hash !== authority.hash) return null;
      const segments = pathSegments(row.pathname);
      if (segments.length !== authority.segmentCount) return null;
      for (const [index, value] of authority.staticSegments) {
        if (segments[index] !== value) return null;
      }
    }
    return authority;
  };
  if (conn) return run(conn);
  const c = await getConnection();
  try {
    return await run(c);
  } finally {
    await c.close();
  }
}

/** True only when (controlIdentity, actionKind) identifies exactly one interaction in the
 *  supplied set -- the caller passes the recording's own canonical interactions; this function
 *  never touches storage, it is the shared eligibility check both the write and read paths use. */
export function isUniqueLineage(
  interactions: readonly { controlIdentity?: string; action?: string }[],
  controlIdentity: string,
  actionKind: string,
): boolean {
  return interactions.filter((i) => i.controlIdentity === controlIdentity && i.action === actionKind).length === 1;
}
