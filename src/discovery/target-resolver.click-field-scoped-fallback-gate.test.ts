import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * FIRST_LOSS (click): `resolveActionTarget`'s wrapper unconditionally returned as soon as a
 * recorded technical target had been supplied at all (`recordedTechnicalTargetRefs`/
 * `recordedTechnicalTargets` non-empty), even when that recorded target had already failed --
 * inside `resolveActionTargetCore` -- for the exact reason the field-scoped fallback exists to
 * recover from: `recorded_target_not_present_or_unique_on_current_surface` (the recorded button
 * moved/re-rendered in the live DOM, on the CORRECT surface). Confirmed against a real physical
 * page (recordingId 52849d4b-bfa5-4842-850a-a43e6460dcaf, jobId
 * 4fe45b83-d5c4-4366-8267-0e349bc61c74): the fill of "Numero de identificacion" on the very same
 * page, in the very same field scope, certified through this fallback moments earlier
 * (`[field-scoped-fallback] status=certified strategy=recorded:css`) -- but the click on the
 * button associated with that field never reached the fallback at all, and fell through to an
 * unbounded 51-candidate page-wide search that failed.
 *
 * Fixed by narrowing what "unaffected" means: a recorded target that failed for a route/surface/
 * structural reason is still never overridden (unaffected, as before); a recorded target that
 * failed only because it is genuinely absent/no-longer-unique on the CURRENT surface, with a
 * real `associatedField` present, now reaches the SAME existing `tryFieldScopedStructuralFallback`
 * fill already uses -- with `requiredCompatibility="actionable"` (already selected correctly for
 * click before this fix; the missing piece was ever reaching that call).
 *
 * This ~6000-line resolver's full behavior is not independently re-testable here without a real
 * browser (`resolveActionTargetCore` drives real `page.locator(...)` calls throughout) -- matching
 * this file's established "no browser" convention (see
 * `target-resolver.fill-field-scoped-fallback-gate.test.ts`). What IS verified here, statically,
 * is the actual code-level claim this ticket cares about.
 */

const SOURCE_PATH = path.resolve(__dirname, "target-resolver.ts");
const source = fs.readFileSync(SOURCE_PATH, "utf8");

function resolveActionTargetSource(): string {
  const start = source.indexOf("export async function resolveActionTarget(");
  assert.ok(start >= 0, "expected resolveActionTarget to be defined");
  const end = source.indexOf("\nasync function trySemanticFallback", start);
  assert.ok(end > start, "expected resolveActionTarget to end before trySemanticFallback");
  return source.slice(start, end);
}

test("1/inputPlusButton-eligibility. a recorded target supplied but genuinely absent/non-unique on the current surface, with associatedField present, is still eligible for the fallback", () => {
  const fn = resolveActionTargetSource();
  assert.match(fn, /recordedTargetGenuinelyAbsentOnCurrentSurface\s*=\s*\n?\s*result\.matchReason === "recorded_target_not_present_or_unique_on_current_surface"/);
  assert.match(fn, /if \(recordedTargetWasSupplied && \(!recordedTargetGenuinelyAbsentOnCurrentSurface \|\| !opts\.associatedField\?\.trim\(\)\)\) \{/);
});

test("2/recordedTargetRegression. a recorded target that failed for a route/surface/structural reason is still never overridden (unaffected)", () => {
  const fn = resolveActionTargetSource();
  // The gate returns whenever the failure reason is anything OTHER than the exact
  // "genuinely absent on current surface" string -- i.e. structural/route/app mismatches keep
  // short-circuiting exactly as before.
  const gateMatch = fn.match(/if \(recordedTargetWasSupplied && \(([\s\S]*?)\)\) \{\s*\n\s*return result;/);
  assert.ok(gateMatch, "expected the widened eligibility gate");
  assert.match(gateMatch![1], /!recordedTargetGenuinelyAbsentOnCurrentSurface/);
});

test("3/missingRecordedUsesFieldScope. no recorded target at all still falls through to the field-scoped fallback exactly as before", () => {
  const fn = resolveActionTargetSource();
  assert.match(fn, /const recordedTargetWasSupplied =\s*\n?\s*\(opts\.recordedTechnicalTargetRefs\?\.length \?\? 0\) > 0 \|\| \(opts\.recordedTechnicalTargets\?\.length \?\? 0\) > 0;/);
  // When recordedTargetWasSupplied is false, the `&&` short-circuits and the early return never
  // fires -- the function proceeds straight to tryFieldScopedStructuralFallback below.
});

test("4/noAssociatedFieldRegression. a recorded target that failed with no associatedField present still returns early, unaffected", () => {
  const fn = resolveActionTargetSource();
  assert.match(fn, /!opts\.associatedField\?\.trim\(\)/);
});

test("5/actionableCompatibility. click (and any non-fill/press action) requests \"actionable\" compatibility from the shared core, unchanged by this fix", () => {
  const fn = resolveActionTargetSource();
  assert.match(fn, /opts\.recordingActionType === "fill" \|\| opts\.recordingActionType === "press" \? "editable" : "actionable"/);
});

test("6/noParallelResolver. no second/duplicate field-scoped resolver was introduced -- the SAME existing helper is reused in mutually-exclusive branches", () => {
  const fn = resolveActionTargetSource();
  const matches = fn.match(/tryFieldScopedStructuralFallback\(/g) ?? [];
  // The shared helper is invoked from TWO mutually-exclusive branches: the exact-resolution branch
  // (diagnostic-only accepted-scope marker certification, never a locator) and the not-found
  // recovery branch. At most ONE executes per resolveActionTarget call -- never a second/parallel
  // resolver, never a downstream re-resolution.
  assert.equal(matches.length, 2, "both call sites reuse the same existing shared fallback");
  assert.doesNotMatch(fn, /function\s+tryFieldScoped\w*Fallback2?\(/i, "no second fallback function defined inline");
  assert.doesNotMatch(fn, /click-field-resolver-v2|associated-button-resolver/i);
});

test("7/fillUntouched. resolveFillTarget's own wrapper source is completely unmodified by this fix", () => {
  const fillStart = source.indexOf("export async function resolveFillTarget(");
  const fillEnd = source.indexOf("\nexport function validateFillResolutionContract", fillStart);
  const fillFn = source.slice(fillStart, fillEnd);
  assert.match(fillFn, /const fieldScopedFallbackEligible = result\.status === "not_found"/);
  assert.match(fillFn, /tryFieldScopedStructuralFallback\(page, gridContext\.associatedField \?\? target, "editable", "fill"\)/);
});

test("8/multiproject. no app/business hardcode was introduced by this fix", () => {
  const fn = resolveActionTargetSource();
  assert.doesNotMatch(fn, /portal-comercial/i);
  assert.doesNotMatch(fn, /numero.de.identificacion/i);
});

test("9/noSleep. no fixed sleep/setTimeout/waitForTimeout was introduced in this fix", () => {
  const fn = resolveActionTargetSource();
  assert.doesNotMatch(fn, /waitForTimeout/);
  assert.doesNotMatch(fn, /\bsetTimeout\s*\(/);
});

test("10/noPosition. no positional selector (nth/first/last) was introduced in this fix", () => {
  const fn = resolveActionTargetSource();
  assert.doesNotMatch(fn, /\.nth\(/);
  assert.doesNotMatch(fn, /\.first\(\)/);
  assert.doesNotMatch(fn, /\.last\(\)/);
});

test("11/noDatasetLogging. the new click diagnostic log carries no dataset value or DOM text, only booleans/strings already known to the caller", () => {
  const fn = resolveActionTargetSource();
  const logMatch = fn.match(/console\.log\(\s*\n?\s*`\[field-scope-click\][\s\S]*?\);/);
  assert.ok(logMatch, "expected a [field-scope-click] diagnostic log");
  assert.doesNotMatch(logMatch![0], /\$\{opts\.associatedField\}/, "must not log the raw associatedField value");
});
