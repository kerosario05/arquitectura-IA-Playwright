"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serializeTestRailSteps = serializeTestRailSteps;
function removeLeadingPresentationOrdinal(value) {
    const trimmed = value.trim();
    const match = /^(\d+)[.)]\s+(.+)$/.exec(trimmed);
    return match?.[2]?.trim() || trimmed;
}
function escapeHtml(value) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
function serializeTestRailSteps(steps) {
    const items = [];
    let ordinal = 0;
    for (const step of steps) {
        const content = removeLeadingPresentationOrdinal(step.content);
        if (!content)
            continue;
        ordinal += 1;
        const itemLines = [escapeHtml(content)];
        const expected = step.expected?.trim();
        if (expected)
            itemLines.push(`Esperado: ${escapeHtml(expected)}`);
        items.push(`<li>${itemLines.join("<br />")}</li>`);
    }
    return `<ol>\n${items.join("\n")}\n</ol>\n`;
}
