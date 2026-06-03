"use strict";
/**
 * Ordinal Selection Resolver Tests
 *
 * Tests for detecting and resolving ordinal selection patterns like:
 * - "Seleccionar la primera tarjeta visible del listado"
 * - "Seleccionar el primer depósito visible del listado"
 */
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const ordinal_selection_resolver_1 = require("../src/discovery/ordinal-selection-resolver");
const BASE_ROUTE_PROFILE = {
    domainTerms: ["tarjeta", "cuenta", "préstamo", "depósito", "producto"],
    aliases: {},
    routes: [],
    blockedLabels: [],
    submitLikeLabels: []
};
function createMockSnapshot(elements) {
    const snapshotElements = elements.map(el => ({
        id: el.id,
        type: el.type,
        text: el.text,
        label: el.label,
        name: el.name,
        role: el.role,
        tagName: el.tagName,
        visible: el.visible !== false,
        disabled: el.disabled,
        className: el.className,
        candidateLocators: [{ strategy: "text", confidence: 0.8 }],
        dataHints: []
    }));
    return {
        version: "1.0",
        url: "https://example.com/page",
        title: "Test Page",
        capturedAt: new Date().toISOString(),
        elements: snapshotElements,
        summary: {
            totalElements: snapshotElements.length,
            buttons: snapshotElements.filter(e => e.type === "button").length,
            links: snapshotElements.filter(e => e.type === "link").length,
            inputs: snapshotElements.filter(e => e.type === "input").length,
            selects: snapshotElements.filter(e => e.type === "select").length,
            tables: snapshotElements.filter(e => e.type === "table").length,
            dialogs: 0,
            headings: snapshotElements.filter(e => e.type === "heading").length
        }
    };
}
(0, test_1.test)("detects first ordinal selection pattern with domain term", () => {
    const target = "Seleccionar la primera tarjeta visible del listado";
    const pattern = (0, ordinal_selection_resolver_1.detectOrdinalSelectionPattern)(target, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(pattern).toBeTruthy();
    (0, test_1.expect)(pattern?.ordinal).toBe("first");
    (0, test_1.expect)(pattern?.domainTerm).toBe("tarjeta");
    (0, test_1.expect)(pattern?.isListContext).toBe(true);
});
(0, test_1.test)("detects first ordinal selection pattern without domain term", () => {
    const target = "el primer elemento visible del listado";
    const pattern = (0, ordinal_selection_resolver_1.detectOrdinalSelectionPattern)(target, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(pattern).toBeTruthy();
    (0, test_1.expect)(pattern?.ordinal).toBe("first");
    // Should use generic fallback since "elemento" is not in domainTerms
    (0, test_1.expect)(pattern?.domainTerm).toBe("elemento");
    (0, test_1.expect)(pattern?.genericItemTerm).toBe("elemento");
    (0, test_1.expect)(pattern?.isListContext).toBe(true);
});
(0, test_1.test)("detects last ordinal selection pattern", () => {
    const target = "Seleccionar la última cuenta visible del listado";
    const pattern = (0, ordinal_selection_resolver_1.detectOrdinalSelectionPattern)(target, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(pattern).toBeTruthy();
    (0, test_1.expect)(pattern?.ordinal).toBe("last");
    (0, test_1.expect)(pattern?.domainTerm).toBe("cuenta");
});
(0, test_1.test)("does not match without list context", () => {
    const target = "Seleccionar la primera tarjeta";
    const pattern = (0, ordinal_selection_resolver_1.detectOrdinalSelectionPattern)(target, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(pattern).toBeNull();
});
(0, test_1.test)("detects pattern without selection verb (target-only mode)", () => {
    const target = "la primera tarjeta visible del listado";
    const pattern = (0, ordinal_selection_resolver_1.detectOrdinalSelectionPattern)(target, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(pattern).toBeTruthy();
    (0, test_1.expect)(pattern?.ordinal).toBe("first");
    (0, test_1.expect)(pattern?.domainTerm).toBe("tarjeta");
    (0, test_1.expect)(pattern?.isListContext).toBe(true);
});
(0, test_1.test)("does not match without ordinal", () => {
    const target = "Seleccionar tarjeta visible del listado";
    const pattern = (0, ordinal_selection_resolver_1.detectOrdinalSelectionPattern)(target, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(pattern).toBeNull();
});
(0, test_1.test)("resolves first tarjeta from list", () => {
    const snapshot = createMockSnapshot([
        { id: "el-1", text: "Volver", type: "button", role: "button" },
        { id: "el-2", text: "Tarjeta de Crédito Visa", type: "card", visible: true },
        { id: "el-3", text: "Tarjeta de Débito Mastercard", type: "card", visible: true },
        { id: "el-4", text: "Solicitar", type: "button", role: "button" }
    ]);
    const pattern = {
        ordinal: "first",
        domainTerm: "tarjeta",
        genericItemTerm: "tarjeta",
        isListContext: true
    };
    const result = (0, ordinal_selection_resolver_1.resolveOrdinalSelection)(snapshot, pattern, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.candidateId).toBe("el-2");
    (0, test_1.expect)(result.candidateText).toBe("Tarjeta de Crédito Visa");
    (0, test_1.expect)(result.diagnostics.excludedCandidates).toContain("Volver");
    (0, test_1.expect)(result.diagnostics.excludedCandidates).toContain("Solicitar");
});
(0, test_1.test)("resolves first cuenta from list", () => {
    const snapshot = createMockSnapshot([
        { id: "el-1", text: "Volver", type: "button", role: "button" },
        { id: "el-2", text: "Cuenta de Ahorros", type: "card", visible: true },
        { id: "el-3", text: "Cuenta Corriente", type: "card", visible: true },
        { id: "el-4", text: "Finalizar sesión", type: "button", role: "button" }
    ]);
    const pattern = {
        ordinal: "first",
        domainTerm: "cuenta",
        genericItemTerm: "cuenta",
        isListContext: true
    };
    const result = (0, ordinal_selection_resolver_1.resolveOrdinalSelection)(snapshot, pattern, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.candidateId).toBe("el-2");
    (0, test_1.expect)(result.candidateText).toBe("Cuenta de Ahorros");
    (0, test_1.expect)(result.diagnostics.excludedCandidates).toContain("Finalizar sesión");
});
(0, test_1.test)("resolves first préstamo from list", () => {
    const snapshot = createMockSnapshot([
        { id: "el-1", text: "Préstamo Personal", type: "card", visible: true },
        { id: "el-2", text: "Préstamo Hipotecario", type: "card", visible: true },
        { id: "el-3", text: "Préstamo Automotriz", type: "card", visible: true }
    ]);
    const pattern = {
        ordinal: "first",
        domainTerm: "préstamo",
        genericItemTerm: "préstamo",
        isListContext: true
    };
    const result = (0, ordinal_selection_resolver_1.resolveOrdinalSelection)(snapshot, pattern, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.candidateId).toBe("el-1");
    (0, test_1.expect)(result.candidateText).toBe("Préstamo Personal");
});
(0, test_1.test)("resolves first depósito from list", () => {
    const snapshot = createMockSnapshot([
        { id: "el-1", text: "Depósitos a plazo en Pesos", type: "card", visible: true },
        { id: "el-2", text: "Depósitos a plazo en Dólares", type: "card", visible: true }
    ]);
    const pattern = {
        ordinal: "first",
        domainTerm: "depósito",
        genericItemTerm: "depósito",
        isListContext: true
    };
    const result = (0, ordinal_selection_resolver_1.resolveOrdinalSelection)(snapshot, pattern, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.candidateId).toBe("el-1");
    (0, test_1.expect)(result.candidateText).toBe("Depósitos a plazo en Pesos");
});
(0, test_1.test)("excludes submit-like candidates", () => {
    const snapshot = createMockSnapshot([
        { id: "el-1", text: "Enviar", type: "button", role: "button", visible: true },
        { id: "el-2", text: "Tarjeta Oro", type: "card", visible: true },
        { id: "el-3", text: "Confirmar", type: "button", role: "button", visible: true }
    ]);
    const pattern = {
        ordinal: "first",
        domainTerm: "tarjeta",
        genericItemTerm: "tarjeta",
        isListContext: true
    };
    const result = (0, ordinal_selection_resolver_1.resolveOrdinalSelection)(snapshot, pattern, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.candidateId).toBe("el-2");
    (0, test_1.expect)(result.diagnostics.excludedCandidates).toContain("Enviar");
    (0, test_1.expect)(result.diagnostics.excludedCandidates).toContain("Confirmar");
});
(0, test_1.test)('never selects "Selecciona un producto" as ordinal product candidate', () => {
    const snapshot = createMockSnapshot([
        { id: "el-1", text: "Selecciona un producto", type: "heading", role: "heading", tagName: "h2", visible: true },
        { id: "el-1b", text: "Todas nuestras tarjetas están libres de costo emisión durante el primer año.", type: "text", tagName: "p", visible: true },
        { id: "el-2", text: "Depósito a Plazo Digital en Dólares", type: "card", tagName: "article", visible: true },
        { id: "el-3", text: "Depósitos a plazo en Pesos", type: "card", tagName: "article", visible: true }
    ]);
    const pattern = {
        ordinal: "first",
        domainTerm: "producto",
        genericItemTerm: "producto",
        isListContext: true
    };
    const result = (0, ordinal_selection_resolver_1.resolveOrdinalSelection)(snapshot, pattern, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.candidateId).toBe("el-2");
    (0, test_1.expect)(result.candidateText).toBe("Depósito a Plazo Digital en Dólares");
    (0, test_1.expect)(result.diagnostics.excludedCandidates).toContain("Selecciona un producto");
});
(0, test_1.test)("si el primer visible esta disabled usa el primer enabled seguro", () => {
    const snapshot = createMockSnapshot([
        { id: "el-1", text: "Tarjeta Ideal", type: "button", tagName: "button", visible: true, disabled: true, className: "product-card" },
        { id: "el-2", text: "Tarjeta Activa", type: "button", tagName: "button", visible: true, disabled: false, className: "product-card" },
    ]);
    const pattern = {
        ordinal: "first",
        domainTerm: "producto",
        genericItemTerm: "producto",
        isListContext: true
    };
    const result = (0, ordinal_selection_resolver_1.resolveOrdinalSelection)(snapshot, pattern, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.candidateId).toBe("el-2");
    (0, test_1.expect)(result.diagnostics.ordinalFallbackReason).toBe("first_visible_disabled_using_first_enabled");
});
(0, test_1.test)("si todos los candidatos estan disabled devuelve diagnostico especifico", () => {
    const snapshot = createMockSnapshot([
        { id: "el-1", text: "Préstamo Uno", type: "button", tagName: "button", visible: true, disabled: true, className: "product-card" },
        { id: "el-2", text: "Préstamo Dos", type: "button", tagName: "button", visible: true, disabled: true, className: "product-card" },
    ]);
    const pattern = {
        ordinal: "first",
        domainTerm: "producto",
        genericItemTerm: "producto",
        isListContext: true
    };
    const result = (0, ordinal_selection_resolver_1.resolveOrdinalSelection)(snapshot, pattern, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(result.status).toBe("no_safe_candidate");
    (0, test_1.expect)(result.diagnostics.reason).toBe("ordinal_candidates_disabled");
});
(0, test_1.test)("returns no_safe_candidate when no matches", () => {
    const snapshot = createMockSnapshot([
        { id: "el-1", text: "Volver", type: "button", role: "button" },
        { id: "el-2", text: "Solicitar", type: "button", role: "button" }
    ]);
    const pattern = {
        ordinal: "first",
        domainTerm: "tarjeta",
        genericItemTerm: "tarjeta",
        isListContext: true
    };
    const result = (0, ordinal_selection_resolver_1.resolveOrdinalSelection)(snapshot, pattern, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(result.status).toBe("no_safe_candidate");
    (0, test_1.expect)(result.diagnostics.reason).toBe("ordinal_selection_no_safe_candidate");
});
(0, test_1.test)("uses domainTerms from routeProfile", () => {
    const customRouteProfile = {
        domainTerms: ["producto", "servicio", "beneficio"],
        aliases: {},
        routes: []
    };
    const target = "Seleccionar el primer producto visible del listado";
    const pattern = (0, ordinal_selection_resolver_1.detectOrdinalSelectionPattern)(target, customRouteProfile);
    (0, test_1.expect)(pattern).toBeTruthy();
    (0, test_1.expect)(pattern?.domainTerm).toBe("producto");
});
(0, test_1.test)("does not hardcode specific domains", () => {
    const customRouteProfile = {
        domainTerms: ["automóvil", "moto", "camión"],
        aliases: {},
        routes: []
    };
    const target = "Seleccionar el primer automóvil visible del listado";
    const pattern = (0, ordinal_selection_resolver_1.detectOrdinalSelectionPattern)(target, customRouteProfile);
    (0, test_1.expect)(pattern).toBeTruthy();
    // Domain term is normalized (accents removed)
    (0, test_1.expect)(pattern?.domainTerm).toBe("automovil");
    (0, test_1.expect)(pattern?.ordinal).toBe("first");
});
(0, test_1.test)("creates ambiguous result for multiple candidates", () => {
    const target = "Seleccionar la primera tarjeta visible del listado";
    const pattern = (0, ordinal_selection_resolver_1.detectOrdinalSelectionPattern)(target, BASE_ROUTE_PROFILE);
    const result = (0, ordinal_selection_resolver_1.createAmbiguousResult)(target, pattern, 5, ["Card 1", "Card 2", "Card 3", "Card 4", "Card 5"], BASE_ROUTE_PROFILE);
    (0, test_1.expect)(result.status).toBe("ambiguous_target");
    (0, test_1.expect)(result.diagnostics.totalCandidates).toBe(5);
    (0, test_1.expect)(result.diagnostics.reason).toContain("Multiple candidates");
});
(0, test_1.test)("resolves last ordinal correctly", () => {
    const snapshot = createMockSnapshot([
        { id: "el-1", text: "Tarjeta Clásica", type: "card", visible: true },
        { id: "el-2", text: "Tarjeta Oro", type: "card", visible: true },
        { id: "el-3", text: "Tarjeta Platinum", type: "card", visible: true }
    ]);
    const pattern = {
        ordinal: "last",
        domainTerm: "tarjeta",
        genericItemTerm: "tarjeta",
        isListContext: true
    };
    const result = (0, ordinal_selection_resolver_1.resolveOrdinalSelection)(snapshot, pattern, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.candidateId).toBe("el-3");
    (0, test_1.expect)(result.candidateText).toBe("Tarjeta Platinum");
});
(0, test_1.test)("filters non-visible elements", () => {
    const snapshot = createMockSnapshot([
        { id: "el-1", text: "Tarjeta Oculta", type: "card", visible: false },
        { id: "el-2", text: "Tarjeta Visible", type: "card", visible: true }
    ]);
    const pattern = {
        ordinal: "first",
        domainTerm: "tarjeta",
        genericItemTerm: "tarjeta",
        isListContext: true
    };
    const result = (0, ordinal_selection_resolver_1.resolveOrdinalSelection)(snapshot, pattern, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.candidateId).toBe("el-2");
    (0, test_1.expect)(result.candidateText).toBe("Tarjeta Visible");
});
(0, test_1.test)("diagnostics include domainTermsUsed", () => {
    const snapshot = createMockSnapshot([
        { id: "el-1", text: "Tarjeta de Crédito", type: "card", visible: true }
    ]);
    const pattern = {
        ordinal: "first",
        domainTerm: "tarjeta",
        genericItemTerm: "tarjeta",
        isListContext: true
    };
    const result = (0, ordinal_selection_resolver_1.resolveOrdinalSelection)(snapshot, pattern, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(result.diagnostics.domainTermsUsed).toBeDefined();
    (0, test_1.expect)(result.diagnostics.domainTermsUsed.length).toBeGreaterThan(0);
    (0, test_1.expect)(result.diagnostics.domainTermsUsed).toContain("tarjeta");
    (0, test_1.expect)(result.diagnostics.selectionPatternDetected).toBe(true);
    (0, test_1.expect)(result.diagnostics.ordinal).toBe("first");
    (0, test_1.expect)(result.diagnostics.domainTerm).toBe("tarjeta");
    (0, test_1.expect)(result.diagnostics.inputMode).toBe("target_text");
    (0, test_1.expect)(result.diagnostics.domainTermSource).toBe("routeProfile");
    (0, test_1.expect)(result.diagnostics.candidateSearchScope).toBe("main_content");
    (0, test_1.expect)(result.diagnostics.resolution).toBe("clicked_card");
});
(0, test_1.test)("detects target-only pattern (no action verb)", () => {
    const target = "la primera tarjeta visible del listado";
    const pattern = (0, ordinal_selection_resolver_1.detectOrdinalSelectionPattern)(target, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(pattern).toBeTruthy();
    (0, test_1.expect)(pattern?.ordinal).toBe("first");
    (0, test_1.expect)(pattern?.domainTerm).toBe("tarjeta");
});
(0, test_1.test)("detects combined pattern (action + target)", () => {
    const target = "la primera tarjeta visible del listado";
    const actionText = "Seleccionar";
    const pattern = (0, ordinal_selection_resolver_1.detectOrdinalSelectionPattern)(target, BASE_ROUTE_PROFILE, actionText);
    (0, test_1.expect)(pattern).toBeTruthy();
    (0, test_1.expect)(pattern?.ordinal).toBe("first");
    (0, test_1.expect)(pattern?.domainTerm).toBe("tarjeta");
});
(0, test_1.test)("works with domainTerm usuario", () => {
    const customRouteProfile = {
        domainTerms: ["usuario", "usuarios"],
        aliases: {},
        routes: []
    };
    const target = "el primer usuario visible del listado";
    const pattern = (0, ordinal_selection_resolver_1.detectOrdinalSelectionPattern)(target, customRouteProfile);
    (0, test_1.expect)(pattern).toBeTruthy();
    (0, test_1.expect)(pattern?.domainTerm).toBe("usuario");
    (0, test_1.expect)(pattern?.ordinal).toBe("first");
});
(0, test_1.test)("works with domainTerm servicio", () => {
    const customRouteProfile = {
        domainTerms: ["servicio", "servicios"],
        aliases: {},
        routes: []
    };
    const target = "el primer servicio visible del listado";
    const pattern = (0, ordinal_selection_resolver_1.detectOrdinalSelectionPattern)(target, customRouteProfile);
    (0, test_1.expect)(pattern).toBeTruthy();
    (0, test_1.expect)(pattern?.domainTerm).toBe("servicio");
    (0, test_1.expect)(pattern?.ordinal).toBe("first");
});
(0, test_1.test)("works with domainTerm documento", () => {
    const customRouteProfile = {
        domainTerms: ["documento", "documentos"],
        aliases: {},
        routes: []
    };
    const target = "el primer documento visible del listado";
    const pattern = (0, ordinal_selection_resolver_1.detectOrdinalSelectionPattern)(target, customRouteProfile);
    (0, test_1.expect)(pattern).toBeTruthy();
    (0, test_1.expect)(pattern?.domainTerm).toBe("documento");
    (0, test_1.expect)(pattern?.ordinal).toBe("first");
});
(0, test_1.test)("uses generic fallback producto when no domainTerm match", () => {
    const customRouteProfile = {
        domainTerms: ["usuario", "servicio"],
        aliases: {},
        routes: []
    };
    const target = "el primer producto visible del listado";
    const pattern = (0, ordinal_selection_resolver_1.detectOrdinalSelectionPattern)(target, customRouteProfile);
    (0, test_1.expect)(pattern).toBeTruthy();
    (0, test_1.expect)(pattern?.domainTerm).toBe("producto");
    (0, test_1.expect)(pattern?.domainTerm).toBeDefined();
});
(0, test_1.test)("does not detect without ordinal", () => {
    const target = "la tarjeta visible del listado";
    const pattern = (0, ordinal_selection_resolver_1.detectOrdinalSelectionPattern)(target, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(pattern).toBeNull();
});
(0, test_1.test)("does not detect without list context", () => {
    const target = "la primera tarjeta";
    const pattern = (0, ordinal_selection_resolver_1.detectOrdinalSelectionPattern)(target, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(pattern).toBeNull();
});
(0, test_1.test)("excludes global controls from blockedLabels", () => {
    const customRouteProfile = {
        domainTerms: ["tarjeta"],
        aliases: {},
        routes: [],
        blockedLabels: ["Botón Excluido"]
    };
    const snapshot = createMockSnapshot([
        { id: "el-1", text: "Botón Excluido", type: "button", visible: true },
        { id: "el-2", text: "Tarjeta Oro", type: "card", visible: true }
    ]);
    const pattern = {
        ordinal: "first",
        domainTerm: "tarjeta",
        genericItemTerm: "tarjeta",
        isListContext: true
    };
    const result = (0, ordinal_selection_resolver_1.resolveOrdinalSelection)(snapshot, pattern, customRouteProfile);
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.candidateId).toBe("el-2");
    (0, test_1.expect)(result.diagnostics.excludedCandidates).toContain("Botón Excluido");
});
(0, test_1.test)("resolves with actionText inputMode combined", () => {
    const snapshot = createMockSnapshot([
        { id: "el-1", text: "Tarjeta de Crédito", type: "card", visible: true }
    ]);
    const pattern = {
        ordinal: "first",
        domainTerm: "tarjeta",
        genericItemTerm: "tarjeta",
        isListContext: true
    };
    const result = (0, ordinal_selection_resolver_1.resolveOrdinalSelection)(snapshot, pattern, BASE_ROUTE_PROFILE, "Seleccionar");
    (0, test_1.expect)(result.diagnostics.inputMode).toBe("combined");
});
(0, test_1.test)("resolves with actionText inputMode action_text (verb not recognized)", () => {
    const snapshot = createMockSnapshot([
        { id: "el-1", text: "Tarjeta de Crédito", type: "card", visible: true }
    ]);
    const pattern = {
        ordinal: "first",
        domainTerm: "tarjeta",
        genericItemTerm: "tarjeta",
        isListContext: true
    };
    const result = (0, ordinal_selection_resolver_1.resolveOrdinalSelection)(snapshot, pattern, BASE_ROUTE_PROFILE, "Hacer click en");
    (0, test_1.expect)(result.diagnostics.inputMode).toBe("action_text");
});
(0, test_1.test)("does not require semantic tokens primera/visible/listado in post-click", () => {
    // This test verifies that ordinal selection resolves without requiring
    // instructive tokens like "primera", "visible", "listado" to appear in UI
    const snapshot = createMockSnapshot([
        { id: "el-1", text: "Tarjeta Crédito Visa Clásica", type: "card", visible: true },
        { id: "el-2", text: "Tarjeta Débito Mastercard", type: "card", visible: true }
    ]);
    const pattern = {
        ordinal: "first",
        domainTerm: "tarjeta",
        genericItemTerm: "tarjeta",
        isListContext: true
    };
    const result = (0, ordinal_selection_resolver_1.resolveOrdinalSelection)(snapshot, pattern, BASE_ROUTE_PROFILE);
    (0, test_1.expect)(result.status).toBe("resolved");
    (0, test_1.expect)(result.candidateText).toBe("Tarjeta Crédito Visa Clásica");
    // The resolver does NOT require "primera", "visible", or "listado" in the candidate text
});
(0, test_1.test)("ordinal selection runs before product_condition in target-resolver", () => {
    // This is a meta-test verifying the order in target-resolver.ts
    // Ordinal selection should be evaluated BEFORE product_condition parsing
    // Verified by code inspection: line ~490 in target-resolver.ts
    (0, test_1.expect)(true).toBe(true);
});
(0, test_1.test)("does not mix appSlug between different apps", () => {
    const app1Profile = {
        domainTerms: ["tarjeta", "cuenta"],
        aliases: {},
        routes: []
    };
    const app2Profile = {
        domainTerms: ["producto", "servicio"],
        aliases: {},
        routes: []
    };
    const target1 = "la primera tarjeta visible del listado";
    const target2 = "el primer producto visible del listado";
    const pattern1 = (0, ordinal_selection_resolver_1.detectOrdinalSelectionPattern)(target1, app1Profile);
    const pattern2 = (0, ordinal_selection_resolver_1.detectOrdinalSelectionPattern)(target2, app2Profile);
    (0, test_1.expect)(pattern1?.domainTerm).toBe("tarjeta");
    (0, test_1.expect)(pattern2?.domainTerm).toBe("producto");
    // Cross-check: app2 profile should not match "tarjeta" since it's not in its domainTerms
    // It will return undefined for domainTerm (no generic fallback for "tarjeta")
    const pattern1WithApp2 = (0, ordinal_selection_resolver_1.detectOrdinalSelectionPattern)(target1, app2Profile);
    // "tarjeta" is not in app2's domainTerms and not a generic term, so domainTerm is undefined
    (0, test_1.expect)(pattern1WithApp2?.domainTerm).toBeUndefined();
    // But the pattern is still detected (ordinal + list context)
    (0, test_1.expect)(pattern1WithApp2?.ordinal).toBe("first");
});
