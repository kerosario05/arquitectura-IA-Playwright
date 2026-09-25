import assert from "node:assert/strict";
import test from "node:test";
import { classifyAuthenticationOutcome, isActionSurfaceStableForStateProbe, shouldClassifyAuthenticationBoundary, type SafeNetworkEvent } from "./case-discovery";

function event(overrides: Partial<SafeNetworkEvent>): SafeNetworkEvent {
  return {
    method: "POST",
    resourceType: "fetch",
    path: "/redacted",
    state: "completed",
    ...overrides,
  };
}

test("state probe remains eligible when the action keeps the same observed surface", () => {
  assert.equal(
    isActionSurfaceStableForStateProbe("https://app.test/form", "https://app.test/form", "https://app.test/form"),
    true,
  );
});

test("state probe is skipped when the next surface owns the action outcome", () => {
  assert.equal(
    isActionSurfaceStableForStateProbe("https://app.test/form", "https://app.test/result", "https://app.test/result"),
    false,
  );
});

test("classifies an authentication 5xx response before business actions", () => {
  const outcome = classifyAuthenticationOutcome({
    beforeAuthDetected: true,
    afterAuthDetected: true,
    events: [event({ status: 504, statusCategory: "5xx" })],
    afterPath: "/redacted",
    loadingObserved: true,
    errorSurfaceObserved: true,
  });

  assert.equal(outcome.classification, "AUTH_INFRASTRUCTURE_FAILURE");
  assert.equal(outcome.authRequestObserved, true);
  assert.equal(outcome.authResponseObserved, true);
  assert.equal(outcome.authHttpStatus, 504);
  assert.equal(outcome.businessSurfaceReached, false);
});

test("classifies a pending authentication request as timeout with progress", () => {
  const outcome = classifyAuthenticationOutcome({
    beforeAuthDetected: true,
    afterAuthDetected: true,
    events: [event({ state: "pending", status: undefined, statusCategory: undefined })],
    afterPath: "/redacted",
    loadingObserved: true,
    errorSurfaceObserved: false,
  });

  assert.equal(outcome.classification, "AUTH_TIMEOUT_WITH_PROGRESS");
  assert.equal(outcome.authRequestObserved, true);
  assert.equal(outcome.authResponseObserved, false);
});

test("recognizes the business surface after a successful authentication response", () => {
  const outcome = classifyAuthenticationOutcome({
    beforeAuthDetected: true,
    afterAuthDetected: false,
    events: [event({ status: 200, statusCategory: "2xx", path: "/redacted" })],
    afterPath: "/redacted-business",
    loadingObserved: false,
    errorSurfaceObserved: false,
  });

  assert.equal(outcome.classification, "BUSINESS_SURFACE_REACHED");
  assert.equal(outcome.postLoginUrlClass, "business_surface");
  assert.equal(outcome.businessSurfaceReached, true);
});

test("preserves the auth submission 303 and accepts its successful business redirect", () => {
  const outcome = classifyAuthenticationOutcome({
    beforeAuthDetected: true,
    afterAuthDetected: true,
    events: [
      event({
        path: "/auth-entry",
        status: 303,
        statusCategory: "3xx",
        redirectObserved: true,
        redirectChain: [{ status: 303 }, { status: 307, targetPath: "/business", followupPath: "/business", followupMethod: "GET", followupState: "completed", followupStatus: 200 }],
      }),
      event({ method: "GET", path: "/business", status: 200, statusCategory: "2xx" }),
    ],
    afterPath: "/business",
    loadingObserved: true,
    errorSurfaceObserved: false,
  });
  assert.equal(outcome.authSubmissionStatus, 303);
  assert.equal(outcome.authHttpStatus, 303);
  assert.deepEqual(outcome.redirectStatuses, [303, 307]);
  assert.equal(outcome.followupNavigationStatus, 200);
  assert.equal(outcome.businessSurfaceReached, true);
  assert.equal(outcome.classification, "BUSINESS_SURFACE_REACHED");
});

test("pending non-critical assets do not block an observed business surface", () => {
  const outcome = classifyAuthenticationOutcome({
    beforeAuthDetected: true,
    afterAuthDetected: true,
    events: [
      event({ path: "/auth-entry", status: 303, statusCategory: "3xx" }),
      event({ method: "GET", resourceType: "document", path: "/business", status: 200, statusCategory: "2xx" }),
      event({ method: "GET", resourceType: "image", path: "/asset.svg", state: "pending", status: undefined }),
    ],
    afterPath: "/business",
    loadingObserved: true,
    errorSurfaceObserved: false,
    businessCandidateObserved: true,
    nextRecordedBusinessTargetVisible: true,
  });
  assert.equal(outcome.businessSurfaceReached, true);
  assert.equal(outcome.nextRecordedBusinessTargetVisible, true);
});

test("completed submission that remains on the auth surface is a navigation failure", () => {
  const outcome = classifyAuthenticationOutcome({
    beforeAuthDetected: true,
    afterAuthDetected: true,
    events: [event({ path: "/auth-entry", status: 303, statusCategory: "3xx" })],
    afterPath: "/auth-entry",
    loadingObserved: false,
    errorSurfaceObserved: false,
  });
  assert.equal(outcome.businessSurfaceReached, false);
  assert.equal(outcome.classification, "POST_AUTH_NAVIGATION_FAILURE");
});

test("a completed auth boundary cannot be reclassified by later business actions", () => {
  assert.equal(shouldClassifyAuthenticationBoundary({
    authDetectedBeforeAction: true,
    authenticationBoundaryCompleted: true,
    relevantNetworkObserved: true,
    unstableSurface: false,
    authErrorSurfaceObserved: false,
  }), false);
});

/**
 * FIRST_LOSS (jobId c1f475c0-7d36-48d8-ade8-19dc3e067a54): an unrelated business GET 400
 * (fetch/xhr in the same post-action network window) was miscast as AUTH_REJECTED merely because
 * a stale `beforeAuthDetected=true` made the classifier eligible at all -- `has4xx` had no
 * causality check against the actual auth boundary. Fixed: has4xx/has5xx only produce an auth
 * failure classification when `afterAuthDetected` (a real DOM scan) proves the user is still
 * observably on/back-on the auth surface.
 */
test("actual auth request 400 with the DOM still on the auth surface is AUTH_REJECTED", () => {
  const outcome = classifyAuthenticationOutcome({
    beforeAuthDetected: true,
    afterAuthDetected: true,
    events: [event({ status: 400, statusCategory: "4xx" })],
    afterPath: "/redacted",
    loadingObserved: false,
    errorSurfaceObserved: false,
  });
  assert.equal(outcome.classification, "AUTH_REJECTED");
});

test("an unrelated business request 400 after auth, with the DOM on a business surface, is NOT AUTH_REJECTED", () => {
  const outcome = classifyAuthenticationOutcome({
    beforeAuthDetected: true,
    afterAuthDetected: false,
    events: [event({ method: "GET", status: 400, statusCategory: "4xx", path: "/redacted-business" })],
    afterPath: "/redacted-business",
    loadingObserved: false,
    errorSurfaceObserved: false,
  });
  assert.notEqual(outcome.classification, "AUTH_REJECTED");
  assert.notEqual(outcome.classification, "AUTH_INFRASTRUCTURE_FAILURE");
});

test("stale beforeAuthDetected=true alone cannot produce AUTH_REJECTED without a corroborating afterAuthDetected DOM signal", () => {
  const outcome = classifyAuthenticationOutcome({
    beforeAuthDetected: true,
    afterAuthDetected: false,
    events: [event({ status: 400, statusCategory: "4xx" })],
    afterPath: "/redacted",
    loadingObserved: false,
    errorSurfaceObserved: false,
  });
  assert.notEqual(outcome.classification, "AUTH_REJECTED");
});

test("successful auth followed by a business 4xx still preserves that evidence in the returned outcome (authHttpStatus), without claiming an auth failure", () => {
  const outcome = classifyAuthenticationOutcome({
    beforeAuthDetected: true,
    afterAuthDetected: false,
    events: [event({ method: "GET", status: 400, statusCategory: "4xx", path: "/redacted-business" })],
    afterPath: "/redacted-business",
    loadingObserved: false,
    errorSurfaceObserved: false,
  });
  assert.equal(outcome.authHttpStatus, 400, "the business failure's own status must not be discarded, only not mislabeled as an auth failure");
  assert.notEqual(outcome.classification, "AUTH_REJECTED");
});

test("a real DOM auth-error banner still forces an auth failure even without a network 4xx (errorSurfaceObserved input is untouched)", () => {
  const outcome = classifyAuthenticationOutcome({
    beforeAuthDetected: true,
    afterAuthDetected: true,
    events: [event({ status: 200, statusCategory: "2xx" })],
    afterPath: "/redacted",
    loadingObserved: false,
    errorSurfaceObserved: true,
  });
  assert.notEqual(outcome.classification, "BUSINESS_SURFACE_REACHED");
});

/**
 * FIRST_LOSS (jobId c64971bc-0ee9-4d1f-8a45-c6546409fe26): the prior HTTP-causality fix was
 * insufficient because `afterAuthDetected` itself is a heuristic DOM scan that can false-positive
 * on a business form shaped like an identification/OTP gate -- exactly what happened here (a
 * business POST 200 + GET 400 after a structured-contract-owned "Depurar" click). The authoritative
 * signal that this action is NOT an auth action -- `structuredActionOwnsSurface`, the same
 * ownership check `tryAuthGateRecovery` already uses to suppress heuristic auth-input injection
 * (`recording_structured_contract_authority`) -- was never reused here. Fixed by making that same
 * signal gate `shouldClassifyAuthenticationBoundary` itself: eligibility is now denied outright
 * when the structured recording contract owns the current action.
 */
test("1/structuredOwnershipSuppresses. structuredActionOwnsSurface=true makes the boundary ineligible even with a heuristic gate + business error present", () => {
  assert.equal(shouldClassifyAuthenticationBoundary({
    authDetectedBeforeAction: true,
    authenticationBoundaryCompleted: false,
    relevantNetworkObserved: true,
    unstableSurface: false,
    authErrorSurfaceObserved: true,
    structuredActionOwnsSurface: true,
  }), false);
});

test("2/genuineAuthActionStillRejects. structuredActionOwnsSurface=false (a real auth step) is completely unaffected -- eligibility unchanged", () => {
  assert.equal(shouldClassifyAuthenticationBoundary({
    authDetectedBeforeAction: true,
    authenticationBoundaryCompleted: false,
    relevantNetworkObserved: true,
    unstableSurface: false,
    authErrorSurfaceObserved: true,
    structuredActionOwnsSurface: false,
  }), true);
});

test("3/heuristicAloneCannotOverrideOwnership. a heuristically-detected gate plus network activity alone is not enough once ownership says otherwise", () => {
  assert.equal(shouldClassifyAuthenticationBoundary({
    authDetectedBeforeAction: true,
    authenticationBoundaryCompleted: false,
    relevantNetworkObserved: true,
    unstableSurface: true,
    authErrorSurfaceObserved: true,
    structuredActionOwnsSurface: true,
  }), false);
});

test("4/omittedFieldRegression. omitting structuredActionOwnsSurface entirely preserves every pre-existing call site's behavior exactly", () => {
  assert.equal(shouldClassifyAuthenticationBoundary({
    authDetectedBeforeAction: true,
    authenticationBoundaryCompleted: false,
    relevantNetworkObserved: true,
    unstableSurface: false,
    authErrorSurfaceObserved: false,
  }), true);
});
