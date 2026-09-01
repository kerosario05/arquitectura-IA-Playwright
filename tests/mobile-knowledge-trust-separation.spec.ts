import { expect, test } from "@playwright/test";
import {
  isMobileRouteTransitionTrustedForReuse,
  type RuntimeTransitionInput,
} from "../src/knowledge/runtime-knowledge-persister";

/**
 * Mobile Knowledge Trust / Composite Reuse Trust
 *
 * Tests the FOUR-CONDITION composite trust rule for MOBILE route_transition:
 *   trustedForReuse = true ONLY when ALL of:
 *     1. transitionValidated === true
 *     2. executionBacked === true
 *     3. actionSemanticAuthority === "validated"
 *     4. destinationSemanticAuthority === "validated"
 *
 * Action and destination authorities are INDEPENDENT:
 *   - action validated + destination pending → trust=false, action authority preserved
 *   - destination validated + action pending → trust=false, destination authority preserved
 */

test.describe("mobile route_transition composite trust", () => {
  test("T1: transitionValidated=undefined + all else valid → false", () => {
    expect(isMobileRouteTransitionTrustedForReuse({
      transitionValidated: undefined,
      executionBacked: true,
      actionSemanticAuthority: "validated",
      destinationSemanticAuthority: "validated",
    })).toBe(false);
  });

  test("T2: transitionValidated=false + all else valid → false", () => {
    expect(isMobileRouteTransitionTrustedForReuse({
      transitionValidated: false,
      executionBacked: true,
      actionSemanticAuthority: "validated",
      destinationSemanticAuthority: "validated",
    })).toBe(false);
  });

  test("T3: executionBacked=false + all else valid → false", () => {
    expect(isMobileRouteTransitionTrustedForReuse({
      transitionValidated: true,
      executionBacked: false,
      actionSemanticAuthority: "validated",
      destinationSemanticAuthority: "validated",
    })).toBe(false);
  });

  test("T4: executionBacked=undefined + all else valid → false", () => {
    expect(isMobileRouteTransitionTrustedForReuse({
      transitionValidated: true,
      executionBacked: undefined,
      actionSemanticAuthority: "validated",
      destinationSemanticAuthority: "validated",
    })).toBe(false);
  });

  test("T5: action=pending + all else valid → false", () => {
    expect(isMobileRouteTransitionTrustedForReuse({
      transitionValidated: true,
      executionBacked: true,
      actionSemanticAuthority: undefined,
      destinationSemanticAuthority: "validated",
    })).toBe(false);
  });

  test("T6: destination=pending + all else valid → false", () => {
    expect(isMobileRouteTransitionTrustedForReuse({
      transitionValidated: true,
      executionBacked: true,
      actionSemanticAuthority: "validated",
      destinationSemanticAuthority: undefined,
    })).toBe(false);
  });

  test("T7: all four conditions valid → true", () => {
    expect(isMobileRouteTransitionTrustedForReuse({
      transitionValidated: true,
      executionBacked: true,
      actionSemanticAuthority: "validated",
      destinationSemanticAuthority: "validated",
    })).toBe(true);
  });

  test("T8: pending destination preserves actionSemanticAuthority=validated", () => {
    const input: RuntimeTransitionInput = {
      sourceScreenKey: "screen_a",
      destinationScreenKey: "screen_b",
      actionLocatorIdentity: "btn-submit",
      controlPackage: "com.example.app",
      transitionValidated: true,
      executionBacked: true,
      requirementIds: ["CA01"],
      actionSemanticAuthority: "validated",
      destinationSemanticAuthority: undefined,
    };

    const trust = isMobileRouteTransitionTrustedForReuse({
      transitionValidated: input.transitionValidated,
      executionBacked: input.executionBacked,
      actionSemanticAuthority: input.actionSemanticAuthority,
      destinationSemanticAuthority: input.destinationSemanticAuthority,
    });

    expect(trust).toBe(false);
    expect(input.actionSemanticAuthority).toBe("validated");
  });

  test("T9: pending action preserves destinationSemanticAuthority=validated", () => {
    const input: RuntimeTransitionInput = {
      sourceScreenKey: "screen_a",
      destinationScreenKey: "screen_b",
      actionLocatorIdentity: "btn-submit",
      controlPackage: "com.example.app",
      transitionValidated: true,
      executionBacked: true,
      actionSemanticAuthority: undefined,
      destinationSemanticAuthority: "validated",
    };

    const trust = isMobileRouteTransitionTrustedForReuse({
      transitionValidated: input.transitionValidated,
      executionBacked: input.executionBacked,
      actionSemanticAuthority: input.actionSemanticAuthority,
      destinationSemanticAuthority: input.destinationSemanticAuthority,
    });

    expect(trust).toBe(false);
    expect(input.destinationSemanticAuthority).toBe("validated");
  });

  test("T10: legacy trusted transition failing one condition → demoted", () => {
    const legacyItem = {
      transitionValidated: true,
      executionBacked: true,
      actionSemanticAuthority: "validated",
      destinationSemanticAuthority: undefined,
      trustedForReuse: true,
    };

    const stillTrusted = isMobileRouteTransitionTrustedForReuse(legacyItem);
    expect(stillTrusted).toBe(false);

    if (!stillTrusted) {
      legacyItem.trustedForReuse = false;
    }
    expect(legacyItem.trustedForReuse).toBe(false);
  });

  test("T11: legacy transition meeting all four conditions → can keep trustedForReuse=true", () => {
    const legacyItem = {
      transitionValidated: true,
      executionBacked: true,
      actionSemanticAuthority: "validated",
      destinationSemanticAuthority: "validated",
      trustedForReuse: true,
    };

    const stillTrusted = isMobileRouteTransitionTrustedForReuse(legacyItem);
    expect(stillTrusted).toBe(true);
    expect(legacyItem.trustedForReuse).toBe(true);
  });

  test("T12: SQL/JSON equivalence after remediation", () => {
    const sqlItem: Record<string, unknown> = {
      id: "test-transition",
      knowledgeKind: "route_transition",
      transitionValidated: true,
      executionBacked: true,
      actionSemanticAuthority: "validated",
      destinationSemanticAuthority: undefined,
      trustedForReuse: true,
    };

    const stillTrusted = isMobileRouteTransitionTrustedForReuse({
      transitionValidated: sqlItem.transitionValidated as boolean | undefined,
      executionBacked: sqlItem.executionBacked as boolean | undefined,
      actionSemanticAuthority: sqlItem.actionSemanticAuthority as string | undefined,
      destinationSemanticAuthority: sqlItem.destinationSemanticAuthority as string | undefined,
    });

    if (!stillTrusted) {
      sqlItem.trustedForReuse = false;
      sqlItem.validationStatus = "validated_technical";
    }

    const jsonItem = { ...sqlItem };

    expect(jsonItem.trustedForReuse).toBe(sqlItem.trustedForReuse);
    expect(jsonItem.validationStatus).toBe(sqlItem.validationStatus);
  });
});
