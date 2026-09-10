/**
 * Segmented (per-character) text inputs — the "one box per digit" OTP pattern.
 *
 * A step like `fill` with target `new UiSelector().className("android.widget.EditText")` resolves
 * to the FIRST matching box. On a screen that splits a 6-digit code across 6 boxes, each capped at
 * one character, sending the whole code there leaves a single digit behind and the submit button
 * disabled — which is exactly how run dee80c7f failed: `observed=[attribute:text=9]` against a
 * six-digit code.
 *
 * These helpers recognise that layout from element geometry (same row, comparable size, one box per
 * character) and write one character per box. Detection is deliberately strict: when the boxes do
 * not line up unambiguously with the value, the caller falls back to the ordinary single-field
 * fill rather than typing into a layout it does not understand.
 */

export type Bounds = { x1: number; y1: number; x2: number; y2: number };

export type SegmentCandidate = {
  /** Position of the element within the selector's match list. */
  index: number;
  bounds: Bounds | null;
  displayed: boolean;
  /**
   * What the box currently holds. A screen can show more than one segmented group at once — the
   * contact-confirmation screen shows the email's six boxes already filled while the phone's six
   * wait empty — and the group still to be filled is the empty one.
   */
  text?: string;
};

/** Parses Android's `bounds` attribute, e.g. "[54,812][152,918]". */
export function parseBounds(raw: string | null | undefined): Bounds | null {
  if (!raw) return null;
  const m = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(raw.trim());
  if (!m) return null;
  const [x1, y1, x2, y2] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (x2 <= x1 || y2 <= y1) return null;
  return { x1, y1, x2, y2 };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Decides whether the matched elements form a segmented input holding exactly `expectedLength`
 * characters, and returns their indices in left-to-right order.
 *
 * Requires all of:
 *  - at least 2 boxes, and exactly `expectedLength` of them on one row (an inexact count means the
 *    layout is not the one we think it is, so we decline instead of guessing);
 *  - comparable widths (widest / narrowest <= 3), ruling out a full-width field sharing a row;
 *  - no horizontal overlap, ruling out stacked or nested elements.
 */
export function detectSegmentedGroup(candidates: SegmentCandidate[], expectedLength: number): number[] | null {
  return analyzeSegmentedGroup(candidates, expectedLength).group;
}

/**
 * Same detection as `detectSegmentedGroup`, but also reports why it declined. The executor logs
 * the reason: a decline is silent otherwise, and a screen that fills only its first box looks
 * identical in the artifacts whether detection ran and said no, or never ran at all.
 */
export function analyzeSegmentedGroup(
  candidates: SegmentCandidate[],
  expectedLength: number,
): { group: number[] | null; reason: string } {
  if (expectedLength < 2) return { group: null, reason: "value_too_short" };
  const usable = candidates.filter((c) => c.displayed && c.bounds !== null) as Array<
    SegmentCandidate & { bounds: Bounds }
  >;
  if (usable.length < 2) {
    return {
      group: null,
      reason: `too_few_usable_elements;matched=${candidates.length};displayed_with_bounds=${usable.length}`,
    };
  }

  // Row tolerance scales with box height so it adapts to screen density.
  const heights = usable.map((c) => c.bounds.y2 - c.bounds.y1);
  const rowTolerance = Math.max(8, median(heights) * 0.5);

  const rows: Array<Array<SegmentCandidate & { bounds: Bounds }>> = [];
  for (const candidate of [...usable].sort((a, b) => a.bounds.y1 - b.bounds.y1)) {
    const row = rows.find((r) => Math.abs(r[0].bounds.y1 - candidate.bounds.y1) <= rowTolerance);
    if (row) row.push(candidate);
    else rows.push([candidate]);
  }

  const sized = rows.filter((r) => r.length === expectedLength);
  if (sized.length === 0) {
    const shape = rows.map((r) => r.length).join("+");
    return {
      group: null,
      reason: `no_row_of_expected_size;expected=${expectedLength};rows=${shape}`,
    };
  }

  const viable: Array<{ ordered: typeof sized[number]; empty: boolean }> = [];
  let lastRejection = "";
  for (const row of sized) {
    const ordered = [...row].sort((a, b) => a.bounds.x1 - b.bounds.x1);

    const widths = ordered.map((c) => c.bounds.x2 - c.bounds.x1);
    const widest = Math.max(...widths);
    const narrowest = Math.min(...widths);
    if (narrowest <= 0 || widest / narrowest > 3) {
      lastRejection = `widths_not_uniform;narrowest=${narrowest};widest=${widest}`;
      continue;
    }

    let overlapAt = -1;
    for (let i = 1; i < ordered.length; i++) {
      if (ordered[i].bounds.x1 < ordered[i - 1].bounds.x2) {
        overlapAt = i;
        break;
      }
    }
    if (overlapAt >= 0) {
      lastRejection = `boxes_overlap_horizontally;at=${overlapAt}`;
      continue;
    }

    viable.push({ ordered, empty: ordered.every((c) => (c.text ?? "").trim() === "") });
  }

  if (viable.length === 0) return { group: null, reason: lastRejection || "no_viable_row" };
  if (viable.length === 1) return { group: viable[0].ordered.map((c) => c.index), reason: "ok" };

  // More than one group of the right size: the one still to be filled is the empty one. Two
  // empty groups would be genuinely ambiguous, so decline rather than pick a side.
  const empty = viable.filter((v) => v.empty);
  if (empty.length === 1) {
    return { group: empty[0].ordered.map((c) => c.index), reason: "ok;picked=empty_group" };
  }
  return {
    group: null,
    reason: `ambiguous_groups;candidates=${viable.length};empty=${empty.length}`,
  };
}

/**
 * Joins what the boxes currently hold, in visual order, so the result can be compared against the
 * submitted value. Empty boxes contribute nothing, so a partial fill reads back shorter than the
 * value — which is precisely the failure this module exists to prevent.
 */
export function joinSegmentValues(values: Array<string | null | undefined>): string {
  return values.map((v) => (v ?? "").trim()).join("");
}
