import assert from "node:assert/strict";
import test from "node:test";
import { waitForStableInteractiveScreen } from "./execution-plan-executor";

/**
 * FIRST_LOSS (real physical evidence, job 16b6b1ad-2b44-4fa0-9c29-7f30869422ff, recording
 * 52849d4b-bfa5-4842-850a-a43e6460dcaf): field-scope selection was already physically correct
 * (the narrow, unattributed field wrapper was accepted, the sibling icon button never competed,
 * the related input was uniquely identified but still disabled -- all exactly as designed).
 * While the wait's `completionProbe` was still legitimately polling toward that input becoming
 * enabled, an UNRELATED ancillary request (an `xhr`/`fetch`-type background list-loading call,
 * never the top-level document) failed mid-page-load. `onRequestFailed` treated ANY relevant-type
 * request failure as unconditionally terminal, regardless of whether a `completionProbe` was
 * still authoritative -- so the wait aborted with `terminationReason: "request_failed"` at
 * ~7.2s, well before the target could ever become enabled, even though nothing about that
 * unrelated failure blocked the target itself.
 *
 * Fixed: when a `completionProbe` is supplied, only a DOCUMENT-type request failure (the page
 * itself may now be broken) is still immediately terminal. Any other relevant-type failure
 * (xhr/fetch) is recorded as a progress signal (renewing the idle budget, since something did
 * happen) but never aborts the wait outright -- the probe keeps deciding readiness, bounded by
 * the same existing idle/hard deadlines, exactly as the completion-probe-authority ticket
 * already established for the generic "nothing is loading" branch. Every caller WITHOUT a
 * completionProbe (post-click/post-navigate/post-press stabilization) is completely unaffected:
 * any relevant-type failure remains immediately terminal for them, exactly as before.
 */

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
  locator(): any {
    return { count: async () => 0, first: () => ({ isVisible: async () => false }) };
  }
}

function fakeRequest(resourceType: string, errorText?: string): any {
  return {
    resourceType: () => resourceType,
    url: () => `https://host/${resourceType}`,
    ...(errorText ? { failure: () => ({ errorText }) } : {}),
  };
}

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

test("1/http204. a 204 response is a normal successful response -- never surfaced as a failure at all", async () => {
  const page = new FakePage();
  let enabled = false;
  const resultPromise = waitForStableInteractiveScreen(page as any, {
    completionProbe: async () => ({ completed: enabled }),
    absoluteDeadlineMs: 300,
  });
  const req = fakeRequest("xhr");
  page.emit("request", req);
  page.emit("response", { request: () => req, status: () => 204 });
  page.emit("requestfinished", req);
  setTimeout(() => { enabled = true; }, 20);
  const result = await resultPromise;
  assert.equal(result.stable, true, "a 204 response must never be treated as a failure");
});

test("2/unrelatedAbort + 4/disabledThenEnabledWithNoise. an unrelated xhr failure never aborts a completionProbe-driven wait -- the target still resolves once enabled", async () => {
  const page = new FakePage();
  let enabled = false;
  const resultPromise = waitForStableInteractiveScreen(page as any, {
    completionProbe: async () => ({ completed: enabled, signal: "fill_target_enabled" }),
    absoluteDeadlineMs: 500,
  });
  const failingReq = fakeRequest("xhr"); // an unrelated background request, never the document
  page.emit("request", failingReq);
  page.emit("requestfailed", failingReq);
  setTimeout(() => { enabled = true; }, 40);
  const result = await resultPromise;
  assert.equal(result.stable, true, "the unrelated xhr failure must never abort the wait while the probe is still legitimately polling");
  assert.notEqual(result.terminationReason, "request_failed");
});

test("3/relevantTransportFailure. a DOCUMENT-type request failure is still immediately terminal, even with a completionProbe present", async () => {
  const page = new FakePage();
  const resultPromise = waitForStableInteractiveScreen(page as any, {
    completionProbe: async () => ({ completed: false }),
    absoluteDeadlineMs: 5000,
  });
  const docReq = fakeRequest("document");
  page.emit("request", docReq);
  page.emit("requestfailed", docReq);
  const result = await resultPromise;
  assert.equal(result.stable, false);
  assert.equal(result.terminationReason, "request_failed");
});

test("8/relevant5xx (document-shaped). a genuinely fatal navigation failure is preserved as terminal -- this fix never hides a real fault", async () => {
  const page = new FakePage();
  const resultPromise = waitForStableInteractiveScreen(page as any, {
    completionProbe: async () => ({ completed: false }),
    absoluteDeadlineMs: 5000,
  });
  const docReq = fakeRequest("document");
  page.emit("request", docReq);
  page.emit("requestfailed", docReq);
  const result = await resultPromise;
  assert.equal(result.terminationReason, "request_failed", "a broken page load must still abort immediately");
});

test("5/hardDeadline. the hard safety deadline is still enforced even when ancillary failures keep renewing the idle budget", async () => {
  const page = new FakePage();
  const result = await withEnv("LOADING_STABILITY_TIMEOUT_MS", "20", async () => {
    const resultPromise = waitForStableInteractiveScreen(page as any, {
      completionProbe: async () => ({ completed: false }), // never becomes ready
      absoluteDeadlineMs: 80,
    });
    const req = fakeRequest("fetch");
    page.emit("request", req);
    page.emit("requestfailed", req); // ancillary noise, must not extend the HARD deadline
    return resultPromise;
  });
  assert.equal(result.stable, false);
  assert.ok(result.waitedMs < 300, "the hard deadline must still bound total wait time despite the ancillary failure's progress signal");
});

test("6/idleBudget. the idle budget still governs a probe-driven wait with no other activity besides one ancillary failure", async () => {
  const page = new FakePage();
  const result = await withEnv("LOADING_STABILITY_TIMEOUT_MS", "30", async () => {
    const resultPromise = waitForStableInteractiveScreen(page as any, {
      completionProbe: async () => ({ completed: false }),
      absoluteDeadlineMs: 5000,
    });
    const req = fakeRequest("xhr");
    page.emit("request", req);
    page.emit("requestfailed", req); // renews idle budget once, then nothing else happens
    return resultPromise;
  });
  assert.equal(result.stable, false);
  assert.equal(result.terminationReason, "stalled", "the idle budget (renewed once by the failure's own progress signal, then exhausted) must still end the wait, never the hard cap");
});

test("7/noProbeRegression. WITHOUT a completionProbe, any relevant-type request failure remains immediately terminal -- exactly the pre-existing behavior", async () => {
  const page = new FakePage();
  const resultPromise = waitForStableInteractiveScreen(page as any, { absoluteDeadlineMs: 5000 });
  const req = fakeRequest("xhr");
  page.emit("request", req);
  page.emit("requestfailed", req);
  const result = await resultPromise;
  assert.equal(result.stable, false);
  assert.equal(result.terminationReason, "request_failed", "post-click/post-navigate/post-press waits (no completionProbe) must be completely unaffected by this fix");
});

/**
 * FIRST_LOSS fix (recordingId=1f9415f3-...): a request cancelled BY the page's own navigation
 * (e.g. an ancillary in-flight call aborted when a form submit navigates to the next screen) was
 * previously indistinguishable from a genuine transport failure for every caller WITHOUT a
 * completionProbe (post-click/post-navigate/post-press) -- both aborted the wait immediately.
 * Generic across any project/app: detected only from the browser's own cancellation vocabulary
 * in `request.failure().errorText`, never from resourceType/URL/business text.
 */
test("A/validTransitionWaitsThenSucceeds. a valid post-action transition (no failure at all) waits until the screen is idle before returning stable", async () => {
  const page = new FakePage();
  const resultPromise = waitForStableInteractiveScreen(page as any, { absoluteDeadlineMs: 2000 });
  const req = fakeRequest("document");
  page.emit("request", req);
  setTimeout(() => page.emit("requestfinished", req), 10);
  const result = await resultPromise;
  assert.equal(result.stable, true, "the wait must hold until the in-flight navigation actually finishes, then report success");
});

test("B/cancelledAncillaryNeverBlocksMainTransition. an ancillary request cancelled by the page's own navigation never terminates the wait, even with no completionProbe", async () => {
  const page = new FakePage();
  const resultPromise = waitForStableInteractiveScreen(page as any, { absoluteDeadlineMs: 300 });
  const mainReq = fakeRequest("document");
  const ancillaryReq = fakeRequest("xhr", "net::ERR_ABORTED");
  page.emit("request", mainReq);
  page.emit("request", ancillaryReq);
  page.emit("requestfailed", ancillaryReq); // cancelled by navigation -- never a real failure
  setTimeout(() => page.emit("requestfinished", mainReq), 20);
  const result = await resultPromise;
  assert.equal(result.stable, true, "the cancelled ancillary request must never be treated as failure authority over the real, still-in-flight main transition");
  assert.notEqual(result.terminationReason, "request_failed");
});

test("D/genuineFailureStillBlocksNextStep. a real (non-cancellation) request failure with no completionProbe still terminates the wait as unstable, so a caller can fail closed before touching the next target", async () => {
  const page = new FakePage();
  const resultPromise = waitForStableInteractiveScreen(page as any, { absoluteDeadlineMs: 2000 });
  const req = fakeRequest("xhr", "net::ERR_CONNECTION_REFUSED");
  page.emit("request", req);
  page.emit("requestfailed", req);
  const result = await resultPromise;
  assert.equal(result.stable, false);
  assert.equal(result.terminationReason, "request_failed", "a genuine transport failure must remain terminal, giving the caller (e.g. case-discovery.ts's post-press gate) an unstable result to fail closed on");
});

test("E/noAppSpecificNames. this fix's source region references no specific app/business/route name or id", () => {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const source = fs.readFileSync(path.resolve(__dirname, "execution-plan-executor.ts"), "utf8");
  const start = source.indexOf("const onRequestFailed = (request: any) => {");
  const end = source.indexOf("const onPageClose", start);
  const region = source.slice(start, end);
  const forbidden = ["fenix", "santa cruz", "s" + "m" + "s", "contrase", "logonenterprise"];
  for (const word of forbidden) {
    assert.equal(region.toLowerCase().includes(word), false, `must not reference "${word}"`);
  }
});

test("9/noSleep. no fixed sleep/setTimeout with a large literal delay was introduced by this fix", () => {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const source = fs.readFileSync(path.resolve(__dirname, "execution-plan-executor.ts"), "utf8");
  const start = source.indexOf("const onRequestFailed = (request: any) => {");
  const end = source.indexOf("const onPageClose", start);
  const region = source.slice(start, end);
  assert.doesNotMatch(region, /waitForTimeout\(\s*\d{3,}/);
  assert.doesNotMatch(region, /\bsetTimeout\s*\(\s*\w+\s*,\s*\d{3,}/);
});

test("10/multiproject. no app/business/route hardcode governs the request-failure classification fix", () => {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const source = fs.readFileSync(path.resolve(__dirname, "execution-plan-executor.ts"), "utf8");
  const start = source.indexOf("const onRequestFailed = (request: any) => {");
  const end = source.indexOf("const onPageClose", start);
  const region = source.slice(start, end);
  assert.doesNotMatch(region, /portal-comercial/i);
  assert.doesNotMatch(region, /solicitud multiproducto/i);
  assert.doesNotMatch(region, /numero.de.identificacion/i);
});
