/**
 * Tests for ordinal_selection Auto-POM integration
 * Verifies that ordinal selection steps generate reusable selectVisibleItemByOrdinal methods
 */

import { test, expect } from "@playwright/test";
import type { ExecutionPlan, ExecutionPlanStep } from "../src/types/execution-plan.types";
import { METHOD_INTENT_NAME_MAP, METHOD_INTENT_PARAMS } from "../src/types/pom-ownership";

function createOrdinalSelectionStep(index: number, target: string, ordinal: "first" | "second" | "third" | "last" = "first"): ExecutionPlanStep {
  return {
    index,
    action: "click",
    target: { strategy: "text", value: target, exact: false },
    description: `Step ${index}: ${target}`,
    locatorStrategy: "ordinal_selection",
    recoveryMetadata: {
      recoveredBy: "ordinal_selection" as const,
      ordinalSelectionDiagnostics: {
        selectionPatternDetected: true,
        ordinal,
        domainTerm: "tarjeta",
        domainTermSource: "routeProfile" as const,
        selectedCandidateText: "Tarjeta de Crédito",
        selectedCandidateId: "card-1"
      }
    }
  };
}

test.describe("ordinal_selection metadata persistence", () => {
  test("creates step with ordinalSelectionDiagnostics", () => {
    const step = createOrdinalSelectionStep(1, "la primera tarjeta visible del listado");
    
    expect(step.locatorStrategy).toBe("ordinal_selection");
    expect(step.recoveryMetadata?.recoveredBy).toBe("ordinal_selection");
    expect(step.recoveryMetadata?.ordinalSelectionDiagnostics?.selectionPatternDetected).toBe(true);
    expect(step.recoveryMetadata?.ordinalSelectionDiagnostics?.ordinal).toBe("first");
    expect(step.recoveryMetadata?.ordinalSelectionDiagnostics?.domainTerm).toBe("tarjeta");
  });

  test("creates step with different ordinals", () => {
    const ordinals: Array<{ ordinal: "first" | "second" | "third" | "last"; target: string }> = [
      { ordinal: "first", target: "la primera tarjeta visible" },
      { ordinal: "second", target: "la segunda tarjeta visible" },
      { ordinal: "third", target: "la tercera tarjeta visible" },
      { ordinal: "last", target: "la última tarjeta visible" }
    ];

    for (const { ordinal, target } of ordinals) {
      const step = createOrdinalSelectionStep(1, target, ordinal);
      expect(step.recoveryMetadata?.ordinalSelectionDiagnostics?.ordinal).toBe(ordinal);
    }
  });
});

test.describe("METHOD_INTENT_NAME_MAP", () => {
  test("includes select_visible_item_by_ordinal", () => {
    expect(METHOD_INTENT_NAME_MAP.select_visible_item_by_ordinal).toBe("selectVisibleItemByOrdinal");
  });

  test("includes expect_loaded mapping to expectLoaded", () => {
    expect(METHOD_INTENT_NAME_MAP.expect_loaded).toBe("expectLoaded");
  });

  test("select_visible_item_by_ordinal has correct params", () => {
    expect(METHOD_INTENT_PARAMS.select_visible_item_by_ordinal).toEqual(["ordinal", "domainTerm"]);
  });
});
