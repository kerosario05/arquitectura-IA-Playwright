"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const product_condition_parser_1 = require("../src/discovery/product-condition-parser");
(0, test_1.test)("parseProductConditionTarget('cuenta de ahorro activa')", () => {
    const result = (0, product_condition_parser_1.parseProductConditionTarget)("cuenta de ahorro activa");
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.kind).toBe("product_condition");
    (0, test_1.expect)(result?.type).toBe("cuenta_ahorro");
    (0, test_1.expect)(result?.status).toBe("activa");
});
(0, test_1.test)("parseProductConditionTarget('cuenta de ahorros activa')", () => {
    const result = (0, product_condition_parser_1.parseProductConditionTarget)("cuenta de ahorros activa");
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.type).toBe("cuenta_ahorro");
    (0, test_1.expect)(result?.status).toBe("activa");
});
(0, test_1.test)("parseProductConditionTarget('préstamo desembolsado')", () => {
    const result = (0, product_condition_parser_1.parseProductConditionTarget)("préstamo desembolsado");
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.type).toBe("prestamo");
    (0, test_1.expect)(result?.status).toBe("desembolsado");
});
(0, test_1.test)("parseProductConditionTarget('depósito a plazo pagado')", () => {
    const result = (0, product_condition_parser_1.parseProductConditionTarget)("depósito a plazo pagado");
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.type).toBe("deposito_plazo");
    (0, test_1.expect)(result?.status).toBe("pagado");
});
(0, test_1.test)("parseProductConditionTarget('tarjeta de crédito activa')", () => {
    const result = (0, product_condition_parser_1.parseProductConditionTarget)("tarjeta de crédito activa");
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.type).toBe("tarjeta_credito");
    (0, test_1.expect)(result?.status).toBe("activa");
});
(0, test_1.test)("parseProductConditionTarget('tarjeta credito activa')", () => {
    const result = (0, product_condition_parser_1.parseProductConditionTarget)("tarjeta credito activa");
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.type).toBe("tarjeta_credito");
    (0, test_1.expect)(result?.status).toBe("activa");
});
(0, test_1.test)("parseProductConditionTarget('producto activo')", () => {
    const result = (0, product_condition_parser_1.parseProductConditionTarget)("producto activo");
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.type).toBe("producto");
    (0, test_1.expect)(result?.status).toBe("activo");
});
(0, test_1.test)("parseProductConditionTarget('primer producto disponible')", () => {
    const result = (0, product_condition_parser_1.parseProductConditionTarget)("primer producto disponible");
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.type).toBe("producto");
    (0, test_1.expect)(result?.status).toBe("disponible");
});
(0, test_1.test)("parseProductConditionTarget('producto disponible')", () => {
    const result = (0, product_condition_parser_1.parseProductConditionTarget)("producto disponible");
    (0, test_1.expect)(result).not.toBeNull();
    (0, test_1.expect)(result?.type).toBe("producto");
    (0, test_1.expect)(result?.status).toBe("disponible");
});
(0, test_1.test)("parseProductConditionTarget returns null for non-product text", () => {
    const result = (0, product_condition_parser_1.parseProductConditionTarget)("hacer clic en continuar");
    (0, test_1.expect)(result).toBeNull();
});
(0, test_1.test)("parseProductConditionTarget returns null for assertion text", () => {
    const result = (0, product_condition_parser_1.parseProductConditionTarget)("validar que se muestre el balance");
    (0, test_1.expect)(result).toBeNull();
});
(0, test_1.test)("matchesProductCondition matches cuenta de ahorros + activa", () => {
    const condition = {
        kind: "product_condition",
        type: "cuenta_ahorro",
        status: "activa",
        keywords: ["cuenta de ahorro", "activa"]
    };
    (0, test_1.expect)((0, product_condition_parser_1.matchesProductCondition)("Cuenta de Ahorros ****4962 Activa", condition)).toBe(true);
    (0, test_1.expect)((0, product_condition_parser_1.matchesProductCondition)("Cuenta de Ahorro ****2855 - Estado: Activa", condition)).toBe(true);
    (0, test_1.expect)((0, product_condition_parser_1.matchesProductCondition)("Tarjeta de Crédito ****1234 Activa", condition)).toBe(false);
    (0, test_1.expect)((0, product_condition_parser_1.matchesProductCondition)("Cuenta de Ahorros ****4962 Bloqueada", condition)).toBe(false);
});
(0, test_1.test)("matchesProductCondition matches prestamo + desembolsado", () => {
    const condition = {
        kind: "product_condition",
        type: "prestamo",
        status: "desembolsado",
        keywords: ["préstamo", "desembolsado"]
    };
    (0, test_1.expect)((0, product_condition_parser_1.matchesProductCondition)("Préstamo Personal ****5678 Desembolsado", condition)).toBe(true);
    (0, test_1.expect)((0, product_condition_parser_1.matchesProductCondition)("Prestamo Hipotecario Pendiente", condition)).toBe(false);
});
(0, test_1.test)("resolveProductConditionAgainstSnapshot finds first matching card", () => {
    const condition = {
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
    const resolution = (0, product_condition_parser_1.resolveProductConditionAgainstSnapshot)(snapshot, condition, "cuenta de ahorro activa");
    (0, test_1.expect)(resolution.status).toBe("multiple");
    (0, test_1.expect)(resolution.matches.length).toBe(2);
    (0, test_1.expect)(resolution.selectedIndex).toBe(0);
    (0, test_1.expect)(resolution.diagnostics.matchedCount).toBe(2);
    (0, test_1.expect)(resolution.diagnostics.resolutionStrategy).toBe("first_visible_matching_product_card");
    (0, test_1.expect)(resolution.diagnostics.selectedTextMasked).toContain("Cuenta de Ahorros");
});
(0, test_1.test)("resolveProductConditionAgainstSnapshot returns not_found when no match", () => {
    const condition = {
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
    const resolution = (0, product_condition_parser_1.resolveProductConditionAgainstSnapshot)(snapshot, condition, "préstamo desembolsado");
    (0, test_1.expect)(resolution.status).toBe("not_found");
    (0, test_1.expect)(resolution.matches.length).toBe(0);
    (0, test_1.expect)(resolution.diagnostics.matchedCount).toBe(0);
});
(0, test_1.test)("resolveProductConditionAgainstSnapshot does not use masked number as criterion", () => {
    const condition = {
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
    const resolution = (0, product_condition_parser_1.resolveProductConditionAgainstSnapshot)(snapshot, condition, "cuenta de ahorro activa");
    (0, test_1.expect)(resolution.status).toBe("resolved");
    (0, test_1.expect)(resolution.diagnostics.parsedCondition.type).toBe("cuenta_ahorro");
    (0, test_1.expect)(resolution.diagnostics.parsedCondition.status).toBe("activa");
    (0, test_1.expect)(resolution.diagnostics.selectedTextMasked).not.toMatch(/\d{4}/);
});
(0, test_1.test)("resolveProductConditionAgainstSnapshot selects first visible when multiple match", () => {
    const condition = {
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
    const resolution = (0, product_condition_parser_1.resolveProductConditionAgainstSnapshot)(snapshot, condition, "cuenta de ahorro activa");
    (0, test_1.expect)(resolution.status).toBe("multiple");
    (0, test_1.expect)(resolution.matches.length).toBe(2);
    (0, test_1.expect)(resolution.selectedIndex).toBe(0);
    (0, test_1.expect)(resolution.diagnostics.matchedCount).toBe(2);
});
