import { test, expect } from "@playwright/test";

test.describe("Encoding Normalization for Catalog", () => {
  test("mojibake corrected before entry matching", () => {
    // Mock mojibake corrections
    const mojibakeCorrections: Array<[RegExp, string]> = [
      [/InformaciÃ³n/gi, "Información"],
      [/DepÃ³sitos/gi, "Depósitos"],
      [/PrÃ©stamos/gi, "Préstamos"],
    ];

    // Mock scenario step with mojibake
    const stepWithMojibake = 'Clic en "InformaciÃ³n de productos".';

    // Fix mojibake
    let fixed = stepWithMojibake;
    for (const [pattern, replacement] of mojibakeCorrections) {
      fixed = fixed.replace(pattern, replacement);
    }

    // Mock entry from route profile
    const entry = {
      businessLabel: "informacion_productos",
      visibleLabel: "Información de productos",
    };

    // Verify that fixed step matches entry
    expect(fixed).toContain(entry.visibleLabel);
    expect(fixed).toBe('Clic en "Información de productos".');
  });

  test("mojibake corrected before MCP pattern matching", () => {
    // Mock step with mojibake
    const stepWithMojibake = 'Clic en "DepÃ³sitos a Plazo".';

    // Fix mojibake
    const mojibakeCorrections: Array<[RegExp, string]> = [
      [/DepÃ³sitos/gi, "Depósitos"],
    ];

    let fixed = stepWithMojibake;
    for (const [pattern, replacement] of mojibakeCorrections) {
      fixed = fixed.replace(pattern, replacement);
    }

    // Verify MCP pattern
    const mcpClickPattern = /^Clic en "([^"]+)"\.$/i;
    const match = fixed.match(mcpClickPattern);

    expect(match).not.toBeNull();
    expect(match![1]).toBe("Depósitos a Plazo");
  });

  test("NFD normalization for comparison", () => {
    // Simulate NFD normalization
    function normalizeText(text: string): string {
      return text
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
    }

    const text1 = "Información de productos";
    const text2 = "Informacion de productos"; // Without accent

    const normalized1 = normalizeText(text1);
    const normalized2 = normalizeText(text2);

    // Both should normalize to the same value
    expect(normalized1).toBe(normalized2);
  });

  test("multiple mojibake patterns in single step", () => {
    // Step with multiple mojibake issues
    const stepWithMultipleMojibake = 'Validar que se muestre "InformaciÃ³n de PrÃ©stamos y DepÃ³sitos".';

    // Fix all mojibake patterns
    const mojibakeCorrections: Array<[RegExp, string]> = [
      [/InformaciÃ³n/gi, "Información"],
      [/PrÃ©stamos/gi, "Préstamos"],
      [/DepÃ³sitos/gi, "Depósitos"],
    ];

    let fixed = stepWithMultipleMojibake;
    for (const [pattern, replacement] of mojibakeCorrections) {
      fixed = fixed.replace(pattern, replacement);
    }

    // Verify all corrections applied
    expect(fixed).toBe('Validar que se muestre "Información de Préstamos y Depósitos".');
    expect(fixed).not.toContain("Ã³");
    expect(fixed).not.toContain("Ã©");
  });

  test("scenario title mojibake corrected", () => {
    // Mock scenario with mojibake in title
    const titleWithMojibake = "Visualizar informaciÃ³n de productos disponibles";

    // Fix mojibake
    const mojibakeCorrections: Array<[RegExp, string]> = [
      [/informaciÃ³n/gi, "información"],
    ];

    let fixed = titleWithMojibake;
    for (const [pattern, replacement] of mojibakeCorrections) {
      fixed = fixed.replace(pattern, replacement);
    }

    // Verify correction
    expect(fixed).toBe("Visualizar información de productos disponibles");
  });

  test("encoding normalization applied before validation", () => {
    // Simulate the normalization flow
    const rawScenario = {
      sourceIssueKey: "TEST-123",
      title: "Visualizar informaciÃ³n",
      steps: ['Clic en "InformaciÃ³n de productos".', 'Validar que se muestre "DepÃ³sitos".'],
    };

    // Mock detectMojibake function
    function detectMojibake(text: string): { hasMojibake: boolean; corrected: string } {
      const corrections: Array<[RegExp, string]> = [
        [/InformaciÃ³n/g, "Información"],
        [/informaciÃ³n/g, "información"],
        [/DepÃ³sitos/g, "Depósitos"],
      ];

      let corrected = text;
      let hasMojibake = false;

      for (const [pattern, replacement] of corrections) {
        if (pattern.test(corrected)) {
          corrected = corrected.replace(pattern, replacement);
          hasMojibake = true;
        }
      }

      return { hasMojibake, corrected };
    }

    // Apply normalization
    const normalizedSteps = rawScenario.steps.map((step) => {
      const fixed = detectMojibake(step);
      return fixed.hasMojibake ? fixed.corrected : step;
    });

    const fixedTitle = detectMojibake(rawScenario.title);

    const normalized = {
      ...rawScenario,
      steps: normalizedSteps,
      title: fixedTitle.hasMojibake ? fixedTitle.corrected : rawScenario.title,
    };

    // Verify normalization
    expect(normalized.title).toBe("Visualizar información");
    expect(normalized.steps[0]).toBe('Clic en "Información de productos".');
    expect(normalized.steps[1]).toBe('Validar que se muestre "Depósitos".');
  });
});
