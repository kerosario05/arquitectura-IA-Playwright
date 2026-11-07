/** A source step may contain one literal segment or a redacted whole-field mask. */
export function isMaskedSegmentValue(value: string): boolean {
  // Some generated JSON artifacts decode UTF-8 mask bullets as the literal mojibake
  // token `â€¢`. Recognize that privacy mask as one marker so a six-box value still
  // projects as one segmented fill; do not broaden this to arbitrary malformed text.
  return /^(?:[•●·*]|â€¢){2,}$/u.test(value.trim());
}

export function isSingleSegmentOrMask(value: unknown): value is string {
  return typeof value === "string" && (value.length === 1 || isMaskedSegmentValue(value));
}

export function isProjectableFirstSegment(value: unknown, valueSource: string | undefined): value is string {
  return valueSource === "unknown" || valueSource === "literal"
    ? isSingleSegmentOrMask(value)
    : valueSource === "test_data" && typeof value === "string" && isMaskedSegmentValue(value);
}

export function isCompatibleSegmentValue(value: unknown, firstValue: string): value is string {
  if (!isSingleSegmentOrMask(value)) return false;
  return isMaskedSegmentValue(firstValue)
    ? isMaskedSegmentValue(value) && value === firstValue
    : value.length === 1;
}
