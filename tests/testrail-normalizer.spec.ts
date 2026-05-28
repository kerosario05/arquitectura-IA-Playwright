/**
 * TestRail Normalizer Tests
 * 
 * Tests for HTML parsing, step splitting, and concatenated step repair.
 */

import { test, expect } from "@playwright/test";
import { normalizeTestRailCase, splitIntoSteps } from "../src/testrail/testrail-normalizer";
import type { RawTestRailCase } from "../src/types/testrail.types";

test.describe("TestRail Normalizer", () => {
  test.describe("HTML List Parsing", () => {
    test("HTML <ol><li> generates multiple steps", () => {
      const rawCase: RawTestRailCase = {
        id: 38230,
        title: "Test Case",
        custom_steps: '<ol><li>Clic en "Iniciar".</li><li>Clic en "Transacciones".</li><li>Validar que se muestre "Menu".</li></ol>',
        custom_expected: "",
        custom_preconds: "",
        refs: ""
      };

      const result = normalizeTestRailCase(rawCase);

      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].action).toBe('Clic en "Iniciar".');
      expect(result.steps[1].action).toBe('Clic en "Transacciones".');
      expect(result.steps[2].action).toBe('Validar que se muestre "Menu".');
    });

    test("HTML <ul><li> generates multiple steps", () => {
      const rawCase: RawTestRailCase = {
        id: 38231,
        title: "Test Case",
        custom_steps: '<ul><li>Step one</li><li>Step two</li><li>Step three</li></ul>',
        custom_expected: "",
        custom_preconds: "",
        refs: ""
      };

      const result = normalizeTestRailCase(rawCase);

      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].action).toBe("Step one");
      expect(result.steps[1].action).toBe("Step two");
      expect(result.steps[2].action).toBe("Step three");
    });

    test("HTML with <br> generates multiple steps", () => {
      const rawCase: RawTestRailCase = {
        id: 38232,
        title: "Test Case",
        custom_steps: 'Clic en "A".<br>Clic en "B".<br>Validar "C".',
        custom_expected: "",
        custom_preconds: "",
        refs: ""
      };

      const result = normalizeTestRailCase(rawCase);

      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].action).toBe('Clic en "A".');
      expect(result.steps[1].action).toBe('Clic en "B".');
      expect(result.steps[2].action).toBe('Validar "C".');
    });

    test("HTML with <p> generates multiple blocks", () => {
      const rawCase: RawTestRailCase = {
        id: 38233,
        title: "Test Case",
        custom_steps: '<p>Clic en "A".</p><p>Clic en "B".</p>',
        custom_expected: "",
        custom_preconds: "",
        refs: ""
      };

      const result = normalizeTestRailCase(rawCase);

      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].action).toBe('Clic en "A".');
      expect(result.steps[1].action).toBe('Clic en "B".');
    });

    test("HTML entities are decoded", () => {
      const rawCase: RawTestRailCase = {
        id: 38234,
        title: "Test &quot;Case&quot;",
        custom_steps: 'Clic en "A" &amp; "B".',
        custom_expected: "",
        custom_preconds: "",
        refs: ""
      };

      const result = normalizeTestRailCase(rawCase);

      expect(result.title).toBe('Test "Case"');
      expect(result.steps[0].action).toBe('Clic en "A" & "B".');
    });
  });

  test.describe("Plain Text Numbered Lists", () => {
    test("Numbered text generates multiple steps", () => {
      const rawCase: RawTestRailCase = {
        id: 38235,
        title: "Test Case",
        custom_steps: "1. Clic en \"A\".\n2. Clic en \"B\".\n3. Validar \"C\".",
        custom_expected: "",
        custom_preconds: "",
        refs: ""
      };

      const result = normalizeTestRailCase(rawCase);

      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].action).toBe('Clic en "A".');
      expect(result.steps[1].action).toBe('Clic en "B".');
      expect(result.steps[2].action).toBe('Validar "C".');
    });

    test("Numbered with parenthesis generates multiple steps", () => {
      const rawCase: RawTestRailCase = {
        id: 38236,
        title: "Test Case",
        custom_steps: "1) Step one\n2) Step two\n3) Step three",
        custom_expected: "",
        custom_preconds: "",
        refs: ""
      };

      const result = normalizeTestRailCase(rawCase);

      expect(result.steps).toHaveLength(3);
    });
  });

  test.describe("Concatenated Step Repair", () => {
    test("Concatenated steps with '.Clic en' are repaired", () => {
      const rawCase: RawTestRailCase = {
        id: 38237,
        title: "Test Case",
        custom_steps: 'Clic en "Iniciar".Clic en "Transacciones".Validar que se muestre "Menu".',
        custom_expected: "",
        custom_preconds: "",
        refs: ""
      };

      const result = normalizeTestRailCase(rawCase);

      expect(result.steps).toHaveLength(3);
      expect(result.steps[0].action).toBe('Clic en "Iniciar".');
      expect(result.steps[1].action).toBe('Clic en "Transacciones".');
      expect(result.steps[2].action).toBe('Validar que se muestre "Menu".');
    });

    test("Concatenated steps with '.Validar que' are repaired", () => {
      const rawCase: RawTestRailCase = {
        id: 38238,
        title: "Test Case",
        custom_steps: 'Clic en "A".Validar que se muestre "B".Clic en "C".',
        custom_expected: "",
        custom_preconds: "",
        refs: ""
      };

      const result = normalizeTestRailCase(rawCase);

      expect(result.steps).toHaveLength(3);
    });

    test("Concatenated steps with quote-verb pattern are repaired", () => {
      const rawCase: RawTestRailCase = {
        id: 38239,
        title: "Test Case",
        custom_steps: '"A"Clic en "B"Validar "C"',
        custom_expected: "",
        custom_preconds: "",
        refs: ""
      };

      const result = normalizeTestRailCase(rawCase);

      // Should split at quote-verb boundaries
      expect(result.steps.length).toBeGreaterThanOrEqual(2);
    });
  });

  test.describe("Expected Result Parsing", () => {
    test("Expected Result with HTML lists is preserved", () => {
      const rawCase: RawTestRailCase = {
        id: 38240,
        title: "Test Case",
        custom_steps: "1. Step one.",
        custom_expected: '<ol><li>Expected one.</li><li>Expected two.</li></ol>',
        custom_preconds: "",
        refs: ""
      };

      const result = normalizeTestRailCase(rawCase);

      expect(result.steps[0].expected).toBeDefined();
      expect(result.steps[0].expected).toContain("Expected one");
      expect(result.steps[0].expected).toContain("Expected two");
    });

    test("Expected Result concatenated is repaired", () => {
      const rawCase: RawTestRailCase = {
        id: 38241,
        title: "Test Case",
        custom_steps: "1. Step one.",
        custom_expected: "Expected one.Expected two.Expected three.",
        custom_preconds: "",
        refs: ""
      };

      const result = normalizeTestRailCase(rawCase);

      expect(result.steps[0].expected).toBeDefined();
      // Should have newlines between items
      expect(result.steps[0].expected).toContain("\n");
    });
  });

  test.describe("Step Index Correctness", () => {
    test("Case with 6 steps generates step indices 1..6", () => {
      const rawCase: RawTestRailCase = {
        id: 38230,
        title: "Visualizar listado de depósitos a plazo",
        custom_steps: '1. Clic en "Iniciar".\n2. Clic en "Transacciones y servicios".\n3. Validar que se muestre "Consulta de balance".\n4. Clic en "Consulta de balance".\n5. Clic en "Depósitos a plazos".\n6. Validar que se muestre "Volver al menú".',
        custom_expected: "",
        custom_preconds: "",
        refs: ""
      };

      const result = normalizeTestRailCase(rawCase);

      expect(result.steps).toHaveLength(6);
      result.steps.forEach((step, index) => {
        expect(step.index).toBe(index + 1);
      });

      expect(result.steps[0].action).toBe('Clic en "Iniciar".');
      expect(result.steps[5].action).toBe('Validar que se muestre "Volver al menú".');
    });
  });

  test.describe("Non-Breaking Cases", () => {
    test("Normal sentences are not incorrectly split", () => {
      const rawCase: RawTestRailCase = {
        id: 38242,
        title: "Test Case",
        custom_steps: "El usuario debe hacer clic en el botón para continuar con el proceso.",
        custom_expected: "",
        custom_preconds: "",
        refs: ""
      };

      const result = normalizeTestRailCase(rawCase);

      // Should be a single step, not split by 'clic en' in middle of sentence
      expect(result.steps).toHaveLength(1);
    });

    test("Existing separated steps are not affected", () => {
      const rawCase: RawTestRailCase = {
        id: 38243,
        title: "Test Case",
        custom_steps: "Step one\nStep two\nStep three",
        custom_expected: "",
        custom_preconds: "",
        refs: ""
      };

      const result = normalizeTestRailCase(rawCase);

      expect(result.steps).toHaveLength(3);
    });
  });
});
