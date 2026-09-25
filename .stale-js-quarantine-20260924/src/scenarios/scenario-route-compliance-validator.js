"use strict";
/**
 * Scenario Route Compliance Validator
 *
 * Post-generation validator that ensures generated scenarios respect the route profile.
 * Validates each scenario against allowed executable clicks, assertion-only terms, and sensitive actions.
 * Also validates navigation coherence (no missing intermediate steps).
 *
 * This is app-agnostic and works with any appSlug/routeProfile.
 * DO NOT hardcode project-specific logic.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateScenarioCompliance = validateScenarioCompliance;
exports.validateScenariosCompliance = validateScenariosCompliance;
exports.logComplianceResult = logComplianceResult;
exports.logComplianceSummary = logComplianceSummary;
const target_normalization_1 = require("./target-normalization");
const scenario_intermediate_repair_1 = require("./scenario-intermediate-repair");
/**
 * Extract click target from step
 */
function extractClickTarget(step) {
    const clickMatch = step.match(/Clic en\s+"([^"]+)"/i);
    if (clickMatch) {
        return clickMatch[1];
    }
    return null;
}
/**
 * Extract validation target from step
 */
function extractValidationTarget(step) {
    const validationMatch = step.match(/Validar que (?:se muestre|el bot[oó]n|la opci[oó]n)\s+"([^"]+)"/i);
    if (validationMatch) {
        return validationMatch[1];
    }
    return null;
}
/**
 * Check if target is backed by profile (including aliases and normalized matching)
 *
 * Returns: { backed: boolean, canonicalTarget: string | null, matchStrategy: string }
 */
function isTargetBacked(target, allowedClicks, aliasesByTarget) {
    // Strategy 1: Direct exact match
    if (allowedClicks.includes(target)) {
        return { backed: true, canonicalTarget: target, matchStrategy: "exact_match" };
    }
    // Strategy 2: Normalized match (accents, encoding, case)
    const canonicalByNormalized = (0, target_normalization_1.findTargetInList)(target, allowedClicks);
    if (canonicalByNormalized) {
        const mojibake = (0, target_normalization_1.detectMojibake)(target);
        const matchStrategy = mojibake.hasMojibake ? "normalized_mojibake" : "normalized_accent";
        return { backed: true, canonicalTarget: canonicalByNormalized, matchStrategy };
    }
    // Strategy 3: Check if target is an alias of an allowed click
    for (const [canonical, aliases] of aliasesByTarget.entries()) {
        // Direct alias match
        if (aliases.includes(target) && allowedClicks.includes(canonical)) {
            return { backed: true, canonicalTarget: canonical, matchStrategy: "alias_exact" };
        }
        // Normalized alias match
        for (const alias of aliases) {
            if ((0, target_normalization_1.targetsMatch)(target, alias) && allowedClicks.includes(canonical)) {
                return { backed: true, canonicalTarget: canonical, matchStrategy: "alias_normalized" };
            }
        }
    }
    // Strategy 4: Check if target is a canonical form of an alias (bidirectional)
    if (aliasesByTarget.has(target)) {
        const aliases = aliasesByTarget.get(target) ?? [];
        for (const alias of aliases) {
            if (allowedClicks.includes(alias)) {
                return { backed: true, canonicalTarget: alias, matchStrategy: "reverse_alias" };
            }
        }
    }
    // Strategy 5: Normalized lookup in aliasesByTarget keys
    const normalizedTarget = (0, target_normalization_1.normalizeTarget)(target);
    for (const [canonical, aliases] of aliasesByTarget.entries()) {
        if ((0, target_normalization_1.normalizeTarget)(canonical) === normalizedTarget) {
            return { backed: true, canonicalTarget: canonical, matchStrategy: "alias_canonical_normalized" };
        }
    }
    return { backed: false, canonicalTarget: null, matchStrategy: "none" };
}
/**
 * Check if step contains sensitive action pattern
 */
function containsSensitiveAction(step, sensitiveActions) {
    const clickTarget = extractClickTarget(step);
    if (!clickTarget)
        return null;
    // Check if click target matches sensitive action
    for (const action of sensitiveActions) {
        if (clickTarget.toLowerCase().includes(action.toLowerCase()) ||
            action.toLowerCase().includes(clickTarget.toLowerCase())) {
            return action;
        }
    }
    // Check if step itself contains sensitive action verb
    const sensitiveVerbs = [
        /Clic en ".*\b(Solicitar|Pagar|Transferir|Contratar|Confirmar|Autorizar|Aprobar|Firmar|Enviar|Aceptar|Debitar|Eliminar|Cancelar)\b/i
    ];
    for (const pattern of sensitiveVerbs) {
        if (pattern.test(step)) {
            const match = step.match(pattern);
            if (match) {
                return match[1];
            }
        }
    }
    return null;
}
/**
 * Check if step is a validation/assertion
 */
function isValidationStep(step) {
    return /Validar que/i.test(step) || /Esperar que/i.test(step);
}
/**
 * Validate individual scenario against route profile compliance
 */
function validateScenarioCompliance(scenario, derivedContext, resolution, canonicalClaims = []) {
    const diagnostics = [];
    let valid = true;
    let reasonCode = "valid";
    if (!scenario.steps || scenario.steps.length === 0) {
        return {
            valid: true,
            reasonCode: "valid",
            diagnostics: []
        };
    }
    // Validate each step
    for (const [stepIndex, step] of scenario.steps.entries()) {
        const clickTarget = extractClickTarget(step);
        if (clickTarget) {
            const stepClaimIds = new Set((scenario.stepClaims ?? [])
                .filter((claim) => claim.stepIndex === stepIndex)
                .map((claim) => claim.claimId));
            const canonicalFunctionalAction = canonicalClaims.some((claim) => claim.claimType === "action" && stepClaimIds.has(claim.claimId));
            // 1. Check if click target is backed
            const backingResult = isTargetBacked(clickTarget, derivedContext.allowedExecutableClicks, derivedContext.aliasesByTarget);
            if (!backingResult.backed) {
                if (canonicalFunctionalAction) {
                    diagnostics.push({
                        level: "warning",
                        step,
                        target: clickTarget,
                        message: "Functional action has canonical authority but no execution backing.",
                    });
                }
                else {
                    // Check if it's a visible but not executable term (content term)
                    const isVisibleButNotExecutable = derivedContext.visibleButNotExecutableTerms.some(term => (0, target_normalization_1.targetsMatch)(clickTarget, term));
                    if (isVisibleButNotExecutable) {
                        diagnostics.push({
                            level: "error",
                            step,
                            target: clickTarget,
                            message: `Click target "${clickTarget}" is a visible content term but not executable. Should use "Validar que se muestre" instead.`
                        });
                        valid = false;
                        if (reasonCode === "valid") {
                            reasonCode = "content_term_used_as_click";
                        }
                    }
                    else {
                        // Check if it's an assertion-only term
                        const isAssertionOnly = derivedContext.assertionOnlyTerms.some(term => (0, target_normalization_1.targetsMatch)(clickTarget, term));
                        if (isAssertionOnly) {
                            diagnostics.push({
                                level: "error",
                                step,
                                target: clickTarget,
                                message: `Click target "${clickTarget}" is an assertion-only term. Should use "Validar que se muestre" instead.`
                            });
                            valid = false;
                            if (reasonCode === "valid") {
                                reasonCode = "assertion_term_used_as_click";
                            }
                        }
                        else {
                            // Provide more helpful error message
                            const normalizedTarget = (0, target_normalization_1.normalizeTarget)(clickTarget);
                            const mojibake = (0, target_normalization_1.detectMojibake)(clickTarget);
                            const allowedSample = derivedContext.allowedExecutableClicks.slice(0, 5).join(", ");
                            let errorMessage = `Click target "${clickTarget}" is not backed by route profile. Not found in allowedExecutableClicks.`;
                            if (mojibake.hasMojibake) {
                                errorMessage += ` (Detected mojibake: "${clickTarget}" → "${mojibake.corrected}", but still not matched)`;
                            }
                            errorMessage += ` Normalized: "${normalizedTarget}". Allowed sample: [${allowedSample}]`;
                            diagnostics.push({
                                level: "error",
                                step,
                                target: clickTarget,
                                message: errorMessage
                            });
                            valid = false;
                            if (reasonCode === "valid") {
                                reasonCode = "unbacked_click_target";
                            }
                        }
                    }
                }
            }
            else {
                // Target is backed - log successful match strategy
                if (backingResult.matchStrategy !== "exact_match") {
                    diagnostics.push({
                        level: "info",
                        step,
                        target: clickTarget,
                        message: `Click target "${clickTarget}" matched via ${backingResult.matchStrategy} (canonical: "${backingResult.canonicalTarget}")`
                    });
                }
            }
            // 2. Check if click is sensitive action
            const sensitiveAction = containsSensitiveAction(step, derivedContext.sensitiveActions);
            if (sensitiveAction) {
                diagnostics.push({
                    level: "error",
                    step,
                    target: clickTarget,
                    message: `Click on sensitive action "${sensitiveAction}" is not allowed. Use validation instead: "Validar que el botón esté visible".`
                });
                valid = false;
                if (reasonCode === "valid") {
                    reasonCode = "sensitive_click_not_allowed";
                }
            }
        }
        else if (isValidationStep(step)) {
            // Validations are allowed for assertion-only terms
            const validationTarget = extractValidationTarget(step);
            if (validationTarget) {
                // This is allowed - validations can use assertion-only terms
                diagnostics.push({
                    level: "info",
                    step,
                    target: validationTarget,
                    message: `Validation step is correctly using assertion pattern.`
                });
            }
        }
    }
    // Check if expectedResult introduced new actions
    if (scenario.expectedResult && scenario.expectedResult.length > 20) {
        // Look for action verbs in expectedResult that might have been converted to steps
        const actionVerbs = ["Clic", "Seleccionar", "Ingresar", "Navegar"];
        for (const verb of actionVerbs) {
            if (scenario.expectedResult.includes(verb)) {
                diagnostics.push({
                    level: "warning",
                    step: "expectedResult",
                    target: "N/A",
                    message: `expectedResult contains action verb "${verb}". Ensure it did not introduce unbacked steps.`
                });
            }
        }
    }
    // Check navigation coherence (missing intermediate steps)
    // This should have been repaired already, but validate as final check
    if (valid && derivedContext.profileConfidence !== "none") {
        const coherenceCheck = (0, scenario_intermediate_repair_1.validateNavigationCoherence)(scenario.steps, 
        // Build a minimal route profile object for coherence check
        // In production, pass the actual routeProfile from context
        {
            name: derivedContext.appSlug,
            entry: [],
            aliases: {},
            intermediates: {},
            domainTerms: {},
            visibleControls: [],
            representativeFixture: {},
            notes: []
        }, derivedContext, resolution);
        if (!coherenceCheck.coherent) {
            diagnostics.push({
                level: "error",
                step: "navigation",
                target: "N/A",
                message: `Navigation is incoherent - missing intermediate steps: ${coherenceCheck.diagnostics.join("; ")}`
            });
            valid = false;
            if (reasonCode === "valid") {
                reasonCode = "navigation_incoherent";
            }
        }
    }
    // Profile quality check
    if (derivedContext.profileConfidence === "low" && valid) {
        diagnostics.push({
            level: "warning",
            step: "N/A",
            target: "N/A",
            message: "Route profile has low confidence. Scenario may be valid but unreliable."
        });
        if (reasonCode === "valid") {
            reasonCode = "route_profile_incomplete";
        }
    }
    return {
        valid,
        reasonCode,
        diagnostics
    };
}
/**
 * Validate multiple scenarios and return compliant/non-compliant sets
 */
function validateScenariosCompliance(scenarios, derivedContext, routeResolutions, canonicalClaims = []) {
    const validScenarios = [];
    const invalidScenarios = [];
    for (const scenario of scenarios) {
        const resolution = routeResolutions.get(scenario.sourceIssueKey);
        const result = validateScenarioCompliance(scenario, derivedContext, resolution, canonicalClaims);
        if (result.valid) {
            validScenarios.push(scenario);
        }
        else {
            invalidScenarios.push({ scenario, result });
        }
    }
    return {
        validScenarios,
        invalidScenarios
    };
}
/**
 * Log compliance validation results
 */
function logComplianceResult(appSlug, issueKey, scenarioTitle, result) {
    if (result.valid) {
        console.log(`[scenario-compliance] appSlug=${appSlug} issue=${issueKey} ` +
            `scenario="${scenarioTitle}" valid=true`);
    }
    else {
        console.log(`[scenario-compliance] appSlug=${appSlug} issue=${issueKey} ` +
            `scenario="${scenarioTitle}" valid=false reasonCode=${result.reasonCode}`);
        for (const diag of result.diagnostics) {
            if (diag.level === "error") {
                console.log(`[scenario-compliance] rejected issue=${issueKey} target="${diag.target}" ` +
                    `reasonCode=${result.reasonCode} message=${diag.message}`);
            }
        }
    }
}
/**
 * Log summary of compliance validation
 */
function logComplianceSummary(appSlug, validCount, invalidCount) {
    console.log(`[scenario-compliance] appSlug=${appSlug} ` +
        `validScenarios=${validCount} invalidScenarios=${invalidCount}`);
}
