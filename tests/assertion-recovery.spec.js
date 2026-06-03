"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const assertion_recovery_1 = require("../src/discovery/assertion-recovery");
function makeSnapshot(elements) {
    return {
        version: "1.0",
        url: "https://example.com",
        title: "Test Page",
        capturedAt: new Date().toISOString(),
        elements: elements.map((el, i) => ({
            id: `el-${i}`,
            type: "text",
            role: "generic",
            tagName: "span",
            text: el.text,
            label: el.label,
            name: el.name,
            placeholder: undefined,
            value: undefined,
            visible: true,
            enabled: true,
            candidateLocators: [],
            dataHints: [],
        })),
        summary: {
            totalElements: elements.length,
            buttons: 0,
            inputs: 0,
            links: 0,
            selects: 0,
            tables: 0,
            dialogs: 0,
            headings: 0,
        },
    };
}
function makeRouteProfile(aliases) {
    return {
        name: "test_profile",
        entry: [],
        aliases: aliases ?? {},
        intermediates: {},
        domainTerms: {},
        visibleControls: ["Volver", "Finalizar sesión", "Solicitar"],
        representativeFixture: {},
        notes: [],
    };
}
// ── attemptAssertionRecovery tests ──
(0, test_1.test)("assertion recovery finds accent-insensitive match", () => {
    const snapshot = makeSnapshot([{ text: "Préstamos personales" }]);
    const result = (0, assertion_recovery_1.attemptAssertionRecovery)(snapshot, "Prestamos personales");
    (0, test_1.expect)(result.recovered).toBe(true);
    (0, test_1.expect)(result.decision).toBe("recovered_accent_insensitive");
    (0, test_1.expect)(result.matchedText).toBe("Préstamos personales");
    (0, test_1.expect)(result.confidence).toBeGreaterThanOrEqual(0.85);
});
(0, test_1.test)("assertion recovery uses alias from routeProfile", () => {
    const snapshot = makeSnapshot([{ text: "USD" }]);
    const routeProfile = makeRouteProfile({
        dolares: ["Dólares", "USD", "Dólares estadounidenses"],
    });
    const result = (0, assertion_recovery_1.attemptAssertionRecovery)(snapshot, "dolares", { routeProfile });
    (0, test_1.expect)(result.recovered).toBe(true);
});
(0, test_1.test)("assertion recovery handles plural/singular variants", () => {
    const snapshot = makeSnapshot([{ text: "Tarjetas" }]);
    const result = (0, assertion_recovery_1.attemptAssertionRecovery)(snapshot, "Tarjetas");
    (0, test_1.expect)(result.recovered).toBe(true);
    (0, test_1.expect)(result.decision).toBe("recovered_accent_insensitive");
});
(0, test_1.test)("assertion recovery uses visibleControls", () => {
    const snapshot = makeSnapshot([{ text: "Volver" }]);
    const routeProfile = makeRouteProfile();
    const result = (0, assertion_recovery_1.attemptAssertionRecovery)(snapshot, "Volver", { routeProfile });
    (0, test_1.expect)(result.recovered).toBe(true);
});
(0, test_1.test)("assertion recovery handles conditional variants", () => {
    const snapshot = makeSnapshot([{ text: "No disponible" }]);
    const result = (0, assertion_recovery_1.attemptAssertionRecovery)(snapshot, "no está disponible");
    (0, test_1.expect)(result.recovered).toBe(true);
    (0, test_1.expect)(result.decision).toBe("recovered_conditional_variant");
});
(0, test_1.test)("assertion recovery returns not_recovered when no match", () => {
    const snapshot = makeSnapshot([{ text: "Something else" }]);
    const result = (0, assertion_recovery_1.attemptAssertionRecovery)(snapshot, "completely different text");
    (0, test_1.expect)(result.recovered).toBe(false);
    (0, test_1.expect)(result.decision).toBe("not_recovered");
    (0, test_1.expect)(result.recoveryAttempts.length).toBeGreaterThan(0);
});
// ── classifyAssertionImportance tests ──
(0, test_1.test)("classifyAssertionImportance: blocking when in title", () => {
    const importance = (0, assertion_recovery_1.classifyAssertionImportance)("Tarjetas de crédito", {
        scenarioTitle: "Visualizar Tarjetas de crédito",
    });
    (0, test_1.expect)(importance).toBe("blocking");
});
(0, test_1.test)("classifyAssertionImportance: blocking when in expectedResult", () => {
    const importance = (0, assertion_recovery_1.classifyAssertionImportance)("Préstamos personales", {
        expectedResult: "Se muestran Préstamos personales",
    });
    (0, test_1.expect)(importance).toBe("blocking");
});
(0, test_1.test)("classifyAssertionImportance: optional for conditional language", () => {
    const importance = (0, assertion_recovery_1.classifyAssertionImportance)("si está disponible");
    (0, test_1.expect)(importance).toBe("optional");
});
(0, test_1.test)("classifyAssertionImportance: optional for 'no está disponible'", () => {
    const importance = (0, assertion_recovery_1.classifyAssertionImportance)("no está disponible");
    (0, test_1.expect)(importance).toBe("optional");
});
(0, test_1.test)("classifyAssertionImportance: contextual for routeProfile labels", () => {
    const routeProfile = makeRouteProfile();
    const importance = (0, assertion_recovery_1.classifyAssertionImportance)("Volver", { routeProfile });
    (0, test_1.expect)(importance).toBe("contextual");
});
(0, test_1.test)("classifyAssertionImportance: contextual for secondary buttons when not primary objective", () => {
    const importance = (0, assertion_recovery_1.classifyAssertionImportance)("Solicitar", {
        scenarioTitle: "Visualizar detalle del producto",
        expectedResult: "Se muestra el detalle completo del producto",
        routeProfile: makeRouteProfile(),
    });
    (0, test_1.expect)(importance).toBe("contextual");
});
(0, test_1.test)("classifyAssertionImportance: blocking for secondary button when explicit objective", () => {
    const importance = (0, assertion_recovery_1.classifyAssertionImportance)("Solicitar", {
        scenarioTitle: "Solicitar producto",
        expectedResult: "Se debe poder Solicitar el producto",
        routeProfile: makeRouteProfile(),
    });
    (0, test_1.expect)(importance).toBe("blocking");
});
// ── detectConditionalAssertionRisk tests ──
(0, test_1.test)("detectConditionalAssertionRisk: high risk without dataRequirement", () => {
    const risk = (0, assertion_recovery_1.detectConditionalAssertionRisk)("no está disponible");
    (0, test_1.expect)(risk.isConditional).toBe(true);
    (0, test_1.expect)(risk.risk).toBe("high");
    (0, test_1.expect)(risk.reason).toContain("without_data_requirement");
});
(0, test_1.test)("detectConditionalAssertionRisk: low risk with dataRequirement", () => {
    const risk = (0, assertion_recovery_1.detectConditionalAssertionRisk)("no está disponible", {
        dataRequirement: "product must be unavailable",
    });
    (0, test_1.expect)(risk.isConditional).toBe(true);
    (0, test_1.expect)(risk.risk).toBe("low");
    (0, test_1.expect)(risk.reason).toContain("with_data_requirement");
});
(0, test_1.test)("detectConditionalAssertionRisk: not conditional for normal assertion", () => {
    const risk = (0, assertion_recovery_1.detectConditionalAssertionRisk)("Tarjetas de crédito");
    (0, test_1.expect)(risk.isConditional).toBe(false);
    (0, test_1.expect)(risk.risk).toBe("low");
});
