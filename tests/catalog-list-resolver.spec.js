"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const catalog_list_resolver_1 = require("../src/discovery/catalog-list-resolver");
function makeSnapshot(elements) {
    return {
        version: "1.0",
        url: "https://example.com/products",
        title: "Product Catalog",
        capturedAt: new Date().toISOString(),
        elements: elements,
        summary: {
            totalElements: elements.length,
            buttons: 5,
            links: 10,
            inputs: 2,
            selects: 0,
            headings: 1,
            tables: 0,
            dialogs: 0,
        },
    };
}
(0, test_1.test)("isCatalogListAssertion detects producto visible con nombre, precio e imagen", () => {
    (0, test_1.expect)((0, catalog_list_resolver_1.isCatalogListAssertion)("Validar que se muestre al menos un producto visible con nombre, precio e imagen")).toBe(true);
});
(0, test_1.test)("isCatalogListAssertion detects productos disponibles", () => {
    (0, test_1.expect)((0, catalog_list_resolver_1.isCatalogListAssertion)("Validar productos disponibles")).toBe(true);
});
(0, test_1.test)("isCatalogListAssertion detects precio visible", () => {
    (0, test_1.expect)((0, catalog_list_resolver_1.isCatalogListAssertion)("Validar precio visible")).toBe(true);
});
(0, test_1.test)("isCatalogListAssertion detects imagen visible", () => {
    (0, test_1.expect)((0, catalog_list_resolver_1.isCatalogListAssertion)("Validar imagen de referencia visible")).toBe(true);
});
(0, test_1.test)("isCatalogListAssertion detects lista de resultados visible", () => {
    (0, test_1.expect)((0, catalog_list_resolver_1.isCatalogListAssertion)("Validar lista de resultados visible")).toBe(true);
});
(0, test_1.test)("isCatalogListAssertion detects tarjetas visibles", () => {
    (0, test_1.expect)((0, catalog_list_resolver_1.isCatalogListAssertion)("Validar tarjetas visibles")).toBe(true);
});
(0, test_1.test)("isCatalogListAssertion detects catalogo visible", () => {
    (0, test_1.expect)((0, catalog_list_resolver_1.isCatalogListAssertion)("Validar catalogo visible")).toBe(true);
});
(0, test_1.test)("isCatalogListAssertion detects resultados disponibles", () => {
    (0, test_1.expect)((0, catalog_list_resolver_1.isCatalogListAssertion)("Validar resultados disponibles")).toBe(true);
});
(0, test_1.test)("isCatalogListAssertion does not match literal text assertions", () => {
    (0, test_1.expect)((0, catalog_list_resolver_1.isCatalogListAssertion)("Validar que se muestre 'Welcome'")).toBe(false);
    (0, test_1.expect)((0, catalog_list_resolver_1.isCatalogListAssertion)("Validar texto 'Hello World'")).toBe(false);
    (0, test_1.expect)((0, catalog_list_resolver_1.isCatalogListAssertion)("Verificar botón continuar")).toBe(false);
});
(0, test_1.test)("Assertion de producto visible pasa si hay card con título, precio e imagen", () => {
    const snapshot = makeSnapshot([
        { tagName: "article", type: "card", text: "Product Card" },
        { tagName: "h3", role: "heading", text: "Visa Gold Card" },
        { tagName: "span", text: "$360.00" },
        { tagName: "img", alt: "Product image", src: "/img/visa-gold.png" },
    ]);
    const result = (0, catalog_list_resolver_1.resolveCatalogListAssertion)(snapshot, "Validar que se muestre al menos un producto visible con nombre, precio e imagen");
    (0, test_1.expect)(result.passed).toBe(true);
    (0, test_1.expect)(result.matchedItems).toBeGreaterThanOrEqual(1);
    (0, test_1.expect)(result.confidence).toBeGreaterThan(0.5);
    (0, test_1.expect)(result.evidence.length).toBeGreaterThan(0);
});
(0, test_1.test)("Assertion de productos disponibles pasa con lista de cards visibles", () => {
    const snapshot = makeSnapshot([
        { tagName: "article", type: "card", text: "Card 1" },
        { tagName: "h3", text: "Product A" },
        { tagName: "article", type: "card", text: "Card 2" },
        { tagName: "h3", text: "Product B" },
        { tagName: "span", text: "$100" },
        { tagName: "span", text: "$200" },
    ]);
    const result = (0, catalog_list_resolver_1.resolveCatalogListAssertion)(snapshot, "Validar productos disponibles con nombre visible");
    (0, test_1.expect)(result.passed).toBe(true);
    (0, test_1.expect)(result.matchedItems).toBeGreaterThanOrEqual(1);
});
(0, test_1.test)("Assertion de precio visible pasa con formatos monetarios comunes", () => {
    const snapshot = makeSnapshot([
        { tagName: "article", type: "card", text: "Product" },
        { tagName: "span", text: "$360" },
    ]);
    const result = (0, catalog_list_resolver_1.resolveCatalogListAssertion)(snapshot, "Validar precio visible");
    (0, test_1.expect)(result.passed).toBe(true);
    (0, test_1.expect)(result.matchedItems).toBeGreaterThanOrEqual(1);
});
(0, test_1.test)("monetary pattern matches $360", () => {
    const snapshot = makeSnapshot([{ tagName: "span", text: "$360" }]);
    const result = (0, catalog_list_resolver_1.resolveCatalogListAssertion)(snapshot, "Validar precio visible");
    (0, test_1.expect)(result.passed).toBe(true);
});
(0, test_1.test)("monetary pattern matches USD$360", () => {
    const snapshot = makeSnapshot([{ tagName: "span", text: "USD$360" }]);
    const result = (0, catalog_list_resolver_1.resolveCatalogListAssertion)(snapshot, "Validar precio visible");
    (0, test_1.expect)(result.passed).toBe(true);
});
(0, test_1.test)("monetary pattern matches RD$1,000.00", () => {
    const snapshot = makeSnapshot([{ tagName: "span", text: "RD$1,000.00" }]);
    const result = (0, catalog_list_resolver_1.resolveCatalogListAssertion)(snapshot, "Validar precio visible");
    (0, test_1.expect)(result.passed).toBe(true);
});
(0, test_1.test)("monetary pattern matches US$25.50", () => {
    const snapshot = makeSnapshot([{ tagName: "span", text: "US$25.50" }]);
    const result = (0, catalog_list_resolver_1.resolveCatalogListAssertion)(snapshot, "Validar precio visible");
    (0, test_1.expect)(result.passed).toBe(true);
});
(0, test_1.test)("monetary pattern matches EUR 20.00", () => {
    const snapshot = makeSnapshot([{ tagName: "span", text: "EUR 20.00" }]);
    const result = (0, catalog_list_resolver_1.resolveCatalogListAssertion)(snapshot, "Validar precio visible");
    (0, test_1.expect)(result.passed).toBe(true);
});
(0, test_1.test)("Assertion de imagen visible pasa si card tiene img visible", () => {
    const snapshot = makeSnapshot([
        { tagName: "article", type: "card", text: "Product Card" },
        { tagName: "h3", text: "Product Name" },
        { tagName: "img", alt: "Product image", src: "/img/product.png" },
    ]);
    const result = (0, catalog_list_resolver_1.resolveCatalogListAssertion)(snapshot, "Validar imagen de producto visible");
    (0, test_1.expect)(result.passed).toBe(true);
    (0, test_1.expect)(result.matchedItems).toBeGreaterThanOrEqual(1);
});
(0, test_1.test)("Assertion falla si no hay items visibles", () => {
    const snapshot = makeSnapshot([
        { tagName: "div", text: "No products found" },
        { tagName: "p", text: "Please try again" },
    ]);
    const result = (0, catalog_list_resolver_1.resolveCatalogListAssertion)(snapshot, "Validar que se muestre al menos un producto visible con nombre, precio e imagen");
    (0, test_1.expect)(result.passed).toBe(false);
    (0, test_1.expect)(result.matchedItems).toBe(0);
});
(0, test_1.test)("No depende de nombres específicos de productos", () => {
    const snapshot = makeSnapshot([
        { tagName: "article", type: "card", text: "Item" },
        { tagName: "h3", text: "Generic Product Name" },
        { tagName: "span", text: "$50.00" },
        { tagName: "img", alt: "Product", src: "/img/generic.png" },
    ]);
    const result = (0, catalog_list_resolver_1.resolveCatalogListAssertion)(snapshot, "Validar producto visible con nombre, precio e imagen");
    (0, test_1.expect)(result.passed).toBe(true);
    (0, test_1.expect)(result.evidence.some((e) => e.includes("title"))).toBe(true);
    (0, test_1.expect)(result.evidence.some((e) => e.includes("price"))).toBe(true);
    (0, test_1.expect)(result.evidence.some((e) => e.includes("image"))).toBe(true);
});
(0, test_1.test)("returns assertionDiagnostics with resolver and evidence", () => {
    const snapshot = makeSnapshot([
        { tagName: "article", type: "card", text: "Product" },
        { tagName: "h3", text: "Test Product" },
        { tagName: "span", text: "$99.99" },
    ]);
    const result = (0, catalog_list_resolver_1.resolveCatalogListAssertion)(snapshot, "Validar producto visible con nombre, precio");
    (0, test_1.expect)(result.resolver).toBe("catalog_list_structure");
    (0, test_1.expect)(result.assertion).toBe("Validar producto visible con nombre, precio");
    (0, test_1.expect)(result.matchedItems).toBeGreaterThanOrEqual(1);
    (0, test_1.expect)(result.evidence.length).toBeGreaterThan(0);
});
(0, test_1.test)("flat elements without containers still resolves", () => {
    const snapshot = makeSnapshot([
        { tagName: "h3", text: "Product A" },
        { tagName: "span", text: "$10" },
        { tagName: "img", alt: "Image A" },
        { tagName: "h3", text: "Product B" },
        { tagName: "span", text: "$20" },
        { tagName: "img", alt: "Image B" },
    ]);
    const result = (0, catalog_list_resolver_1.resolveCatalogListAssertion)(snapshot, "Validar productos disponibles");
    (0, test_1.expect)(result.passed).toBe(true);
    (0, test_1.expect)(result.matchedItems).toBeGreaterThanOrEqual(1);
});
(0, test_1.test)("listado actualizado pasa con cards visibles", () => {
    const snapshot = makeSnapshot([
        { tagName: "article", type: "card", text: "Card 1" },
        { tagName: "h3", text: "Product A" }
    ]);
    const result = (0, catalog_list_resolver_1.resolveCatalogListAssertion)(snapshot, "El listado se actualiza y muestra productos");
    (0, test_1.expect)(result.passed).toBe(true);
    (0, test_1.expect)(result.diagnostics?.productsVisible).toBe(true);
});
(0, test_1.test)("productos relacionados con categoria Phones pasa por match estructural", () => {
    const snapshot = makeSnapshot([
        { tagName: "article", type: "card", text: "Card 1" },
        { tagName: "h3", text: "Nokia 3310" }
    ]);
    const result = (0, catalog_list_resolver_1.resolveCatalogListAssertion)(snapshot, "productos relacionados con categoria Phones");
    (0, test_1.expect)(result.passed).toBe(true);
    (0, test_1.expect)(result.diagnostics?.structuralMatch).toBe(true);
    (0, test_1.expect)(result.diagnostics?.category?.toLowerCase()).toContain("phones");
});
