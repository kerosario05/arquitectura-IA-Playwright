import { test, expect } from "@playwright/test";
import { evaluateEarlyCompletionPolicy } from "../src/discovery/early-completion-policy";
import type { ActionTargetItem } from "../src/discovery/step-intent-parser";

test.describe("Critical Assertion Gate", () => {
  test("blocks early completion when critical assertions are pending", () => {
    const pendingActions: ActionTargetItem[] = [];
    const executedStepIndices = new Set([1, 2, 3]);
    const skippedSteps: Array<{ targetText: string; status: string; recoveredBy?: string; index?: number }> = [];

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

    const result = evaluateEarlyCompletionPolicy({
      pendingActions,
      executedStepIndices,
      skippedSteps,
      satisfiedAssertions,
      pendingAssertions,
      criticalAssertions
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("pending_critical_assertions");
    console.log(`✓ Early completion blocked with critical assertions pending`);
  });

  test("allows early completion when all critical assertions are satisfied", () => {
    const pendingActions: ActionTargetItem[] = [];
    const executedStepIndices = new Set([1, 2, 3, 4, 5]);
    const skippedSteps: Array<{ targetText: string; status: string; recoveredBy?: string; index?: number }> = [];

    const satisfiedAssertions = [
      "Se muestra Iniciar",
      "Se muestra Información de productos",
      "Se muestra Tarjeta Crédito Visa Clásica",
      "Se muestra Beneficios",
      "Se muestra Detalles",
      "Botón Solicitar visible",
      "Botón Volver visible"
    ];
    const pendingAssertions: string[] = [];

    const criticalAssertions = {
      target: "Tarjeta Crédito Visa Clásica",
      detailSections: ["Beneficios", "Detalles"],
      actionButtons: ["Solicitar", "Volver"]
    };

    const result = evaluateEarlyCompletionPolicy({
      pendingActions,
      executedStepIndices,
      skippedSteps,
      satisfiedAssertions,
      pendingAssertions,
      criticalAssertions
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("no_actions_remaining");
    console.log(`✓ Early completion allowed when all critical assertions satisfied`);
  });

  test("blocks when product name pending", () => {
    const pendingActions: ActionTargetItem[] = [];
    const executedStepIndices = new Set([1, 2, 3]);
    const skippedSteps: Array<{ targetText: string; status: string; recoveredBy?: string; index?: number }> = [];

    const satisfiedAssertions = ["Se muestra Beneficios", "Se muestra Detalles"];
    const pendingAssertions = ["Se muestra Préstamo Personal"];

    const criticalAssertions = {
      target: "Préstamo Personal",
      detailSections: ["Detalles", "Requisitos"],
      actionButtons: ["Solicitar"]
    };

    const result = evaluateEarlyCompletionPolicy({
      pendingActions,
      executedStepIndices,
      skippedSteps,
      satisfiedAssertions,
      pendingAssertions,
      criticalAssertions
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("pending_critical_assertions");
    console.log(`✓ Blocked when product name is pending`);
  });

  test("blocks when detail sections pending", () => {
    const pendingActions: ActionTargetItem[] = [];
    const executedStepIndices = new Set([1, 2, 3, 4]);
    const skippedSteps: Array<{ targetText: string; status: string; recoveredBy?: string; index?: number }> = [];

    const satisfiedAssertions = ["Se muestra Depósito a Plazo en Dólares"];
    const pendingAssertions = ["Se muestra Detalles del producto", "Se muestra Requisitos"];

    const criticalAssertions = {
      target: "Depósito a Plazo en Dólares",
      detailSections: ["Detalles del producto", "Requisitos"],
      actionButtons: []
    };

    const result = evaluateEarlyCompletionPolicy({
      pendingActions,
      executedStepIndices,
      skippedSteps,
      satisfiedAssertions,
      pendingAssertions,
      criticalAssertions
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("pending_critical_assertions");
    console.log(`✓ Blocked when detail sections are pending`);
  });

  test("blocks when action buttons pending", () => {
    const pendingActions: ActionTargetItem[] = [];
    const executedStepIndices = new Set([1, 2, 3, 4, 5]);
    const skippedSteps: Array<{ targetText: string; status: string; recoveredBy?: string; index?: number }> = [];

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

    const result = evaluateEarlyCompletionPolicy({
      pendingActions,
      executedStepIndices,
      skippedSteps,
      satisfiedAssertions,
      pendingAssertions,
      criticalAssertions
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("pending_critical_assertions");
    console.log(`✓ Blocked when action buttons are pending`);
  });

  test("works without criticalAssertions (backward compatible)", () => {
    const pendingActions: ActionTargetItem[] = [];
    const executedStepIndices = new Set([1, 2, 3]);
    const skippedSteps: Array<{ targetText: string; status: string; recoveredBy?: string; index?: number }> = [];

    const satisfiedAssertions = ["Se muestra Iniciar"];
    const pendingAssertions: string[] = [];

    const result = evaluateEarlyCompletionPolicy({
      pendingActions,
      executedStepIndices,
      skippedSteps,
      satisfiedAssertions,
      pendingAssertions
      // No criticalAssertions provided
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("no_actions_remaining");
    console.log(`✓ Backward compatible - works without criticalAssertions`);
  });
});
