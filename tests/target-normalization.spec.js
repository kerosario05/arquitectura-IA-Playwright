"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const target_normalization_1 = require("../src/scenarios/target-normalization");
test_1.test.describe("Target Normalization", () => {
    (0, test_1.test)("normalizes accents correctly", () => {
        (0, test_1.expect)((0, target_normalization_1.normalizeTarget)("Información")).toBe("informacion");
        (0, test_1.expect)((0, target_normalization_1.normalizeTarget)("Depósitos")).toBe("depositos");
        (0, test_1.expect)((0, target_normalization_1.normalizeTarget)("Crédito")).toBe("credito");
        (0, test_1.expect)((0, target_normalization_1.normalizeTarget)("Categorías")).toBe("categorias");
    });
    (0, test_1.test)("normalizes mojibake patterns", () => {
        (0, test_1.expect)((0, target_normalization_1.normalizeTarget)("InformaciÃ³n")).toBe("informacion");
        (0, test_1.expect)((0, target_normalization_1.normalizeTarget)("DepÃ³sitos")).toBe("depositos");
        (0, test_1.expect)((0, target_normalization_1.normalizeTarget)("PrÃ©stamos")).toBe("prestamos");
        (0, test_1.expect)((0, target_normalization_1.normalizeTarget)("CrÃ©dito")).toBe("credito");
    });
    (0, test_1.test)("collapses whitespace", () => {
        (0, test_1.expect)((0, target_normalization_1.normalizeTarget)("Información   de   productos")).toBe("informacion de productos");
        (0, test_1.expect)((0, target_normalization_1.normalizeTarget)("  Tarjeta  de  crédito  ")).toBe("tarjeta de credito");
    });
    (0, test_1.test)("handles mixed case and accents", () => {
        (0, test_1.expect)((0, target_normalization_1.normalizeTarget)("INFORMACIÓN DE PRODUCTOS")).toBe("informacion de productos");
        (0, test_1.expect)((0, target_normalization_1.normalizeTarget)("DePóSiToS a PlAzO")).toBe("depositos a plazo");
    });
    (0, test_1.test)("targetsMatch returns true for matching targets", () => {
        (0, test_1.expect)((0, target_normalization_1.targetsMatch)("Información", "informacion")).toBe(true);
        (0, test_1.expect)((0, target_normalization_1.targetsMatch)("InformaciÃ³n", "Información")).toBe(true);
        (0, test_1.expect)((0, target_normalization_1.targetsMatch)("Depósitos a Plazo", "DEPOSITOS A PLAZO")).toBe(true);
    });
    (0, test_1.test)("targetsMatch returns false for non-matching targets", () => {
        (0, test_1.expect)((0, target_normalization_1.targetsMatch)("Información", "Depósitos")).toBe(false);
        (0, test_1.expect)((0, target_normalization_1.targetsMatch)("Crédito", "Préstamo")).toBe(false);
    });
    (0, test_1.test)("findTargetInList finds exact match", () => {
        const allowed = ["Información de productos", "Depósitos", "Crédito"];
        (0, test_1.expect)((0, target_normalization_1.findTargetInList)("Información de productos", allowed)).toBe("Información de productos");
    });
    (0, test_1.test)("findTargetInList finds normalized match", () => {
        const allowed = ["Información de productos", "Depósitos", "Crédito"];
        (0, test_1.expect)((0, target_normalization_1.findTargetInList)("informacion de productos", allowed)).toBe("Información de productos");
        (0, test_1.expect)((0, target_normalization_1.findTargetInList)("DEPOSITOS", allowed)).toBe("Depósitos");
    });
    (0, test_1.test)("findTargetInList finds mojibake match", () => {
        const allowed = ["Información de productos", "Depósitos a Plazo"];
        (0, test_1.expect)((0, target_normalization_1.findTargetInList)("InformaciÃ³n de productos", allowed)).toBe("Información de productos");
        (0, test_1.expect)((0, target_normalization_1.findTargetInList)("DepÃ³sitos a Plazo", allowed)).toBe("Depósitos a Plazo");
    });
    (0, test_1.test)("findTargetInList returns null for no match", () => {
        const allowed = ["Información de productos", "Depósitos"];
        (0, test_1.expect)((0, target_normalization_1.findTargetInList)("Préstamos", allowed)).toBeNull();
    });
    (0, test_1.test)("detectMojibake identifies mojibake patterns", () => {
        const result1 = (0, target_normalization_1.detectMojibake)("InformaciÃ³n de productos");
        (0, test_1.expect)(result1.hasMojibake).toBe(true);
        (0, test_1.expect)(result1.corrected).toBe("Información de productos");
        const result2 = (0, target_normalization_1.detectMojibake)("DepÃ³sitos a plazo");
        (0, test_1.expect)(result2.hasMojibake).toBe(true);
        (0, test_1.expect)(result2.corrected).toBe("Depósitos a plazo");
    });
    (0, test_1.test)("detectMojibake returns false for clean text", () => {
        const result = (0, target_normalization_1.detectMojibake)("Información de productos");
        (0, test_1.expect)(result.hasMojibake).toBe(false);
        (0, test_1.expect)(result.corrected).toBe("Información de productos");
    });
    (0, test_1.test)("buildNormalizedLookup creates correct map", () => {
        const targets = ["Información de productos", "Depósitos a Plazo", "Crédito"];
        const lookup = (0, target_normalization_1.buildNormalizedLookup)(targets);
        (0, test_1.expect)(lookup.get("informacion de productos")).toBe("Información de productos");
        (0, test_1.expect)(lookup.get("depositos a plazo")).toBe("Depósitos a Plazo");
        (0, test_1.expect)(lookup.get("credito")).toBe("Crédito");
    });
    (0, test_1.test)("buildNormalizedLookup handles duplicates", () => {
        const targets = ["Información", "informacion", "INFORMACIÓN"];
        const lookup = (0, target_normalization_1.buildNormalizedLookup)(targets);
        // Should only have one entry for normalized form (first occurrence wins)
        (0, test_1.expect)(lookup.get("informacion")).toBe("Información");
        (0, test_1.expect)(lookup.size).toBe(1);
    });
});
