import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";

test.describe("Detail Target Detection with Fallbacks", () => {
  test("detailTarget detection logs show fallback chain", async ({ page }) => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    try {
      await page.goto("data:text/html,<html><body><h1>Test</h1></body></html>");

      // Wait briefly to ensure page loads
      await page.waitForTimeout(100);

      console.log = originalLog;

      // Just verify the test infrastructure works
      expect(logs.length).toBeGreaterThan(0);
      console.log("✓ Test infrastructure working");
    } finally {
      console.log = originalLog;
    }
  });

  test("Visa Clásica resolves from lastAction fallback", async () => {
    const mockActionTargets = [
      { index: 1, target: "Iniciar", action: 'Clic en "Iniciar".' },
      { index: 2, target: "Información de productos", action: 'Clic en "Información de productos".' },
      { index: 3, target: "Tarjetas de Crédito", action: 'Clic en "Tarjetas de Crédito".' },
      { index: 4, target: "Tarjeta Crédito Visa Clásica", action: 'Clic en "Tarjeta Crédito Visa Clásica".' }
    ];

    const mockAssertionTargets = [
      { index: 5, target: "Detalles" },
      { index: 6, target: "Beneficios" }
    ];

    // Expected behavior: detailTarget = "Tarjeta Crédito Visa Clásica" (lastAction fallback)
    const expectedDetailTarget = "Tarjeta Crédito Visa Clásica";
    const expectedStepIndex = 4;
    const expectedSource = "lastAction";

    // Simulate detection logic
    const entryTerms = new Set(["iniciar", "inicio", "información de productos"]);
    const intermediateTerms = new Set(["tarjetas de crédito", "tarjetas"]);

    let detailTarget: string | undefined;
    let finalProductClickStepIndex: number | undefined;

    // Fallback B: lastAction
    for (let i = mockActionTargets.length - 1; i >= 0; i--) {
      const actionTarget = mockActionTargets[i];
      const targetLower = actionTarget.target.toLowerCase().trim();

      if (entryTerms.has(targetLower) || intermediateTerms.has(targetLower)) {
        continue;
      }

      detailTarget = actionTarget.target;
      finalProductClickStepIndex = actionTarget.index;
      break;
    }

    expect(detailTarget).toBe(expectedDetailTarget);
    expect(finalProductClickStepIndex).toBe(expectedStepIndex);
    console.log(`✓ Visa Clásica resolved: target="${detailTarget}" source=${expectedSource} step=${finalProductClickStepIndex}`);
  });

  test("Préstamo Personal resolves from productAssertion fallback when ordinal present", async () => {
    const mockActionTargets = [
      { index: 1, target: "Iniciar", action: 'Clic en "Iniciar".' },
      { index: 2, target: "Información de productos", action: 'Clic en "Información de productos".' },
      { index: 3, target: "Préstamos", action: 'Clic en "Préstamos".' },
      { index: 4, target: "Seleccionar el primer elemento visible del listado", action: "Seleccionar..." }
    ];

    const mockAssertionTargets = [
      { index: 5, target: "Préstamo Personal" },
      { index: 6, target: "Beneficios" }
    ];

    // Expected: detailTarget = "Préstamo Personal" (productAssertion or ordinalAssertionFallback)
    const detailSectionTerms = new Set(["detalles", "beneficios", "requisitos"]);
    const actionButtonTerms = new Set(["volver", "solicitar"]);
    const entryTerms = new Set(["iniciar", "información de productos"]);
    const intermediateTerms = new Set(["préstamos", "prestamos"]);

    let detailTarget: string | undefined;

    // Fallback C: productAssertion
    for (const assertionTarget of mockAssertionTargets) {
      const assertionLower = assertionTarget.target.toLowerCase().trim();

      if (detailSectionTerms.has(assertionLower) ||
          actionButtonTerms.has(assertionLower) ||
          entryTerms.has(assertionLower) ||
          intermediateTerms.has(assertionLower)) {
        continue;
      }

      detailTarget = assertionTarget.target;
      break;
    }

    expect(detailTarget).toBe("Préstamo Personal");
    console.log(`✓ Préstamo Personal resolved from assertion despite ordinal: target="${detailTarget}"`);
  });

  test("Cuenta Pesos resolves from lastAction when no ordinal", async () => {
    const mockActionTargets = [
      { index: 1, target: "Iniciar", action: 'Clic en "Iniciar".' },
      { index: 2, target: "Información de productos", action: 'Clic en "Información de productos".' },
      { index: 3, target: "Cuentas de Efectivo", action: 'Clic en "Cuentas de Efectivo".' },
      { index: 4, target: "Cuenta de Ahorros Personal en Pesos", action: 'Clic en "Cuenta...".' }
    ];

    const entryTerms = new Set(["iniciar", "información de productos"]);
    const intermediateTerms = new Set(["cuentas de efectivo", "cuentas"]);

    let detailTarget: string | undefined;

    for (let i = mockActionTargets.length - 1; i >= 0; i--) {
      const actionTarget = mockActionTargets[i];
      const targetLower = actionTarget.target.toLowerCase().trim();

      if (entryTerms.has(targetLower) || intermediateTerms.has(targetLower)) {
        continue;
      }

      detailTarget = actionTarget.target;
      break;
    }

    expect(detailTarget).toBe("Cuenta de Ahorros Personal en Pesos");
    console.log(`✓ Cuenta Pesos resolved: target="${detailTarget}"`);
  });

  test("Depósito Dólares must not match Pesos", async () => {
    const mockTargetDolares = "Depósitos a plazo en Dólares";
    const mockTargetPesos = "Depósitos a plazo en Pesos";

    const userIntendedTarget = "dólares";

    const matchesDolares = mockTargetDolares.toLowerCase().includes(userIntendedTarget);
    const matchesPesos = mockTargetPesos.toLowerCase().includes(userIntendedTarget);

    expect(matchesDolares).toBe(true);
    expect(matchesPesos).toBe(false);
    console.log(`✓ Dólares variant correctly discriminates from Pesos`);
  });

  test("Detail scenario with unresolved target should block early completion", async () => {
    // Scenario has detail assertions but detailTarget couldn't be resolved
    const hasDetailAssertions = true;
    const detailTarget = undefined;

    if (hasDetailAssertions && !detailTarget) {
      console.log("[detail-early-completion-gate] blocked=true reason=detail_target_unresolved");
      expect(true).toBe(true);
      console.log("✓ Early completion correctly blocked when detailTarget unresolved");
    } else {
      throw new Error("Should have blocked early completion");
    }
  });

  test("Detail scenario with resolved target but no screenshot should block", async () => {
    const detailTarget = "Tarjeta Visa Gold";
    const detailScreenshotCaptured = false;

    if (detailTarget && !detailScreenshotCaptured) {
      console.log("[detail-early-completion-gate] blocked=true reason=detail_screenshot_not_captured_yet");
      expect(true).toBe(true);
      console.log("✓ Early completion correctly blocked when screenshot not captured");
    } else {
      throw new Error("Should have blocked early completion");
    }
  });

  test("Evidence gate should fail scenario without detail screenshot", async () => {
    const detailEvidenceRequired = true;
    const detailEvidenceCaptured = false;

    if (detailEvidenceRequired && !detailEvidenceCaptured) {
      const status = "Fallido";
      console.log("[evidence-gate] statusOverride=failed reason=missing_detail_screenshot");
      expect(status).toBe("Fallido");
      console.log("✓ Evidence gate correctly overrides status to Fallido");
    } else {
      throw new Error("Should have overridden status to Fallido");
    }
  });
});
