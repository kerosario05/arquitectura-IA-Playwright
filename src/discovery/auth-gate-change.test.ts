import assert from "node:assert/strict";
import test from "node:test";
import { detectAuthGateChange, isNewSurfaceObserved } from "./case-discovery";
import type { AuthGateDetection } from "./auth-gate-detector";

function gate(overrides: Partial<AuthGateDetection>): AuthGateDetection {
  return {
    detected: false,
    gateType: "unknown",
    stage: "unknown",
    requiredInputs: [],
    confidence: 0,
    evidence: [],
    hasVirtualKeyboard: false,
    hasNativeInput: false,
    continueButtonPresent: false,
    ...overrides,
  };
}

test("a gate that was never present cannot change (false positive suppressed)", () => {
  assert.equal(detectAuthGateChange(gate({ detected: false }), gate({ detected: true, gateType: "classic_login", stage: "credentials" })), false);
  assert.equal(detectAuthGateChange(undefined, gate({ detected: true })), false);
});

test("a present gate that disappears is a real gate change", () => {
  assert.equal(detectAuthGateChange(gate({ detected: true, gateType: "classic_login", stage: "credentials" }), gate({ detected: false })), true);
});

test("a present gate whose type or stage changes is a real gate change", () => {
  assert.equal(
    detectAuthGateChange(gate({ detected: true, gateType: "classic_login", stage: "credentials" }), gate({ detected: true, gateType: "customer_identification_otp", stage: "identification_input" })),
    true,
  );
});

test("an unchanged present gate is not a change", () => {
  assert.equal(
    detectAuthGateChange(gate({ detected: true, gateType: "classic_login", stage: "credentials" }), gate({ detected: true, gateType: "classic_login", stage: "credentials" })),
    false,
  );
});

test("a URL change is a new surface even with an absent screen key", () => {
  assert.equal(isNewSurfaceObserved("/", undefined, "/product-catalog", undefined), true);
});

test("a structural screen key change on the same path is a new surface", () => {
  assert.equal(isNewSurfaceObserved("/", "k1", "/", "k2"), true);
});

test("an unchanged surface is not new", () => {
  assert.equal(isNewSurfaceObserved("/", "k1", "/", "k1"), false);
  assert.equal(isNewSurfaceObserved("/", undefined, "/", undefined), false);
});
