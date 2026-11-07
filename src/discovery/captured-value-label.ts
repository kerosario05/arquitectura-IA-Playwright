/**
 * A value transported between tabs (a request number copied from one app and pasted into another) shows up
 * again later as the visible text of a control (the row to open, a link, a badge). The recording keeps that
 * text as a literal from the run that was recorded, which is wrong on the next run.
 *
 * The recording stores the SHAPE of every transported value (letters and punctuation literal, digit runs
 * generalized, e.g. "^MPN\-\d+$"), never the value itself. At replay a label that fully matches the shape of a
 * value captured in THIS run is that value: use the run's own value instead of the recorded literal.
 */
export type CapturedValueShapeSource = { valueSelection?: { valueShape?: string } };

export type CapturedValueLabelMatch = { sourceEventRef: string; value: string };

const MAX_LABEL_LENGTH = 120;

/** A shape made only of digits would match any number on the page (a page number, an amount): never substitute on it. */
function shapeHasLiteralLetters(shape: string): boolean {
  return /[A-Za-z]/.test(shape.replace(/\\[A-Za-z]/g, ""));
}

export function matchCapturedValueForLabel(
  label: string | undefined,
  captures: ReadonlyMap<string, CapturedValueShapeSource>,
  capturedValues: ReadonlyMap<string, string>,
): CapturedValueLabelMatch | undefined {
  const text = (label ?? "").trim();
  if (!text || text.length > MAX_LABEL_LENGTH) return undefined;
  let match: CapturedValueLabelMatch | undefined;
  // capturedValues is filled in capture order: when several values share a shape, the latest one wins.
  for (const [sourceEventRef, value] of capturedValues) {
    const shape = captures.get(sourceEventRef)?.valueSelection?.valueShape;
    if (!value || !shape || !shapeHasLiteralLetters(shape)) continue;
    let pattern: RegExp;
    try { pattern = new RegExp(shape); } catch { continue; }
    if (pattern.test(text) && pattern.test(value)) match = { sourceEventRef, value };
  }
  return match;
}
