"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isSensitiveDataLabel = isSensitiveDataLabel;
exports.slugifyDataKey = slugifyDataKey;
exports.applyDataOverrides = applyDataOverrides;
const SENSITIVE_KEYWORDS = [
    "documento", "cedula", "cédula", "pasaporte", "identificacion", "identificación",
    "otp", "contrasena", "contraseña", "password", "correo", "email", "tarjeta", "cvv", "pin"
];
/** Detects whether a data field is sensitive from its label (for UI masking). */
function isSensitiveDataLabel(label) {
    const normalized = label.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return SENSITIVE_KEYWORDS.some((kw) => normalized.includes(kw.normalize("NFD").replace(/[\u0300-\u036f]/g, "")));
}
/** Builds a stable, readable slug key from a field label. */
function slugifyDataKey(label) {
    return label
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 60) || "campo";
}
/**
 * Returns a copy of `steps` with the user-supplied real values applied to the matching
 * steps (by index). Steps without an override keep their original value. Never mutates
 * the input array.
 *
 * - text field → replaces the `fill` step's `value`.
 * - select field → re-targets the `click` step to the chosen option using the field's
 *   `applyTargetTemplate` (`{{value}}` substituted). Needs `requiredData` to know the
 *   field kind + template; without it, only text (fill) overrides are applied.
 */
function applyDataOverrides(steps, overridesByStepIndex, requiredData) {
    if (!overridesByStepIndex || Object.keys(overridesByStepIndex).length === 0) {
        return steps;
    }
    const fieldByStep = new Map();
    for (const f of requiredData ?? [])
        fieldByStep.set(f.stepIndex, f);
    const result = [];
    const consumed = new Set();
    // Structural role detection (never by description text). An option is a click whose target
    // equals the field's applyTargetTemplate rendered with one of its options, OR is structurally
    // marked select_option.
    const isOptionStep = (s, f) => {
        if (!s || s.action !== "click" || !f.applyTargetTemplate)
            return false;
        if (s.actionRole === "select_option")
            return true;
        return (f.options ?? []).some((opt) => s.target?.value === f.applyTargetTemplate.value.replace(/{{value}}/g, opt));
    };
    const isOpenerMarked = (s) => s?.actionRole === "open_selector";
    const renderedFor = (field, opt) => field.applyTargetTemplate.value.replace(/{{value}}/g, opt);
    for (let idx = 0; idx < steps.length; idx++) {
        if (consumed.has(idx))
            continue;
        const step = steps[idx];
        const override = overridesByStepIndex[idx];
        if (typeof override !== "string") {
            result.push(step);
            continue;
        }
        const field = fieldByStep.get(idx);
        if (step.action === "click" && field?.kind === "select" && field.applyTargetTemplate) {
            const buildOption = (base) => ({
                ...(base ?? { action: "click" }),
                action: "click",
                actionRole: "select_option",
                expectedState: "option_selected",
                requiredNextTarget: base?.requiredNextTarget ?? steps[idx + 1]?.target,
                description: `Seleccionar ${field.label}: ${override}`,
                target: { strategy: field.applyTargetTemplate.strategy, value: renderedFor(field, override) },
            });
            const anchorIsOption = isOptionStep(step, field);
            if (anchorIsOption) {
                // Local opener = ONLY the immediately-preceding step of the original array. Never scan
                // arbitrary earlier positions for an opener.
                const prev = idx > 0 ? steps[idx - 1] : undefined;
                const localOpener = prev &&
                    prev.action === "click" &&
                    !isOptionStep(prev, field) &&
                    !fieldByStep.has(idx - 1) &&
                    !consumed.has(idx - 1)
                    ? prev
                    : undefined;
                if (localOpener) {
                    // The opener was already emitted at its own position (idx-1 has no field/override).
                    // Emit ONLY the option here; never re-emit the opener (no duplication).
                    consumed.add(idx - 1);
                    result.push(buildOption(step));
                }
                else if (field.openerLocator) {
                    // Only-option case WITH a structural opener locator: materialize exactly ONE safe opener
                    // from field.openerLocator (the declared toggle target, distinct from the option target),
                    // then emit the option. This never uses applyTargetTemplate/defaultValue/exampleValue to
                    // build the opener, never clones the option's target, and never scans for a global click.
                    result.push({
                        action: "click",
                        actionRole: "open_selector",
                        expectedState: "selector_open",
                        description: `Abrir selector de ${field.label}`,
                        target: { strategy: field.openerLocator.strategy, value: field.openerLocator.value },
                    });
                    result.push(buildOption(step));
                }
                else {
                    // Only-option case WITHOUT an opener locator: fail-safe. Do NOT fabricate an opener — the
                    // only structural metadata (applyTargetTemplate) describes the option target, not an
                    // opener, so synthesizing one would open the selector without selecting. Emit ONLY the
                    // single select_option step.
                    result.push(buildOption(step));
                }
                continue;
            }
            // Anchor is the opener (or a plain click treated as opener). Pair with an option that is
            // LOCAL (immediately after); otherwise materialize a single option from the override.
            const optionAfter = idx + 1 < steps.length && isOptionStep(steps[idx + 1], field) && !consumed.has(idx + 1)
                ? steps[idx + 1]
                : undefined;
            const opener = {
                ...step,
                actionRole: "open_selector",
                expectedState: "selector_open",
            };
            if (optionAfter) {
                consumed.add(idx + 1);
                result.push(opener);
                result.push(buildOption(optionAfter));
            }
            else {
                result.push(opener);
                result.push(buildOption(undefined));
            }
            continue;
        }
        if (step.action === "fill" && (!field || field.kind === "text")) {
            result.push({ ...step, value: override });
            continue;
        }
        result.push(step);
    }
    return result;
}
