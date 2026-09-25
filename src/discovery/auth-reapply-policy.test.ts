import test from "node:test";
import assert from "node:assert/strict";
import { shouldReapplyAuthFields } from "./auth-reapply-policy";

test("active auth surface with rematerialized auth fields reapplies", () => {
  assert.equal(shouldReapplyAuthFields({
    authGateActive: true,
    authSurfacePresent: true,
    authAlreadySatisfied: false,
    rematerializationRelevant: true,
  }), true);
});

test("completed auth on a business surface skips reapply", () => {
  assert.equal(shouldReapplyAuthFields({
    authGateActive: false,
    authSurfacePresent: false,
    authAlreadySatisfied: true,
    rematerializationRelevant: false,
  }), false);
});

test("business DOM rematerialization without auth applicability skips reapply", () => {
  assert.equal(shouldReapplyAuthFields({
    authGateActive: false,
    authSurfacePresent: false,
    authAlreadySatisfied: true,
    rematerializationRelevant: true,
  }), false);
});

test("actual auth rematerialization remains eligible", () => {
  assert.equal(shouldReapplyAuthFields({
    authGateActive: true,
    authSurfacePresent: true,
    authAlreadySatisfied: false,
    rematerializationRelevant: true,
  }), true);
});

test("stale auth detection without a current auth surface does not reapply", () => {
  assert.equal(shouldReapplyAuthFields({
    authGateActive: true,
    authSurfacePresent: false,
    authAlreadySatisfied: false,
    rematerializationRelevant: true,
  }), false);
});
