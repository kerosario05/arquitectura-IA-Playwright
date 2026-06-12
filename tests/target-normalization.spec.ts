import { test, expect } from "@playwright/test";
import {
  normalizeTarget,
  targetsMatch,
  findTargetInList,
  detectMojibake,
  buildNormalizedLookup,
} from "../src/scenarios/target-normalization";

test.describe("Target Normalization", () => {
  test("normalizes accents correctly", () => {
    expect(normalizeTarget("Información")).toBe("informacion");
    expect(normalizeTarget("Depósitos")).toBe("depositos");
    expect(normalizeTarget("Crédito")).toBe("credito");
    expect(normalizeTarget("Categorías")).toBe("categorias");
  });

  test("normalizes mojibake patterns", () => {
    expect(normalizeTarget("InformaciÃ³n")).toBe("informacion");
    expect(normalizeTarget("DepÃ³sitos")).toBe("depositos");
    expect(normalizeTarget("PrÃ©stamos")).toBe("prestamos");
    expect(normalizeTarget("CrÃ©dito")).toBe("credito");
  });

  test("collapses whitespace", () => {
    expect(normalizeTarget("Información   de   productos")).toBe("informacion de productos");
    expect(normalizeTarget("  Tarjeta  de  crédito  ")).toBe("tarjeta de credito");
  });

  test("handles mixed case and accents", () => {
    expect(normalizeTarget("INFORMACIÓN DE PRODUCTOS")).toBe("informacion de productos");
    expect(normalizeTarget("DePóSiToS a PlAzO")).toBe("depositos a plazo");
  });

  test("targetsMatch returns true for matching targets", () => {
    expect(targetsMatch("Información", "informacion")).toBe(true);
    expect(targetsMatch("InformaciÃ³n", "Información")).toBe(true);
    expect(targetsMatch("Depósitos a Plazo", "DEPOSITOS A PLAZO")).toBe(true);
  });

  test("targetsMatch returns false for non-matching targets", () => {
    expect(targetsMatch("Información", "Depósitos")).toBe(false);
    expect(targetsMatch("Crédito", "Préstamo")).toBe(false);
  });

  test("findTargetInList finds exact match", () => {
    const allowed = ["Información de productos", "Depósitos", "Crédito"];
    expect(findTargetInList("Información de productos", allowed)).toBe("Información de productos");
  });

  test("findTargetInList finds normalized match", () => {
    const allowed = ["Información de productos", "Depósitos", "Crédito"];
    expect(findTargetInList("informacion de productos", allowed)).toBe("Información de productos");
    expect(findTargetInList("DEPOSITOS", allowed)).toBe("Depósitos");
  });

  test("findTargetInList finds mojibake match", () => {
    const allowed = ["Información de productos", "Depósitos a Plazo"];
    expect(findTargetInList("InformaciÃ³n de productos", allowed)).toBe("Información de productos");
    expect(findTargetInList("DepÃ³sitos a Plazo", allowed)).toBe("Depósitos a Plazo");
  });

  test("findTargetInList returns null for no match", () => {
    const allowed = ["Información de productos", "Depósitos"];
    expect(findTargetInList("Préstamos", allowed)).toBeNull();
  });

  test("detectMojibake identifies mojibake patterns", () => {
    const result1 = detectMojibake("InformaciÃ³n de productos");
    expect(result1.hasMojibake).toBe(true);
    expect(result1.corrected).toBe("Información de productos");

    const result2 = detectMojibake("DepÃ³sitos a plazo");
    expect(result2.hasMojibake).toBe(true);
    expect(result2.corrected).toBe("Depósitos a plazo");
  });

  test("detectMojibake returns false for clean text", () => {
    const result = detectMojibake("Información de productos");
    expect(result.hasMojibake).toBe(false);
    expect(result.corrected).toBe("Información de productos");
  });

  test("buildNormalizedLookup creates correct map", () => {
    const targets = ["Información de productos", "Depósitos a Plazo", "Crédito"];
    const lookup = buildNormalizedLookup(targets);

    expect(lookup.get("informacion de productos")).toBe("Información de productos");
    expect(lookup.get("depositos a plazo")).toBe("Depósitos a Plazo");
    expect(lookup.get("credito")).toBe("Crédito");
  });

  test("buildNormalizedLookup handles duplicates", () => {
    const targets = ["Información", "informacion", "INFORMACIÓN"];
    const lookup = buildNormalizedLookup(targets);

    // Should only have one entry for normalized form (first occurrence wins)
    expect(lookup.get("informacion")).toBe("Información");
    expect(lookup.size).toBe(1);
  });
});
