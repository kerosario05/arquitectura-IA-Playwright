import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * FIRST_LOSS: `resolveFillTarget`'s wrapper only ever attempted the field-scoped structural
 * fallback (`tryFieldScopedStructuralFallback`) on a genuine `not_found` status
 * (`if (result.status !== "not_found") return result;`). A candidate MATCHED by the generic
 * text-scan but rejected as non-editable (`not_editable`/`fill_target_not_editable` -- the
 * field's own <span>/label text node) never reached `"not_found"`, so the fallback was
 * unreachable for exactly the shape it exists to solve. Confirmed against a real physical page
 * (recordingId 52849d4b-bfa5-4842-850a-a43e6460dcaf, execution
 * e134f548-e2e8-4fc6-9222-352a933bb960): the real input sat as the very next DOM sibling of the
 * rejected label span for the entire 33-poll, ~15s wait, and was never once considered.
 *
 * Fixed by widening the eligibility condition to also cover `not_editable`/
 * `fill_target_not_editable`, and by passing the real `gridContext.associatedField` authority to
 * the fallback (previously the raw `target` string was passed positionally in its place).
 *
 * This ~6000-line resolver's full behavior is not independently re-testable here without a real
 * browser (`resolveFillTargetCore` drives real `page.locator(...)` calls throughout) -- matching
 * this session's established "no browser" convention for this file (see
 * `target-resolver.press-compatibility.test.ts`). What IS verified here, statically, is the
 * actual code-level claim this ticket cares about: the eligibility condition now includes both
 * non-editable statuses, the fallback receives the real associatedField authority (never a
 * positional substitution), and no parallel/duplicate resolver was introduced. The fallback's own
 * DOM-evidence-gathering logic is exhaustively covered, unmodified in its wiring, by
 * `field-scoped-live-discovery.test.ts` and `field-scoped-live-discovery.text-anchor.test.ts`.
 */

const SOURCE_PATH = path.resolve(__dirname, "target-resolver.ts");
const source = fs.readFileSync(SOURCE_PATH, "utf8");

function resolveFillTargetSource(): string {
  const start = source.indexOf("export async function resolveFillTarget(");
  assert.ok(start >= 0, "expected resolveFillTarget to be defined");
  const end = source.indexOf("\nexport function validateFillResolutionContract", start);
  assert.ok(end > start, "expected resolveFillTarget to end before validateFillResolutionContract");
  return source.slice(start, end);
}

test("1/statusEligible. the fallback eligibility condition covers not_found, not_editable, and fill_target_not_editable", () => {
  const fn = resolveFillTargetSource();
  assert.match(fn, /result\.status === "not_found"/);
  assert.match(fn, /result\.status === "not_editable"/);
  assert.match(fn, /result\.status === "fill_target_not_editable"/);
});

test("2/fieldRelationEligible. the fallback receives the real associatedField authority, never the raw target positionally", () => {
  const fn = resolveFillTargetSource();
  assert.match(fn, /tryFieldScopedStructuralFallback\(page, gridContext\.associatedField \?\? target, "editable", "fill"\)/);
});

test("3/noParallelResolver. no second/duplicate field-scoped resolver was introduced -- the SAME existing helper is reused", () => {
  const fn = resolveFillTargetSource();
  const matches = fn.match(/tryFieldScopedStructuralFallback\(/g) ?? [];
  assert.equal(matches.length, 1, "expected exactly one call to the existing shared fallback");
  assert.doesNotMatch(fn, /function\s+tryFieldScoped\w*Fallback2?\(/i, "no second fallback function defined inline");
});

test("4/gridScopedUnaffected. grid-scoped fills and fills with recorded technical targets still skip the fallback entirely, unaffected by the widened status set", () => {
  const fn = resolveFillTargetSource();
  assert.match(fn, /const isGridScoped = gridContext\.rowScope !== undefined \|\| Boolean\(gridContext\.entityScope\);/);
  assert.match(fn, /if \(isGridScoped\) return result;/);
  assert.match(fn, /recordedTechnicalTargetRefs\?\.length \?\? 0\) > 0 \|\| \(gridContext\.recordedTechnicalTargets\?\.length \?\? 0\) > 0\) return result;/);
});

test("5/resolvedAndAmbiguousUnaffected. a genuinely resolved or ambiguous status is never routed into the fallback -- only the three explicit statuses are", () => {
  const fn = resolveFillTargetSource();
  const gateMatch = fn.match(/const fieldScopedFallbackEligible = ([\s\S]*?);/);
  assert.ok(gateMatch, "expected the eligibility variable's assignment expression");
  assert.doesNotMatch(gateMatch![1], /"resolved"/);
  assert.doesNotMatch(gateMatch![1], /"ambiguous"/);
  assert.doesNotMatch(gateMatch![1], /"not_visible"/);
});

test("6/multiproject. no app/business/route hardcode was introduced in this fix", () => {
  const fn = resolveFillTargetSource();
  assert.doesNotMatch(fn, /portal-comercial/i);
  assert.doesNotMatch(fn, /solicitud multiproducto/i);
  assert.doesNotMatch(fn, /numero.de.identificacion/i);
});

test("7/noSleep. no fixed sleep/setTimeout/waitForTimeout was introduced in this fix", () => {
  const fn = resolveFillTargetSource();
  assert.doesNotMatch(fn, /waitForTimeout/);
  assert.doesNotMatch(fn, /\bsetTimeout\s*\(/);
});

test("8/noPosition. no positional selector (nth/first/last) was introduced in this fix", () => {
  const fn = resolveFillTargetSource();
  assert.doesNotMatch(fn, /\.nth\(/);
  assert.doesNotMatch(fn, /\.first\(\)/);
  assert.doesNotMatch(fn, /\.last\(\)/);
});
