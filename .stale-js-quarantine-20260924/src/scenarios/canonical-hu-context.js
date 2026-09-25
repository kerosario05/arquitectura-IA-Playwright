"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCanonicalHuContext = buildCanonicalHuContext;
function normalizeJiraValue(value, depth = 0) {
    if (value == null)
        return [];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value).replace(/\r\n?/g, "\n").split("\n").map((line) => line.trimEnd()).filter(Boolean);
    }
    if (Array.isArray(value)) {
        return value.flatMap((item) => normalizeJiraValue(item, depth));
    }
    if (typeof value !== "object" || depth > 12)
        return [];
    const record = value;
    if (typeof record.text === "string")
        return normalizeJiraValue(record.text, depth + 1);
    if (typeof record.value === "string")
        return normalizeJiraValue(record.value, depth + 1);
    if (typeof record.content === "string")
        return normalizeJiraValue(record.content, depth + 1);
    if (Array.isArray(record.content)) {
        const content = normalizeJiraValue(record.content, depth + 1);
        if (record.type === "listItem" && content.length > 0) {
            return [`- ${content[0]}`, ...content.slice(1)];
        }
        return content;
    }
    if (Array.isArray(record.children))
        return normalizeJiraValue(record.children, depth + 1);
    if (Array.isArray(record.items))
        return normalizeJiraValue(record.items, depth + 1);
    return [];
}
function normalizeFunctionalField(value) {
    return normalizeJiraValue(value).join("\n").trim();
}
function buildCanonicalHuContext(issue) {
    const summary = normalizeFunctionalField(issue.summary).normalize("NFC").trim();
    const description = normalizeFunctionalField(issue.description).normalize("NFC").trim();
    const acceptanceCriteria = issue.acceptanceCriteria
        ? normalizeFunctionalField(issue.acceptanceCriteria).normalize("NFC").trim()
        : null;
    const fields = [summary, description, acceptanceCriteria ?? ""].filter(Boolean);
    const text = fields.join("\n");
    const lines = text.split("\n").filter(Boolean);
    const hasSelectionHeading = lines.some((line) => {
        const normalized = line.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return /(?:seleccion\w*|eleg\w*|elig\w*|escog\w*|opcion\w*|alternativ\w*)/i.test(normalized) && /[:：]/.test(line);
    });
    const listItemCount = lines.filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line)).length;
    const hasFunctionalOutcomeEvidence = lines.some((line) => {
        const normalized = line.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        return /(?:cuando|si|al)\s+(?:(?:el|la)\s+)?(?:(?:usuario|cliente|persona)\s+)?(?:se\s+)?(?:seleccion\w*|eleg\w*|elig\w*|escog\w*)\s+.+?,\s*.+/i.test(normalized)
            || /^\s*(?:[-*•]|\d+[.)])\s+.+?\s*(?::|：|→)\s*.+$/.test(line);
    });
    return {
        issueKey: issue.key,
        sourceFields: ["summary", "description", ...(acceptanceCriteria ? ["acceptanceCriteria"] : [])],
        summary,
        description,
        acceptanceCriteria,
        text,
        normalizedLineCount: lines.length,
        normalizedListItemCount: listItemCount,
        canonicalExtractionIncomplete: hasSelectionHeading && listItemCount >= 2 && !hasFunctionalOutcomeEvidence,
    };
}
