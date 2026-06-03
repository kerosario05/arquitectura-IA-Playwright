"use strict";
/**
 * TestRail Normalizer Tests
 *
 * Tests for HTML parsing, step splitting, and concatenated step repair.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const testrail_normalizer_1 = require("../src/testrail/testrail-normalizer");
test_1.test.describe("TestRail Normalizer", () => {
    test_1.test.describe("HTML List Parsing", () => {
        (0, test_1.test)("HTML <ol><li> generates multiple steps", () => {
            const rawCase = {
                id: 38230,
                title: "Test Case",
                custom_steps: '<ol><li>Clic en "Iniciar".</li><li>Clic en "Transacciones".</li><li>Validar que se muestre "Menu".</li></ol>',
                custom_expected: "",
                custom_preconds: "",
                refs: ""
            };
            const result = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase);
            (0, test_1.expect)(result.steps).toHaveLength(3);
            (0, test_1.expect)(result.steps[0].action).toBe('Clic en "Iniciar".');
            (0, test_1.expect)(result.steps[1].action).toBe('Clic en "Transacciones".');
            (0, test_1.expect)(result.steps[2].action).toBe('Validar que se muestre "Menu".');
        });
        (0, test_1.test)("HTML <ul><li> generates multiple steps", () => {
            const rawCase = {
                id: 38231,
                title: "Test Case",
                custom_steps: '<ul><li>Step one</li><li>Step two</li><li>Step three</li></ul>',
                custom_expected: "",
                custom_preconds: "",
                refs: ""
            };
            const result = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase);
            (0, test_1.expect)(result.steps).toHaveLength(3);
            (0, test_1.expect)(result.steps[0].action).toBe("Step one");
            (0, test_1.expect)(result.steps[1].action).toBe("Step two");
            (0, test_1.expect)(result.steps[2].action).toBe("Step three");
        });
        (0, test_1.test)("HTML with <br> generates multiple steps", () => {
            const rawCase = {
                id: 38232,
                title: "Test Case",
                custom_steps: 'Clic en "A".<br>Clic en "B".<br>Validar "C".',
                custom_expected: "",
                custom_preconds: "",
                refs: ""
            };
            const result = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase);
            (0, test_1.expect)(result.steps).toHaveLength(3);
            (0, test_1.expect)(result.steps[0].action).toBe('Clic en "A".');
            (0, test_1.expect)(result.steps[1].action).toBe('Clic en "B".');
            (0, test_1.expect)(result.steps[2].action).toBe('Validar "C".');
        });
        (0, test_1.test)("HTML with <p> generates multiple blocks", () => {
            const rawCase = {
                id: 38233,
                title: "Test Case",
                custom_steps: '<p>Clic en "A".</p><p>Clic en "B".</p>',
                custom_expected: "",
                custom_preconds: "",
                refs: ""
            };
            const result = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase);
            (0, test_1.expect)(result.steps).toHaveLength(2);
            (0, test_1.expect)(result.steps[0].action).toBe('Clic en "A".');
            (0, test_1.expect)(result.steps[1].action).toBe('Clic en "B".');
        });
        (0, test_1.test)("HTML entities are decoded", () => {
            const rawCase = {
                id: 38234,
                title: "Test &quot;Case&quot;",
                custom_steps: 'Clic en "A" &amp; "B".',
                custom_expected: "",
                custom_preconds: "",
                refs: ""
            };
            const result = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase);
            (0, test_1.expect)(result.title).toBe('Test "Case"');
            (0, test_1.expect)(result.steps[0].action).toBe('Clic en "A" & "B".');
        });
    });
    test_1.test.describe("Plain Text Numbered Lists", () => {
        (0, test_1.test)("Numbered text generates multiple steps", () => {
            const rawCase = {
                id: 38235,
                title: "Test Case",
                custom_steps: "1. Clic en \"A\".\n2. Clic en \"B\".\n3. Validar \"C\".",
                custom_expected: "",
                custom_preconds: "",
                refs: ""
            };
            const result = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase);
            (0, test_1.expect)(result.steps).toHaveLength(3);
            (0, test_1.expect)(result.steps[0].action).toBe('Clic en "A".');
            (0, test_1.expect)(result.steps[1].action).toBe('Clic en "B".');
            (0, test_1.expect)(result.steps[2].action).toBe('Validar "C".');
        });
        (0, test_1.test)("Numbered with parenthesis generates multiple steps", () => {
            const rawCase = {
                id: 38236,
                title: "Test Case",
                custom_steps: "1) Step one\n2) Step two\n3) Step three",
                custom_expected: "",
                custom_preconds: "",
                refs: ""
            };
            const result = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase);
            (0, test_1.expect)(result.steps).toHaveLength(3);
        });
    });
    test_1.test.describe("Concatenated Step Repair", () => {
        (0, test_1.test)("Concatenated steps with '.Clic en' are repaired", () => {
            const rawCase = {
                id: 38237,
                title: "Test Case",
                custom_steps: 'Clic en "Iniciar".Clic en "Transacciones".Validar que se muestre "Menu".',
                custom_expected: "",
                custom_preconds: "",
                refs: ""
            };
            const result = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase);
            (0, test_1.expect)(result.steps).toHaveLength(3);
            (0, test_1.expect)(result.steps[0].action).toBe('Clic en "Iniciar".');
            (0, test_1.expect)(result.steps[1].action).toBe('Clic en "Transacciones".');
            (0, test_1.expect)(result.steps[2].action).toBe('Validar que se muestre "Menu".');
        });
        (0, test_1.test)("Concatenated steps with '.Validar que' are repaired", () => {
            const rawCase = {
                id: 38238,
                title: "Test Case",
                custom_steps: 'Clic en "A".Validar que se muestre "B".Clic en "C".',
                custom_expected: "",
                custom_preconds: "",
                refs: ""
            };
            const result = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase);
            (0, test_1.expect)(result.steps).toHaveLength(3);
        });
        (0, test_1.test)("Concatenated steps with quote-verb pattern are repaired", () => {
            const rawCase = {
                id: 38239,
                title: "Test Case",
                custom_steps: '"A"Clic en "B"Validar "C"',
                custom_expected: "",
                custom_preconds: "",
                refs: ""
            };
            const result = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase);
            // Should split at quote-verb boundaries
            (0, test_1.expect)(result.steps.length).toBeGreaterThanOrEqual(2);
        });
    });
    test_1.test.describe("Expected Result Parsing", () => {
        (0, test_1.test)("Expected Result with HTML lists is preserved", () => {
            const rawCase = {
                id: 38240,
                title: "Test Case",
                custom_steps: "1. Step one.",
                custom_expected: '<ol><li>Expected one.</li><li>Expected two.</li></ol>',
                custom_preconds: "",
                refs: ""
            };
            const result = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase);
            (0, test_1.expect)(result.steps[0].expected).toBeDefined();
            (0, test_1.expect)(result.steps[0].expected).toContain("Expected one");
            (0, test_1.expect)(result.steps[0].expected).toContain("Expected two");
        });
        (0, test_1.test)("Expected Result concatenated is repaired", () => {
            const rawCase = {
                id: 38241,
                title: "Test Case",
                custom_steps: "1. Step one.",
                custom_expected: "Expected one.Expected two.Expected three.",
                custom_preconds: "",
                refs: ""
            };
            const result = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase);
            (0, test_1.expect)(result.steps[0].expected).toBeDefined();
            // Should have newlines between items
            (0, test_1.expect)(result.steps[0].expected).toContain("\n");
        });
    });
    test_1.test.describe("Step Index Correctness", () => {
        (0, test_1.test)("Case with 6 steps generates step indices 1..6", () => {
            const rawCase = {
                id: 38230,
                title: "Visualizar listado de depósitos a plazo",
                custom_steps: '1. Clic en "Iniciar".\n2. Clic en "Transacciones y servicios".\n3. Validar que se muestre "Consulta de balance".\n4. Clic en "Consulta de balance".\n5. Clic en "Depósitos a plazos".\n6. Validar que se muestre "Volver al menú".',
                custom_expected: "",
                custom_preconds: "",
                refs: ""
            };
            const result = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase);
            (0, test_1.expect)(result.steps).toHaveLength(6);
            result.steps.forEach((step, index) => {
                (0, test_1.expect)(step.index).toBe(index + 1);
            });
            (0, test_1.expect)(result.steps[0].action).toBe('Clic en "Iniciar".');
            (0, test_1.expect)(result.steps[5].action).toBe('Validar que se muestre "Volver al menú".');
        });
    });
    test_1.test.describe("Non-Breaking Cases", () => {
        (0, test_1.test)("Normal sentences are not incorrectly split", () => {
            const rawCase = {
                id: 38242,
                title: "Test Case",
                custom_steps: "El usuario debe hacer clic en el botón para continuar con el proceso.",
                custom_expected: "",
                custom_preconds: "",
                refs: ""
            };
            const result = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase);
            // Should be a single step, not split by 'clic en' in middle of sentence
            (0, test_1.expect)(result.steps).toHaveLength(1);
        });
        (0, test_1.test)("Existing separated steps are not affected", () => {
            const rawCase = {
                id: 38243,
                title: "Test Case",
                custom_steps: "Step one\nStep two\nStep three",
                custom_expected: "",
                custom_preconds: "",
                refs: ""
            };
            const result = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase);
            (0, test_1.expect)(result.steps).toHaveLength(3);
        });
    });
});
