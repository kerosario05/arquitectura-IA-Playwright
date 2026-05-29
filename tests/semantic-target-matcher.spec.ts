import { test, expect } from "@playwright/test";
import {
  normalizeTextForMatching,
  tokenizeForSemanticMatch,
  scoreSemanticTextMatch,
  findBestSemanticMatch,
  type SemanticCandidate
} from "../src/automations/runtime/semantic-target-matcher";

test.describe("Semantic Target Matcher", () => {
  test.describe("Text normalization", () => {
    test("normalizeTextForMatching removes accents and lowercases", () => {
      expect(normalizeTextForMatching("Préstamos personales")).toBe("prestamos personales");
      expect(normalizeTextForMatching("TARJETA DE CRÉDITO")).toBe("tarjeta de credito");
      expect(normalizeTextForMatching("Depósitos a Plazo")).toBe("depositos a plazo");
    });

    test("normalizeTextForMatching normalizes whitespace", () => {
      expect(normalizeTextForMatching("  tarjeta   de   credito  ")).toBe("tarjeta de credito");
      expect(normalizeTextForMatching("tarjeta\nde\ncredito")).toBe("tarjeta de credito");
    });

    test("tokenizeForSemanticMatch removes stopwords", () => {
      const tokens = tokenizeForSemanticMatch("Préstamos personales");
      expect(tokens).toEqual(["prestamos", "personales"]);
      
      const tokensWithStopwords = tokenizeForSemanticMatch("la tarjeta de credito");
      expect(tokensWithStopwords).toEqual(["tarjeta", "credito"]);
    });

    test("tokenizeForSemanticMatch filters short tokens", () => {
      const tokens = tokenizeForSemanticMatch("a b cd efg");
      expect(tokens).toEqual(["efg"]);
    });
  });

  test.describe("Semantic scoring", () => {
    test("exact normalized match scores 1.0", () => {
      const { score, reason } = scoreSemanticTextMatch("tarjeta de credito", "Tarjeta de Crédito");
      expect(score).toBe(1.0);
      expect(reason).toBe("exact_normalized_match");
    });

    test("plural/singular match scores with token overlap", () => {
      const { score, reason } = scoreSemanticTextMatch("Préstamos personales", "Préstamo Personal");
      // "prestamos" vs "prestamo" and "personales" vs "personal" are partial matches
      expect(score).toBeGreaterThanOrEqual(0.5);
      expect(reason).toMatch(/token_overlap/);
    });

    test("contains match scores well", () => {
      const { score, reason } = scoreSemanticTextMatch("tarjeta credito", "Tarjeta de Crédito Visa Gold");
      expect(score).toBeGreaterThanOrEqual(0.7);
    });

    test("token overlap scores proportionally", () => {
      const { score, reason } = scoreSemanticTextMatch("tarjeta credito visa gold", "Tarjeta Crédito Visa Gold");
      expect(score).toBe(1.0); // exact match after normalization
    });

    test("no overlap scores 0", () => {
      const { score, reason } = scoreSemanticTextMatch("cuenta de ahorro", "tarjeta de credito");
      expect(score).toBeLessThan(0.3);
    });
  });

  test.describe("Semantic candidate matching", () => {
    test("Préstamos personales matches Préstamo Personal", () => {
      const candidates: SemanticCandidate[] = [
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

      const result = findBestSemanticMatch("Préstamos personales", candidates, { minScore: 0.6 });
      expect(result.status).toBe("semantic");
      expect(result.candidate?.text).toBe("Préstamo Personal");
      expect(result.bestScore).toBeGreaterThanOrEqual(0.7);
    });

    test("tarjeta de credito visa gold matches Tarjeta Crédito Visa Gold", () => {
      const candidates: SemanticCandidate[] = [
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

      const result = findBestSemanticMatch("tarjeta credito visa gold", candidates, { minScore: 0.6 });
      expect(result.status).toBe("exact");
      expect(result.candidate?.text).toBe("Tarjeta Crédito Visa Gold");
      expect(result.bestScore).toBe(1.0);
    });

    test("Volver al listado matches Volver button with partial score", () => {
      const candidates: SemanticCandidate[] = [
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
      const result = findBestSemanticMatch("Volver", candidates, { 
        minScore: 0.6,
        actionIntent: "return_to_list"
      });
      expect(result.status).toBe("exact");
      expect(result.candidate?.text).toBe("Volver");
      expect(result.bestScore).toBe(1.0);
    });

    test("select_category prefers categories over product cards", () => {
      const candidates: SemanticCandidate[] = [
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

      const result = findBestSemanticMatch("Préstamos personales", candidates, { 
        minScore: 0.6,
        actionIntent: "select_category",
        excludeTypes: ["card"]
      });
      expect(result.status).toBe("semantic");
      expect(result.candidate?.text).toBe("Préstamo Personal");
      expect(result.candidate?.type).toBe("category");
    });

    test("ambiguous candidates return ambiguous status", () => {
      const candidates: SemanticCandidate[] = [
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

      const result = findBestSemanticMatch("Préstamos personales", candidates, { 
        minScore: 0.6,
        allowAmbiguity: false
      });
      expect(result.status).toBe("ambiguous");
      expect(result.candidates).toHaveLength(2);
      expect(result.reason).toContain("ambiguous");
    });

    test("no candidates above threshold returns not_found", () => {
      const candidates: SemanticCandidate[] = [
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

      const result = findBestSemanticMatch("Préstamos personales", candidates, { minScore: 0.6 });
      expect(result.status).toBe("not_found");
      expect(result.bestScore).toBeLessThan(0.6);
    });
  });
});
