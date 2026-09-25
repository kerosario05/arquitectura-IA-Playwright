import assert from "node:assert/strict";
import test from "node:test";
import {
  recordRouteObservation,
  deriveRouteAuthority,
  isUniqueLineage,
  type RouteObservationInput,
} from "./recording-route-observation-repository";

/**
 * FIRST_LOSS (recordingId a1282e09-65a1-45cc-b4e0-62832a5a7985, action "Depurar"):
 * `classifyRecordedSurfaceCompatibility` only ever knew the literal recorded pathname
 * (`/requests/10207/edit`), so a physically-correct replay that legitimately reached
 * `/requests/10211/edit` (a different, backend-assigned request id for the SAME action) was
 * reported RECORDED_POSTCONDITION_NOT_REACHED. No route-template/params authority exists
 * anywhere in this codebase's runtime (checked: route-profile-learning.ts, AppRouteProfile,
 * McpRouteProfile, history.state, router introspection -- none). This repository accumulates
 * independent SQL observations of the SAME canonical Recording action's post-action route and
 * derives (never lexically guesses) which path-segment positions are allowed to vary, from
 * genuine repeated variation across >= 3 samples -- never broadened by a later sample, always
 * fail-closed on any inconsistency.
 */

class FakeConnection {
  rows: Array<RouteObservationInput & { id: string; observedAt: string }> = [];
  private seq = 0;
  private nextObservedAt = 1;

  async beginTransaction(): Promise<void> {}
  async commit(): Promise<void> {}
  async rollback(): Promise<void> {}
  async close(): Promise<void> {}

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    if (sql.trim().startsWith("INSERT INTO dbo.RecordingRouteObservation")) {
      const [recordingId, controlIdentity, actionKind, origin, pathname, search, hash, sourceKind, sourceExecutionId] = params as string[];
      const duplicate = this.rows.some((r) =>
        r.recordingId === recordingId && r.controlIdentity === controlIdentity && r.actionKind === actionKind
        && r.sourceKind === sourceKind && r.sourceExecutionId === sourceExecutionId,
      );
      if (duplicate) {
        const err = new Error("UNIQUE constraint failed: RecordingRouteObservation.recordingId, ...");
        throw err;
      }
      this.seq += 1;
      this.rows.push({
        recordingId, controlIdentity, actionKind, origin, pathname, search, hash, sourceKind, sourceExecutionId,
        id: `obs-${this.seq}`,
        observedAt: String(this.nextObservedAt++).padStart(10, "0"),
      });
      return [] as T[];
    }
    if (sql.trim().startsWith("SELECT")) {
      const [recordingId, controlIdentity, actionKind] = params as string[];
      const matches = this.rows
        .filter((r) => r.recordingId === recordingId && r.controlIdentity === controlIdentity && r.actionKind === actionKind)
        .sort((a, b) => (a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : a.id < b.id ? -1 : 1));
      return matches.map((r) => ({ origin: r.origin, pathname: r.pathname, search: r.search, hash: r.hash, observedAt: r.observedAt, id: r.id })) as T[];
    }
    throw new Error(`FakeConnection: unhandled query: ${sql}`);
  }
}

function observation(pathname: string, sourceExecutionId: string, overrides: Partial<RouteObservationInput> = {}): RouteObservationInput {
  return {
    recordingId: "rec-1",
    controlIdentity: "screen-1|Depurar",
    actionKind: "click",
    origin: "https://app.test",
    pathname,
    search: "",
    hash: "",
    sourceKind: sourceExecutionId === "rec-1" ? "capture" : "replay",
    sourceExecutionId,
    ...overrides,
  };
}

test("1/lineageAmbiguity. isUniqueLineage rejects a controlIdentity+action that appears twice in the recording", () => {
  const interactions = [
    { controlIdentity: "screen-1|Aceptar", action: "click" },
    { controlIdentity: "screen-1|Aceptar", action: "click" },
    { controlIdentity: "screen-1|Depurar", action: "click" },
  ];
  assert.equal(isUniqueLineage(interactions, "screen-1|Aceptar", "click"), false);
  assert.equal(isUniqueLineage(interactions, "screen-1|Depurar", "click"), true);
});

test("2/insufficientSamples. fewer than 3 observations produce no authority", async () => {
  const conn = new FakeConnection();
  await recordRouteObservation(observation("/requests/10207/edit", "rec-1"), conn as any);
  await recordRouteObservation(observation("/requests/10209/edit", "job-1"), conn as any);
  const authority = await deriveRouteAuthority("rec-1", "screen-1|Depurar", "click", conn as any);
  assert.equal(authority, null);
});

test("3/threeConsistentSamples. 3 independent observations with one varying segment derive a single dynamic index", async () => {
  const conn = new FakeConnection();
  await recordRouteObservation(observation("/requests/100/edit", "rec-1"), conn as any);
  await recordRouteObservation(observation("/requests/101/edit", "job-1"), conn as any);
  await recordRouteObservation(observation("/requests/102/edit", "job-2"), conn as any);
  const authority = await deriveRouteAuthority("rec-1", "screen-1|Depurar", "click", conn as any);
  assert.ok(authority);
  assert.deepEqual([...authority!.dynamicIndices], [2]);
  assert.equal(authority!.staticSegments.get(1), "requests");
  assert.equal(authority!.staticSegments.get(3), "edit");
});

test("4/laterCompatibleSample. a 4th sample conforming to the baseline keeps authority valid", async () => {
  const conn = new FakeConnection();
  await recordRouteObservation(observation("/requests/100/edit", "rec-1"), conn as any);
  await recordRouteObservation(observation("/requests/101/edit", "job-1"), conn as any);
  await recordRouteObservation(observation("/requests/102/edit", "job-2"), conn as any);
  await recordRouteObservation(observation("/requests/103/edit", "job-3"), conn as any);
  const authority = await deriveRouteAuthority("rec-1", "screen-1|Depurar", "click", conn as any);
  assert.ok(authority);
});

test("5/laterIncompatibleStaticSegment. a 4th sample violating a static segment invalidates authority entirely -- mask is never broadened", async () => {
  const conn = new FakeConnection();
  await recordRouteObservation(observation("/requests/100/edit", "rec-1"), conn as any);
  await recordRouteObservation(observation("/requests/101/edit", "job-1"), conn as any);
  await recordRouteObservation(observation("/requests/102/edit", "job-2"), conn as any);
  await recordRouteObservation(observation("/customers/104/edit", "job-3"), conn as any);
  const authority = await deriveRouteAuthority("rec-1", "screen-1|Depurar", "click", conn as any);
  assert.equal(authority, null);
});

test("6/laterIncompatibleTerminalSegment. a 4th sample with a different terminal static segment invalidates authority", async () => {
  const conn = new FakeConnection();
  await recordRouteObservation(observation("/requests/100/edit", "rec-1"), conn as any);
  await recordRouteObservation(observation("/requests/101/edit", "job-1"), conn as any);
  await recordRouteObservation(observation("/requests/102/edit", "job-2"), conn as any);
  await recordRouteObservation(observation("/requests/105/view", "job-3"), conn as any);
  const authority = await deriveRouteAuthority("rec-1", "screen-1|Depurar", "click", conn as any);
  assert.equal(authority, null);
});

test("7/originMismatchInBaseline. a baseline sample with a different origin never derives authority", async () => {
  const conn = new FakeConnection();
  await recordRouteObservation(observation("/requests/100/edit", "rec-1"), conn as any);
  await recordRouteObservation(observation("/requests/101/edit", "job-1", { origin: "https://other.test" }), conn as any);
  await recordRouteObservation(observation("/requests/102/edit", "job-2"), conn as any);
  const authority = await deriveRouteAuthority("rec-1", "screen-1|Depurar", "click", conn as any);
  assert.equal(authority, null);
});

test("8/searchMismatchInBaseline. a baseline sample with a different query string never derives authority", async () => {
  const conn = new FakeConnection();
  await recordRouteObservation(observation("/requests/100/edit", "rec-1"), conn as any);
  await recordRouteObservation(observation("/requests/101/edit", "job-1", { search: "?tab=info" }), conn as any);
  await recordRouteObservation(observation("/requests/102/edit", "job-2"), conn as any);
  const authority = await deriveRouteAuthority("rec-1", "screen-1|Depurar", "click", conn as any);
  assert.equal(authority, null);
});

test("9/hashMismatchInBaseline. a baseline sample with a different fragment never derives authority", async () => {
  const conn = new FakeConnection();
  await recordRouteObservation(observation("/requests/100/edit", "rec-1"), conn as any);
  await recordRouteObservation(observation("/requests/101/edit", "job-1", { hash: "#summary" }), conn as any);
  await recordRouteObservation(observation("/requests/102/edit", "job-2"), conn as any);
  const authority = await deriveRouteAuthority("rec-1", "screen-1|Depurar", "click", conn as any);
  assert.equal(authority, null);
});

test("10/noStaticSegmentLeft. every non-empty segment varying yields no usable authority (no real family identity)", async () => {
  const conn = new FakeConnection();
  await recordRouteObservation(observation("/aaa/100", "rec-1"), conn as any);
  await recordRouteObservation(observation("/bbb/101", "job-1"), conn as any);
  await recordRouteObservation(observation("/ccc/102", "job-2"), conn as any);
  const authority = await deriveRouteAuthority("rec-1", "screen-1|Depurar", "click", conn as any);
  assert.equal(authority, null);
});

test("13/idempotency. inserting the same (recordingId, controlIdentity, actionKind, sourceKind, sourceExecutionId) twice never duplicates a row", async () => {
  const conn = new FakeConnection();
  await recordRouteObservation(observation("/requests/100/edit", "job-1"), conn as any);
  await recordRouteObservation(observation("/requests/100/edit", "job-1"), conn as any);
  assert.equal(conn.rows.length, 1);
});

test("14/captureSourceExecutionIdNotNull. multiple capture-kind inserts for the SAME recording never create multiple capture rows", async () => {
  const conn = new FakeConnection();
  await recordRouteObservation(observation("/requests/100/edit", "rec-1"), conn as any);
  await recordRouteObservation(observation("/requests/100/edit", "rec-1"), conn as any);
  assert.equal(conn.rows.filter((r) => r.sourceKind === "capture").length, 1);
});

test("15/sameRunThirdSample. inserting the 3rd observation and re-deriving immediately (same call) yields authority without a 4th execution", async () => {
  const conn = new FakeConnection();
  await recordRouteObservation(observation("/requests/100/edit", "rec-1"), conn as any);
  await recordRouteObservation(observation("/requests/101/edit", "job-1"), conn as any);
  let authority = await deriveRouteAuthority("rec-1", "screen-1|Depurar", "click", conn as any);
  assert.equal(authority, null, "still only 2 samples");
  await recordRouteObservation(observation("/requests/102/edit", "job-2"), conn as any);
  authority = await deriveRouteAuthority("rec-1", "screen-1|Depurar", "click", conn as any);
  assert.ok(authority, "authority available in the SAME execution right after the 3rd insert");
});
