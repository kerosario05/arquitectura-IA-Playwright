import assert from "node:assert/strict";
import test from "node:test";
import { summarizeNavigationCausality, type NavigationCausalityEvent } from "./navigation-causality-observer";

let timestamp = 0;
const event = (eventType: string, urlBefore: string, urlAfter: string, extra: Partial<NavigationCausalityEvent> = {}): NavigationCausalityEvent => ({ timestamp: ++timestamp, eventType, urlBefore, urlAfter, ...extra });

test("history event identifies a client-caused route revert", () => {
  const summary = summarizeNavigationCausality([
    event("pushState", "/", "/product-catalog"),
    event("response_received", "/api/products", "/product-catalog", { status: 200, resourceType: "fetch" }),
    event("replaceState", "/product-catalog", "/"),
  ]);
  assert.equal(summary.historyReplaceStateCount, 1);
  assert.equal(summary.routeTransitions.at(-1)?.eventType, "replaceState");
  assert.equal(summary.routeTransitions.at(-1)?.urlAfter, "/");
  assert.equal(summary.firstEventAfterApiResponse?.eventType, "replaceState");
});

test("an oracle-like evidence record is not a navigation event", () => {
  const summary = summarizeNavigationCausality([
    event("response_received", "/api/products", "/", { status: 200 }),
    event("evidence_oracle_built", "/", "/"),
  ]);
  assert.equal(summary.routeTransitions.length, 0);
  assert.equal(summary.historyPushStateCount, 0);
  assert.equal(summary.historyReplaceStateCount, 0);
});
