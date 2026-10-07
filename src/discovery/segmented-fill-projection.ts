/** A source step may contain one literal segment or a redacted whole-field mask. */
export function isMaskedSegmentValue(value: string): boolean {
  return /^(?:[•●·*]){2,}$/u.test(value.trim());
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
