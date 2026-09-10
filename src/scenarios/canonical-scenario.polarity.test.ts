import assert from "node:assert/strict";
import test from "node:test";
import { classifyAssertionPolarity, resolveCanonicalAssertionPolarity, type CanonicalRequirement } from "./canonical-scenario";

test("explicit presence assertion is represented as positive", () => {
  assert.deepEqual(classifyAssertionPolarity("se muestre la pantalla inicial"), {
    polarity: "positive",
    reason: "presence",
  });
});

test("explicit inactive-state assertion is represented as negative", () => {
  assert.deepEqual(classifyAssertionPolarity("ya no sea la pantalla activa"), {
    polarity: "negative",
    reason: "absence",
  });
});

test("disappearance is negative without relying only on the word no", () => {
  assert.deepEqual(classifyAssertionPolarity("el elemento debe desaparecer"), {
    polarity: "negative",
    reason: "absence",
  });
});

test("ordinary positive visibility is never inverted", () => {
  const result = classifyAssertionPolarity("el estado debe estar visible");
  assert.equal(result.polarity, "positive");
  assert.equal(result.reason, "presence");
});

test("ambiguous assertions fail closed without inventing polarity", () => {
  assert.deepEqual(classifyAssertionPolarity("validar el estado actual"), {
    reason: "ambiguous",
  });
});

test("canonical requirement can carry polarity without losing existing fields", () => {
  const requirement: CanonicalRequirement = {
    requirementId: "fixture.assertion",
    kind: "navigation_transition",
    description: "fixture assertion",
    polarity: "negative",
    origin: { originRef: "fixture" },
  };
  assert.equal(requirement.kind, "navigation_transition");
  assert.equal(requirement.polarity, "negative");
  assert.equal(requirement.origin.originRef, "fixture");
});

test("canonical transition_blocked resolves to authoritative negative polarity", () => {
  assert.deepEqual(resolveCanonicalAssertionPolarity({ intent: "transition_blocked", expectedState: "advance remains disabled" }), {
    polarity: "negative",
    reason: "structured_transition",
  });
});

test("canonical validation_present resolves to positive polarity", () => {
  assert.deepEqual(resolveCanonicalAssertionPolarity({ intent: "validation_present", expectedState: "invalid state and message present" }), {
    polarity: "positive",
    reason: "structured_presence",
  });
});

test("canonical disabled state is positive state evidence, not a forbidden transition", () => {
  assert.deepEqual(resolveCanonicalAssertionPolarity({ intent: "state_assertion", expectedState: "advance action is disabled" }), {
    polarity: "positive",
    reason: "structured_state",
  });
});

test("canonical absence remains negative", () => {
  assert.deepEqual(resolveCanonicalAssertionPolarity({ intent: "state_assertion", expectedState: "the destination is absent" }), {
    polarity: "negative",
    reason: "absence",
  });
});

test("unknown canonical state remains unresolved", () => {
  assert.deepEqual(resolveCanonicalAssertionPolarity({ intent: "state_assertion", expectedState: "the current state is acceptable" }), {
    reason: "ambiguous",
  });
});
