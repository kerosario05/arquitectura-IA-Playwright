export type RuntimeFillFormat = { numeric: boolean; decimalSeparator?: "." | "," };

// Compare decimal strings without floating-point rounding or discarding signs/precision.
// Group separators must form complete groups of three; malformed values stay invalid.
function decimalIdentity(value: string, separator: "." | ","): string | undefined {
  const token = value.trim().replace(/[\u00a0\u202f]/g, " ");
  const parts = token.split(separator);
  if (parts.length > 2 || (parts.length === 2 && !/^\d+$/.test(parts[1]))) return undefined;
  const grouping = separator === "." ? "," : ".";
  let integer = parts[0];
  const negative = integer.startsWith("-");
  integer = integer.replace(/^[+-]/, "");
  if (!/^\d+$/.test(integer)) {
    const escapedGrouping = grouping === "." ? "\\." : ",";
    const grouped = new RegExp(`^\\d{1,3}(?:${escapedGrouping}\\d{3})+$`);
    if (grouped.test(integer)) integer = integer.split(grouping).join("");
    else if (/^\d{1,3}(?: \d{3})+$/.test(integer)) integer = integer.replace(/ /g, "");
    else return undefined;
  }
  integer = integer.replace(/^0+(?=\d)/, "");
  const fraction = (parts[1] ?? "").replace(/0+$/, "");
  const isZero = integer === "0" && !fraction;
  return `${negative && !isZero ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

export function runtimeFillValuesMatch(expected: string, actual: string, format?: RuntimeFillFormat): boolean {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "");
  const expectedNormalized = normalize(expected);
  const actualNormalized = normalize(actual);
  if (expectedNormalized === actualNormalized) return true;
  if (format?.numeric) {
    // Runtime values may be canonical dot decimals even when the editor displays commas.
    const expectedSeparator = /^[+-]?\d+(?:\.\d+)?$/.test(expected.trim())
      ? "." : format.decimalSeparator ?? ".";
    const expectedNumber = decimalIdentity(expected, expectedSeparator);
    return expectedNumber !== undefined
      && expectedNumber === decimalIdentity(actual, format.decimalSeparator ?? ".");
  }
  const isoDate = expectedNormalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const localizedDate = actualNormalized.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
  if (isoDate && localizedDate && isoDate[1] === localizedDate[3]
    && isoDate[2] === localizedDate[2] && isoDate[3] === localizedDate[1]) return true;
  // Preserve existing punctuation masks for identifiers, without treating them as numbers.
  const expectedDigits = expectedNormalized.replace(/\D/g, "");
  const actualDigits = actualNormalized.replace(/\D/g, "");
  return expectedDigits.length > 0 && expectedDigits === actualDigits;
}
