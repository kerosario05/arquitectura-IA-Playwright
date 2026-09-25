"use strict";
/**
 * Step Formatter Utility
 *
 * Formats executable steps as MCP-ready strings.
 * Handles conversion from object format to string format.
 *
 * This is app-agnostic and multiproject-safe.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatExecutableStep = formatExecutableStep;
exports.ensureStepStrings = ensureStepStrings;
exports.normalizeScenarioSteps = normalizeScenarioSteps;
/**
 * Format an executable step as a numbered MCP string
 *
 * @param step - Step object or string
 * @param index - 1-based step number
 * @returns Formatted step string
 */
function formatExecutableStep(step, index) {
    // If already a string, just ensure it's numbered correctly
    if (typeof step === "string") {
        // Remove existing numbering if present
        const withoutNumber = step.replace(/^\d+[\.)]\s*/, "");
        return `${index}. ${withoutNumber}`;
    }
    // Convert object to string based on action
    const { action, target, description } = step;
    // If description is provided and looks like a formatted step, use it
    if (description && /^(?:\d+\.\s*)?(?:Clic|Validar|Seleccionar|Esperar)/i.test(description)) {
        const withoutNumber = description.replace(/^\d+[\.)]\s*/, "");
        return `${index}. ${withoutNumber}`;
    }
    // Format based on action type
    switch (action.toLowerCase()) {
        case "click":
            return `${index}. Clic en "${target}".`;
        case "assert":
        case "assert_visible":
            return `${index}. Validar que se muestre "${target}".`;
        case "assert_button_visible":
            return `${index}. Validar que el botón "${target}" esté visible.`;
        case "select_ordinal":
            return `${index}. Seleccionar el primer ${target} visible del listado.`;
        case "navigate":
            return `${index}. Navegar a "${target}".`;
        case "wait":
            return `${index}. Esperar que se muestre "${target}".`;
        default:
            // Fallback: try to extract a reasonable string
            if (description) {
                const withoutNumber = description.replace(/^\d+[\.)]\s*/, "");
                return `${index}. ${withoutNumber}`;
            }
            return `${index}. Clic en "${target}".`;
    }
}
/**
 * Ensure scenario steps are strings
 * Converts object steps to string steps if needed
 *
 * @param steps - Array of steps (strings or objects)
 * @returns Array of formatted string steps
 */
function ensureStepStrings(steps) {
    if (!Array.isArray(steps)) {
        console.warn("[step-formatter] steps is not an array, returning empty array");
        return [];
    }
    const stringSteps = [];
    let convertedCount = 0;
    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (typeof step === "string") {
            stringSteps.push(formatExecutableStep(step, i + 1));
        }
        else if (typeof step === "object" && step !== null) {
            // Convert object to string
            stringSteps.push(formatExecutableStep(step, i + 1));
            convertedCount++;
        }
        else {
            console.warn(`[step-formatter] invalid step at index ${i}, skipping:`, step);
        }
    }
    if (convertedCount > 0) {
        console.log(`[step-formatter] converted ${convertedCount} object steps to strings`);
    }
    return stringSteps;
}
/**
 * Defensive normalization for scenario steps
 * Ensures all steps are valid strings before processing
 *
 * @param scenario - Scenario with potentially mixed step formats
 * @returns Scenario with normalized string steps
 */
function normalizeScenarioSteps(scenario) {
    if (!scenario.steps || !Array.isArray(scenario.steps)) {
        return scenario;
    }
    // Check if any steps are objects
    const hasObjectSteps = scenario.steps.some((step) => typeof step === "object" && step !== null);
    if (hasObjectSteps) {
        return {
            ...scenario,
            steps: ensureStepStrings(scenario.steps),
        };
    }
    // Ensure all string steps are properly numbered
    return {
        ...scenario,
        steps: scenario.steps.map((step, i) => formatExecutableStep(step, i + 1)),
    };
}
