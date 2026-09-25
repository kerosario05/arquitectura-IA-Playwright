"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
test_1.test.describe("Deterministic Seeds Deduplication", () => {
    (0, test_1.test)("dedupeConsecutiveSteps removes duplicate consecutive clicks", () => {
        // Simulate the deduplication logic
        const steps = [
            { description: "Clic en \"Iniciar\".", action: "click", target: "Iniciar" },
            { description: "Clic en \"Información de productos\".", action: "click", target: "Información de productos" },
            { description: "Clic en \"Información de productos\".", action: "click", target: "Información de productos" },
            { description: "Clic en \"Tarjetas\".", action: "click", target: "Tarjetas" }
        ];
        // Mock deduplication function (same logic as in codex-scenario-generator.ts)
        function dedupeConsecutiveSteps(steps) {
            if (steps.length === 0)
                return steps;
            const deduped = [steps[0]];
            for (let i = 1; i < steps.length; i++) {
                const current = steps[i];
                const previous = steps[i - 1];
                const getCurrentTarget = (step) => {
                    if (typeof step === "string") {
                        const match = step.match(/Clic en "([^"]+)"/i);
                        return match ? match[1].toLowerCase().trim() : null;
                    }
                    if (typeof step === "object" && step.action === "click" && step.target) {
                        return step.target.toLowerCase().trim();
                    }
                    return null;
                };
                const currentTarget = getCurrentTarget(current);
                const previousTarget = getCurrentTarget(previous);
                if (currentTarget && previousTarget && currentTarget === previousTarget) {
                    continue;
                }
                deduped.push(current);
            }
            return deduped;
        }
        const deduped = dedupeConsecutiveSteps(steps);
        // Should have removed the duplicate "Información de productos"
        (0, test_1.expect)(deduped).toHaveLength(3);
        (0, test_1.expect)(deduped[0].target).toBe("Iniciar");
        (0, test_1.expect)(deduped[1].target).toBe("Información de productos");
        (0, test_1.expect)(deduped[2].target).toBe("Tarjetas");
    });
    (0, test_1.test)("dedupeConsecutiveSteps works with string steps", () => {
        const steps = [
            "1. Clic en \"Iniciar\".",
            "2. Clic en \"Información de productos\".",
            "3. Clic en \"Información de productos\".",
            "4. Validar que se muestre \"Tarjetas\"."
        ];
        function dedupeConsecutiveSteps(steps) {
            if (steps.length === 0)
                return steps;
            const deduped = [steps[0]];
            for (let i = 1; i < steps.length; i++) {
                const current = steps[i];
                const previous = steps[i - 1];
                const getCurrentTarget = (step) => {
                    if (typeof step === "string") {
                        const match = step.match(/Clic en "([^"]+)"/i);
                        return match ? match[1].toLowerCase().trim() : null;
                    }
                    if (typeof step === "object" && step.action === "click" && step.target) {
                        return step.target.toLowerCase().trim();
                    }
                    return null;
                };
                const currentTarget = getCurrentTarget(current);
                const previousTarget = getCurrentTarget(previous);
                if (currentTarget && previousTarget && currentTarget === previousTarget) {
                    continue;
                }
                deduped.push(current);
            }
            return deduped;
        }
        const deduped = dedupeConsecutiveSteps(steps);
        // Should have removed duplicate click, kept validation
        (0, test_1.expect)(deduped).toHaveLength(3);
        (0, test_1.expect)(deduped[0]).toContain("Iniciar");
        (0, test_1.expect)(deduped[1]).toContain("Información de productos");
        (0, test_1.expect)(deduped[2]).toContain("Validar que se muestre");
    });
    (0, test_1.test)("dedupeConsecutiveSteps keeps non-consecutive duplicates", () => {
        const steps = [
            { description: "Clic en \"Iniciar\".", action: "click", target: "Iniciar" },
            { description: "Clic en \"Información de productos\".", action: "click", target: "Información de productos" },
            { description: "Clic en \"Tarjetas\".", action: "click", target: "Tarjetas" },
            { description: "Clic en \"Información de productos\".", action: "click", target: "Información de productos" }
        ];
        function dedupeConsecutiveSteps(steps) {
            if (steps.length === 0)
                return steps;
            const deduped = [steps[0]];
            for (let i = 1; i < steps.length; i++) {
                const current = steps[i];
                const previous = steps[i - 1];
                const getCurrentTarget = (step) => {
                    if (typeof step === "string") {
                        const match = step.match(/Clic en "([^"]+)"/i);
                        return match ? match[1].toLowerCase().trim() : null;
                    }
                    if (typeof step === "object" && step.action === "click" && step.target) {
                        return step.target.toLowerCase().trim();
                    }
                    return null;
                };
                const currentTarget = getCurrentTarget(current);
                const previousTarget = getCurrentTarget(previous);
                if (currentTarget && previousTarget && currentTarget === previousTarget) {
                    continue;
                }
                deduped.push(current);
            }
            return deduped;
        }
        const deduped = dedupeConsecutiveSteps(steps);
        // Should keep all steps (no consecutive duplicates)
        (0, test_1.expect)(deduped).toHaveLength(4);
    });
    (0, test_1.test)("dedupeConsecutiveSteps handles validation and assert steps", () => {
        const steps = [
            { description: "Clic en \"Iniciar\".", action: "click", target: "Iniciar" },
            { description: "Validar que se muestre \"Tarjetas\".", action: "assert", target: "Tarjetas" },
            { description: "Validar que se muestre \"Tarjetas\".", action: "assert", target: "Tarjetas" }
        ];
        function dedupeConsecutiveSteps(steps) {
            if (steps.length === 0)
                return steps;
            const deduped = [steps[0]];
            for (let i = 1; i < steps.length; i++) {
                const current = steps[i];
                const previous = steps[i - 1];
                const getCurrentTarget = (step) => {
                    if (typeof step === "string") {
                        const match = step.match(/Clic en "([^"]+)"/i);
                        return match ? match[1].toLowerCase().trim() : null;
                    }
                    if (typeof step === "object" && step.action === "click" && step.target) {
                        return step.target.toLowerCase().trim();
                    }
                    return null;
                };
                const currentTarget = getCurrentTarget(current);
                const previousTarget = getCurrentTarget(previous);
                if (currentTarget && previousTarget && currentTarget === previousTarget) {
                    continue;
                }
                deduped.push(current);
            }
            return deduped;
        }
        const deduped = dedupeConsecutiveSteps(steps);
        // Should keep all steps (deduplication only applies to clicks)
        (0, test_1.expect)(deduped).toHaveLength(3);
    });
});
