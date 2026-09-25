import assert from "node:assert/strict";
import test from "node:test";
import { waitForStableInteractiveScreen } from "./execution-plan-executor";

/**
 * Physical evidence: Portal Comercial's post-login business surface kept a required field
 * (present but disabled while dependent data loaded) for ~6-8s — exactly LOADING_STABILITY_
 * TIMEOUT_MS's default idle window — even though ~120s of hard safety budget remained. The
 * wait loop only renewed its rolling idle deadline (AsyncOperationProgressLease) on tracked
 * network events; a purely DOM-visible loading signal (spinner/aria-busy/loading text/disabled
 * overlay) never did, so a continuously-loading screen with no NEW distinguishable network
 * event silently ran out its idle budget and returned stable=false well before the hard
 * deadline — "idle timeout" got treated as equivalent to "give up", not "keep watching".
 * Fixed: any DOM-detected loading signal now also renews the idle deadline, so the wait keeps
 * polling toward the hard budget for as long as loading evidence is actually still present.
 * Callers pass a target-specific `completionProbe` (already-existing option) to gate on the
 * NEXT required action's own readiness (present + visible + enabled) rather than "the whole
 * page went quiet".
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
  emit(name: string, value: any): void { this.listeners.get(name)?.forEach((listener) => listener(value)); }
  context(): any { return this.fakeContext; }
  async waitForTimeout(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(5, ms)));
  }
}

/** A page whose spinner clears once `enableAfterMs` has elapsed — simulates a required target
 *  becoming enabled after async dependency loading, without ever firing a tracked network event
 *  in between (the exact "DOM-only, no new request" gap this ticket closes). */
class DisabledUntilPage extends FakePage {
  private readonly startedAt = Date.now();
  constructor(private readonly enableAfterMs: number | null) {
    super();
  }
  get enabled(): boolean {
    return this.enableAfterMs !== null && Date.now() - this.startedAt >= this.enableAfterMs;
  }
  locator(selector: string): any {
    const isSpinnerSelector = selector.includes("spinner") || selector.includes("progressbar") || selector.includes("load");
    const spinnerVisible = !this.enabled;
    return {
      count: async () => isSpinnerSelector && spinnerVisible ? 1 : 0,
      first: () => ({ isVisible: async () => spinnerVisible }),
    };
  }
}

test("1. next target immediately enabled: readiness is reported without waiting for the idle window", async () => {
  const page = new DisabledUntilPage(0);
  const result = await withEnv("LOADING_STABILITY_TIMEOUT_MS", "8000", () =>
    waitForStableInteractiveScreen(page as any, {
      completionProbe: async () => ({ completed: page.enabled, signal: "next_target_enabled" }),
      absoluteDeadlineMs: 5000,
    }));
  assert.equal(result.stable, true);
  assert.ok(result.waitedMs < 500, "must not wait an idle window when already ready");
});

test("2/3. next target disabled, then becomes enabled after an async load with no new tracked request: continues only once enabled", async () => {
  const page = new DisabledUntilPage(60);
  const result = await withEnv("LOADING_STABILITY_TIMEOUT_MS", "20", () =>
    waitForStableInteractiveScreen(page as any, {
      completionProbe: async () => ({ completed: page.enabled, signal: "next_target_enabled" }),
      absoluteDeadlineMs: 5000,
    }));
  assert.equal(result.stable, true);
  assert.ok(result.waitedMs >= 60, "must not report ready before the target actually became enabled");
  assert.ok(page.enabled, "must only resolve once the target reports enabled=true");
});

test("4. spinner active with the idle window elapsed but hard budget remaining: never marked ready, keeps waiting", async () => {
  const page = new DisabledUntilPage(null); // never enables — a genuinely stuck screen
  const result = await withEnv("LOADING_STABILITY_TIMEOUT_MS", "20", () =>
    waitForStableInteractiveScreen(page as any, { absoluteDeadlineMs: 80 }));
  assert.equal(result.stable, false, "must never mark ready while the spinner is still visible");
  assert.ok(result.waitedMs >= 60, "must keep polling well past the idle window while loading evidence persists, not bail at ~20ms");
});

test("5. spinner active, then clears: the wait continues past the old idle window and succeeds", async () => {
  const page = new DisabledUntilPage(50);
  const result = await withEnv("LOADING_STABILITY_TIMEOUT_MS", "20", () =>
    waitForStableInteractiveScreen(page as any, { absoluteDeadlineMs: 5000 }));
  assert.equal(result.stable, true);
  assert.ok(result.waitedMs >= 50, "must have waited past the idle window for the spinner to actually clear");
});

test("6. hard timeout reached with the target still disabled: fails explicitly at the hard deadline, not the idle window", async () => {
  const page = new DisabledUntilPage(null);
  const result = await withEnv("LOADING_STABILITY_TIMEOUT_MS", "20", () =>
    waitForStableInteractiveScreen(page as any, { absoluteDeadlineMs: 70 }));
  assert.equal(result.stable, false);
  assert.ok(result.waitedMs >= 60, "the hard deadline (70ms), not the idle window (20ms), must govern when the wait gives up");
  assert.ok(result.hardSafetyDeadlineMs > 0);
});

test("9. a persistent websocket connection alone never counts as a pending relevant request", async () => {
  const page = new FakePage();
  const websocketRequest = { resourceType: () => "websocket", url: () => "wss://host/socket" };
  const resultPromise = waitForStableInteractiveScreen(page as any, { absoluteDeadlineMs: 200 });
  page.emit("request", websocketRequest); // opens and never finishes/fails — a real persistent socket
  const result = await resultPromise;
  assert.equal(result.relevantPendingRequests, 0, "an open websocket must never be counted as a blocking pending request");
});

test("10. portal-shaped fixture: identification-field resolver only starts once the field reports enabled=true, never on idle timeout alone", async () => {
  const page = new DisabledUntilPage(60); // dependency load finishes after the old idle window
  let resolverStarted = false;
  const readiness = await withEnv("LOADING_STABILITY_TIMEOUT_MS", "20", () =>
    waitForStableInteractiveScreen(page as any, {
      completionProbe: async () => ({ completed: page.enabled, signal: "identification_field_enabled" }),
      absoluteDeadlineMs: 5000,
    }));
  if (readiness.stable) resolverStarted = true;
  assert.equal(resolverStarted, true, "resolver must eventually start once readiness is genuinely reached");
  assert.ok(readiness.waitedMs >= 40, "must not have started before the field actually became enabled (i.e. not merely on the old ~20ms idle timeout)");
});
