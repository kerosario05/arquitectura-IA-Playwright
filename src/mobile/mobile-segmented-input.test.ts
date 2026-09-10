import assert from "node:assert";
import { analyzeSegmentedGroup, detectSegmentedGroup, joinSegmentValues, parseBounds, type SegmentCandidate } from "./mobile-segmented-input";

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function describe(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

function box(index: number, x1: number, y1: number, w = 150, h = 150): SegmentCandidate {
  return { index, displayed: true, bounds: { x1, y1, x2: x1 + w, y2: y1 + h } };
}

/**
 * The OTP screen of run dee80c7f: six boxes in a row, which the old single-field fill left
 * holding just "9" of a six-digit code. Coordinates follow the 1440x3120 screenshot.
 */
const OTP_ROW: SegmentCandidate[] = [
  box(0, 85, 1275),
  box(1, 310, 1275),
  box(2, 535, 1275),
  box(3, 760, 1275),
  box(4, 985, 1275),
  box(5, 1210, 1275),
];

describe("parseBounds", () => {
  test("parses Android bounds", () => {
    assert.deepStrictEqual(parseBounds("[54,812][152,918]"), { x1: 54, y1: 812, x2: 152, y2: 918 });
  });

  test("rejects malformed or degenerate bounds", () => {
    assert.strictEqual(parseBounds(""), null);
    assert.strictEqual(parseBounds("54,812,152,918"), null);
    assert.strictEqual(parseBounds("[100,100][100,200]"), null);
    assert.strictEqual(parseBounds(null), null);
  });
});

describe("detectSegmentedGroup", () => {
  test("detects the six OTP boxes of the real failing screen, in visual order", () => {
    assert.deepStrictEqual(detectSegmentedGroup(OTP_ROW, 6), [0, 1, 2, 3, 4, 5]);
  });

  test("orders by x even when the matches come back scrambled", () => {
    const scrambled = [OTP_ROW[3], OTP_ROW[0], OTP_ROW[5], OTP_ROW[1], OTP_ROW[4], OTP_ROW[2]];
    assert.deepStrictEqual(detectSegmentedGroup(scrambled, 6), [0, 1, 2, 3, 4, 5]);
  });

  test("tolerates small vertical jitter across the row", () => {
    const jittered = OTP_ROW.map((b, i) => box(i, b.bounds!.x1, 1275 + (i % 2 === 0 ? 0 : 6)));
    assert.deepStrictEqual(detectSegmentedGroup(jittered, 6), [0, 1, 2, 3, 4, 5]);
  });

  test("declines a single full-width field — the ordinary fill path handles it", () => {
    assert.strictEqual(detectSegmentedGroup([box(0, 54, 1275, 1330)], 6), null);
  });

  test("declines when the box count does not match the value length", () => {
    assert.strictEqual(detectSegmentedGroup(OTP_ROW, 4), null);
    assert.strictEqual(detectSegmentedGroup(OTP_ROW.slice(0, 5), 6), null);
  });

  test("ignores boxes that are not displayed", () => {
    const withHidden = [...OTP_ROW, { index: 6, displayed: false, bounds: { x1: 85, y1: 1275, x2: 235, y2: 1425 } }];
    assert.deepStrictEqual(detectSegmentedGroup(withHidden, 6), [0, 1, 2, 3, 4, 5]);
  });

  test("does not mix a distant row into the group", () => {
    const twoRows = [...OTP_ROW.slice(0, 3), box(3, 85, 2100), box(4, 310, 2100), box(5, 535, 2100)];
    assert.strictEqual(detectSegmentedGroup(twoRows, 6), null);
  });

  test("rejects a row whose widths differ wildly — not a uniform segmented input", () => {
    const uneven = [box(0, 85, 1275, 60), box(1, 200, 1275, 900)];
    assert.strictEqual(detectSegmentedGroup(uneven, 2), null);
  });

  test("rejects horizontally overlapping elements — nested, not side by side", () => {
    const overlapping = [box(0, 85, 1275, 400), box(1, 200, 1275, 400)];
    assert.strictEqual(detectSegmentedGroup(overlapping, 2), null);
  });

  test("never engages for a single character", () => {
    assert.strictEqual(detectSegmentedGroup(OTP_ROW, 1), null);
  });

  test("skips candidates with unparseable bounds", () => {
    const broken = [...OTP_ROW.slice(0, 5), { index: 5, displayed: true, bounds: null }];
    assert.strictEqual(detectSegmentedGroup(broken, 6), null);
  });
});

describe("joinSegmentValues", () => {
  test("joins the boxes in order", () => {
    assert.strictEqual(joinSegmentValues(["9", "4", "8", "2", "1", "3"]), "948213");
  });

  test("a partial fill reads back shorter than the code — the dee80c7f symptom", () => {
    assert.strictEqual(joinSegmentValues(["9", "", "", "", "", ""]), "9");
  });

  test("tolerates null and whitespace boxes", () => {
    assert.strictEqual(joinSegmentValues(["1", null, " 2 ", undefined]), "12");
  });
});

describe("analyzeSegmentedGroup reasons", () => {
  test("reports ok for the real OTP row", () => {
    assert.strictEqual(analyzeSegmentedGroup(OTP_ROW, 6).reason, "ok");
  });

  test("explains a single full-width field", () => {
    const r = analyzeSegmentedGroup([box(0, 54, 1275, 1330)], 6);
    assert.match(r.reason, /^too_few_usable_elements;matched=1;displayed_with_bounds=1$/);
  });

  test("explains a row whose size does not match the value", () => {
    const r = analyzeSegmentedGroup(OTP_ROW, 4);
    assert.match(r.reason, /^no_row_of_expected_size;expected=4;rows=6$/);
  });

  test("explains two separate rows", () => {
    const twoRows = [...OTP_ROW.slice(0, 3), box(3, 85, 2100), box(4, 310, 2100), box(5, 535, 2100)];
    assert.match(analyzeSegmentedGroup(twoRows, 6).reason, /^no_row_of_expected_size;expected=6;rows=3\+3$/);
  });

  test("explains non-uniform widths", () => {
    const r = analyzeSegmentedGroup([box(0, 85, 1275, 60), box(1, 200, 1275, 900)], 2);
    assert.match(r.reason, /^widths_not_uniform;/);
  });

  test("explains overlapping boxes", () => {
    const r = analyzeSegmentedGroup([box(0, 85, 1275, 400), box(1, 200, 1275, 400)], 2);
    assert.match(r.reason, /^boxes_overlap_horizontally;at=1$/);
  });
});

describe("two segmented groups on one screen (email validated, phone pending)", () => {
  // The contact-confirmation screen after the email OTP is accepted: 12 EditText total, the
  // email's six filled and higher up, the phone's six empty below.
  const EMAIL_FILLED: SegmentCandidate[] = "177058".split("").map((ch, i) => ({
    ...box(i, 85 + i * 225, 1275),
    text: ch,
  }));
  const PHONE_EMPTY: SegmentCandidate[] = [0, 1, 2, 3, 4, 5].map((i) => ({
    ...box(6 + i, 85 + i * 225, 2050),
    text: "",
  }));
  const BOTH = [...EMAIL_FILLED, ...PHONE_EMPTY];

  test("picks the empty group, not the first row on screen", () => {
    assert.deepStrictEqual(detectSegmentedGroup(BOTH, 6), [6, 7, 8, 9, 10, 11]);
  });

  test("says it chose by emptiness", () => {
    assert.strictEqual(analyzeSegmentedGroup(BOTH, 6).reason, "ok;picked=empty_group");
  });

  test("still works when the matches arrive phone-first", () => {
    assert.deepStrictEqual(detectSegmentedGroup([...PHONE_EMPTY, ...EMAIL_FILLED], 6), [6, 7, 8, 9, 10, 11]);
  });

  test("a single group needs no emptiness tie-break", () => {
    assert.strictEqual(analyzeSegmentedGroup(PHONE_EMPTY, 6).reason, "ok");
    assert.deepStrictEqual(detectSegmentedGroup(EMAIL_FILLED, 6), [0, 1, 2, 3, 4, 5]);
  });

  test("declines when both groups are empty — genuinely ambiguous", () => {
    const bothEmpty = [...EMAIL_FILLED.map((c) => ({ ...c, text: "" })), ...PHONE_EMPTY];
    const r = analyzeSegmentedGroup(bothEmpty, 6);
    assert.strictEqual(r.group, null);
    assert.match(r.reason, /^ambiguous_groups;candidates=2;empty=2$/);
  });

  test("declines when both groups are already filled", () => {
    const bothFilled = [...EMAIL_FILLED, ...PHONE_EMPTY.map((c) => ({ ...c, text: "4" }))];
    const r = analyzeSegmentedGroup(bothFilled, 6);
    assert.strictEqual(r.group, null);
    assert.match(r.reason, /^ambiguous_groups;candidates=2;empty=0$/);
  });
});
