"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseTestRailInputRequirements = parseTestRailInputRequirements;
const DECLARATION_PATTERN = /^\s*(?:[-*]\s*)?(.+?)\s*\(\s*([^(),]+?)\s*,\s*([^()]+?)\s*\)\s*(?:\[[^\]]+\]\s*)*$/;
const PLACEHOLDER_PATTERN = /\[([^\]]+)\]/g;
function isSensitiveControlType(controlType) {
    return /^(?:secret|password|credential)$/i.test(controlType.trim());
}
function sameMetadata(left, right) {
    return left.label === right.label
        && left.controlType === right.controlType
        && left.required === right.required
        && left.sensitive === right.sensitive
        && JSON.stringify(left.allowedValues) === JSON.stringify(right.allowedValues);
}
function parseTestRailInputRequirements(text) {
    const requirements = [];
    const conflicts = [];
    const byKey = new Map();
    for (const line of String(text ?? "").split(/\r?\n/)) {
        const match = line.match(DECLARATION_PATTERN);
        if (!match)
            continue;
        const label = match[1].trim();
        const key = match[2].trim();
        const controlType = match[3].trim();
        if (!label || !key || !controlType)
            continue;
        const requirement = {
            key,
            label,
            controlType,
            required: true,
            sensitive: isSensitiveControlType(controlType),
            allowedValues: [],
        };
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, requirement);
            requirements.push(requirement);
        }
        else if (!sameMetadata(existing, requirement)) {
            conflicts.push({ key, existing, incoming: requirement });
        }
    }
    const declaredKeys = new Set(requirements.map((requirement) => requirement.key));
    const unresolvedPlaceholders = [];
    const seenPlaceholders = new Set();
    for (const match of String(text ?? "").matchAll(PLACEHOLDER_PATTERN)) {
        const key = match[1].trim();
        if (key && !declaredKeys.has(key) && !seenPlaceholders.has(key)) {
            seenPlaceholders.add(key);
            unresolvedPlaceholders.push(key);
        }
    }
    return { requirements, unresolvedPlaceholders, conflicts };
}
