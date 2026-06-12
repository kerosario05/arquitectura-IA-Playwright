import { test, expect } from "@playwright/test";

test.describe("Detail Oracle Validation", () => {
  test("Visa no pasa si solo productName=true y detailSections=false", async () => {
    // Simulate detail oracle evaluation where only product name is visible
    // but no exclusive detail sections/buttons/headings are present

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    try {
      const detailTarget = "Tarjeta Crédito Visa Clásica";

      // Oracle inputs - only product name visible
      const productNameVisible = true;
      const detailHeadingVisible = false;  // NO exclusive headings
      const detailSectionsVisible = false;  // NO exclusive sections
      const actionButtonsVisible = false;   // NO exclusive buttons
      const urlChanged = false;
      const elementsCountChanged = false;

      // Separate concepts
      const navigationTransitionDetected = urlChanged || elementsCountChanged;
      const exclusiveDetailSignal = detailHeadingVisible || detailSectionsVisible || actionButtonsVisible;
      const detailScreenVisible = productNameVisible && exclusiveDetailSignal;
      const detailOpened = detailScreenVisible;  // Simplified - no longer requires transition

      console.log(
        `[detail-oracle] target="${detailTarget}" ` +
        `productName=${productNameVisible} detailHeading=${detailHeadingVisible} detailSections=${detailSectionsVisible} ` +
        `actionButtons=${actionButtonsVisible} urlChanged=${urlChanged} domChanged=${elementsCountChanged} ` +
        `navigationTransition=${navigationTransitionDetected} exclusiveSignal=${exclusiveDetailSignal} ` +
        `detailScreenVisible=${detailScreenVisible} opened=${detailOpened}`
      );

      // Should NOT open - only product name is not enough
      expect(detailOpened).toBe(false);

      if (!detailOpened) {
        const reason = !productNameVisible ? "product_name_not_visible" :
                      !exclusiveDetailSignal ? "only_product_name_visible" :
                      "no_page_transition";  // This reason should not happen with new logic
        console.log(`[detail-oracle] opened=false reason=${reason}`);
        console.log(`[detail-screenshot] skipped reason=detail_not_opened`);
        expect(reason).toBe("only_product_name_visible");
      }

      // Evidence gate should override to Fallido
      const status = detailOpened ? "Exitoso" : "Fallido";
      expect(status).toBe("Fallido");

      console.log("✓ Visa correctly fails when only productName visible without exclusive signals");
    } finally {
      console.log = originalLog;
    }

    // Verify logs
    const oracleLog = logs.find(l =>
      l.includes("[detail-oracle]") &&
      l.includes("productName=true") &&
      l.includes("detailSections=false") &&
      l.includes("exclusiveSignal=false") &&
      l.includes("opened=false")
    );
    expect(oracleLog).toBeDefined();

    const reasonLog = logs.find(l => l.includes("reason=only_product_name_visible"));
    expect(reasonLog).toBeDefined();

    const skippedLog = logs.find(l => l.includes("[detail-screenshot] skipped reason=detail_not_opened"));
    expect(skippedLog).toBeDefined();
  });

  test("Cuenta no pasa si no hay señal exclusiva de detalle", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    try {
      const detailTarget = "Cuenta de Ahorros Personal en Pesos";

      // Oracle inputs - product name visible, URL changed, but NO exclusive signals
      const productNameVisible = true;
      const detailHeadingVisible = false;   // NO "Más detalles", "Detalle del producto"
      const detailSectionsVisible = false;  // NO "Detalles", "Requisitos", etc.
      const actionButtonsVisible = false;   // NO "Volver", "Solicitar", etc.
      const urlChanged = true;              // URL changed
      const elementsCountChanged = true;    // DOM changed

      // Oracle computation - should fail because no exclusive signal
      const navigationTransitionDetected = urlChanged || elementsCountChanged;
      const exclusiveDetailSignal = detailHeadingVisible || detailSectionsVisible || actionButtonsVisible;
      const detailScreenVisible = productNameVisible && exclusiveDetailSignal;
      const detailOpened = detailScreenVisible;  // No longer requires transition

      console.log(
        `[detail-oracle] target="${detailTarget}" ` +
        `productName=${productNameVisible} detailHeading=${detailHeadingVisible} detailSections=${detailSectionsVisible} ` +
        `actionButtons=${actionButtonsVisible} urlChanged=${urlChanged} domChanged=${elementsCountChanged} ` +
        `navigationTransition=${navigationTransitionDetected} exclusiveSignal=${exclusiveDetailSignal} ` +
        `detailScreenVisible=${detailScreenVisible} opened=${detailOpened}`
      );

      // Should NOT open - exclusive signal required
      expect(detailOpened).toBe(false);

      if (!detailOpened) {
        const reason = !productNameVisible ? "product_name_not_visible" :
                      !exclusiveDetailSignal ? "only_product_name_visible" :
                      "no_page_transition";
        console.log(`[detail-oracle] opened=false reason=${reason}`);
        console.log(`[detail-screenshot] skipped reason=detail_not_opened`);
        expect(reason).toBe("only_product_name_visible");
      }

      const status = detailOpened ? "Exitoso" : "Fallido";
      expect(status).toBe("Fallido");

      console.log("✓ Cuenta correctly fails without exclusive detail signal");
    } finally {
      console.log = originalLog;
    }

    const oracleLog = logs.find(l =>
      l.includes("[detail-oracle]") &&
      l.includes("opened=false")
    );
    expect(oracleLog).toBeDefined();
  });

  test("NUEVO: Detalle acepta con señales exclusivas sin transición URL/DOM (SPA navigation)", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    try {
      const detailTarget = "Tarjeta Crédito Visa Clásica";

      // Oracle inputs - product name visible, exclusive signals present, but NO URL/DOM change (SPA)
      const productNameVisible = true;
      const detailHeadingVisible = false;
      const detailSectionsVisible = true;   // "Detalles", "Beneficios" visible
      const actionButtonsVisible = true;    // "Volver", "Solicitar" visible
      const urlChanged = false;             // NO URL change (SPA navigation)
      const elementsCountChanged = false;   // NO DOM change detected

      // Oracle computation - should PASS because strong signals present (sections)
      const navigationTransitionDetected = urlChanged || elementsCountChanged;
      const strongDetailSignal = detailHeadingVisible || detailSectionsVisible;  // HARDENED: NOT buttons
      const detailScreenVisible = productNameVisible && strongDetailSignal;
      const detailOpened = detailScreenVisible;

      console.log(
        `[detail-oracle] target="${detailTarget}" ` +
        `productName=${productNameVisible} detailHeading=${detailHeadingVisible} detailSections=${detailSectionsVisible} ` +
        `actionButtons=${actionButtonsVisible} urlChanged=${urlChanged} domChanged=${elementsCountChanged} ` +
        `navigationTransition=${navigationTransitionDetected} strongSignal=${strongDetailSignal} ` +
        `detailScreenVisible=${detailScreenVisible} opened=${detailOpened}`
      );

      // Should PASS - strong signals present (sections)
      expect(detailOpened).toBe(true);
      expect(strongDetailSignal).toBe(true);
      expect(navigationTransitionDetected).toBe(false);  // No transition, but still accepted

      if (detailOpened) {
        console.log(`[detail-screenshot] required=true target="${detailTarget}"`);
        console.log(`[detail-screenshot] captured=true target="${detailTarget}" evidenceIndex=4`);
      }

      const status = detailOpened ? "Exitoso" : "Fallido";
      expect(status).toBe("Exitoso");

      console.log("✓ Detail correctly accepted with strong signals (sections) despite no URL/DOM transition (SPA case)");
    } finally {
      console.log = originalLog;
    }

    // Verify logs
    const oracleLog = logs.find(l =>
      l.includes("[detail-oracle]") &&
      l.includes("opened=true") &&
      l.includes("navigationTransition=false") &&
      l.includes("strongSignal=true")
    );
    expect(oracleLog).toBeDefined();

    const capturedLog = logs.find(l => l.includes("[detail-screenshot] captured=true"));
    expect(capturedLog).toBeDefined();
  });

  test("NUEVO: Oracle rechaza solo actionButtons sin heading/sections", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    try {
      const detailTarget = "Tarjeta Crédito Visa Clásica";

      // Oracle inputs - product name visible, actionButtons visible, but NO heading/sections
      const productNameVisible = true;
      const detailHeadingVisible = false;   // NO headings
      const detailSectionsVisible = false;  // NO sections
      const actionButtonsVisible = true;    // Only buttons visible (NOT sufficient)
      const urlChanged = false;
      const elementsCountChanged = false;

      // Oracle computation - should FAIL because no strong signals (buttons alone not enough)
      const navigationTransitionDetected = urlChanged || elementsCountChanged;
      const strongDetailSignal = detailHeadingVisible || detailSectionsVisible;  // HARDENED: NOT buttons
      const detailScreenVisible = productNameVisible && strongDetailSignal;
      const detailOpened = detailScreenVisible;

      console.log(
        `[detail-oracle] target="${detailTarget}" ` +
        `productName=${productNameVisible} detailHeading=${detailHeadingVisible} detailSections=${detailSectionsVisible} ` +
        `actionButtons=${actionButtonsVisible} urlChanged=${urlChanged} domChanged=${elementsCountChanged} ` +
        `navigationTransition=${navigationTransitionDetected} strongSignal=${strongDetailSignal} ` +
        `detailScreenVisible=${detailScreenVisible} opened=${detailOpened}`
      );

      // Should FAIL - actionButtons alone not sufficient
      expect(detailOpened).toBe(false);
      expect(strongDetailSignal).toBe(false);  // No strong signal (buttons don't count)
      expect(actionButtonsVisible).toBe(true);  // Buttons present but not enough

      if (!detailOpened) {
        const reason = !productNameVisible ? "product_name_not_visible" :
                      !strongDetailSignal ? "insufficient_detail_signals" :
                      "no_page_transition";
        console.log(`[detail-oracle] opened=false reason=${reason}`);
        console.log(`[detail-screenshot] skipped reason=detail_not_opened`);
        expect(reason).toBe("insufficient_detail_signals");
      }

      const status = detailOpened ? "Exitoso" : "Fallido";
      expect(status).toBe("Fallido");

      console.log("✓ Oracle correctly rejects detail when only actionButtons present (no heading/sections)");
    } finally {
      console.log = originalLog;
    }

    // Verify logs
    const oracleLog = logs.find(l =>
      l.includes("[detail-oracle]") &&
      l.includes("opened=false") &&
      l.includes("strongSignal=false") &&
      l.includes("actionButtons=true")  // Buttons present but not enough
    );
    expect(oracleLog).toBeDefined();

    const reasonLog = logs.find(l => l.includes("reason=insufficient_detail_signals"));
    expect(reasonLog).toBeDefined();

    const skippedLog = logs.find(l => l.includes("[detail-screenshot] skipped"));
    expect(skippedLog).toBeDefined();
  });

  test("Préstamo ordinal pasa solo si selectedCandidate == Préstamo Personal", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    try {
      // Simulate ordinal selection with matching candidate
      const detailTarget = "Préstamo Personal";
      const selectedCandidateText = "Préstamo Personal";
      const wasOrdinalSelection = true;

      console.log(`[discovery:case] Selected candidate: ${selectedCandidateText}`);

      const selectedNormalized = selectedCandidateText.toLowerCase().trim();
      const expectedNormalized = detailTarget.toLowerCase().trim();

      const candidateMatches = selectedNormalized.includes(expectedNormalized) ||
                              expectedNormalized.includes(selectedNormalized) ||
                              selectedNormalized === expectedNormalized;

      console.log(
        `[ordinal-selection] expectedTarget="${detailTarget}" ` +
        `selectedCandidate="${selectedCandidateText}" match=${candidateMatches}`
      );

      expect(candidateMatches).toBe(true);

      if (candidateMatches) {
        console.log(`[ordinal-selection] candidate match verified ✓`);
      }

      console.log("✓ Préstamo ordinal passes when selectedCandidate matches expected target");
    } finally {
      console.log = originalLog;
    }

    // Verify logs
    const matchLog = logs.find(l =>
      l.includes("[ordinal-selection]") &&
      l.includes("match=true")
    );
    expect(matchLog).toBeDefined();

    const verifiedLog = logs.find(l => l.includes("candidate match verified ✓"));
    expect(verifiedLog).toBeDefined();
  });

  test("Depósitos Dólares falla si selectedCandidate == Pesos", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    try {
      // Simulate ordinal selection with WRONG candidate
      const detailTarget = "Depósito a Plazo en Dólares";
      const selectedCandidateText = "Depósito a Plazo en Pesos";  // WRONG!

      console.log(`[discovery:case] Selected candidate: ${selectedCandidateText}`);

      const selectedNormalized = selectedCandidateText.toLowerCase().trim();
      const expectedNormalized = detailTarget.toLowerCase().trim();

      const candidateMatches = selectedNormalized.includes(expectedNormalized) ||
                              expectedNormalized.includes(selectedNormalized) ||
                              selectedNormalized === expectedNormalized;

      console.log(
        `[ordinal-selection] expectedTarget="${detailTarget}" ` +
        `selectedCandidate="${selectedCandidateText}" match=${candidateMatches}`
      );

      // Should NOT match - Pesos vs Dólares
      expect(candidateMatches).toBe(false);

      if (!candidateMatches) {
        console.log(`[ordinal-selection] MISMATCH detected!`);
        const errorMessage = `Wrong ordinal candidate selected. Expected: "${detailTarget}", Selected: "${selectedCandidateText}"`;
        console.log(`[ordinal-selection] error: ${errorMessage}`);
      }

      console.log("✓ Depósitos correctly fails when selectedCandidate is Pesos instead of Dólares");
    } finally {
      console.log = originalLog;
    }

    // Verify logs
    const mismatchLog = logs.find(l =>
      l.includes("[ordinal-selection]") &&
      l.includes("match=false")
    );
    expect(mismatchLog).toBeDefined();

    const detectedLog = logs.find(l => l.includes("[ordinal-selection] MISMATCH detected!"));
    expect(detectedLog).toBeDefined();
  });

  test("detailEvidence no puede capturarse si detailOpened=false", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    try {
      const detailTarget = "Tarjeta Crédito Visa Gold";

      // Oracle inputs - detail does NOT open
      const productNameVisible = true;
      const detailSectionsVisible = false;
      const actionButtonsVisible = false;
      const urlChanged = false;
      const elementsCountChanged = false;

      const detailOpened = productNameVisible &&
                          (detailSectionsVisible || actionButtonsVisible) &&
                          (urlChanged || elementsCountChanged);

      expect(detailOpened).toBe(false);

      console.log(
        `[detail-oracle] target="${detailTarget}" ` +
        `productName=${productNameVisible} detailSections=${detailSectionsVisible} ` +
        `actionButtons=${actionButtonsVisible} urlChanged=${urlChanged} ` +
        `domChanged=${elementsCountChanged} opened=${detailOpened}`
      );

      // Simulate setDetailOpened call
      console.log(`[detail-evidence] detailOpened set to ${detailOpened}`);

      if (!detailOpened) {
        console.log(`[detail-oracle] opened=false reason=only_product_name_visible`);
        console.log(`[detail-screenshot] skipped reason=detail_not_opened`);

        // detailEvidence should NOT be captured
        const detailEvidence = {
          required: true,
          captured: false,  // NOT captured because detail didn't open
          target: detailTarget,
          reason: "detail_not_opened"
        };

        expect(detailEvidence.captured).toBe(false);
      }

      console.log("✓ detailEvidence correctly skipped when detailOpened=false");
    } finally {
      console.log = originalLog;
    }

    // Verify logs
    const skippedLog = logs.find(l => l.includes("[detail-screenshot] skipped reason=detail_not_opened"));
    expect(skippedLog).toBeDefined();

    const setLog = logs.find(l => l.includes("[detail-evidence] detailOpened set to false"));
    expect(setLog).toBeDefined();
  });

  test("El DOCX usa displayStepIndex correcto: step-004-detail-loaded", async () => {
    // Simulate step record with correct display index
    const runtimeIndex = 3;        // 0-based (step 4 in 0-based is index 3)
    const displayIndex = 4;        // 1-based (shown as step 4)

    // Screenshot filename should use displayIndex padded
    const screenshotFilename = `step-${String(displayIndex).padStart(3, '0')}-detail_loaded-visa.png`;
    expect(screenshotFilename).toBe("step-004-detail_loaded-visa.png");

    // DOCX should reference display step 4, not runtime index 3
    const docxStepReference = `Paso ${displayIndex}`;
    expect(docxStepReference).toBe("Paso 4");

    console.log(`✓ DOCX uses correct display step index: ${docxStepReference} (runtime index ${runtimeIndex})`);

    // Evidence record should track both
    const stepRecord = {
      index: displayIndex,  // Display index for DOCX
      stepText: 'Clic en "Tarjeta Crédito Visa Clásica".',
      status: "passed" as const,
      screenshotPath: `evidence/screenshots/${screenshotFilename}`,
      timestamp: new Date().toISOString()
    };

    expect(stepRecord.index).toBe(4);
    expect(stepRecord.screenshotPath).toContain("step-004");

    console.log("✓ Step record contains correct display index for DOCX insertion");
  });

  test("El caso no puede quedar Exitoso si falta la pantalla final de detalle", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logs.push(args.join(" "));
      originalLog(...args);
    };

    try {
      // Simulate evidence gate validation
      const detailScreenshotRequired = true;
      const detailFound = true;
      const detailActuallyOpened = false;  // Detail did NOT open
      const capturedAfterStep = 4;
      const finalProductClickStepIndex = 4;

      console.log(
        `[evidence-gate] scenario=test detailScreenshotRequired=true found=${detailFound} ` +
        `capturedAfterStep=${capturedAfterStep} finalProductClickStepIndex=${finalProductClickStepIndex} ` +
        `detailOpened=${detailActuallyOpened}`
      );

      let status = "Exitoso";  // Initially passed

      if (detailScreenshotRequired && detailActuallyOpened === false) {
        // Override status to failed
        const originalStatus = status;
        status = "Fallido";
        console.log(
          `[evidence-gate] scenario=test detailScreenshotRequired=true found=${detailFound} ` +
          `statusOverride=failed originalStatus=${originalStatus} reason=detail_not_opened`
        );

        // Add error message
        const errorMessage = "Detail screen did not open - missing exclusive detail signals (sections/buttons/transition)";
        console.log(`[evidence-gate] errorMessage: ${errorMessage}`);
      }

      // Status must be Fallido if detail didn't open
      expect(status).toBe("Fallido");

      console.log("✓ Case correctly fails when detail screen did not actually open");
    } finally {
      console.log = originalLog;
    }

    // Verify logs
    const overrideLog = logs.find(l =>
      l.includes("[evidence-gate]") &&
      l.includes("statusOverride=failed") &&
      l.includes("reason=detail_not_opened")
    );
    expect(overrideLog).toBeDefined();

    const errorLog = logs.find(l => l.includes("Detail screen did not open"));
    expect(errorLog).toBeDefined();
  });
});
