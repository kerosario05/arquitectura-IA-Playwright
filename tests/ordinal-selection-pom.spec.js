"use strict";
/**
 * Tests for ordinal_selection Auto-POM integration
 * Verifies that ordinal selection steps generate reusable selectVisibleItemByOrdinal methods
 */
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const pom_ownership_1 = require("../src/types/pom-ownership");
function createOrdinalSelectionStep(index, target, ordinal = "first") {
    return {
        index,
        action: "click",
        target: { strategy: "text", value: target, exact: false },
        description: `Step ${index}: ${target}`,
        locatorStrategy: "ordinal_selection",
        recoveryMetadata: {
            recoveredBy: "ordinal_selection",
            ordinalSelectionDiagnostics: {
                selectionPatternDetected: true,
                ordinal,
                domainTerm: "tarjeta",
                domainTermSource: "routeProfile",
                selectedCandidateText: "Tarjeta de Crédito",
                selectedCandidateId: "card-1"
            }
        }
    };
}
test_1.test.describe("ordinal_selection metadata persistence", () => {
    (0, test_1.test)("creates step with ordinalSelectionDiagnostics", () => {
        const step = createOrdinalSelectionStep(1, "la primera tarjeta visible del listado");
        (0, test_1.expect)(step.locatorStrategy).toBe("ordinal_selection");
        (0, test_1.expect)(step.recoveryMetadata?.recoveredBy).toBe("ordinal_selection");
        (0, test_1.expect)(step.recoveryMetadata?.ordinalSelectionDiagnostics?.selectionPatternDetected).toBe(true);
        (0, test_1.expect)(step.recoveryMetadata?.ordinalSelectionDiagnostics?.ordinal).toBe("first");
        (0, test_1.expect)(step.recoveryMetadata?.ordinalSelectionDiagnostics?.domainTerm).toBe("tarjeta");
    });
    (0, test_1.test)("creates step with different ordinals", () => {
        const ordinals = [
            { ordinal: "first", target: "la primera tarjeta visible" },
            { ordinal: "second", target: "la segunda tarjeta visible" },
            { ordinal: "third", target: "la tercera tarjeta visible" },
            { ordinal: "last", target: "la última tarjeta visible" }
        ];
        for (const { ordinal, target } of ordinals) {
            const step = createOrdinalSelectionStep(1, target, ordinal);
            (0, test_1.expect)(step.recoveryMetadata?.ordinalSelectionDiagnostics?.ordinal).toBe(ordinal);
        }
    });
});
test_1.test.describe("METHOD_INTENT_NAME_MAP", () => {
    (0, test_1.test)("includes select_visible_item_by_ordinal", () => {
        (0, test_1.expect)(pom_ownership_1.METHOD_INTENT_NAME_MAP.select_visible_item_by_ordinal).toBe("selectVisibleItemByOrdinal");
    });
    (0, test_1.test)("includes expect_loaded mapping to expectLoaded", () => {
        (0, test_1.expect)(pom_ownership_1.METHOD_INTENT_NAME_MAP.expect_loaded).toBe("expectLoaded");
    });
    (0, test_1.test)("select_visible_item_by_ordinal has correct params", () => {
        (0, test_1.expect)(pom_ownership_1.METHOD_INTENT_PARAMS.select_visible_item_by_ordinal).toEqual(["ordinal", "domainTerm"]);
    });
});
