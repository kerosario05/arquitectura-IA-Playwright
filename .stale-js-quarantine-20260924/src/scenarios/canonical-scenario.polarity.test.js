"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const canonical_scenario_1 = require("./canonical-scenario");
(0, node_test_1.default)("explicit presence assertion is represented as positive", () => {
    strict_1.default.deepEqual((0, canonical_scenario_1.classifyAssertionPolarity)("se muestre la pantalla inicial"), {
        polarity: "positive",
        reason: "presence",
    });
});
(0, node_test_1.default)("explicit inactive-state assertion is represented as negative", () => {
    strict_1.default.deepEqual((0, canonical_scenario_1.classifyAssertionPolarity)("ya no sea la pantalla activa"), {
        polarity: "negative",
        reason: "absence",
    });
});
(0, node_test_1.default)("disappearance is negative without relying only on the word no", () => {
    strict_1.default.deepEqual((0, canonical_scenario_1.classifyAssertionPolarity)("el elemento debe desaparecer"), {
        polarity: "negative",
        reason: "absence",
    });
});
(0, node_test_1.default)("ordinary positive visibility is never inverted", () => {
    const result = (0, canonical_scenario_1.classifyAssertionPolarity)("el estado debe estar visible");
    strict_1.default.equal(result.polarity, "positive");
    strict_1.default.equal(result.reason, "presence");
});
(0, node_test_1.default)("ambiguous assertions fail closed without inventing polarity", () => {
    strict_1.default.deepEqual((0, canonical_scenario_1.classifyAssertionPolarity)("validar el estado actual"), {
        reason: "ambiguous",
    });
});
(0, node_test_1.default)("canonical requirement can carry polarity without losing existing fields", () => {
    const requirement = {
        requirementId: "fixture.assertion",
        kind: "navigation_transition",
        description: "fixture assertion",
        polarity: "negative",
        origin: { originRef: "fixture" },
    };
    strict_1.default.equal(requirement.kind, "navigation_transition");
    strict_1.default.equal(requirement.polarity, "negative");
    strict_1.default.equal(requirement.origin.originRef, "fixture");
});
(0, node_test_1.default)("canonical transition_blocked resolves to authoritative negative polarity", () => {
    strict_1.default.deepEqual((0, canonical_scenario_1.resolveCanonicalAssertionPolarity)({ intent: "transition_blocked", expectedState: "advance remains disabled" }), {
        polarity: "negative",
        reason: "structured_transition",
    });
});
(0, node_test_1.default)("canonical validation_present resolves to positive polarity", () => {
    strict_1.default.deepEqual((0, canonical_scenario_1.resolveCanonicalAssertionPolarity)({ intent: "validation_present", expectedState: "invalid state and message present" }), {
        polarity: "positive",
        reason: "structured_presence",
    });
});
(0, node_test_1.default)("canonical disabled state is positive state evidence, not a forbidden transition", () => {
    strict_1.default.deepEqual((0, canonical_scenario_1.resolveCanonicalAssertionPolarity)({ intent: "state_assertion", expectedState: "advance action is disabled" }), {
        polarity: "positive",
        reason: "structured_state",
    });
});
(0, node_test_1.default)("canonical absence remains negative", () => {
    strict_1.default.deepEqual((0, canonical_scenario_1.resolveCanonicalAssertionPolarity)({ intent: "state_assertion", expectedState: "the destination is absent" }), {
        polarity: "negative",
        reason: "absence",
    });
});
(0, node_test_1.default)("unknown canonical state remains unresolved", () => {
    strict_1.default.deepEqual((0, canonical_scenario_1.resolveCanonicalAssertionPolarity)({ intent: "state_assertion", expectedState: "the current state is acceptable" }), {
        reason: "ambiguous",
    });
});
