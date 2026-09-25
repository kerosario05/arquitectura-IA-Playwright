/**
 * Serializes TestRail's legacy rich-text steps field using the format already
 * used by the working cases in the configured suite.  The canonical array is
 * the source of truth; this string is only the destination representation.
 */
export type PublishableTestRailStep = { content: string; expected?: string };

function removeLeadingPresentationOrdinal(value: string): string {
  const trimmed = value.trim();
  const match = /^(\d+)[.)]\s+(.+)$/.exec(trimmed);
  return match?.[2]?.trim() || trimmed;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function serializeTestRailSteps(steps: readonly PublishableTestRailStep[]): string {
  const items: string[] = [];
  let ordinal = 0;
  for (const step of steps) {
    const content = removeLeadingPresentationOrdinal(step.content);
    if (!content) continue;
    ordinal += 1;
    const itemLines = [escapeHtml(content)];
    const expected = step.expected?.trim();
    if (expected) itemLines.push(`Esperado: ${escapeHtml(expected)}`);
    items.push(`<li>${itemLines.join("<br />")}</li>`);
  }
  return `<ol>\n${items.join("\n")}\n</ol>\n`;
}
