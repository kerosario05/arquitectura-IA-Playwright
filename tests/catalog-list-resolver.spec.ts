import { test, expect } from "@playwright/test";
import { resolveCatalogListAssertion, isCatalogListAssertion } from "../src/discovery/catalog-list-resolver";
import type { PageSnapshot } from "../src/types/page-snapshot.types";

function makeSnapshot(elements: any[]): PageSnapshot {
  return {
    version: "1.0",
    url: "https://example.com/products",
    title: "Product Catalog",
    capturedAt: new Date().toISOString(),
    elements: elements as any,
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

test("isCatalogListAssertion detects producto visible con nombre, precio e imagen", () => {
  expect(isCatalogListAssertion("Validar que se muestre al menos un producto visible con nombre, precio e imagen")).toBe(true);
});

test("isCatalogListAssertion detects productos disponibles", () => {
  expect(isCatalogListAssertion("Validar productos disponibles")).toBe(true);
});

test("isCatalogListAssertion detects precio visible", () => {
  expect(isCatalogListAssertion("Validar precio visible")).toBe(true);
});

test("isCatalogListAssertion detects imagen visible", () => {
  expect(isCatalogListAssertion("Validar imagen de referencia visible")).toBe(true);
});

test("isCatalogListAssertion detects lista de resultados visible", () => {
  expect(isCatalogListAssertion("Validar lista de resultados visible")).toBe(true);
});

test("isCatalogListAssertion detects tarjetas visibles", () => {
  expect(isCatalogListAssertion("Validar tarjetas visibles")).toBe(true);
});

test("isCatalogListAssertion detects catalogo visible", () => {
  expect(isCatalogListAssertion("Validar catalogo visible")).toBe(true);
});

test("isCatalogListAssertion detects resultados disponibles", () => {
  expect(isCatalogListAssertion("Validar resultados disponibles")).toBe(true);
});

test("isCatalogListAssertion does not match literal text assertions", () => {
  expect(isCatalogListAssertion("Validar que se muestre 'Welcome'")).toBe(false);
  expect(isCatalogListAssertion("Validar texto 'Hello World'")).toBe(false);
  expect(isCatalogListAssertion("Verificar botón continuar")).toBe(false);
});

test("Assertion de producto visible pasa si hay card con título, precio e imagen", () => {
  const snapshot = makeSnapshot([
    { tagName: "article", type: "card", text: "Product Card" },
    { tagName: "h3", role: "heading", text: "Visa Gold Card" },
    { tagName: "span", text: "$360.00" },
    { tagName: "img", alt: "Product image", src: "/img/visa-gold.png" },
  ]);

  const result = resolveCatalogListAssertion(snapshot, "Validar que se muestre al menos un producto visible con nombre, precio e imagen");

  expect(result.passed).toBe(true);
  expect(result.matchedItems).toBeGreaterThanOrEqual(1);
  expect(result.confidence).toBeGreaterThan(0.5);
  expect(result.evidence.length).toBeGreaterThan(0);
});

test("Assertion de productos disponibles pasa con lista de cards visibles", () => {
  const snapshot = makeSnapshot([
    { tagName: "article", type: "card", text: "Card 1" },
    { tagName: "h3", text: "Product A" },
    { tagName: "article", type: "card", text: "Card 2" },
    { tagName: "h3", text: "Product B" },
    { tagName: "span", text: "$100" },
    { tagName: "span", text: "$200" },
  ]);

  const result = resolveCatalogListAssertion(snapshot, "Validar productos disponibles con nombre visible");

  expect(result.passed).toBe(true);
  expect(result.matchedItems).toBeGreaterThanOrEqual(1);
});

test("Assertion de precio visible pasa con formatos monetarios comunes", () => {
  const snapshot = makeSnapshot([
    { tagName: "article", type: "card", text: "Product" },
    { tagName: "span", text: "$360" },
  ]);

  const result = resolveCatalogListAssertion(snapshot, "Validar precio visible");

  expect(result.passed).toBe(true);
  expect(result.matchedItems).toBeGreaterThanOrEqual(1);
});

test("monetary pattern matches $360", () => {
  const snapshot = makeSnapshot([{ tagName: "span", text: "$360" }]);
  const result = resolveCatalogListAssertion(snapshot, "Validar precio visible");
  expect(result.passed).toBe(true);
});

test("monetary pattern matches USD$360", () => {
  const snapshot = makeSnapshot([{ tagName: "span", text: "USD$360" }]);
  const result = resolveCatalogListAssertion(snapshot, "Validar precio visible");
  expect(result.passed).toBe(true);
});

test("monetary pattern matches RD$1,000.00", () => {
  const snapshot = makeSnapshot([{ tagName: "span", text: "RD$1,000.00" }]);
  const result = resolveCatalogListAssertion(snapshot, "Validar precio visible");
  expect(result.passed).toBe(true);
});

test("monetary pattern matches US$25.50", () => {
  const snapshot = makeSnapshot([{ tagName: "span", text: "US$25.50" }]);
  const result = resolveCatalogListAssertion(snapshot, "Validar precio visible");
  expect(result.passed).toBe(true);
});

test("monetary pattern matches EUR 20.00", () => {
  const snapshot = makeSnapshot([{ tagName: "span", text: "EUR 20.00" }]);
  const result = resolveCatalogListAssertion(snapshot, "Validar precio visible");
  expect(result.passed).toBe(true);
});

test("Assertion de imagen visible pasa si card tiene img visible", () => {
  const snapshot = makeSnapshot([
    { tagName: "article", type: "card", text: "Product Card" },
    { tagName: "h3", text: "Product Name" },
    { tagName: "img", alt: "Product image", src: "/img/product.png" },
  ]);

  const result = resolveCatalogListAssertion(snapshot, "Validar imagen de producto visible");

  expect(result.passed).toBe(true);
  expect(result.matchedItems).toBeGreaterThanOrEqual(1);
});

test("Assertion falla si no hay items visibles", () => {
  const snapshot = makeSnapshot([
    { tagName: "div", text: "No products found" },
    { tagName: "p", text: "Please try again" },
  ]);

  const result = resolveCatalogListAssertion(snapshot, "Validar que se muestre al menos un producto visible con nombre, precio e imagen");

  expect(result.passed).toBe(false);
  expect(result.matchedItems).toBe(0);
});

test("No depende de nombres específicos de productos", () => {
  const snapshot = makeSnapshot([
    { tagName: "article", type: "card", text: "Item" },
    { tagName: "h3", text: "Generic Product Name" },
    { tagName: "span", text: "$50.00" },
    { tagName: "img", alt: "Product", src: "/img/generic.png" },
  ]);

  const result = resolveCatalogListAssertion(snapshot, "Validar producto visible con nombre, precio e imagen");

  expect(result.passed).toBe(true);
  expect(result.evidence.some((e) => e.includes("title"))).toBe(true);
  expect(result.evidence.some((e) => e.includes("price"))).toBe(true);
  expect(result.evidence.some((e) => e.includes("image"))).toBe(true);
});

test("returns assertionDiagnostics with resolver and evidence", () => {
  const snapshot = makeSnapshot([
    { tagName: "article", type: "card", text: "Product" },
    { tagName: "h3", text: "Test Product" },
    { tagName: "span", text: "$99.99" },
  ]);

  const result = resolveCatalogListAssertion(snapshot, "Validar producto visible con nombre, precio");

  expect(result.resolver).toBe("catalog_list_structure");
  expect(result.assertion).toBe("Validar producto visible con nombre, precio");
  expect(result.matchedItems).toBeGreaterThanOrEqual(1);
  expect(result.evidence.length).toBeGreaterThan(0);
});

test("flat elements without containers still resolves", () => {
  const snapshot = makeSnapshot([
    { tagName: "h3", text: "Product A" },
    { tagName: "span", text: "$10" },
    { tagName: "img", alt: "Image A" },
    { tagName: "h3", text: "Product B" },
    { tagName: "span", text: "$20" },
    { tagName: "img", alt: "Image B" },
  ]);

  const result = resolveCatalogListAssertion(snapshot, "Validar productos disponibles");

  expect(result.passed).toBe(true);
  expect(result.matchedItems).toBeGreaterThanOrEqual(1);
});

test("listado actualizado pasa con cards visibles", () => {
  const snapshot = makeSnapshot([
    { tagName: "article", type: "card", text: "Card 1" },
    { tagName: "h3", text: "Product A" }
  ]);
  const result = resolveCatalogListAssertion(snapshot, "El listado se actualiza y muestra productos");
  expect(result.passed).toBe(true);
  expect(result.diagnostics?.productsVisible).toBe(true);
});

test("productos relacionados con categoria Phones pasa por match estructural", () => {
  const snapshot = makeSnapshot([
    { tagName: "article", type: "card", text: "Card 1" },
    { tagName: "h3", text: "Nokia 3310" }
  ]);
  const result = resolveCatalogListAssertion(snapshot, "productos relacionados con categoria Phones");
  expect(result.passed).toBe(true);
  expect(result.diagnostics?.structuralMatch).toBe(true);
  expect(result.diagnostics?.category?.toLowerCase()).toContain("phones");
});
