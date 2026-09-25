"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.proposeTestRailInputRequirements = proposeTestRailInputRequirements;
const PLACEHOLDER_PATTERN = /\[([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)\]/g;
function appendText(lines, value, usage) {
    if (typeof value === "string" && value.trim()) {
        lines.push({ text: value, usage });
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value)
            appendText(lines, item, usage);
        return;
    }
    if (value && typeof value === "object") {
        const step = value;
        appendText(lines, step.content, "action");
        appendText(lines, step.expected, "expected");
        appendText(lines, step.additional_info, "assertion");
    }
}
function collectContractLines(rawCase) {
    const lines = [];
    // Keep preconditions available for explicit local metadata (for example a
    // password label), while their bare placeholders remain unresolved. A
    // field must otherwise be declared, referenced by an action, or required by
    // an assertion/expected result before it becomes a form input.
    appendText(lines, rawCase.custom_preconds, "action");
    appendText(lines, rawCase.custom_steps, "action");
    appendText(lines, rawCase.custom_steps_separated, "action");
    appendText(lines, rawCase.custom_expected, "expected");
    return lines.flatMap((line) => line.text.split(/\r?\n/).map((text) => ({ text, usage: line.usage })));
}
const SENSITIVE_CONTEXT = /(?:contrase(?:ñ|n)a|password|secret|clave)/i;
function resolveLocalMetadata(line, placeholderStart) {
    const occurrences = Array.from(line.matchAll(PLACEHOLDER_PATTERN));
    if (occurrences.length !== 1)
        return undefined;
    const localText = line.trim();
    const quotedField = localText.match(/\b(?:campo|field)\s+(?:de\s+)?["']([^"']+)["']/i);
    const beforePlaceholder = localText.slice(0, placeholderStart).trim();
    const sensitiveWord = beforePlaceholder.match(SENSITIVE_CONTEXT);
    const label = quotedField?.[1]?.trim() || sensitiveWord?.[0]?.trim();
    if (!label)
        return undefined;
    const sensitive = SENSITIVE_CONTEXT.test(localText);
    return {
        label,
        controlType: sensitive ? "password" : "text",
        sensitive,
    };
}
function humanizeKey(key) {
    const lastPart = key.split(".").at(-1) ?? key;
    return lastPart
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/^./, (char) => char.toUpperCase());
}
function isActionReference(line) {
    return /\b(?:ingresar|introducir|llenar|completar|escribir|seleccionar|elegir|marcar|usar|fill|enter|type|select)\b/i.test(line);
}
function isAssertionReference(line) {
    return /\b(?:verificar|validar|comprobar|confirmar|mostrar|aparecer|debe\s+(?:mostrar|contener)|should|expect|assert)\b/i.test(line);
}
function proposeTestRailInputRequirements(input) {
    const existingKeys = new Set(input.converterOutput.requirements.map((requirement) => requirement.key));
    const lines = collectContractLines(input.rawCase);
    const proposals = [];
    const unresolved = new Set(input.converterOutput.unresolvedPlaceholders);
    const seenKeys = new Set();
    lines.forEach(({ text: line, usage }) => {
        for (const match of line.matchAll(PLACEHOLDER_PATTERN)) {
            const key = match[1];
            if (existingKeys.has(key) || seenKeys.has(key))
                continue;
            seenKeys.add(key);
            const context = line.replace(/\s+/g, " ").trim();
            const metadata = resolveLocalMetadata(line, match.index ?? 0);
            const inferredUsage = usage === "expected" || isAssertionReference(line) ? (usage === "expected" ? "expected" : "assertion") : "action";
            const canInferFromUsage = usage === "expected" || isActionReference(line) || isAssertionReference(line);
            if (!metadata && !canInferFromUsage) {
                unresolved.add(key);
                continue;
            }
            proposals.push({
                key,
                label: metadata?.label ?? humanizeKey(key),
                controlType: metadata?.controlType ?? "text",
                required: true,
                sensitive: metadata?.sensitive ?? false,
                allowedValues: [],
                inputRole: "scenario",
                inputUsage: [inferredUsage],
                confidence: 0.9,
                evidence: context,
                provenance: "placeholder_reference",
            });
        }
    });
    return {
        proposals,
        unresolved: Array.from(unresolved).filter((key) => !proposals.some((proposal) => proposal.key === key)),
        requiresApproval: true,
    };
}
