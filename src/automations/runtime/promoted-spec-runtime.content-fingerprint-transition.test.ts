import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "@playwright/test";
import { PromotedSpecRuntime } from "./promoted-spec-runtime";

/**
 * FIRST_LOSS fix (runId=preview-2026-09-24T19-08-48): physical evidence showed a click on a
 * recorded, uniquely-resolved target (SMS) genuinely transition the app to a new screen (an
 * OTP-sent confirmation with a "Reenviar codigo en ... segundos" countdown) -- no URL change
 * (SPA in-place transition), and no change to `signature` either, because `signature` only ever
 * covers a narrow interactive-control selector (button/a/input/h1-h6/etc.) -- plain rendered text
 * (the confirmation message, the countdown) never touches it. `postActionStability` reported
 * `no_observable_post_action_outcome` for an action that demonstrably had a real effect.
 *
 * `contentFingerprint` (the browser's own rendered `innerText`) is now an additional, equally
 * real signal: a change in EITHER `signature` or `contentFingerprint` counts as an observed
 * transition. Tests drive `postActionStability` directly (a private method, called the same way
 * `promoted-spec-runtime.test.ts` already accesses `ensureInitialNavigation`) via a fake page
 * whose `evaluate` returns a controllable snapshot sequence.
 */

function fakePageWithSnapshots(snapshots: any[]): Page {
  let call = 0;
  return {
    evaluate: async () => {
      const snapshot = snapshots[Math.min(call, snapshots.length - 1)];
      call += 1;
      return snapshot;
    },
    waitForTimeout: async () => undefined,
    url: () => snapshots[0].url,
    on: () => undefined,
    off: () => undefined,
  } as unknown as Page;
}

const BASE_SNAPSHOT = {
  url: "https://example.test/onlinebanking/IdentifyUser",
  signature: "button|sms|enabled/unchecked|valueFingerprint=0:0",
  targetVisible: true,
  surfaceCount: 1,
};

test("1/contentOnlyTransitionObservedWithoutUrlChange. a content-only in-place transition (same URL, same interactive-control signature, different rendered text) is recognized -- never reported as no_observable_post_action_outcome", async () => {
  const before = { ...BASE_SNAPSHOT, contentFingerprint: "10:111" };
  const after = { ...BASE_SNAPSHOT, contentFingerprint: "42:999" }; // rendered text changed, structural signature did not
  const page = fakePageWithSnapshots([after]); // capturePromotedActionSurfaceSnapshot is called once more, for "current"
  const runtime = new PromotedSpecRuntime(page, { evidenceEnabled: false, stabilityTimeoutMs: 500 } as any);
  // Only the transition-detection boundary is under test here; the follow-up UI-stability page
  // scan (a separate, already-GREEN boundary) is stubbed out rather than deep-mocking its own
  // Playwright surface.
  (runtime as any).waitForPromotedUiStable = async () => undefined;

  await assert.doesNotReject(
    () => (runtime as any).postActionStability(BASE_SNAPSHOT.url, "ui_change", undefined, before, "text:SMS"),
    "a genuine content-only transition must be accepted as an observed outcome",
  );
});

test("2/clickWithoutEffectStillFails. neither signature nor contentFingerprint nor route change -- still fails closed with no_observable_post_action_outcome (regression guard)", async () => {
  const before = { ...BASE_SNAPSHOT, contentFingerprint: "10:111" };
  const unchanged = { ...BASE_SNAPSHOT, contentFingerprint: "10:111" };
  const page = fakePageWithSnapshots([unchanged]);
  const runtime = new PromotedSpecRuntime(page, { evidenceEnabled: false, stabilityTimeoutMs: 200 } as any);

  await assert.rejects(
    () => (runtime as any).postActionStability(BASE_SNAPSHOT.url, "ui_change", undefined, before, "text:SMS"),
    (error: unknown) => error instanceof Error && error.message.includes("no_observable_post_action_outcome"),
    "a click with genuinely no observable effect must still fail closed, unchanged",
  );
});

test("3/routeChangeStillObserved. a real navigation (expectedEffect=navigation) still counts as an observed outcome -- regression guard, independent of the content fingerprint", async () => {
  const before = { ...BASE_SNAPSHOT, contentFingerprint: "10:111" };
  const navigated = { ...BASE_SNAPSHOT, url: "https://example.test/onlinebanking/Otp", contentFingerprint: "10:111" };
  const page = fakePageWithSnapshots([navigated]);
  const runtime = new PromotedSpecRuntime(page, { evidenceEnabled: false, stabilityTimeoutMs: 500 } as any);
  (runtime as any).waitForPromotedUiStable = async () => undefined;

  await assert.doesNotReject(
    () => (runtime as any).postActionStability(BASE_SNAPSHOT.url, "navigation", undefined, before, "text:SMS"),
  );
});
