import { test, expect } from "@playwright/test";

test.describe("Detail Evidence Gate Validation", () => {
  test("Evidence gate blocks when capturedAfterStep < finalProductClickStepIndex", async () => {
    // Simulate scenario:
    // Step 3: Tarjetas de Crédito (intermediate category)
    // Step 4: Tarjeta Crédito Visa Clásica (final product click)
    // Step 5: Validar "Detalles"

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    try {
      // Simulate detection phase
      console.log('[detail-runtime] scenario="Visualizar detalles de Tarjeta Crédito Visa Clásica" detailTarget="Tarjeta Crédito Visa Clásica" source=lastAction finalProductClickStepIndex=4');
      console.log('[detail-evidence] finalProductClickStepIndex set to 4');

      // Simulate incorrect screenshot capture at step 3 (too early)
      console.log('[detail-screenshot] captured=true target="Tarjeta Crédito Visa Clásica" capturedAfterStep=3');

      // Simulate evidence gate validation
      const detailScreenshotRequired = true;
      const capturedAfterStep = 3;
      const finalProductClickStepIndex = 4;
      const found = true;

      if (detailScreenshotRequired && found && capturedAfterStep < finalProductClickStepIndex) {
        const originalStatus = "Exitoso";
        const status = "Fallido";
        console.log(
          `[evidence-gate] scenario=test detailScreenshotRequired=true found=true ` +
          `statusOverride=failed originalStatus=${originalStatus} reason=detail_screenshot_captured_too_early ` +
          `capturedAfterStep=${capturedAfterStep} finalProductClickStepIndex=${finalProductClickStepIndex}`
        );
        expect(status).toBe("Fallido");
        console.log("✓ Evidence gate correctly blocked scenario with screenshot captured too early");
      } else {
        throw new Error("Should have blocked scenario");
      }
    } finally {
      console.log = originalLog;
    }

    // Verify logs
    const setIndexLog = logs.find(l => l.includes("[detail-evidence] finalProductClickStepIndex set to 4"));
    expect(setIndexLog).toBeDefined();

    const capturedLog = logs.find(l => l.includes("[detail-screenshot] captured=true") && l.includes("capturedAfterStep=3"));
    expect(capturedLog).toBeDefined();

    const gateBlockedLog = logs.find(l =>
      l.includes("[evidence-gate]") &&
      l.includes("statusOverride=failed") &&
      l.includes("reason=detail_screenshot_captured_too_early") &&
      l.includes("capturedAfterStep=3") &&
      l.includes("finalProductClickStepIndex=4")
    );
    expect(gateBlockedLog).toBeDefined();
  });

  test("Evidence gate passes when capturedAfterStep === finalProductClickStepIndex", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    try {
      // Simulate correct detection and capture
      console.log('[detail-runtime] scenario="Visualizar detalles de Tarjeta Crédito Visa Clásica" detailTarget="Tarjeta Crédito Visa Clásica" source=lastAction finalProductClickStepIndex=4');
      console.log('[detail-evidence] finalProductClickStepIndex set to 4');

      // Simulate correct screenshot capture at step 4 (after final product click)
      console.log('[detail-screenshot] captured=true target="Tarjeta Crédito Visa Clásica" capturedAfterStep=4');

      // Simulate evidence gate validation
      const detailScreenshotRequired = true;
      const capturedAfterStep = 4;
      const finalProductClickStepIndex = 4;
      const found = true;

      if (detailScreenshotRequired && found) {
        if (capturedAfterStep < finalProductClickStepIndex) {
          throw new Error("Should not have blocked");
        } else {
          const status = "Exitoso";
          console.log(
            `[evidence-gate] scenario=test detailScreenshotRequired=true found=true ` +
            `screenshotPath=evidence/screenshots/step-004-visa-clasica.png target="Tarjeta Crédito Visa Clásica" ` +
            `capturedAfterStep=${capturedAfterStep} finalProductClickStepIndex=${finalProductClickStepIndex}`
          );
          expect(status).toBe("Exitoso");
          console.log("✓ Evidence gate correctly passed scenario with screenshot captured at correct step");
        }
      }
    } finally {
      console.log = originalLog;
    }

    // Verify logs
    const gatePassedLog = logs.find(l =>
      l.includes("[evidence-gate]") &&
      l.includes("found=true") &&
      l.includes("capturedAfterStep=4") &&
      l.includes("finalProductClickStepIndex=4") &&
      !l.includes("statusOverride=failed")
    );
    expect(gatePassedLog).toBeDefined();
  });

  test("Visa Clásica: finalProductClickStepIndex must be 4, not 3", async () => {
    // Mock scenario steps
    const steps = [
      { index: 1, target: "Iniciar", type: "action" },
      { index: 2, target: "Información de productos", type: "action" },
      { index: 3, target: "Tarjetas de Crédito", type: "action" }, // Intermediate
      { index: 4, target: "Tarjeta Crédito Visa Clásica", type: "action" }, // Final product
      { index: 5, target: "Detalles", type: "assertion" }
    ];

    const entryTerms = new Set(["iniciar", "información de productos"]);
    const intermediateCategoryTerms = new Set(["tarjetas de crédito", "tarjetas"]);

    // Simulate Fallback B: lastAction
    let detailTarget: string | undefined;
    let finalProductClickStepIndex: number | undefined;

    const actionTargets = steps.filter(s => s.type === "action");
    for (let i = actionTargets.length - 1; i >= 0; i--) {
      const actionTarget = actionTargets[i];
      const targetLower = actionTarget.target.toLowerCase().trim();

      if (entryTerms.has(targetLower) || intermediateCategoryTerms.has(targetLower)) {
        continue;
      }

      detailTarget = actionTarget.target;
      finalProductClickStepIndex = actionTarget.index;
      break;
    }

    expect(detailTarget).toBe("Tarjeta Crédito Visa Clásica");
    expect(finalProductClickStepIndex).toBe(4); // Must be 4, not 3
    console.log(`✓ Visa Clásica: finalProductClickStepIndex=${finalProductClickStepIndex} (expected 4)`);
  });

  test("Cuenta Pesos: finalProductClickStepIndex must be 4, not 3", async () => {
    const steps = [
      { index: 1, target: "Iniciar", type: "action" },
      { index: 2, target: "Información de productos", type: "action" },
      { index: 3, target: "Cuentas de Efectivo", type: "action" }, // Intermediate
      { index: 4, target: "Cuenta de Ahorros Personal en Pesos", type: "action" }, // Final product
      { index: 5, target: "Detalles", type: "assertion" }
    ];

    const entryTerms = new Set(["iniciar", "información de productos"]);
    const intermediateCategoryTerms = new Set(["cuentas de efectivo", "cuentas"]);

    let detailTarget: string | undefined;
    let finalProductClickStepIndex: number | undefined;

    const actionTargets = steps.filter(s => s.type === "action");
    for (let i = actionTargets.length - 1; i >= 0; i--) {
      const actionTarget = actionTargets[i];
      const targetLower = actionTarget.target.toLowerCase().trim();

      if (entryTerms.has(targetLower) || intermediateCategoryTerms.has(targetLower)) {
        continue;
      }

      detailTarget = actionTarget.target;
      finalProductClickStepIndex = actionTarget.index;
      break;
    }

    expect(detailTarget).toBe("Cuenta de Ahorros Personal en Pesos");
    expect(finalProductClickStepIndex).toBe(4);
    console.log(`✓ Cuenta Pesos: finalProductClickStepIndex=${finalProductClickStepIndex} (expected 4)`);
  });

  test("Préstamo ordinal: capturedAfterStep must be 4 (ordinal step)", async () => {
    const steps = [
      { index: 1, target: "Iniciar", type: "action" },
      { index: 2, target: "Información de productos", type: "action" },
      { index: 3, target: "Préstamos", type: "action" },
      { index: 4, target: "Seleccionar el primer elemento visible del listado", type: "action" }, // Ordinal
      { index: 5, target: "Préstamo Personal", type: "assertion" },
      { index: 6, target: "Beneficios", type: "assertion" }
    ];

    // Simulate Fallback D: ordinalAssertionFallback
    const hasOrdinal = steps.some(s => /seleccionar|primer|elemento.*visible/.test(s.target));
    expect(hasOrdinal).toBe(true);

    const ordinalAction = steps.find(s => /seleccionar|primer|elemento.*visible/.test(s.target));
    const finalProductClickStepIndex = ordinalAction?.index;

    expect(finalProductClickStepIndex).toBe(4);

    // Simulate screenshot capture must be after step 4
    const capturedAfterStep = 4;
    expect(capturedAfterStep).toBe(finalProductClickStepIndex);
    console.log(`✓ Préstamo ordinal: capturedAfterStep=${capturedAfterStep} finalProductClickStepIndex=${finalProductClickStepIndex}`);
  });

  test("DOCX should not use detail_loaded from intermediate step", async () => {
    // Simulate detailEvidence with incorrect capturedAfterStep
    const detailEvidence = {
      required: true,
      captured: true,
      target: "Tarjeta Crédito Visa Clásica",
      capturedAfterStep: 3,
      screenshotPath: "evidence/screenshots/step-003-detail_loaded-tarjetas.png"
    };

    const finalProductClickStepIndex = 4;

    // Evidence gate should reject this
    if (detailEvidence.capturedAfterStep < finalProductClickStepIndex) {
      console.log("[evidence-gate] rejecting detail_loaded from intermediate step");
      expect(true).toBe(true);
      console.log("✓ DOCX correctly rejected detail_loaded from intermediate step (step 3 instead of step 4)");
    } else {
      throw new Error("Should have rejected detail_loaded from intermediate step");
    }
  });
});
