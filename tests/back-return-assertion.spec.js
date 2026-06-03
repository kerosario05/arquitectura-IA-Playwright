"use strict";
/**
 * Back/Return Assertion Matching Tests
 *
 * Tests for semantic matching of back/return assertions.
 * Verifies that "Volver al menú principal" can match "Volver al menú" or "Volver".
 */
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const assertion_resolver_1 = require("../src/discovery/assertion-resolver");
function createSnapshotWithButtons(buttonTexts) {
    const elements = buttonTexts.map((text, index) => ({
        id: `button-${index}`,
        type: "button",
        tagName: "button",
        role: "button",
        text,
        visible: true,
        candidateLocators: [{ strategy: "role", role: "button", name: text, confidence: 0.9 }],
        dataHints: []
    }));
    return {
        version: "1.0",
        url: "http://example.com/test",
        title: "Test Page",
        capturedAt: new Date().toISOString(),
        elements,
        summary: {
            totalElements: elements.length,
            inputs: 0,
            buttons: buttonTexts.length,
            links: 0,
            selects: 0,
            tables: 0,
            dialogs: 0,
            headings: 0
        }
    };
}
test_1.test.describe("Back/Return Assertion Matching", () => {
    (0, test_1.test)("Volver al menú principal matches Volver al menú", () => {
        const snapshot = createSnapshotWithButtons(["Volver al menú", "Inicio", "Solicitar"]);
        const assertionTargets = [
            {
                index: 0,
                action: "Validar que se muestre 'Volver al menú principal'",
                target: "Volver al menú principal",
                source: "action"
            }
        ];
        const results = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, assertionTargets);
        (0, test_1.expect)(results).toHaveLength(1);
        (0, test_1.expect)(results[0].status).toBe("passed");
        (0, test_1.expect)(results[0].matchedText).toBe("Volver al menú");
        (0, test_1.expect)(results[0].confidence).toBeGreaterThanOrEqual(0.8);
        (0, test_1.expect)(results[0].matchReason).toContain("alias");
        (0, test_1.expect)(results[0].originalTarget).toBe("Volver al menú principal");
        (0, test_1.expect)(results[0].matchedTarget).toBe("Volver al menú");
    });
    (0, test_1.test)("Volver al menú principal matches Volver", () => {
        const snapshot = createSnapshotWithButtons(["Volver", "Inicio", "Solicitar"]);
        const assertionTargets = [
            {
                index: 0,
                action: "Validar que se muestre 'Volver al menú principal'",
                target: "Volver al menú principal",
                source: "action"
            }
        ];
        const results = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, assertionTargets);
        (0, test_1.expect)(results).toHaveLength(1);
        (0, test_1.expect)(results[0].status).toBe("passed");
        (0, test_1.expect)(results[0].matchedText).toBe("Volver");
        (0, test_1.expect)(results[0].confidence).toBeGreaterThanOrEqual(0.7);
        (0, test_1.expect)(results[0].matchReason).toContain("alias");
    });
    (0, test_1.test)("Volver al listado de productos matches Volver", () => {
        const snapshot = createSnapshotWithButtons(["Volver", "Productos", "Detalle"]);
        const assertionTargets = [
            {
                index: 0,
                action: "Validar que se muestre 'Volver al listado de productos'",
                target: "Volver al listado de productos",
                source: "action"
            }
        ];
        const results = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, assertionTargets);
        (0, test_1.expect)(results).toHaveLength(1);
        (0, test_1.expect)(results[0].status).toBe("passed");
        (0, test_1.expect)(results[0].matchedText).toBe("Volver");
        (0, test_1.expect)(results[0].confidence).toBeGreaterThanOrEqual(0.7);
    });
    (0, test_1.test)("Regresar al inicio matches Regresar", () => {
        const snapshot = createSnapshotWithButtons(["Regresar", "Inicio", "Continuar"]);
        const assertionTargets = [
            {
                index: 0,
                action: "Validar que se muestre 'Regresar al inicio'",
                target: "Regresar al inicio",
                source: "action"
            }
        ];
        const results = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, assertionTargets);
        (0, test_1.expect)(results).toHaveLength(1);
        (0, test_1.expect)(results[0].status).toBe("passed");
        (0, test_1.expect)(results[0].matchedText).toBe("Regresar");
        (0, test_1.expect)(results[0].confidence).toBeGreaterThanOrEqual(0.7);
    });
    (0, test_1.test)("Non-back assertions do not use alias matching", () => {
        const snapshot = createSnapshotWithButtons(["Tarjetas", "Préstamos", "Depósitos"]);
        const assertionTargets = [
            {
                index: 0,
                action: "Validar que se muestre 'Tarjetas de Crédito'",
                target: "Tarjetas de Crédito",
                source: "action"
            }
        ];
        const results = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, assertionTargets);
        (0, test_1.expect)(results).toHaveLength(1);
        // "Tarjetas" matches via contains_match (not alias)
        (0, test_1.expect)(results[0].status).toBe("passed");
        (0, test_1.expect)(results[0].matchedText).toBe("Tarjetas");
        (0, test_1.expect)(results[0].matchReason).toBe("contains_match");
        // Should NOT have back/return diagnostics
        (0, test_1.expect)(results[0].originalTarget).toBeUndefined();
        (0, test_1.expect)(results[0].matchedTarget).toBeUndefined();
    });
    (0, test_1.test)("Exact match still works for back assertions", () => {
        const snapshot = createSnapshotWithButtons(["Volver al menú principal", "Inicio"]);
        const assertionTargets = [
            {
                index: 0,
                action: "Validar que se muestre 'Volver al menú principal'",
                target: "Volver al menú principal",
                source: "action"
            }
        ];
        const results = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, assertionTargets);
        (0, test_1.expect)(results).toHaveLength(1);
        (0, test_1.expect)(results[0].status).toBe("passed");
        (0, test_1.expect)(results[0].matchedText).toBe("Volver al menú principal");
        (0, test_1.expect)(results[0].confidence).toBe(1.0);
        (0, test_1.expect)(results[0].matchReason).toBe("exact_match");
    });
    (0, test_1.test)("Back assertion fails when no matching button exists", () => {
        const snapshot = createSnapshotWithButtons(["Solicitar", "Cancelar", "Cerrar"]);
        const assertionTargets = [
            {
                index: 0,
                action: "Validar que se muestre 'Volver al menú principal'",
                target: "Volver al menú principal",
                source: "action"
            }
        ];
        const results = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, assertionTargets);
        (0, test_1.expect)(results).toHaveLength(1);
        (0, test_1.expect)(results[0].status).toBe("failed");
        (0, test_1.expect)(results[0].confidence).toBeLessThan(0.6);
        // Should still include diagnostics about attempted aliases
        (0, test_1.expect)(results[0].assertionDiagnostics).toBeDefined();
    });
    (0, test_1.test)("Atrás matches back assertion", () => {
        const snapshot = createSnapshotWithButtons(["Atrás", "Siguiente"]);
        const assertionTargets = [
            {
                index: 0,
                action: "Validar que se muestre 'Volver'",
                target: "Volver",
                source: "action"
            }
        ];
        const results = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, assertionTargets);
        (0, test_1.expect)(results).toHaveLength(1);
        (0, test_1.expect)(results[0].status).toBe("passed");
        (0, test_1.expect)(results[0].matchedText).toBe("Atrás");
        (0, test_1.expect)(results[0].confidence).toBeGreaterThanOrEqual(0.7);
        (0, test_1.expect)(results[0].matchReason).toContain("alias");
    });
});
