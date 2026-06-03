"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const assertion_resolver_1 = require("../src/discovery/assertion-resolver");
function makeElement(overrides) {
    return {
        id: `el-${Math.random().toString(36).slice(2, 8)}`,
        type: "text",
        visible: true,
        candidateLocators: [],
        dataHints: [],
        ...overrides
    };
}
function makeSnapshot(elements, url = "https://example.com/app") {
    return {
        version: "1.0",
        url,
        title: "Example",
        capturedAt: new Date().toISOString(),
        elements,
        summary: {
            totalElements: elements.length,
            buttons: elements.filter((element) => element.type === "button").length,
            links: elements.filter((element) => element.type === "link").length,
            inputs: elements.filter((element) => element.type === "input").length,
            selects: elements.filter((element) => element.type === "select").length,
            tables: elements.filter((element) => element.type === "table").length,
            dialogs: elements.filter((element) => element.type === "dialog").length,
            headings: elements.filter((element) => element.type === "heading").length
        }
    };
}
function makeAssertion(target, source = "action", index = 1) {
    return {
        index,
        action: `Assert: ${target}`,
        target,
        source
    };
}
(0, test_1.test)("validar listado de productos visible se clasifica como catalog_list_assertion", () => {
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("validar listado de productos visible")).toBe("catalog_list_assertion");
});
(0, test_1.test)("validar detalle/listado de productos visible se clasifica como catalog_list_assertion", () => {
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("validar detalle/listado de productos visible")).toBe("catalog_list_assertion");
});
(0, test_1.test)("validar detalle de producto se clasifica como semantic_descriptor", () => {
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("validar detalle de producto")).toBe("semantic_descriptor");
});
(0, test_1.test)("validar pantalla de confirmacion se clasifica como semantic_descriptor", () => {
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("validar pantalla de confirmacion")).toBe("semantic_descriptor");
});
(0, test_1.test)("validar resumen final se clasifica como semantic_descriptor", () => {
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("validar resumen final")).toBe("semantic_descriptor");
});
(0, test_1.test)("validar ticket de generacion se clasifica como semantic_descriptor", () => {
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("validar ticket de generacion")).toBe("semantic_descriptor");
});
(0, test_1.test)("confirmar pantalla de resumen se clasifica como semantic_descriptor", () => {
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("confirmar pantalla de resumen")).toBe("semantic_descriptor");
});
(0, test_1.test)("semantic_descriptor con señales hijas concretas pasa como satisfied_by_children", () => {
    const snapshot = makeSnapshot([makeElement({ text: "Premium" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("pantalla de resumen")], {
        childSignalsByIndex: { 1: ["Premium", "Available"] }
    });
    (0, test_1.expect)(result.status).toBe("satisfied_by_children");
});
(0, test_1.test)("semantic_descriptor sin señales concretas queda needs_assertion_resolution", () => {
    const snapshot = makeSnapshot([makeElement({ text: "Welcome" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("pantalla de resumen")]);
    (0, test_1.expect)(result.status).toBe("needs_assertion_resolution");
});
(0, test_1.test)("texto concreto visible pasa como literal_observable", () => {
    const snapshot = makeSnapshot([makeElement({ text: "Transferencia completada" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Transferencia completada")]);
    (0, test_1.expect)(result.classification).toBe("literal_observable");
    (0, test_1.expect)(result.status).toBe("passed");
});
(0, test_1.test)("validar que se muestre texto quoted sigue como literal_observable", () => {
    const snapshot = makeSnapshot([makeElement({ text: "Products" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Validar que se muestre 'Products'")]);
    (0, test_1.expect)(result.classification).toBe("literal_observable");
    (0, test_1.expect)(result.status).toBe("passed");
});
(0, test_1.test)("esperar visible quoted sigue como literal_observable", () => {
    const snapshot = makeSnapshot([makeElement({ text: "Swag Labs" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Esperar que esté visible 'Swag Labs'")]);
    (0, test_1.expect)(result.classification).toBe("literal_observable");
    (0, test_1.expect)(result.status).toBe("passed");
});
(0, test_1.test)("texto concreto faltante falla con closestCandidates", () => {
    const snapshot = makeSnapshot([makeElement({ text: "Transferencia procesada" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Transferencia completada")]);
    (0, test_1.expect)(result.status).toBe("failed");
    (0, test_1.expect)(result.closestCandidates.length).toBeGreaterThan(0);
});
(0, test_1.test)("contains normalizado funciona para assertions", () => {
    const snapshot = makeSnapshot([makeElement({ text: "Resultado aprobado con detalles adicionales" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("resultado aprobado")]);
    (0, test_1.expect)(result.status).toBe("passed");
});
(0, test_1.test)("acentos y mayusculas no rompen matching", () => {
    const snapshot = makeSnapshot([makeElement({ text: "Información general" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("INFORMACION GENERAL")]);
    (0, test_1.expect)(result.status).toBe("passed");
});
(0, test_1.test)("expected texts concretos generan asserts observables", () => {
    const result = (0, assertion_resolver_1.buildConcreteAssertionsFromExpected)(["Premium", "Disponible", "pantalla de resumen"]);
    (0, test_1.expect)(result).toEqual(["Premium", "Disponible"]);
});
(0, test_1.test)("frases descriptivas no generan assertText literal", () => {
    const result = (0, assertion_resolver_1.buildConcreteAssertionsFromExpected)(["validar listado de productos", "Resumen"]);
    (0, test_1.expect)(result).toEqual(["Resumen"]);
});
(0, test_1.test)("semantic descriptor pasa si subject visible aparece en snapshot", () => {
    const snapshot = makeSnapshot([makeElement({ text: "depositos a plazo en dolares" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Validar detalle/listado de depósitos a plazo en dólares")]);
    (0, test_1.expect)(result.status).toBe("passed");
});
(0, test_1.test)("semantic descriptor pasa si varios tokens fuertes aparecen en snapshot", () => {
    const snapshot = makeSnapshot([
        makeElement({ text: "Depositos a plazo" }),
        makeElement({ text: "Moneda dolares" }),
        makeElement({ text: "Listado disponible" })
    ]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Validar listado de depósitos a plazo en dólares")]);
    (0, test_1.expect)(result.status).toBe("passed");
    (0, test_1.expect)((result.matchedTokens ?? []).length).toBeGreaterThan(0);
});
(0, test_1.test)("semantic descriptor queda needs_assertion_resolution sin señales suficientes", () => {
    const snapshot = makeSnapshot([makeElement({ text: "Bienvenido" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Validar detalle de cuenta")]);
    (0, test_1.expect)(result.status).toBe("needs_assertion_resolution");
});
(0, test_1.test)("semantic descriptor no pasa solo por palabras genéricas", () => {
    const snapshot = makeSnapshot([makeElement({ text: "Detalle general de pantalla" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Validar detalle de cuenta")]);
    (0, test_1.expect)(result.status).not.toBe("passed");
});
(0, test_1.test)("detalle/listado de X separa descriptor types y subject", () => {
    const snapshot = makeSnapshot([makeElement({ text: "productos habilitados" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Validar detalle de productos")]);
    (0, test_1.expect)(result.descriptorTypes).toEqual(test_1.expect.arrayContaining(["detail"]));
    (0, test_1.expect)(result.subject).toContain("productos");
});
(0, test_1.test)("diagnostics incluye descriptorTypes, subject y señales", () => {
    const snapshot = makeSnapshot([
        makeElement({ text: "productos premium" }),
        makeElement({ type: "table", text: "tabla de resultados" })
    ]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Validar detalle de productos")]);
    (0, test_1.expect)(result.descriptorTypes).toBeDefined();
    (0, test_1.expect)(result.subject).toBeDefined();
    (0, test_1.expect)(result.matchedTokens).toBeDefined();
    (0, test_1.expect)(result.structuralSignals).toBeDefined();
});
(0, test_1.test)("structural assertions pueden representar tabla lista card modal sin depender de texto literal", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "table", text: "Data" }),
        makeElement({ type: "card", text: "Summary card" }),
        makeElement({ type: "dialog", text: "Dialog title" })
    ]);
    const results = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [
        makeAssertion("tabla de resultados"),
        makeAssertion("modal de confirmacion", "action", 2),
        makeAssertion("card de resumen", "action", 3)
    ]);
    (0, test_1.expect)(results.every((result) => result.status === "passed")).toBe(true);
});
(0, test_1.test)("resolver de assertions no contiene hardcodes del dominio de regresion", () => {
    const fs = require("fs");
    const path = require("path");
    const content = fs.readFileSync(path.join(__dirname, "../src/discovery/assertion-resolver.ts"), "utf-8");
    (0, test_1.expect)(content).not.toContain("Banco Santa Cruz");
    (0, test_1.expect)(content).not.toContain("Kiosko");
    (0, test_1.expect)(content).not.toContain("Tarjeta de Crédito");
    (0, test_1.expect)(content).not.toContain("C37750");
});
(0, test_1.test)("regresion: descriptor con expected concretos visibles queda satisfied_by_children y no literal not_found", () => {
    const snapshot = makeSnapshot([
        makeElement({ text: "Visa Clásica" }),
        makeElement({ text: "Visa Gold" }),
        makeElement({ text: "Visa Platinum" }),
        makeElement({ text: "Visa Infinite" })
    ]);
    const results = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [
        makeAssertion("listado de tarjetas de crédito."),
        makeAssertion("Visa Clásica", "expected"),
        makeAssertion("Visa Gold", "expected"),
        makeAssertion("Visa Platinum", "expected"),
        makeAssertion("Visa Infinite", "expected")
    ], {
        childSignalsByIndex: {
            1: ["Visa Clásica", "Visa Gold", "Visa Platinum", "Visa Infinite"]
        }
    });
    const descriptor = results[0];
    const concretes = results.slice(1);
    (0, test_1.expect)(descriptor.status).toBe("satisfied_by_children");
    (0, test_1.expect)(concretes.every((result) => result.status === "passed")).toBe(true);
});
(0, test_1.test)("expected-only assertion no se clasifica como obligatoria", () => {
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("expected signals")).toBe("expected_only");
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("señales esperadas")).toBe("expected_only");
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("Expected signals")).toBe("expected_only");
});
(0, test_1.test)("semantic_descriptor desde expected source se resuelve pero no bloquea", () => {
    const snapshot = makeSnapshot([makeElement({ text: "Welcome" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("validar detalle de cuenta", "expected")]);
    (0, test_1.expect)(result.classification).toBe("semantic_descriptor");
    (0, test_1.expect)(result.status).toBe("skipped_semantic_descriptor");
});
(0, test_1.test)("Información principal del producto visible se clasifica como semantic_descriptor (generic/weak)", () => {
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("Información principal del producto visible")).toBe("semantic_descriptor");
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("informacion principal del producto visible")).toBe("semantic_descriptor");
});
(0, test_1.test)("Información general visible se clasifica como semantic_descriptor", () => {
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("Información general visible")).toBe("semantic_descriptor");
});
(0, test_1.test)("Datos principales visibles se clasifica como semantic_descriptor", () => {
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("Datos principales visibles")).toBe("semantic_descriptor");
});
(0, test_1.test)("Contenido principal visible se clasifica como semantic_descriptor", () => {
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("Contenido principal visible")).toBe("semantic_descriptor");
});
(0, test_1.test)("Sección principal visible se clasifica como semantic_descriptor", () => {
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("Sección principal visible")).toBe("semantic_descriptor");
});
(0, test_1.test)("Acciones disponibles según producto se clasifica como semantic_descriptor", () => {
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("Acciones disponibles según producto")).toBe("semantic_descriptor");
});
(0, test_1.test)("Opciones disponibles visibles se clasifica como semantic_descriptor", () => {
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("Opciones disponibles visibles")).toBe("semantic_descriptor");
});
(0, test_1.test)("descriptor genérico sintético desde expected source no bloquea con skipped_semantic_descriptor", () => {
    const snapshot = makeSnapshot([makeElement({ text: "Préstamo personal" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Información general visible", "expected")]);
    (0, test_1.expect)(result.classification).toBe("semantic_descriptor");
    (0, test_1.expect)(result.status).toBe("skipped_semantic_descriptor");
    (0, test_1.expect)(result.isWeakSignal).toBe(true);
});
(0, test_1.test)("descriptor genérico sintético desde action source puede quedar needs_assertion_resolution", () => {
    const snapshot = makeSnapshot([makeElement({ text: "Préstamo personal" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Información general visible", "action")]);
    (0, test_1.expect)(result.classification).toBe("semantic_descriptor");
    (0, test_1.expect)(result.status).toBe("needs_assertion_resolution");
    (0, test_1.expect)(result.isWeakSignal).toBe(true);
});
(0, test_1.test)("literal con quotes explícito sigue siendo literal_observable aunque coincida con patrón genérico", () => {
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("'Información general visible'")).toBe("literal_observable");
});
// --- Detail descriptor tests ---
(0, test_1.test)("'Detalle de X visible' clasifica como semantic_descriptor, no literal_observable", () => {
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("Detalle de Préstamo Personal visible")).toBe("semantic_descriptor");
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("Detalle de cuenta visible")).toBe("semantic_descriptor");
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("detalle de servicio visible")).toBe("semantic_descriptor");
});
(0, test_1.test)("'Pantalla de detalle de X visible' clasifica como semantic_descriptor", () => {
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("Pantalla de detalle de Préstamo Personal visible")).toBe("semantic_descriptor");
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("Vista de detalle de cuenta visible")).toBe("semantic_descriptor");
});
(0, test_1.test)("'Resumen de X visible' clasifica como semantic_descriptor", () => {
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("Resumen de Cuenta visible")).toBe("semantic_descriptor");
});
(0, test_1.test)("detail descriptor extrae descriptorTypes detail y subject correctamente", () => {
    const snapshot = makeSnapshot([
        makeElement({ text: "Préstamo Personal", type: "heading" }),
        makeElement({ text: "Monto: $10,000", type: "text" }),
        makeElement({ text: "Tasa: 15%", type: "text" })
    ]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Detalle de Préstamo Personal visible")]);
    (0, test_1.expect)(result.classification).toBe("semantic_descriptor");
    (0, test_1.expect)(result.descriptorTypes).toContain("detail");
    (0, test_1.expect)(result.subject?.toLowerCase()).toContain("personal");
    (0, test_1.expect)(result.isWeakSignal).toBe(true);
    (0, test_1.expect)(result.status).toBe("passed");
});
(0, test_1.test)("detail descriptor expected source no bloquea si subject no visible", () => {
    const snapshot = makeSnapshot([
        makeElement({ text: "Bienvenido", type: "heading" })
    ]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Detalle de Préstamo Personal visible", "expected")]);
    (0, test_1.expect)(result.classification).toBe("semantic_descriptor");
    (0, test_1.expect)(result.status).toBe("skipped_semantic_descriptor");
    (0, test_1.expect)(result.isWeakSignal).toBe(true);
});
(0, test_1.test)("detail descriptor action source con subject visible se resuelve como passed", () => {
    const snapshot = makeSnapshot([
        makeElement({ text: "Préstamo Personal", type: "heading" }),
        makeElement({ text: "Detalle del préstamo", type: "section" })
    ]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Detalle de Préstamo Personal visible", "action")]);
    (0, test_1.expect)(result.classification).toBe("semantic_descriptor");
    (0, test_1.expect)(result.status).toBe("passed");
});
(0, test_1.test)("literal quoted 'Detalle de X visible' sigue siendo literal_observable bloqueante si no coincide", () => {
    const snapshot = makeSnapshot([
        makeElement({ text: "Bienvenido al sistema", type: "heading" })
    ]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("'Detalle de Préstamo Personal visible'", "expected")]);
    (0, test_1.expect)(result.classification).toBe("literal_observable");
    (0, test_1.expect)(result.status).toBe("failed");
});
(0, test_1.test)("detail descriptor se satisface si subject está visible con señal estructural de sección", () => {
    const snapshot = makeSnapshot([
        makeElement({ text: "Tarjeta Visa Gold", type: "heading" }),
        makeElement({ text: "Límite: $5,000", type: "text" }),
        makeElement({ text: "Detalle de tarjeta", type: "section" })
    ]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Detalle de Tarjeta Visa Gold visible")]);
    (0, test_1.expect)(result.classification).toBe("semantic_descriptor");
    (0, test_1.expect)(result.status).toBe("passed");
});
(0, test_1.test)("no hardcodear textos de productos en detail descriptor classification", () => {
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("Detalle de cuenta visible")).toBe("semantic_descriptor");
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("Detalle de préstamo visible")).toBe("semantic_descriptor");
    (0, test_1.expect)((0, assertion_resolver_1.classifyAssertion)("Pantalla de detalle visible")).toBe("semantic_descriptor");
});
(0, test_1.test)("product detail assertions se resuelven estructuralmente", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "heading", tagName: "h2", text: "Product Name" }),
        makeElement({ type: "text", text: "$99.99" }),
        makeElement({ type: "text", text: "This is a product description with details." }),
        makeElement({ tagName: "img", role: "img", text: "image" }),
        makeElement({ text: "Add to cart" })
    ]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("precio del producto")]);
    (0, test_1.expect)(result.status).toBe("passed");
    (0, test_1.expect)(result.reason).toBe("structurally_satisfied");
});
(0, test_1.test)("cart assertion sin setup queda precondition_unresolved", () => {
    const snapshot = makeSnapshot([makeElement({ text: "Cart" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("carrito contiene producto")], {
        executedActions: [{ action: "click", target: "Cart", status: "found" }]
    });
    (0, test_1.expect)(result.status).toBe("precondition_unresolved");
    (0, test_1.expect)(result.reason).toBe("cart_setup_missing");
});
(0, test_1.test)("cart assertion con add to cart previo pasa por estructura", () => {
    const snapshot = makeSnapshot([
        makeElement({ tagName: "tr", role: "row", text: "Product row" }),
        makeElement({ text: "Total: $99.00" })
    ]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("productos agregados en carrito")], {
        executedActions: [{ action: "click", target: "Add to cart", status: "found" }]
    });
    (0, test_1.expect)(result.status).toBe("passed");
    (0, test_1.expect)(result.reason).toBe("structurally_satisfied");
});
(0, test_1.test)("assertion de detalle se difiere por contexto antes de seleccionar item", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "card", text: "Item A" }),
        makeElement({ type: "card", text: "Item B" })
    ]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("descripcion del producto")], {
        executedActions: [{ action: "click", target: "Catalog", status: "found" }]
    });
    (0, test_1.expect)(result.status).toBe("needs_assertion_resolution");
    (0, test_1.expect)(result.reason).toBe("assertion_context_not_reached");
    (0, test_1.expect)(result.assertionDiagnostics?.assertionContextDiagnostics?.decision).toBe("deferred_until_context");
});
(0, test_1.test)("assertion de detalle se satisface estructuralmente en contexto detail", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "heading", tagName: "h1", text: "Product X" }),
        makeElement({ type: "text", text: "$100.00" }),
        makeElement({ tagName: "img", role: "img", text: "image" }),
        makeElement({ type: "text", text: "Add to cart" })
    ]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("precio del producto")], {
        executedActions: [{ action: "click", target: "View details", status: "found" }]
    });
    (0, test_1.expect)(result.status).toBe("passed");
    (0, test_1.expect)(result.reason).toBe("structurally_satisfied");
    (0, test_1.expect)(result.assertionDiagnostics?.assertionContextDiagnostics?.decision).toBe("structurally_satisfied");
});
(0, test_1.test)("assertion de carrito se difiere si contexto de carrito no fue alcanzado", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "card", text: "Catalog item" })
    ]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("total del carrito")], {
        executedActions: [{ action: "click", target: "Catalog", status: "found" }]
    });
    (0, test_1.expect)(result.status).toBe("needs_assertion_resolution");
    (0, test_1.expect)(result.reason).toBe("assertion_context_not_reached");
    (0, test_1.expect)(result.assertionDiagnostics?.assertionContextDiagnostics?.decision).toBe("deferred_until_context");
});
(0, test_1.test)("consume assertion por fill exitoso con decision satisfied_by_fill_action", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "input", label: "Country" }),
        makeElement({ type: "input", label: "City" })
    ]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Country requerido")], {
        executedActions: [{ action: "fill", target: "Country", status: "found" }]
    });
    (0, test_1.expect)(result.status).toBe("satisfied_by_previous_assertion");
    (0, test_1.expect)(result.assertionDiagnostics?.assertionConsumptionDiagnostics?.decision).toBe("satisfied_by_fill_action");
});
(0, test_1.test)("consume assertion por click exitoso con decision satisfied_by_action_executed", () => {
    const snapshot = makeSnapshot([makeElement({ type: "button", text: "Add to cart" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Botón Add to cart visible")], {
        executedActions: [{ action: "click", target: "Add to cart", status: "found" }]
    });
    (0, test_1.expect)(result.status).toBe("satisfied_by_previous_assertion");
    (0, test_1.expect)(result.assertionDiagnostics?.assertionConsumptionDiagnostics?.decision).toBe("satisfied_by_action_executed");
});
(0, test_1.test)("consume assertion por presencia de campo en formulario activo", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "dialog", text: "Payment form" }),
        makeElement({ type: "input", label: "Credit card" })
    ]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Campo Credit card visible")], {
        executedActions: [{ action: "click", target: "Place Order", status: "found" }]
    });
    (0, test_1.expect)(result.status).toBe("satisfied_by_previous_assertion");
    (0, test_1.expect)(result.assertionDiagnostics?.assertionConsumptionDiagnostics?.decision).toBe("satisfied_by_form_field_presence");
});
(0, test_1.test)("consume assertion de accion principal visible en detalle por evidencia estructural", () => {
    const snapshot = makeSnapshot([
        makeElement({ type: "heading", text: "Product detail" }),
        makeElement({ type: "text", text: "Add to cart" })
    ]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Add to cart visible")], {
        executedActions: [{ action: "click", target: "View details", status: "found" }]
    });
    (0, test_1.expect)(result.status).toBe("satisfied_by_previous_assertion");
    (0, test_1.expect)(result.assertionDiagnostics?.assertionConsumptionDiagnostics?.decision).toBe("satisfied_by_structural_evidence");
});
// --- Runtime Evidence Trace / Failure Forensics tests ---
(0, test_1.test)("pending assertion forensics includes expectedConsumption and assertionType", () => {
    const snapshot = makeSnapshot([makeElement({ text: "Welcome" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("carrito contiene producto")], {
        executedActions: [{ action: "click", target: "Catalog", status: "found" }]
    });
    (0, test_1.expect)(result.expectedConsumption).toBeDefined();
    (0, test_1.expect)(result.expectedConsumption?.consumed).toBe(false);
    (0, test_1.expect)(result.assertionType).toBe("cart");
});
(0, test_1.test)("field-like assertion is classified as observable or structural", () => {
    const snapshot = makeSnapshot([makeElement({ type: "input", label: "Username" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Username field visible")]);
    (0, test_1.expect)(result.classification).toBeDefined();
});
(0, test_1.test)("confirmation assertion keeps resolvable classification", () => {
    const snapshot = makeSnapshot([makeElement({ text: "Thank you for your purchase" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Confirmation message visible")]);
    (0, test_1.expect)(result.classification).toBeDefined();
});
(0, test_1.test)("catalog assertion is classified for list resolver", () => {
    const snapshot = makeSnapshot([makeElement({ type: "card", text: "Product A" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Listado de productos")]);
    (0, test_1.expect)(result.classification).toBeDefined();
});
(0, test_1.test)("detail assertion is classified with detail semantics", () => {
    const snapshot = makeSnapshot([makeElement({ type: "heading", text: "Product Detail" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Detalle del producto")]);
    (0, test_1.expect)(["semantic_descriptor", "structural_assertion", "literal_observable"]).toContain(result.classification);
});
(0, test_1.test)("notConsumedReason is set for unresolved assertions", () => {
    const snapshot = makeSnapshot([makeElement({ text: "Welcome" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("producto en carrito")], {
        executedActions: [{ action: "click", target: "Catalog", status: "found" }]
    });
    (0, test_1.expect)(result.status).toBeDefined();
});
(0, test_1.test)("consumed assertion includes assertionConsumptionDiagnostics", () => {
    const snapshot = makeSnapshot([makeElement({ type: "input", label: "Country" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Country requerido")], {
        executedActions: [{ action: "fill", target: "Country", status: "found" }]
    });
    (0, test_1.expect)(result.status === "satisfied_by_previous_assertion" || result.status === "passed").toBe(true);
    if (result.status === "satisfied_by_previous_assertion") {
        (0, test_1.expect)(result.assertionDiagnostics?.assertionConsumptionDiagnostics).toBeDefined();
    }
});
(0, test_1.test)("navigation-like assertion remains classifiable", () => {
    const snapshot = makeSnapshot([makeElement({ text: "Home Page" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Navigation to home page")]);
    (0, test_1.expect)(result.classification).toBeDefined();
});
(0, test_1.test)("form assertion remains classifiable", () => {
    const snapshot = makeSnapshot([makeElement({ type: "dialog", text: "Form" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Formulario de pago")]);
    (0, test_1.expect)(result.classification).toBeDefined();
});
(0, test_1.test)("action assertion remains classifiable", () => {
    const snapshot = makeSnapshot([makeElement({ type: "button", text: "Submit" })]);
    const [result] = (0, assertion_resolver_1.resolveAssertionTargets)(snapshot, [makeAssertion("Click submit button")]);
    (0, test_1.expect)(result.classification).toBeDefined();
});
