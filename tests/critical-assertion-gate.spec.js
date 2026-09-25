"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const early_completion_policy_1 = require("../src/discovery/early-completion-policy");
test_1.test.describe("Critical Assertion Gate", () => {
    (0, test_1.test)("blocks early completion when critical assertions are pending", () => {
        const pendingActions = [];
        const executedStepIndices = new Set([1, 2, 3]);
        const skippedSteps = [];
        const satisfiedAssertions = ["Se muestra Iniciar", "Se muestra Información de productos"];
        const pendingAssertions = [
            "Se muestra Tarjeta Crédito Visa Clásica",
            "Se muestra Beneficios",
            "Se muestra Detalles"
        ];
        const criticalAssertions = {
            target: "Tarjeta Crédito Visa Clásica",
            detailSections: ["Beneficios", "Detalles"],
            actionButtons: ["Solicitar", "Volver"]
        };
        const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
            pendingActions,
            executedStepIndices,
            skippedSteps,
            satisfiedAssertions,
            pendingAssertions,
            criticalAssertions
        });
        (0, test_1.expect)(result.allowed).toBe(false);
        (0, test_1.expect)(result.reason).toBe("pending_critical_assertions");
        console.log(`✓ Early completion blocked with critical assertions pending`);
    });
    (0, test_1.test)("allows early completion when all critical assertions are satisfied", () => {
        const pendingActions = [];
        const executedStepIndices = new Set([1, 2, 3, 4, 5]);
        const skippedSteps = [];
        const satisfiedAssertions = [
            "Se muestra Iniciar",
            "Se muestra Información de productos",
            "Se muestra Tarjeta Crédito Visa Clásica",
            "Se muestra Beneficios",
            "Se muestra Detalles",
            "Botón Solicitar visible",
            "Botón Volver visible"
        ];
        const pendingAssertions = [];
        const criticalAssertions = {
            target: "Tarjeta Crédito Visa Clásica",
            detailSections: ["Beneficios", "Detalles"],
            actionButtons: ["Solicitar", "Volver"]
        };
        const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
            pendingActions,
            executedStepIndices,
            skippedSteps,
            satisfiedAssertions,
            pendingAssertions,
            criticalAssertions
        });
        (0, test_1.expect)(result.allowed).toBe(true);
        (0, test_1.expect)(result.reason).toBe("no_actions_remaining");
        console.log(`✓ Early completion allowed when all critical assertions satisfied`);
    });
    (0, test_1.test)("blocks when product name pending", () => {
        const pendingActions = [];
        const executedStepIndices = new Set([1, 2, 3]);
        const skippedSteps = [];
        const satisfiedAssertions = ["Se muestra Beneficios", "Se muestra Detalles"];
        const pendingAssertions = ["Se muestra Préstamo Personal"];
        const criticalAssertions = {
            target: "Préstamo Personal",
            detailSections: ["Detalles", "Requisitos"],
            actionButtons: ["Solicitar"]
        };
        const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
            pendingActions,
            executedStepIndices,
            skippedSteps,
            satisfiedAssertions,
            pendingAssertions,
            criticalAssertions
        });
        (0, test_1.expect)(result.allowed).toBe(false);
        (0, test_1.expect)(result.reason).toBe("pending_critical_assertions");
        console.log(`✓ Blocked when product name is pending`);
    });
    (0, test_1.test)("blocks when detail sections pending", () => {
        const pendingActions = [];
        const executedStepIndices = new Set([1, 2, 3, 4]);
        const skippedSteps = [];
        const satisfiedAssertions = ["Se muestra Depósito a Plazo en Dólares"];
        const pendingAssertions = ["Se muestra Detalles del producto", "Se muestra Requisitos"];
        const criticalAssertions = {
            target: "Depósito a Plazo en Dólares",
            detailSections: ["Detalles del producto", "Requisitos"],
            actionButtons: []
        };
        const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
            pendingActions,
            executedStepIndices,
            skippedSteps,
            satisfiedAssertions,
            pendingAssertions,
            criticalAssertions
        });
        (0, test_1.expect)(result.allowed).toBe(false);
        (0, test_1.expect)(result.reason).toBe("pending_critical_assertions");
        console.log(`✓ Blocked when detail sections are pending`);
    });
    (0, test_1.test)("blocks when action buttons pending", () => {
        const pendingActions = [];
        const executedStepIndices = new Set([1, 2, 3, 4, 5]);
        const skippedSteps = [];
        const satisfiedAssertions = [
            "Se muestra Cuenta de Ahorros Personal en Euros",
            "Se muestra Detalles"
        ];
        const pendingAssertions = ["Botón Volver visible", "Botón Solicitar visible"];
        const criticalAssertions = {
            target: "Cuenta de Ahorros Personal en Euros",
            detailSections: ["Detalles"],
            actionButtons: ["Volver", "Solicitar"]
        };
        const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
            pendingActions,
            executedStepIndices,
            skippedSteps,
            satisfiedAssertions,
            pendingAssertions,
            criticalAssertions
        });
        (0, test_1.expect)(result.allowed).toBe(false);
        (0, test_1.expect)(result.reason).toBe("pending_critical_assertions");
        console.log(`✓ Blocked when action buttons are pending`);
    });
    (0, test_1.test)("works without criticalAssertions (backward compatible)", () => {
        const pendingActions = [];
        const executedStepIndices = new Set([1, 2, 3]);
        const skippedSteps = [];
        const satisfiedAssertions = ["Se muestra Iniciar"];
        const pendingAssertions = [];
        const result = (0, early_completion_policy_1.evaluateEarlyCompletionPolicy)({
            pendingActions,
            executedStepIndices,
            skippedSteps,
            satisfiedAssertions,
            pendingAssertions
            // No criticalAssertions provided
        });
        (0, test_1.expect)(result.allowed).toBe(true);
        (0, test_1.expect)(result.reason).toBe("no_actions_remaining");
        console.log(`✓ Backward compatible - works without criticalAssertions`);
    });
});
