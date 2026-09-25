import assert from "node:assert/strict";
import test from "node:test";
import { classifyActionability, isFrameworkActionOwner } from "./actionability-contract";

test("native and semantic controls share the actionable contract", () => {
  assert.equal(classifyActionability({ tagName: "button" }), "NATIVE_ACTIONABLE");
  assert.equal(classifyActionability({ tagName: "div", role: "button" }), "SEMANTIC_ACTIONABLE");
});

test("framework control requires objective pointer evidence", () => {
  assert.equal(classifyActionability({
    tagName: "div",
    cursor: "pointer",
    pointerEvents: "auto",
    trustedInteraction: true,
  }), "FRAMEWORK_ACTIONABLE");
  assert.equal(classifyActionability({
    tagName: "div",
    cursor: "default",
    pointerEvents: "auto",
    trustedInteraction: true,
  }), "NON_ACTIONABLE");
});

test("stable framework identity and structured ancestors are accepted without text matching", () => {
  assert.equal(classifyActionability({
    tagName: "div",
    cursor: "pointer",
    pointerEvents: "auto",
    stableTechnicalIdentity: true,
  }), "FRAMEWORK_ACTIONABLE");
  assert.equal(classifyActionability({
    tagName: "span",
    cursor: "pointer",
    pointerEvents: "auto",
    structuredClickableAncestor: true,
  }), "FRAMEWORK_ACTIONABLE");
  assert.equal(classifyActionability({ tagName: "div", cursor: "default", trustedInteraction: true }), "NON_ACTIONABLE");
});

test("pointer-events none never becomes a framework candidate", () => {
  assert.equal(classifyActionability({
    tagName: "div",
    cursor: "pointer",
    pointerEvents: "none",
    trustedInteraction: true,
  }), "NON_ACTIONABLE");
});

test("inherited pointer affordance belongs to the outer framework owner", () => {
  assert.equal(isFrameworkActionOwner({
    actionability: "FRAMEWORK_ACTIONABLE",
    ancestorFrameworkActionable: false,
    explicitPointerCursor: false,
  }), true);
  assert.equal(isFrameworkActionOwner({
    actionability: "FRAMEWORK_ACTIONABLE",
    ancestorFrameworkActionable: true,
    explicitPointerCursor: false,
  }), false);
  assert.equal(isFrameworkActionOwner({
    actionability: "FRAMEWORK_ACTIONABLE",
    ancestorFrameworkActionable: true,
    explicitPointerCursor: true,
  }), true);
});
