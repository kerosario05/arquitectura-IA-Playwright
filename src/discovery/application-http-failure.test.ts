import assert from "node:assert/strict";
import test from "node:test";
import type { SafeNetworkEvent } from "./case-discovery";
import { describeApplicationHttpFailure, detectApplicationHttpFailure } from "./application-http-failure";

function event(overrides: Partial<SafeNetworkEvent>): SafeNetworkEvent {
  return { method: "POST", resourceType: "fetch", path: "/api/turns/generate", state: "completed", status: 200, ...overrides };
}

test("kiosko 'Generar Turno': a 400 on the submit with no progress is an application failure", () => {
  // Shape copied from run preview-11d-2026-09-26T20-33-11, step 18.
  const failure = detectApplicationHttpFailure({
    events: [event({ status: 400, statusCategory: "4xx", durationMs: 17 })],
    routeChanged: false,
    nextTargetVisible: false,
  });
  assert.deepEqual(failure, { method: "POST", path: "/api/turns/generate", status: 400 });
  assert.equal(describeApplicationHttpFailure(failure!), "Falla del aplicativo: POST /api/turns/generate respondió HTTP 400");
});

test("a 5xx is an application failure too", () => {
  const failure = detectApplicationHttpFailure({ events: [event({ status: 503 })], routeChanged: false, nextTargetVisible: false });
  assert.equal(failure?.status, 503);
});

test("a rejected request is tolerated when the flow still advanced", () => {
  const events = [event({ path: "/api/telemetry", status: 500 })];
  assert.equal(detectApplicationHttpFailure({ events, routeChanged: true, nextTargetVisible: false }), undefined);
  assert.equal(detectApplicationHttpFailure({ events, routeChanged: false, nextTargetVisible: true }), undefined);
});

test("401/403 are left to the authentication boundary", () => {
  for (const status of [401, 403]) {
    assert.equal(detectApplicationHttpFailure({ events: [event({ status })], routeChanged: false, nextTargetVisible: false }), undefined);
  }
});

test("successful responses and non-API resources never count", () => {
  const events = [
    event({ status: 200 }),
    event({ resourceType: "document", path: "/", status: 404 }),
    event({ resourceType: "image", path: "/logo.png", status: 404 }),
    event({ state: "pending", status: undefined }),
  ];
  assert.equal(detectApplicationHttpFailure({ events, routeChanged: false, nextTargetVisible: false }), undefined);
});

test("the last rejected API call is reported", () => {
  const failure = detectApplicationHttpFailure({
    events: [event({ path: "/api/a", status: 422 }), event({ path: "/api/b", status: 400 })],
    routeChanged: false,
    nextTargetVisible: false,
  });
  assert.equal(failure?.path, "/api/b");
});
