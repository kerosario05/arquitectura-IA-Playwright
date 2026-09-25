import assert from "node:assert/strict";
import test from "node:test";
import { waitForStableInteractiveScreen } from "./execution-plan-executor";

/**
 * FIRST_LOSS: `waitForStableInteractiveScreen`'s generic "nothing is loading, no pending
 * requests" branch returned `stable: true, terminationReason: "stable"` UNCONDITIONALLY --
 * even on an iteration whose OWN `completionProbe()` call, made moments earlier in the SAME
 * loop tick, had just returned `completed: false`. Physical evidence (job
 * 095fefcf-51fa-463d-8d4a-b144439f2647): a recorded fill target (`Número de identificación`)
 * remained disabled while the target app finished loading unrelated dependent lists via
 * mechanisms that produce NO visible spinner/aria-busy/loading-text/pending-request signal on
 * the page at the exact poll instant (e.g. a client-side state update between two network
 * bursts) -- `screenStable=true, loadingSignal=false, relevantPendingRequests=0` while
 * `completionProbe=false`. `waitForFillTargetReadiness` then returned this false "success"
 * (`terminationReason: "stable"`) to its caller, which proceeded to fill the still-disabled
 * target and failed with `fill_target_not_editable` -- exactly reproducing the physical
 * `[fill-target-readiness] phase=result status=resolved resolutionStatus=fill_target_not_editable`
 * anomaly (a "resolved" wait paired with an unresolved fill status).
 *
 * None of `execution-plan-executor.next-action-readiness.test.ts`'s fixtures exercised this
 * exact gap: every one of them keeps a DOM-visible spinner active (`loadingDetected=true`)
 * for the entire disabled period, so the generic branch this bug lives in was never reached
 * before the probe turned true. This file's `QuietUntilPage` fixture is deliberately
 * spinner-less throughout -- the screen looks idle/settled from the FIRST poll, exactly
 * the shape that let the bug hide.
 *
 * Fixed: when a `completionProbe` is supplied, only `completion.completed === true` may ever
 * return `stable: true` -- the generic idle branch is skipped entirely for a probe-driven wait,
 * polling instead until the SAME existing idle deadline (renewed by any future real network
 * progress, unmodified) is reached, then reporting `stable: false, terminationReason: "stalled"`.
 * No new wait system, no fixed sleep, no duplicated status.
 */

async function withEnv<T>(name: string, value: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

class FakePage {
  private listeners = new Map<string, Set<(value: any) => void>>();
  private fakeContext = {
    on: (name: string, listener: (value: any) => void) => this.on(`context:${name}`, listener),
    off: (name: string, listener: (value: any) => void) => this.off(`context:${name}`, listener),
  };
  on(name: string, listener: (value: any) => void): void {
    const set = this.listeners.get(name) ?? new Set();
    set.add(listener);
    this.listeners.set(name, set);
  }
  off(name: string, listener: (value: any) => void): void { this.listeners.get(name)?.delete(listener); }
  context(): any { return this.fakeContext; }
  async waitForTimeout(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(5, ms)));
  }
  locator(): any {
    // Never a spinner/loading-text/aria-busy/disabled-overlay match -- the screen looks
    // perfectly quiet from the very first poll, exactly the gap this ticket closes.
    return { count: async () => 0, first: () => ({ isVisible: async () => false }) };
  }
}

/** A page whose target becomes actionable after `enableAfterMs`, with NO DOM loading signal
 *  and NO network activity ever observed -- the exact "quiet screen, unready target" shape. */
class QuietUntilPage extends FakePage {
  private readonly startedAt = Date.now();
  constructor(private readonly enableAfterMs: number | null) {
    super();
  }
  get enabled(): boolean {
    return this.enableAfterMs !== null && Date.now() - this.startedAt >= this.enableAfterMs;
  }
}

test("1/stableProbeFalse. a quiet screen (no spinner, no pending) with completionProbe=false is never reported stable", async () => {
  const page = new QuietUntilPage(null); // never enables
  const result = await withEnv("LOADING_STABILITY_TIMEOUT_MS", "30", () =>
    waitForStableInteractiveScreen(page as any, {
      completionProbe: async () => ({ completed: page.enabled }),
      absoluteDeadlineMs: 200,
    }));
  assert.equal(result.stable, false, "screenStable=true + loadingSignal=false + pendingRequests=0 + probe=false must never mean success");
});

test("2/noNetworkProbeFalse. relevantPendingRequests=0 and loadingSignal=false together are insufficient when a probe exists and says false", async () => {
  const page = new QuietUntilPage(null);
  const result = await withEnv("LOADING_STABILITY_TIMEOUT_MS", "30", () =>
    waitForStableInteractiveScreen(page as any, {
      completionProbe: async () => ({ completed: page.enabled }),
      absoluteDeadlineMs: 200,
    }));
  assert.equal(result.relevantPendingRequests, 0);
  assert.equal(result.stable, false);
});

test("3/probeEventuallyTrue. probe false -> false -> true: success only once true, never earlier", async () => {
  // A quiet screen never renews the idle deadline (no network/DOM progress signal at all in
  // this fixture), so the idle window itself must comfortably exceed the enable delay here --
  // unlike a loading-signal-driven wait, this state has no other renewal mechanism, by design
  // (see 6/neverEnabled for the case where the idle window is what correctly ends the wait).
  const page = new QuietUntilPage(40);
  const result = await withEnv("LOADING_STABILITY_TIMEOUT_MS", "300", () =>
    waitForStableInteractiveScreen(page as any, {
      completionProbe: async () => ({ completed: page.enabled, signal: "fill_target_enabled" }),
      absoluteDeadlineMs: 5000,
    }));
  assert.equal(result.stable, true);
  assert.ok(result.waitedMs >= 40, "must not report success before the probe actually turned true, despite the screen looking idle the whole time");
});

test("4/disabledSeveralPolls. the target stays disabled across many polls with a quiet screen: never fills, never reports success prematurely", async () => {
  const page = new QuietUntilPage(80);
  let pollCount = 0;
  const result = await withEnv("LOADING_STABILITY_TIMEOUT_MS", "300", () =>
    waitForStableInteractiveScreen(page as any, {
      completionProbe: async () => {
        pollCount += 1;
        return { completed: page.enabled };
      },
      absoluteDeadlineMs: 5000,
    }));
  assert.equal(result.stable, true);
  assert.ok(pollCount > 3, "expected multiple re-polls across the disabled period, never a single premature check");
});

test("5/disabledThenEnabled. the resolver picks up a fresh resolution once the SAME target flips disabled -> enabled", async () => {
  const page = new QuietUntilPage(50);
  const observedStates: boolean[] = [];
  const result = await withEnv("LOADING_STABILITY_TIMEOUT_MS", "300", () =>
    waitForStableInteractiveScreen(page as any, {
      completionProbe: async () => {
        observedStates.push(page.enabled);
        return { completed: page.enabled, signal: "fill_target_enabled" };
      },
      absoluteDeadlineMs: 5000,
    }));
  assert.equal(result.stable, true);
  assert.ok(observedStates.includes(false), "must have observed the disabled state at least once");
  assert.equal(observedStates.at(-1), true, "the final observation that ended the wait must be the fresh enabled resolution");
});

test("6/neverEnabled. a target that never becomes ready fails closed (stalled), not success, well before the hard deadline", async () => {
  const page = new QuietUntilPage(null);
  const result = await withEnv("LOADING_STABILITY_TIMEOUT_MS", "20", () =>
    waitForStableInteractiveScreen(page as any, {
      completionProbe: async () => ({ completed: page.enabled }),
      absoluteDeadlineMs: 5000,
    }));
  assert.equal(result.stable, false);
  assert.equal(result.terminationReason, "stalled");
  assert.ok(result.waitedMs < 5000, "must fail at the idle deadline, never wait out the full hard safety cap for a target that will never be ready");
});

test("7/spanCannotSatisfy. a probe permanently returning completed=false (simulating a label/span match, never a real fill target) can never satisfy readiness", async () => {
  const page = new QuietUntilPage(null);
  const result = await withEnv("LOADING_STABILITY_TIMEOUT_MS", "20", () =>
    waitForStableInteractiveScreen(page as any, {
      completionProbe: async () => ({ completed: false }),
      absoluteDeadlineMs: 200,
    }));
  assert.equal(result.stable, false);
});

test("8/enabledInitially. a target already enabled on the first poll incurs no additional latency", async () => {
  const page = new QuietUntilPage(0);
  const result = await withEnv("LOADING_STABILITY_TIMEOUT_MS", "8000", () =>
    waitForStableInteractiveScreen(page as any, {
      completionProbe: async () => ({ completed: page.enabled }),
      absoluteDeadlineMs: 5000,
    }));
  assert.equal(result.stable, true);
  assert.ok(result.waitedMs < 500, "must not wait an idle window when already ready");
});

test("9/noProbeRegression. without any completionProbe, a quiet screen still reports success exactly as before -- unaffected by this fix", async () => {
  const page = new QuietUntilPage(0);
  const result = await waitForStableInteractiveScreen(page as any, { absoluteDeadlineMs: 5000 });
  assert.equal(result.stable, true);
  assert.equal(result.terminationReason, "stable");
});

test("10/multiproject. no app/business/route hardcode governs the completion-probe authority fix", () => {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const source = fs.readFileSync(path.resolve(__dirname, "execution-plan-executor.ts"), "utf8");
  const start = source.indexOf("if (options?.completionProbe) {\n        const idleDeadlineReached");
  assert.ok(start >= 0, "expected the completion-probe-authority branch to exist");
  const region = source.slice(start, start + 700);
  assert.doesNotMatch(region, /portal-comercial/i);
  assert.doesNotMatch(region, /solicitud multiproducto/i);
  assert.doesNotMatch(region, /numero.de.identificacion/i);
  assert.doesNotMatch(region, /waitForTimeout\(\s*\d{3,}/, "no large fixed sleep introduced");
});
