/** Month/year label used only in the cover's standalone dash placeholder. */
export function formatEvidenceCoverPeriod(date: Date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${month}-${date.getFullYear()}`;
}

/**
 * Replaces standalone dash text nodes used by the cover text box and its legacy VML fallback.
 * Hyphens in requirements, scenario names, and page content remain untouched.
 */
export function replaceEvidenceCoverDash(documentXml: string, period: string): { documentXml: string; replacedCount: number } {
  let replacedCount = 0;
  const escapedPeriod = period.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const coverEnd = documentXml.indexOf("Caso de prueba:");
  const coverXml = coverEnd >= 0 ? documentXml.slice(0, coverEnd) : documentXml;
  const updatedCover = coverXml.replace(/(<w:t(?:\s[^>]*)?>)-(<\/w:t>)/g, (_match, opening: string, closing: string) => {
    replacedCount += 1;
    return `${opening}${escapedPeriod}${closing}`;
  });
  const updatedXml = coverEnd >= 0 ? `${updatedCover}${documentXml.slice(coverEnd)}` : updatedCover;
  return { documentXml: updatedXml, replacedCount };
}
