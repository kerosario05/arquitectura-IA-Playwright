"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.quoteHumanValue = quoteHumanValue;
exports.renderHumanStepValue = renderHumanStepValue;
/** Shared presentation-only materialization for recorded human steps. */
function quoteHumanValue(value) {
    return JSON.stringify(value);
}
function renderHumanStepValue(template, valueKey, value) {
    return template.split(`[${valueKey}]`).join(quoteHumanValue(value));
}
