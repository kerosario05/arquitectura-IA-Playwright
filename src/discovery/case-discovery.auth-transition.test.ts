import assert from "node:assert/strict";
import test from "node:test";
import { settleAuthenticationTransition } from "./case-discovery";

type Outcome = Parameters<typeof settleAuthenticationTransition>[0];
const outcome = (classification: Outcome["classification"], extra: Partial<Outcome> = {}): Outcome => ({
  classification, authRequestObserved: true, authResponseObserved: true, redirectChain: [], postLoginUrlClass: "unknown",
  postLoginSurface: "/", loadingObserved: true, errorSurfaceObserved: false, businessSurfaceReached: false, ...extra,
} as Outcome);

function clock() {
  let t = 0;
  return { now: () => t, wait: async (ms: number) => { t += ms; } };
}

test("an accepted login that is still loading settles into the business surface once the page gets there", async () => {
  const { now, wait } = clock();
  let calls = 0;
  const result = await settleAuthenticationTransition(outcome("POST_AUTH_NAVIGATION_FAILURE"), async () => {
    calls += 1;
    return calls < 3 ? outcome("POST_AUTH_NAVIGATION_FAILURE") : outcome("BUSINESS_SURFACE_REACHED", { businessSurfaceReached: true });
  }, { graceMs: 15000, wait, now });
  assert.equal(result.classification, "BUSINESS_SURFACE_REACHED");
  assert.equal(calls, 3);
});

test("a login surface that outlives the grace period stays a navigation failure", async () => {
  const { now, wait } = clock();
  let calls = 0;
  const result = await settleAuthenticationTransition(outcome("POST_AUTH_NAVIGATION_FAILURE"), async () => {
    calls += 1;
    return outcome("POST_AUTH_NAVIGATION_FAILURE");
  }, { graceMs: 5000, pollMs: 1000, wait, now });
  assert.equal(result.classification, "POST_AUTH_NAVIGATION_FAILURE");
  assert.equal(calls, 5);
});

test("rejected logins, error surfaces and unanswered requests are never waited on", async () => {
  const { now, wait } = clock();
  for (const initial of [
    outcome("AUTH_REJECTED"),
    outcome("POST_AUTH_NAVIGATION_FAILURE", { errorSurfaceObserved: true }),
    outcome("POST_AUTH_NAVIGATION_FAILURE", { authResponseObserved: false }),
    outcome("BUSINESS_SURFACE_REACHED", { businessSurfaceReached: true }),
  ]) {
    let calls = 0;
    const result = await settleAuthenticationTransition(initial, async () => { calls += 1; return initial; }, { wait, now });
    assert.equal(calls, 0);
    assert.equal(result, initial);
  }
});
