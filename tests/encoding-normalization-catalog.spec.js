"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
test_1.test.describe("Encoding Normalization for Catalog", () => {
    (0, test_1.test)("mojibake corrected before entry matching", () => {
        // Mock mojibake corrections
        const mojibakeCorrections = [
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
        (0, test_1.expect)(fixed).toContain(entry.visibleLabel);
        (0, test_1.expect)(fixed).toBe('Clic en "Información de productos".');
    });
    (0, test_1.test)("mojibake corrected before MCP pattern matching", () => {
        // Mock step with mojibake
        const stepWithMojibake = 'Clic en "DepÃ³sitos a Plazo".';
        // Fix mojibake
        const mojibakeCorrections = [
            [/DepÃ³sitos/gi, "Depósitos"],
        ];
        let fixed = stepWithMojibake;
        for (const [pattern, replacement] of mojibakeCorrections) {
            fixed = fixed.replace(pattern, replacement);
        }
        // Verify MCP pattern
        const mcpClickPattern = /^Clic en "([^"]+)"\.$/i;
        const match = fixed.match(mcpClickPattern);
        (0, test_1.expect)(match).not.toBeNull();
        (0, test_1.expect)(match[1]).toBe("Depósitos a Plazo");
    });
    (0, test_1.test)("NFD normalization for comparison", () => {
        // Simulate NFD normalization
        function normalizeText(text) {
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
        (0, test_1.expect)(normalized1).toBe(normalized2);
    });
    (0, test_1.test)("multiple mojibake patterns in single step", () => {
        // Step with multiple mojibake issues
        const stepWithMultipleMojibake = 'Validar que se muestre "InformaciÃ³n de PrÃ©stamos y DepÃ³sitos".';
        // Fix all mojibake patterns
        const mojibakeCorrections = [
            [/InformaciÃ³n/gi, "Información"],
            [/PrÃ©stamos/gi, "Préstamos"],
            [/DepÃ³sitos/gi, "Depósitos"],
        ];
        let fixed = stepWithMultipleMojibake;
        for (const [pattern, replacement] of mojibakeCorrections) {
            fixed = fixed.replace(pattern, replacement);
        }
        // Verify all corrections applied
        (0, test_1.expect)(fixed).toBe('Validar que se muestre "Información de Préstamos y Depósitos".');
        (0, test_1.expect)(fixed).not.toContain("Ã³");
        (0, test_1.expect)(fixed).not.toContain("Ã©");
    });
    (0, test_1.test)("scenario title mojibake corrected", () => {
        // Mock scenario with mojibake in title
        const titleWithMojibake = "Visualizar informaciÃ³n de productos disponibles";
        // Fix mojibake
        const mojibakeCorrections = [
            [/informaciÃ³n/gi, "información"],
        ];
        let fixed = titleWithMojibake;
        for (const [pattern, replacement] of mojibakeCorrections) {
            fixed = fixed.replace(pattern, replacement);
        }
        // Verify correction
        (0, test_1.expect)(fixed).toBe("Visualizar información de productos disponibles");
    });
    (0, test_1.test)("encoding normalization applied before validation", () => {
        // Simulate the normalization flow
        const rawScenario = {
            sourceIssueKey: "TEST-123",
            title: "Visualizar informaciÃ³n",
            steps: ['Clic en "InformaciÃ³n de productos".', 'Validar que se muestre "DepÃ³sitos".'],
        };
        // Mock detectMojibake function
        function detectMojibake(text) {
            const corrections = [
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
        (0, test_1.expect)(normalized.title).toBe("Visualizar información");
        (0, test_1.expect)(normalized.steps[0]).toBe('Clic en "Información de productos".');
        (0, test_1.expect)(normalized.steps[1]).toBe('Validar que se muestre "Depósitos".');
    });
});
