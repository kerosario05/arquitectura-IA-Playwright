"use strict";
/**
 * Scenario Intermediate Step Repair
 *
 * Detects and inserts missing intermediate navigation steps in generated scenarios.
 * This is app-agnostic and works with any appSlug/routeProfile.
 *
 * DO NOT hardcode project-specific logic, targets, or paths.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.repairMissingIntermediates = repairMissingIntermediates;
exports.validateNavigationCoherence = validateNavigationCoherence;
exports.logIntermediateRepair = logIntermediateRepair;
const scenario_path_resolver_1 = require("./scenario-path-resolver");
const target_normalization_1 = require("./target-normalization");
/**
 * Extract click target from step string
 */
function extractClickTarget(step) {
    const clickMatch = step.match(/Clic en\s+"([^"]+)"/i);
    return clickMatch ? clickMatch[1] : null;
}
/**
 * Check if step is a click step
 */
function isClickStep(step) {
    return /Clic en\s+"/i.test(step);
}
/**
 * Check if step is a validation step
 */
function isValidationStep(step) {
    return /Validar que/i.test(step) || /Esperar que/i.test(step);
}
/**
 * Detect missing intermediate steps in a scenario
 *
 * @param scenario - Scenario to analyze
 * @param routeProfile - Route profile with intermediates
 * @param derivedContext - Derived execution context
 * @param routeResolution - Route resolution for this scenario
 * @param confidenceThreshold - Minimum confidence to insert intermediates (default: medium)
 * @returns IntermediateRepairResult with repaired steps or diagnostics
 */
function repairMissingIntermediates(scenario, routeProfile, derivedContext, routeResolution, confidenceThreshold = "medium") {
    const diagnostics = [];
    const originalSteps = [...scenario.steps];
    const repairedSteps = [];
    const stepOrigins = [];
    const insertedSteps = [];
    let insertedCount = 0;
    if (!routeProfile) {
        return {
            repaired: false,
            originalSteps,
            repairedSteps: originalSteps,
            stepOrigins: originalSteps.map((_, index) => index),
            insertedSteps: [],
            insertedCount: 0,
            reasonCode: "no_route_profile",
            diagnostics: [
                {
                    level: "error",
                    target: "N/A",
                    decision: "cannot_repair",
                    message: "No route profile available for intermediate repair",
                },
            ],
        };
    }
    // Track navigation context (where we are in the flow)
    const navigationContext = [];
    // Process each step
    for (let i = 0; i < originalSteps.length; i++) {
        const step = originalSteps[i];
        const clickTarget = extractClickTarget(step);
        if (isClickStep(step) && clickTarget) {
            // Check if we can reach this target from current context
            const pathResolution = (0, scenario_path_resolver_1.resolveExecutablePath)(clickTarget, navigationContext, routeProfile, derivedContext, routeResolution);
            if (pathResolution.canResolve && pathResolution.insertedSteps.length > 0) {
                // Check if confidence meets threshold
                const confidenceLevels = { high: 3, medium: 2, low: 1, none: 0 };
                const thresholdLevel = confidenceLevels[confidenceThreshold];
                const resolutionLevel = confidenceLevels[pathResolution.confidence];
                if (resolutionLevel >= thresholdLevel) {
                    // Insert missing intermediates before this step
                    for (const insertedStep of pathResolution.insertedSteps) {
                        const stepNumber = repairedSteps.length + 1;
                        const stepText = `${stepNumber}. Clic en "${insertedStep.target}".`;
                        repairedSteps.push(stepText);
                        stepOrigins.push(undefined);
                        insertedSteps.push(stepText);
                        insertedCount++;
                        navigationContext.push(insertedStep.target);
                        diagnostics.push({
                            level: "info",
                            target: clickTarget,
                            missingParent: navigationContext.length > 1 ? navigationContext[navigationContext.length - 2] : undefined,
                            insertedIntermediate: insertedStep.target,
                            pathSource: pathResolution.reasonCode,
                            confidence: pathResolution.confidence,
                            decision: "inserted",
                            message: `Inserted intermediate step "${insertedStep.target}" before "${clickTarget}"`,
                        });
                    }
                }
                else {
                    // Confidence too low - reject scenario
                    diagnostics.push({
                        level: "error",
                        target: clickTarget,
                        confidence: pathResolution.confidence,
                        decision: "rejected_low_confidence",
                        message: `Cannot insert intermediate for "${clickTarget}" - confidence ${pathResolution.confidence} below threshold ${confidenceThreshold}`,
                    });
                    return {
                        repaired: false,
                        originalSteps,
                        repairedSteps: originalSteps,
                        stepOrigins: originalSteps.map((_, index) => index),
                        insertedSteps: [],
                        insertedCount: 0,
                        reasonCode: "low_confidence_path",
                        diagnostics,
                    };
                }
            }
            else if (!pathResolution.canResolve) {
                // Check if target is already reachable (no intermediates needed)
                const isReachable = navigationContext.length === 0 || // First click
                    derivedContext.entryActionTargets.some((entry) => (0, target_normalization_1.targetsMatch)(entry, clickTarget)) || // Entry points
                    derivedContext.allowedExecutableClicks.some((entry) => (0, target_normalization_1.targetsMatch)(entry, clickTarget)); // Navigation authority / private route targets
                if (!isReachable) {
                    diagnostics.push({
                        level: "error",
                        target: clickTarget,
                        decision: "rejected_unresolvable",
                        message: `Cannot resolve path to "${clickTarget}" from current context`,
                    });
                    return {
                        repaired: false,
                        originalSteps,
                        repairedSteps: originalSteps,
                        stepOrigins: originalSteps.map((_, index) => index),
                        insertedSteps: [],
                        insertedCount: 0,
                        reasonCode: "unresolvable_path",
                        diagnostics,
                    };
                }
            }
            // Add the original click step (with updated numbering)
            const stepNumber = repairedSteps.length + 1;
            const stepText = `${stepNumber}. Clic en "${clickTarget}".`;
            repairedSteps.push(stepText);
            stepOrigins.push(i);
            navigationContext.push(clickTarget);
        }
        else {
            // Non-click step (validation, etc.) - add as-is with updated numbering
            const stepNumber = repairedSteps.length + 1;
            // Preserve original step text but update numbering
            const stepText = step.replace(/^\d+\./, `${stepNumber}.`);
            repairedSteps.push(stepText);
            stepOrigins.push(i);
        }
    }
    const reasonCode = insertedCount > 0 ? "missing_intermediate_step_repaired" : "no_repair_needed";
    if (insertedCount > 0) {
        diagnostics.push({
            level: "info",
            target: "scenario",
            decision: "repaired",
            message: `Successfully repaired scenario - inserted ${insertedCount} intermediate step(s)`,
        });
    }
    return {
        repaired: insertedCount > 0,
        originalSteps,
        repairedSteps,
        stepOrigins,
        insertedSteps,
        insertedCount,
        reasonCode,
        diagnostics,
    };
}
/**
 * Validate navigation coherence - check if scenario can be navigated without gaps
 *
 * @param steps - Scenario steps to validate
 * @param routeProfile - Route profile
 * @param derivedContext - Derived execution context
 * @returns true if navigation is coherent, false if missing intermediates detected
 */
function validateNavigationCoherence(steps, routeProfile, derivedContext, routeResolution) {
    const missingIntermediates = [];
    const diagnostics = [];
    const navigationContext = [];
    if (!routeProfile) {
        return {
            coherent: true, // Cannot validate without profile
            missingIntermediates: [],
            diagnostics: ["no_route_profile_for_validation"],
        };
    }
    for (const step of steps) {
        if (isClickStep(step)) {
            const clickTarget = extractClickTarget(step);
            if (clickTarget) {
                const pathResolution = (0, scenario_path_resolver_1.resolveExecutablePath)(clickTarget, navigationContext, routeProfile, derivedContext, routeResolution);
                if (pathResolution.insertedSteps.length > 0) {
                    missingIntermediates.push({
                        target: clickTarget,
                        context: [...navigationContext],
                    });
                    diagnostics.push(`Missing intermediate(s) before "${clickTarget}"`);
                }
                navigationContext.push(clickTarget);
            }
        }
    }
    return {
        coherent: missingIntermediates.length === 0,
        missingIntermediates,
        diagnostics,
    };
}
/**
 * Log intermediate repair result
 */
function logIntermediateRepair(issueKey, scenarioTitle, result, appSlug) {
    if (result.repaired) {
        console.log(`[intermediate-repair] appSlug=${appSlug} issue=${issueKey} ` +
            `scenario="${scenarioTitle}" ` +
            `repaired=true insertedCount=${result.insertedCount} ` +
            `reasonCode=${result.reasonCode}`);
        if (result.insertedSteps.length > 0) {
            const insertedTargets = result.insertedSteps
                .map((s) => extractClickTarget(s))
                .filter(Boolean)
                .join(", ");
            console.log(`[intermediate-repair] inserted: ${insertedTargets}`);
        }
    }
    else if (result.reasonCode !== "no_repair_needed") {
        console.log(`[intermediate-repair] appSlug=${appSlug} issue=${issueKey} ` +
            `scenario="${scenarioTitle}" ` +
            `repaired=false reasonCode=${result.reasonCode}`);
        for (const diag of result.diagnostics) {
            if (diag.level === "error") {
                console.log(`[intermediate-repair] error target="${diag.target}" decision=${diag.decision} ` +
                    `message=${diag.message}`);
            }
        }
    }
}
