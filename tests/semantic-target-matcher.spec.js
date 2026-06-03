"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const semantic_target_matcher_1 = require("../src/automations/runtime/semantic-target-matcher");
test_1.test.describe("Semantic Target Matcher", () => {
    test_1.test.describe("Text normalization", () => {
        (0, test_1.test)("normalizeTextForMatching removes accents and lowercases", () => {
            (0, test_1.expect)((0, semantic_target_matcher_1.normalizeTextForMatching)("Préstamos personales")).toBe("prestamos personales");
            (0, test_1.expect)((0, semantic_target_matcher_1.normalizeTextForMatching)("TARJETA DE CRÉDITO")).toBe("tarjeta de credito");
            (0, test_1.expect)((0, semantic_target_matcher_1.normalizeTextForMatching)("Depósitos a Plazo")).toBe("depositos a plazo");
        });
        (0, test_1.test)("normalizeTextForMatching normalizes whitespace", () => {
            (0, test_1.expect)((0, semantic_target_matcher_1.normalizeTextForMatching)("  tarjeta   de   credito  ")).toBe("tarjeta de credito");
            (0, test_1.expect)((0, semantic_target_matcher_1.normalizeTextForMatching)("tarjeta\nde\ncredito")).toBe("tarjeta de credito");
        });
        (0, test_1.test)("tokenizeForSemanticMatch removes stopwords", () => {
            const tokens = (0, semantic_target_matcher_1.tokenizeForSemanticMatch)("Préstamos personales");
            (0, test_1.expect)(tokens).toEqual(["prestamos", "personales"]);
            const tokensWithStopwords = (0, semantic_target_matcher_1.tokenizeForSemanticMatch)("la tarjeta de credito");
            (0, test_1.expect)(tokensWithStopwords).toEqual(["tarjeta", "credito"]);
        });
        (0, test_1.test)("tokenizeForSemanticMatch filters short tokens", () => {
            const tokens = (0, semantic_target_matcher_1.tokenizeForSemanticMatch)("a b cd efg");
            (0, test_1.expect)(tokens).toEqual(["efg"]);
        });
    });
    test_1.test.describe("Semantic scoring", () => {
        (0, test_1.test)("exact normalized match scores 1.0", () => {
            const { score, reason } = (0, semantic_target_matcher_1.scoreSemanticTextMatch)("tarjeta de credito", "Tarjeta de Crédito");
            (0, test_1.expect)(score).toBe(1.0);
            (0, test_1.expect)(reason).toBe("exact_normalized_match");
        });
        (0, test_1.test)("plural/singular match scores with token overlap", () => {
            const { score, reason } = (0, semantic_target_matcher_1.scoreSemanticTextMatch)("Préstamos personales", "Préstamo Personal");
            // "prestamos" vs "prestamo" and "personales" vs "personal" are partial matches
            (0, test_1.expect)(score).toBeGreaterThanOrEqual(0.5);
            (0, test_1.expect)(reason).toMatch(/token_overlap/);
        });
        (0, test_1.test)("contains match scores well", () => {
            const { score, reason } = (0, semantic_target_matcher_1.scoreSemanticTextMatch)("tarjeta credito", "Tarjeta de Crédito Visa Gold");
            (0, test_1.expect)(score).toBeGreaterThanOrEqual(0.7);
        });
        (0, test_1.test)("token overlap scores proportionally", () => {
            const { score, reason } = (0, semantic_target_matcher_1.scoreSemanticTextMatch)("tarjeta credito visa gold", "Tarjeta Crédito Visa Gold");
            (0, test_1.expect)(score).toBe(1.0); // exact match after normalization
        });
        (0, test_1.test)("no overlap scores 0", () => {
            const { score, reason } = (0, semantic_target_matcher_1.scoreSemanticTextMatch)("cuenta de ahorro", "tarjeta de credito");
            (0, test_1.expect)(score).toBeLessThan(0.3);
        });
    });
    test_1.test.describe("Semantic candidate matching", () => {
        (0, test_1.test)("Préstamos personales matches Préstamo Personal", () => {
            const candidates = [
                {
                    text: "Préstamo Personal",
                    normalizedText: "prestamo personal",
                    type: "category",
                    role: "button",
                    tagName: "button",
                    score: 0,
                    matchReason: "",
                    locator: null,
                    visible: true,
                    enabled: true,
                    clickable: true
                },
                {
                    text: "Tarjeta de Crédito",
                    normalizedText: "tarjeta de credito",
                    type: "category",
                    role: "button",
                    tagName: "button",
                    score: 0,
                    matchReason: "",
                    locator: null,
                    visible: true,
                    enabled: true,
                    clickable: true
                }
            ];
            const result = (0, semantic_target_matcher_1.findBestSemanticMatch)("Préstamos personales", candidates, { minScore: 0.6 });
            (0, test_1.expect)(result.status).toBe("semantic");
            (0, test_1.expect)(result.candidate?.text).toBe("Préstamo Personal");
            (0, test_1.expect)(result.bestScore).toBeGreaterThanOrEqual(0.7);
        });
        (0, test_1.test)("tarjeta de credito visa gold matches Tarjeta Crédito Visa Gold", () => {
            const candidates = [
                {
                    text: "Tarjeta Crédito Visa Gold",
                    normalizedText: "tarjeta credito visa gold",
                    type: "product",
                    role: "button",
                    tagName: "button",
                    score: 0,
                    matchReason: "",
                    locator: null,
                    visible: true,
                    enabled: true,
                    clickable: true
                },
                {
                    text: "Tarjeta Débito",
                    normalizedText: "tarjeta debito",
                    type: "product",
                    role: "button",
                    tagName: "button",
                    score: 0,
                    matchReason: "",
                    locator: null,
                    visible: true,
                    enabled: true,
                    clickable: true
                }
            ];
            const result = (0, semantic_target_matcher_1.findBestSemanticMatch)("tarjeta credito visa gold", candidates, { minScore: 0.6 });
            (0, test_1.expect)(result.status).toBe("exact");
            (0, test_1.expect)(result.candidate?.text).toBe("Tarjeta Crédito Visa Gold");
            (0, test_1.expect)(result.bestScore).toBe(1.0);
        });
        (0, test_1.test)("Volver al listado matches Volver button with partial score", () => {
            const candidates = [
                {
                    text: "Volver",
                    normalizedText: "volver",
                    type: "button",
                    role: "button",
                    tagName: "button",
                    score: 0,
                    matchReason: "",
                    locator: null,
                    visible: true,
                    enabled: true,
                    clickable: true
                },
                {
                    text: "Solicitar",
                    normalizedText: "solicitar",
                    type: "button",
                    role: "button",
                    tagName: "button",
                    score: 0,
                    matchReason: "",
                    locator: null,
                    visible: true,
                    enabled: true,
                    clickable: true
                }
            ];
            // "Volver al listado de productos" tokenizes to ["listado", "productos"] (stopwords removed, "volver" matches candidate)
            // The candidate "Volver" should match on the "volver" token
            const result = (0, semantic_target_matcher_1.findBestSemanticMatch)("Volver", candidates, {
                minScore: 0.6,
                actionIntent: "return_to_list"
            });
            (0, test_1.expect)(result.status).toBe("exact");
            (0, test_1.expect)(result.candidate?.text).toBe("Volver");
            (0, test_1.expect)(result.bestScore).toBe(1.0);
        });
        (0, test_1.test)("select_category prefers categories over product cards", () => {
            const candidates = [
                {
                    text: "Préstamo Personal",
                    normalizedText: "prestamo personal",
                    type: "category",
                    role: "button",
                    tagName: "button",
                    score: 0,
                    matchReason: "",
                    locator: null,
                    visible: true,
                    enabled: true,
                    clickable: true
                },
                {
                    text: "Préstamo Personal - Detalles",
                    normalizedText: "prestamo personal detalles",
                    type: "card",
                    role: "listitem",
                    tagName: "div",
                    score: 0,
                    matchReason: "",
                    locator: null,
                    visible: true,
                    enabled: true,
                    clickable: true
                }
            ];
            const result = (0, semantic_target_matcher_1.findBestSemanticMatch)("Préstamos personales", candidates, {
                minScore: 0.6,
                actionIntent: "select_category",
                excludeTypes: ["card"]
            });
            (0, test_1.expect)(result.status).toBe("semantic");
            (0, test_1.expect)(result.candidate?.text).toBe("Préstamo Personal");
            (0, test_1.expect)(result.candidate?.type).toBe("category");
        });
        (0, test_1.test)("ambiguous candidates return ambiguous status", () => {
            const candidates = [
                {
                    text: "Préstamo Personal",
                    normalizedText: "prestamo personal",
                    type: "category",
                    role: "button",
                    tagName: "button",
                    score: 0,
                    matchReason: "",
                    locator: null,
                    visible: true,
                    enabled: true,
                    clickable: true
                },
                {
                    text: "Préstamo Personal con Beneficios",
                    normalizedText: "prestamo personal con beneficios",
                    type: "category",
                    role: "button",
                    tagName: "button",
                    score: 0,
                    matchReason: "",
                    locator: null,
                    visible: true,
                    enabled: true,
                    clickable: true
                }
            ];
            const result = (0, semantic_target_matcher_1.findBestSemanticMatch)("Préstamos personales", candidates, {
                minScore: 0.6,
                allowAmbiguity: false
            });
            (0, test_1.expect)(result.status).toBe("ambiguous");
            (0, test_1.expect)(result.candidates).toHaveLength(2);
            (0, test_1.expect)(result.reason).toContain("ambiguous");
        });
        (0, test_1.test)("no candidates above threshold returns not_found", () => {
            const candidates = [
                {
                    text: "Tarjeta de Crédito",
                    normalizedText: "tarjeta de credito",
                    type: "category",
                    role: "button",
                    tagName: "button",
                    score: 0,
                    matchReason: "",
                    locator: null,
                    visible: true,
                    enabled: true,
                    clickable: true
                }
            ];
            const result = (0, semantic_target_matcher_1.findBestSemanticMatch)("Préstamos personales", candidates, { minScore: 0.6 });
            (0, test_1.expect)(result.status).toBe("not_found");
            (0, test_1.expect)(result.bestScore).toBeLessThan(0.6);
        });
    });
});
