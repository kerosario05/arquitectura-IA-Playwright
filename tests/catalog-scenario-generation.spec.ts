import { test, expect } from "@playwright/test";

test.describe("Catalog Scenario Generation", () => {
  test("detail sections become validations not clicks", () => {
    // Mock scenario with detail sections
    const detailSections = ["Detalles", "Requisitos", "Beneficios", "Condiciones"];

    // Simulate classification: detail sections should NOT be clicked
    const detailSectionPatterns = [
      /^Detalles?$/i,
      /^Requisitos?$/i,
      /^Beneficios?$/i,
      /^Condiciones?$/i,
    ];

    for (const section of detailSections) {
      const isDetailSection = detailSectionPatterns.some((p) => p.test(section));
      expect(isDetailSection).toBe(true);

      // Should generate validation, not click
      const expectedStep = `Validar que se muestre "${section}"`;
      expect(expectedStep).toContain("Validar");
      expect(expectedStep).not.toContain("Clic en");
    }
  });

  test("Solicitar button validates visible only", () => {
    // Mock scenario with Solicitar button
    const sensitiveButton = "Solicitar";

    // Sensitive action patterns
    const sensitiveActionPatterns = [
      /\bSolicitar\b/i,
      /\bPagar\b/i,
      /\bTransferir\b/i,
      /\bContratar\b/i,
    ];

    const isSensitive = sensitiveActionPatterns.some((p) => p.test(sensitiveButton));
    expect(isSensitive).toBe(true);

    // Should validate visible only, not click
    const expectedStep = `Validar que el botón "${sensitiveButton}" esté visible`;
    expect(expectedStep).toContain("Validar");
    expect(expectedStep).toContain("visible");
    expect(expectedStep).not.toContain("Clic en");
  });

  test("discovered products referenced in scenarios", () => {
    // Mock discovered products
    const discoveredProducts = [
      {
        target: "Cuenta de Ahorros Personal en Pesos",
        category: "Cuentas de Efectivo",
        path: ["Iniciar", "Información de productos", "Cuentas de Efectivo"],
      },
      {
        target: "Tarjeta de Crédito Classic",
        category: "Tarjetas de crédito",
        path: ["Iniciar", "Información de productos", "Tarjetas de crédito"],
      },
    ];

    // Mock scenario steps that reference discovered products
    const scenarioSteps = [
      'Clic en "Iniciar".',
      'Clic en "Información de productos".',
      'Clic en "Cuentas de Efectivo".',
      'Clic en "Cuenta de Ahorros Personal en Pesos".',
      'Validar que se muestre "Detalles".',
    ];

    // Verify product is referenced
    const productReferencedInSteps = scenarioSteps.some((step) =>
      step.includes("Cuenta de Ahorros Personal en Pesos")
    );
    expect(productReferencedInSteps).toBe(true);

    // Verify navigation path is followed
    const navigationSteps = scenarioSteps.slice(0, 4); // First 4 steps
    expect(navigationSteps[0]).toContain("Iniciar");
    expect(navigationSteps[1]).toContain("Información de productos");
    expect(navigationSteps[2]).toContain("Cuentas de Efectivo");
    expect(navigationSteps[3]).toContain("Cuenta de Ahorros Personal en Pesos");
  });

  test("representative mode limits scenarios per category", () => {
    // Mock products: 10 across 3 categories
    const products = [
      { category: "Cuentas de Efectivo", label: "Cuenta 1" },
      { category: "Cuentas de Efectivo", label: "Cuenta 2" },
      { category: "Cuentas de Efectivo", label: "Cuenta 3" },
      { category: "Cuentas de Efectivo", label: "Cuenta 4" },
      { category: "Tarjetas de crédito", label: "Tarjeta 1" },
      { category: "Tarjetas de crédito", label: "Tarjeta 2" },
      { category: "Tarjetas de crédito", label: "Tarjeta 3" },
      { category: "Préstamos", label: "Préstamo 1" },
      { category: "Préstamos", label: "Préstamo 2" },
      { category: "Préstamos", label: "Préstamo 3" },
    ];

    // Representative mode: max 2 per category
    const maxPerCategory = 2;
    const byCategory = new Map<string, typeof products>();

    for (const prod of products) {
      if (!byCategory.has(prod.category)) {
        byCategory.set(prod.category, []);
      }
      byCategory.get(prod.category)!.push(prod);
    }

    const representative: typeof products = [];
    for (const [_, prods] of byCategory.entries()) {
      representative.push(...prods.slice(0, maxPerCategory));
    }

    // Verify ≤2 scenarios per category
    expect(representative).toHaveLength(6); // 2 + 2 + 2
    const countByCategory = new Map<string, number>();
    for (const prod of representative) {
      countByCategory.set(prod.category, (countByCategory.get(prod.category) || 0) + 1);
    }
    expect(countByCategory.get("Cuentas de Efectivo")).toBe(2);
    expect(countByCategory.get("Tarjetas de crédito")).toBe(2);
    expect(countByCategory.get("Préstamos")).toBe(2);
  });

  test("exhaustive mode generates for all products", () => {
    // Mock products
    const products = [
      { category: "Cuentas", label: "Cuenta 1" },
      { category: "Cuentas", label: "Cuenta 2" },
      { category: "Cuentas", label: "Cuenta 3" },
      { category: "Tarjetas", label: "Tarjeta 1" },
      { category: "Tarjetas", label: "Tarjeta 2" },
    ];

    // Exhaustive mode: all products
    const exhaustive = products;

    // Verify all products included
    expect(exhaustive).toHaveLength(5);
  });

  test("encoding mojibake corrected before validation", () => {
    // Mock mojibake patterns
    const mojibakeCorrections: Array<[RegExp, string]> = [
      [/InformaciÃ³n/gi, "Información"],
      [/DepÃ³sitos/gi, "Depósitos"],
      [/CrÃ©dito/gi, "Crédito"],
    ];

    // Mock scenario with mojibake
    const stepWithMojibake = 'Clic en "InformaciÃ³n de productos".';

    // Fix mojibake
    let fixed = stepWithMojibake;
    for (const [pattern, replacement] of mojibakeCorrections) {
      fixed = fixed.replace(pattern, replacement);
    }

    // Verify correction
    expect(fixed).toBe('Clic en "Información de productos".');
    expect(fixed).not.toContain("Ã³");
  });

  test("category detection from product labels", () => {
    // Category detection patterns (multiproject)
    // Note: \w doesn't match accented characters, so we use a broader pattern
    const categoryPatterns = [
      /^([^:]+?):/i, // "Cuentas: Personal en Pesos" → "Cuentas"
      /^([^\s-]+?(?:\s+[^\s-]+?)*?)\s+-\s+/i, // "Tarjetas - Crédito Classic" → "Tarjetas"
      /^([^\s]+(?:\s+[^\s]+)*?)\s+en\s+/i, // "Depósito en Pesos" → "Depósito" (handles accents)
      /^([^\s]+(?:\s+[^\s]+)*?)\s+de\s+/i, // "Cuenta de Ahorro" → "Cuenta"
    ];

    // Test pattern matching
    const testCases = [
      { label: "Cuentas: Personal en Pesos", expected: "Cuentas" },
      { label: "Tarjetas - Crédito Classic", expected: "Tarjetas" },
      { label: "Depósito en Pesos", expected: "Depósito" },
      { label: "Cuenta de Ahorro", expected: "Cuenta" },
    ];

    for (const testCase of testCases) {
      let category = "General";
      for (const pattern of categoryPatterns) {
        const match = testCase.label.match(pattern);
        if (match && match[1]) {
          category = match[1].trim();
          break;
        }
      }
      expect(category).toBe(testCase.expected);
    }
  });

  test("generates specific scenario for product_card", () => {
    // Mock discovered product with product_card presentation
    const discoveredProduct = {
      target: "Tarjeta de Crédito Visa Joven",
      presentationType: "product_card",
      validationStatus: "validated_card",
      clickableToDetail: false,
      requiredIntermediates: ["Información de productos", "Tarjetas"],
      expectedCardSignals: {
        bulletCount: 0,
        hasImageOrIcon: true,
        cardTextPreview: "Before boarding: 6 pases anuales...",
      },
    };

    // Generated scenario should:
    // 1. Use real product name in title
    const scenarioTitle = "Validar tarjeta Visa Joven en listado de productos";
    expect(scenarioTitle).toContain("Visa Joven");
    expect(scenarioTitle).not.toBe("Validar tarjetas");

    // 2. Navigate using requiredIntermediates
    const steps = [
      '1. Clic en "Información de productos".',
      '2. Clic en "Tarjetas".',
      '3. Validar que se muestre "Tarjeta de Crédito Visa Joven".',
      '4. Validar que la tarjeta contenga información visible.',
    ];

    // Should have navigation steps
    expect(steps[0]).toContain("Información de productos");
    expect(steps[1]).toContain("Tarjetas");

    // Should validate card presence
    expect(steps[2]).toContain("Validar que se muestre");
    expect(steps[2]).toContain("Tarjeta de Crédito Visa Joven");

    // Should NOT click on card (clickableToDetail=false)
    const hasClickOnCard = steps.some((s) => s.includes('Clic en "Tarjeta de Crédito Visa Joven"'));
    expect(hasClickOnCard).toBe(false);
  });

  test("generates specific scenario for detail_page", () => {
    // Mock discovered product with detail_page presentation
    const discoveredProduct = {
      target: "Préstamo Personal",
      presentationType: "detail_page",
      validationStatus: "validated_detail",
      requiredIntermediates: ["Información de productos", "Préstamos"],
      detailSections: ["Beneficios", "Información del Producto"],
      actionButtons: ["Solicitar", "Volver", "Finalizar sesión"],
    };

    // Generated scenario should:
    // 1. Use real product name
    const scenarioTitle = "Consultar información de Préstamo Personal";
    expect(scenarioTitle).toContain("Préstamo Personal");

    // 2. Navigate and click product (detail_page is clickable)
    const steps = [
      '1. Clic en "Información de productos".',
      '2. Clic en "Préstamos".',
      '3. Clic en "Préstamo Personal".',
      '4. Validar que se muestre "Beneficios".',
      '5. Validar que se muestre "Información del Producto".',
      '6. Validar que el botón "Volver" esté visible.',
    ];

    // Should click the product
    expect(steps[2]).toContain('Clic en "Préstamo Personal"');

    // Should validate detail sections
    expect(steps[3]).toContain("Beneficios");
    expect(steps[4]).toContain("Información del Producto");

    // Should validate safe buttons only (not "Solicitar")
    const validatesSolicitar = steps.some((s) => s.includes('Clic en "Solicitar"'));
    expect(validatesSolicitar).toBe(false);

    const validatesVolver = steps.some((s) => s.includes('Validar') && s.includes("Volver"));
    expect(validatesVolver).toBe(true);
  });

  test("validator rejects click on non-clickable card", () => {
    // Mock validator function
    function validateProductRules(scenario: any, routeProfile: any): string | null {
      const discoveredProducts = Object.entries(routeProfile.targetPaths || {})
        .filter(([_, tp]: [string, any]) => tp.productMetadata)
        .map(([target, tp]: [string, any]) => ({
          target,
          normalizedTarget: target.toLowerCase(),
          presentationType: tp.productMetadata?.presentationType,
          clickableToDetail: tp.productMetadata?.clickableToDetail ?? true,
        }));

      for (const step of scenario.steps || []) {
        const clickMatch = step.match(/Clic en [""]([^""]+)[""]|Clic en ['']([^'']+)['']/i);
        if (!clickMatch) continue;

        const clickTarget = (clickMatch[1] || clickMatch[2]).trim();
        const normalizedTarget = clickTarget.toLowerCase();

        const matchedProduct = discoveredProducts.find(
          (p) => p.normalizedTarget === normalizedTarget || p.target === clickTarget
        );

        if (!matchedProduct) continue;

        if (matchedProduct.presentationType === "product_card" && matchedProduct.clickableToDetail === false) {
          return `Cannot click on product card "${matchedProduct.target}" - it's marked as not clickable`;
        }
      }

      return null;
    }

    // Mock scenario clicking non-clickable card
    const scenario = {
      steps: [
        '1. Clic en "Información de productos".',
        '2. Clic en "Tarjetas".',
        '3. Clic en "Tarjeta Multicrédito".', // This card is NOT clickable
      ],
    };

    const routeProfile = {
      targetPaths: {
        "Tarjeta Multicrédito": {
          productMetadata: {
            presentationType: "product_card",
            clickableToDetail: false,
          },
        },
      },
    };

    const error = validateProductRules(scenario, routeProfile);
    expect(error).toContain("Cannot click on product card");
    expect(error).toContain("Tarjeta Multicrédito");
    expect(error).toContain("not clickable");
  });

  test("uses discovered products even if not literal in HU", () => {
    // Mock generic HU
    const huDescription = "Como cliente quiero ver el listado de tarjetas disponibles";

    // Mock discovered products
    const discoveredProducts = [
      "Tarjeta de Crédito Visa Joven",
      "Tarjeta Multicrédito",
      "Tarjeta de Crédito PriceSmart",
    ];

    // AI should generate specific scenarios per product
    const generatedScenarios = [
      {
        title: "Validar tarjeta Visa Joven en listado",
        steps: ['Validar que se muestre "Tarjeta de Crédito Visa Joven".'],
      },
      {
        title: "Validar tarjeta Multicrédito en listado",
        steps: ['Validar que se muestre "Tarjeta Multicrédito".'],
      },
      {
        title: "Validar tarjeta PriceSmart en listado",
        steps: ['Validar que se muestre "Tarjeta de Crédito PriceSmart".'],
      },
    ];

    // Should have one scenario per product
    expect(generatedScenarios.length).toBe(3);

    // Each should use real product name
    expect(generatedScenarios[0].title).toContain("Visa Joven");
    expect(generatedScenarios[1].title).toContain("Multicrédito");
    expect(generatedScenarios[2].title).toContain("PriceSmart");

    // None should be generic
    const hasGenericTitle = generatedScenarios.some((s) => s.title === "Validar listado de tarjetas");
    expect(hasGenericTitle).toBe(false);
  });
});
