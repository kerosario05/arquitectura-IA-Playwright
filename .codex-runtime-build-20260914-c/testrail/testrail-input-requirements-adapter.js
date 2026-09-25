"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractTestRailInputRequirements = extractTestRailInputRequirements;
const testrail_input_requirements_parser_1 = require("./testrail-input-requirements-parser");
function appendFieldText(parts, value) {
    if (typeof value === "string" && value.trim()) {
        parts.push(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value)
            appendFieldText(parts, item);
        return;
    }
    if (value && typeof value === "object") {
        const step = value;
        for (const key of ["content", "expected", "additional_info"]) {
            appendFieldText(parts, step[key]);
        }
    }
}
function stripContractMarkup(value) {
    return value
        .replace(/<br\s*\/?\s*>/gi, "\n")
        .replace(/<\/li\s*>/gi, "\n")
        .replace(/<li[^>]*>/gi, "")
        .replace(/<\/p\s*>/gi, "\n")
        .replace(/<p[^>]*>/gi, "")
        .replace(/<\/ol\s*>|<ol[^>]*>/gi, "\n")
        .replace(/<\/ul\s*>|<ul[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&quot;/gi, '"')
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/\r\n?/g, "\n");
}
function contractText(rawCase) {
    const parts = [];
    appendFieldText(parts, rawCase.custom_preconds);
    appendFieldText(parts, rawCase.custom_steps);
    appendFieldText(parts, rawCase.custom_expected);
    appendFieldText(parts, rawCase.custom_steps_separated);
    return parts.join("\n");
}
function extractTestRailInputRequirements(rawCase) {
    return (0, testrail_input_requirements_parser_1.parseTestRailInputRequirements)(stripContractMarkup(contractText(rawCase)));
}
