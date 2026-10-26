import test from "node:test";
import assert from "node:assert/strict";
import { isTransientStatusTap } from "./canonical-recording-contract";

test("a tap on a non-interactive status/progress region is capture noise", () => {
  assert.equal(isTransientStatusTap({ role: "status", tag: "div" }), true);
  assert.equal(isTransientStatusTap({ role: "progressbar", tag: "span" }), true);
});

test("actionable elements and ordinary roles are never filtered", () => {
  assert.equal(isTransientStatusTap({ role: "status", tag: "button" }), false);
  assert.equal(isTransientStatusTap({ role: "button", tag: "div" }), false);
  assert.equal(isTransientStatusTap({ tag: "div" }), false);
  assert.equal(isTransientStatusTap(undefined), false);
});
