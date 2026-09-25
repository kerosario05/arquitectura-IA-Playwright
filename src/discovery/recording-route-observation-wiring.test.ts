import assert from "node:assert/strict";
import test from "node:test";
import {
  isRouteObservationEligible,
  seedCaptureObservation,
  recordReplayObservationAndReevaluate,
} from "./recording-route-observation-wiring";
import { classifyRecordedSurfaceCompatibility } from "./target-resolver";
import type { RouteObservationInput } from "../db/recording-route-observation-repository";

/**
 * Focal coverage for the case-discovery.ts wiring itself (gates + write + same-invocation
 * re-derive), not just the underlying repository/matcher (already covered elsewhere). The
 * critical property under test: a 3rd observation landing during THIS action's own probe
 * invocation must let `recordedPostActionSurfaceReached` return true in that SAME call --
 * never dependent on a later poll tick, job, or a 4th sample.
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
      if (duplicate) throw new Error("UNIQUE constraint failed: RecordingRouteObservation...");
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

const identity = { recordingId: "rec-1", controlIdentity: "screen-1|Depurar", actionKind: "click" };
const origin = "https://app.test";

test("1/firstReplayTwoSamples. capture seed only in DB; this action's replay write becomes sample #2 -- no authority yet, literal mismatch still holds", async () => {
  const conn = new FakeConnection();
  await seedCaptureObservation(identity, "/requests/10207/edit", origin, conn as any);
  const result = await recordReplayObservationAndReevaluate(
    { eligible: true, runId: "job-1", recordedPostActionExpected: "/requests/10207/edit", routeChanged: true, applicationErrorVisible: false, alreadyWritten: false },
    identity,
    `${origin}/requests/10209/edit`,
    conn as any,
  );
  assert.equal(result.written, true);
  assert.equal(conn.rows.length, 2, "sampleCount=2 (capture + this replay)");
  assert.equal(result.authority, null, "authority unavailable with only 2 samples");
  const compatibility = classifyRecordedSurfaceCompatibility(`${origin}/requests/10209/edit`, "/requests/10207/edit", result.authority ?? undefined);
  assert.equal(compatibility.routeMismatch, true, "no false-positive: literal mismatch persists without authority");
});

test("2/thirdSampleSameInvocation. capture + replay1 already in DB; THIS action's write is sample #3 -- authority and surface-reached must both be true in this SAME call, no next poll required", async () => {
  const conn = new FakeConnection();
  await seedCaptureObservation(identity, "/requests/100/edit", origin, conn as any);
  await recordReplayObservationAndReevaluate(
    { eligible: true, runId: "job-1", recordedPostActionExpected: "/requests/100/edit", routeChanged: true, applicationErrorVisible: false, alreadyWritten: false },
    identity, `${origin}/requests/101/edit`, conn as any,
  );
  assert.equal(conn.rows.length, 2, "capture + replay1 baseline before this action");

  // This action's own probe invocation produces sample #3 in one call.
  const result = await recordReplayObservationAndReevaluate(
    { eligible: true, runId: "job-2", recordedPostActionExpected: "/requests/100/edit", routeChanged: true, applicationErrorVisible: false, alreadyWritten: false },
    identity, `${origin}/requests/102/edit`, conn as any,
  );
  assert.equal(result.written, true);
  assert.equal(conn.rows.length, 3, "sampleCount=3 after insert, same call");
  assert.ok(result.authority, "authority available in this same invocation right after the 3rd insert");

  const reached = classifyRecordedSurfaceCompatibility(`${origin}/requests/102/edit`, "/requests/100/edit", result.authority ?? undefined);
  assert.equal(reached.routeMismatch, false, "recorded surface reached=true, immediately, no 4th sample or next poll");
});

test("3/ambiguousLineage. controlIdentity+action appears twice in the recording -- no capture seed, no replay write, no authority, fail-closed", async () => {
  const interactions = [
    { controlIdentity: "screen-1|Aceptar", action: "click" },
    { controlIdentity: "screen-1|Aceptar", action: "click" },
  ];
  const eligible = isRouteObservationEligible({
    recordingId: "rec-1", controlIdentity: "screen-1|Aceptar", actionKind: "click", interactions,
  });
  assert.equal(eligible, false);

  const conn = new FakeConnection();
  const result = await recordReplayObservationAndReevaluate(
    { eligible, runId: "job-1", recordedPostActionExpected: "/x/1", routeChanged: true, applicationErrorVisible: false, alreadyWritten: false },
    { recordingId: "rec-1", controlIdentity: "screen-1|Aceptar", actionKind: "click" },
    `${origin}/x/2`,
    conn as any,
  );
  assert.equal(result.written, false);
  assert.equal(conn.rows.length, 0, "no observation written for an ambiguous lineage");
});

test("4/idempotency. a second probe tick within the same action must not attempt a second write once alreadyWritten is set", async () => {
  const conn = new FakeConnection();
  const gatesBase = { eligible: true, runId: "job-1", recordedPostActionExpected: "/requests/100/edit", routeChanged: true, applicationErrorVisible: false };

  const first = await recordReplayObservationAndReevaluate({ ...gatesBase, alreadyWritten: false }, identity, `${origin}/requests/101/edit`, conn as any);
  assert.equal(first.written, true);
  assert.equal(conn.rows.length, 1);

  // Simulates the caller's own `routeObservationReplayWritten` flag being set after the first write.
  const second = await recordReplayObservationAndReevaluate({ ...gatesBase, alreadyWritten: true }, identity, `${origin}/requests/101/edit`, conn as any);
  assert.equal(second.written, false, "the wiring's own flag gate blocks a redundant attempt");
  assert.equal(conn.rows.length, 1, "still exactly one replay row");
});

test("5/ineligibleObservation. routeChanged=false or applicationErrorVisible=true must never write an observation", async () => {
  const conn = new FakeConnection();
  const noRouteChange = await recordReplayObservationAndReevaluate(
    { eligible: true, runId: "job-1", recordedPostActionExpected: "/requests/100/edit", routeChanged: false, applicationErrorVisible: false, alreadyWritten: false },
    identity, `${origin}/requests/100/edit`, conn as any,
  );
  assert.equal(noRouteChange.written, false);

  const withAppError = await recordReplayObservationAndReevaluate(
    { eligible: true, runId: "job-1", recordedPostActionExpected: "/requests/100/edit", routeChanged: true, applicationErrorVisible: true, alreadyWritten: false },
    identity, `${origin}/requests/101/edit`, conn as any,
  );
  assert.equal(withAppError.written, false);
  assert.equal(conn.rows.length, 0);
});
