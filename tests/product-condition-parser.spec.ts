import { test, expect } from "@playwright/test";
import {
  parseProductConditionTarget,
  matchesProductCondition,
  resolveProductConditionAgainstSnapshot,
  type ProductCondition
} from "../src/discovery/product-condition-parser";

test("parseProductConditionTarget('cuenta de ahorro activa')", () => {
  const result = parseProductConditionTarget("cuenta de ahorro activa");
  expect(result).not.toBeNull();
  expect(result?.kind).toBe("product_condition");
  expect(result?.type).toBe("cuenta_ahorro");
  expect(result?.status).toBe("activa");
});

test("parseProductConditionTarget('cuenta de ahorros activa')", () => {
  const result = parseProductConditionTarget("cuenta de ahorros activa");
  expect(result).not.toBeNull();
  expect(result?.type).toBe("cuenta_ahorro");
  expect(result?.status).toBe("activa");
});

test("parseProductConditionTarget('préstamo desembolsado')", () => {
  const result = parseProductConditionTarget("préstamo desembolsado");
  expect(result).not.toBeNull();
  expect(result?.type).toBe("prestamo");
  expect(result?.status).toBe("desembolsado");
});

test("parseProductConditionTarget('depósito a plazo pagado')", () => {
  const result = parseProductConditionTarget("depósito a plazo pagado");
  expect(result).not.toBeNull();
  expect(result?.type).toBe("deposito_plazo");
  expect(result?.status).toBe("pagado");
});

test("parseProductConditionTarget('tarjeta de crédito activa')", () => {
  const result = parseProductConditionTarget("tarjeta de crédito activa");
  expect(result).not.toBeNull();
  expect(result?.type).toBe("tarjeta_credito");
  expect(result?.status).toBe("activa");
});

test("parseProductConditionTarget('tarjeta credito activa')", () => {
  const result = parseProductConditionTarget("tarjeta credito activa");
  expect(result).not.toBeNull();
  expect(result?.type).toBe("tarjeta_credito");
  expect(result?.status).toBe("activa");
});

test("parseProductConditionTarget('producto activo')", () => {
  const result = parseProductConditionTarget("producto activo");
  expect(result).not.toBeNull();
  expect(result?.type).toBe("producto");
  expect(result?.status).toBe("activo");
});

test("parseProductConditionTarget('primer producto disponible')", () => {
  const result = parseProductConditionTarget("primer producto disponible");
  expect(result).not.toBeNull();
  expect(result?.type).toBe("producto");
  expect(result?.status).toBe("disponible");
});

test("parseProductConditionTarget('producto disponible')", () => {
  const result = parseProductConditionTarget("producto disponible");
  expect(result).not.toBeNull();
  expect(result?.type).toBe("producto");
  expect(result?.status).toBe("disponible");
});

test("parseProductConditionTarget returns null for non-product text", () => {
  const result = parseProductConditionTarget("hacer clic en continuar");
  expect(result).toBeNull();
});

test("parseProductConditionTarget returns null for assertion text", () => {
  const result = parseProductConditionTarget("validar que se muestre el balance");
  expect(result).toBeNull();
});

test("matchesProductCondition matches cuenta de ahorros + activa", () => {
  const condition: ProductCondition = {
    kind: "product_condition",
    type: "cuenta_ahorro",
    status: "activa",
    keywords: ["cuenta de ahorro", "activa"]
  };

  expect(matchesProductCondition("Cuenta de Ahorros ****4962 Activa", condition)).toBe(true);
  expect(matchesProductCondition("Cuenta de Ahorro ****2855 - Estado: Activa", condition)).toBe(true);
  expect(matchesProductCondition("Tarjeta de Crédito ****1234 Activa", condition)).toBe(false);
  expect(matchesProductCondition("Cuenta de Ahorros ****4962 Bloqueada", condition)).toBe(false);
});

test("matchesProductCondition matches prestamo + desembolsado", () => {
  const condition: ProductCondition = {
    kind: "product_condition",
    type: "prestamo",
    status: "desembolsado",
    keywords: ["préstamo", "desembolsado"]
  };

  expect(matchesProductCondition("Préstamo Personal ****5678 Desembolsado", condition)).toBe(true);
  expect(matchesProductCondition("Prestamo Hipotecario Pendiente", condition)).toBe(false);
});

test("resolveProductConditionAgainstSnapshot finds first matching card", () => {
  const condition: ProductCondition = {
    kind: "product_condition",
    type: "cuenta_ahorro",
    status: "activa",
    keywords: ["cuenta de ahorro", "activa"]
  };

  const snapshot = {
    elements: [
      {
        id: "el-1",
        text: "Cuenta de Ahorros ****4962",
        nearbyText: "Saldo: RD$ 10,000.00 Activa Apertura: 2023-01-15",
        visible: true,
        type: "card",
        role: "listitem",
        tagName: "div",
        isClickable: true
      },
      {
        id: "el-2",
        text: "Tarjeta de Crédito ****1234",
        nearbyText: "Limite: RD$ 50,000.00 Activa",
        visible: true,
        type: "card",
        role: "listitem",
        tagName: "div",
        isClickable: true
      },
      {
        id: "el-3",
        text: "Cuenta de Ahorros ****2855",
        nearbyText: "Saldo: RD$ 5,000.00 Activa Apertura: 2023-06-01",
        visible: true,
        type: "card",
        role: "listitem",
        tagName: "div",
        isClickable: true
      }
    ]
  };

  const resolution = resolveProductConditionAgainstSnapshot(snapshot, condition, "cuenta de ahorro activa");

  expect(resolution.status).toBe("multiple");
  expect(resolution.matches.length).toBe(2);
  expect(resolution.selectedIndex).toBe(0);
  expect(resolution.diagnostics.matchedCount).toBe(2);
  expect(resolution.diagnostics.resolutionStrategy).toBe("first_visible_matching_product_card");
  expect(resolution.diagnostics.selectedTextMasked).toContain("Cuenta de Ahorros");
});

test("resolveProductConditionAgainstSnapshot returns not_found when no match", () => {
  const condition: ProductCondition = {
    kind: "product_condition",
    type: "prestamo",
    status: "desembolsado",
    keywords: ["préstamo", "desembolsado"]
  };

  const snapshot = {
    elements: [
      {
        id: "el-1",
        text: "Cuenta de Ahorros ****4962",
        nearbyText: "Saldo: RD$ 10,000.00 Activa",
        visible: true,
        type: "card",
        role: "listitem",
        tagName: "div",
        isClickable: true
      }
    ]
  };

  const resolution = resolveProductConditionAgainstSnapshot(snapshot, condition, "préstamo desembolsado");

  expect(resolution.status).toBe("not_found");
  expect(resolution.matches.length).toBe(0);
  expect(resolution.diagnostics.matchedCount).toBe(0);
});

test("resolveProductConditionAgainstSnapshot does not use masked number as criterion", () => {
  const condition: ProductCondition = {
    kind: "product_condition",
    type: "cuenta_ahorro",
    status: "activa",
    keywords: ["cuenta de ahorro", "activa"]
  };

  const snapshot = {
    elements: [
      {
        id: "el-1",
        text: "Cuenta de Ahorros ****9999",
        nearbyText: "Saldo: RD$ 1,000.00 Activa",
        visible: true,
        type: "card",
        role: "listitem",
        tagName: "div",
        isClickable: true
      }
    ]
  };

  const resolution = resolveProductConditionAgainstSnapshot(snapshot, condition, "cuenta de ahorro activa");

  expect(resolution.status).toBe("resolved");
  expect(resolution.diagnostics.parsedCondition.type).toBe("cuenta_ahorro");
  expect(resolution.diagnostics.parsedCondition.status).toBe("activa");
  expect(resolution.diagnostics.selectedTextMasked).not.toMatch(/\d{4}/);
});

test("resolveProductConditionAgainstSnapshot selects first visible when multiple match", () => {
  const condition: ProductCondition = {
    kind: "product_condition",
    type: "cuenta_ahorro",
    status: "activa",
    keywords: ["cuenta de ahorro", "activa"]
  };

  const snapshot = {
    elements: [
      {
        id: "el-1",
        text: "Cuenta de Ahorros ****1111",
        nearbyText: "Saldo: RD$ 100.00 Activa",
        visible: true,
        type: "card",
        role: "listitem",
        tagName: "div",
        isClickable: true
      },
      {
        id: "el-2",
        text: "Cuenta de Ahorros ****2222",
        nearbyText: "Saldo: RD$ 200.00 Activa",
        visible: true,
        type: "card",
        role: "listitem",
        tagName: "div",
        isClickable: true
      }
    ]
  };

  const resolution = resolveProductConditionAgainstSnapshot(snapshot, condition, "cuenta de ahorro activa");

  expect(resolution.status).toBe("multiple");
  expect(resolution.matches.length).toBe(2);
  expect(resolution.selectedIndex).toBe(0);
  expect(resolution.diagnostics.matchedCount).toBe(2);
});
