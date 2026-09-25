import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "@playwright/test";
import { PromotedSpecRuntime } from "./promoted-spec-runtime";

/**
 * FIRST_LOSS fix (recordingId=1f9415f3-...): physical evidence showed that after the timeout
 * microfix, a `session_expiring_warning` detection still attempted `safeReplayContext`'s
 * recorded-earlier-surface replay (e.g. re-clicking the landing page's own entry link) even
 * though the warning means the page NEVER LEFT the current screen -- it's a still-open countdown
 * dialog, not a reset back to the recorded flow's starting surface. That replay target provably
 * cannot exist on the current surface, so the attempt only ever burns the bounded action timeout
 * before failing anyway. `clickPromotedTarget` now recognizes this classification up front and
 * fails closed immediately with `session_expiring_warning_unrecoverable`, never attempting the
 * doomed replay, never touching the diagnostic patterns or the timeout itself.
 */

const APP_URL = "https://example.test/app";

function fakePage(visibleTexts: string[]): { page: Page; replayInvoked: boolean[] } {
  const replayInvoked: boolean[] = [];
  const notFound = {
    all: async () => [],
    filter() { return this; },
    count: async () => 0,
  };
  const page: any = {
    context: () => ({}),
    isClosed: () => false,
    url: () => APP_URL,
    goto: async () => undefined,
    waitForLoadState: async () => undefined,
    waitForTimeout: async () => undefined,
    on: () => undefined,
    title: async () => "",
    evaluate: async () => visibleTexts,
    locator: () => notFound,
  };
  return { page, replayInvoked };
}

function baseClickOptions(replayInvoked: boolean[]) {
  return {
    stepIndex: 6,
    target: "text:SMS",
    actionIntent: "click",
    expectedEffect: "ui_change" as const,
    technicalTargetRefs: ["text:SMS"],
    previousStepReplays: [
      {
        stepIndex: 1,
        actionIntent: "restore_recorded_context",
        target: 'css:[href="#empresarial"]',
        sensitive: false,
        replay: async () => { replayInvoked.push(true); },
      },
    ],
    action: async () => { throw new Error("action must never run when session reset is detected"); },
  };
}

test("1/sessionExpiringWarningFailsClosedWithoutReplay. session_expiring_warning never attempts safeReplayContext -- fails closed immediately with a distinct reason", async () => {
  process.env.APP_BASE_URL = APP_URL;
  process.env.EVIDENCE_ENABLED = "false";
  const { page, replayInvoked } = fakePage(["Sesión a punto de Expirar", "Su sesión alcanzó el límite máximo"]);
  const runtime = new PromotedSpecRuntime(page, { evidenceEnabled: false });

  await assert.rejects(
    () => runtime.clickPromotedTarget(baseClickOptions(replayInvoked) as any),
    (error: unknown) => error instanceof Error && error.message.startsWith("session_expiring_warning_unrecoverable:"),
  );
  assert.equal(replayInvoked.length, 0, "the recorded-earlier-surface replay must never be attempted for a session-expiring warning");
});

test("2/otherResetReasonsStillAttemptReplay. a genuine reset reason (unrelated to the expiry warning) still attempts the existing replay path -- regression guard", async () => {
  process.env.APP_BASE_URL = APP_URL;
  process.env.EVIDENCE_ENABLED = "false";
  const { page, replayInvoked } = fakePage(["Su sesión se cerró por inactividad"]);
  const runtime = new PromotedSpecRuntime(page, { evidenceEnabled: false });

  await assert.rejects(() => runtime.clickPromotedTarget(baseClickOptions(replayInvoked) as any));
  assert.equal(replayInvoked.length, 1, "a genuine already-reset classification must still attempt the existing replay path, unchanged");
});
