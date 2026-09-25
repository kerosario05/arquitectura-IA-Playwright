import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * FIRST_LOSS (observability): a physical run (job 094a33f0-bab8-49b9-a5bd-267c5996a2e3) showed
 * `[field-scoped-fallback] status=field_container_not_resolved` on every attempt, but the
 * `[field-scope-diagnostic]` logs the previous ticket added never appeared. Direct source
 * inspection confirmed the diagnostic code itself was already correct and complete: EVERY
 * meaningful return path of `extractFieldScopedDomEvidence` (no-anchor, anchor-found-but-climb-
 * exhausted, container-missing-stable-attribute, success) already attaches a `diagnostics`
 * object, and `tryFieldScopedStructuralFallback` already logs it whenever present -- verified by
 * `awk`-extracting the entire function body and confirming its only unconditional
 * diagnostics-free return is the (legitimate, non-diagnosable) blank-`associatedField` guard.
 *
 * The remaining, real gap: `.evaluate(...).catch(() => undefined)` made a genuinely THROWN
 * exception (a real runtime error somewhere in the live DOM traversal against a complex,
 * unpredictable real page) indistinguishable from "the extractor legitimately ran to completion
 * and found nothing" -- both silently became `evidence === undefined` with ZERO diagnostics
 * either way, and the eval'd function's own source string was independently confirmed
 * syntactically valid (`eval()`-able with no error). Fixed by capturing and logging the error's
 * own message (never DOM text/dataset values) so the two cases are never confused again, plus a
 * per-`associatedField` fingerprint dedupe so a poll loop calling this dozens of times never
 * floods the log with identical repeated lines.
 *
 * `resolverBehaviorChanged=false` is mandatory: this ticket adds observability only. Verified
 * here by confirming the actual resolution-outcome code (the `if (!evidence?.container) ...`/
 * materializer call/return statements) is byte-for-byte unchanged from before this ticket.
 */

const SOURCE_PATH = path.resolve(__dirname, "target-resolver.ts");
const source = fs.readFileSync(SOURCE_PATH, "utf8");

function fallbackFunctionSource(): string {
  const start = source.indexOf("async function tryFieldScopedStructuralFallback(");
  assert.ok(start >= 0, "expected tryFieldScopedStructuralFallback to be defined");
  // End at the NEXT top-level declaration after this function, so the slice contains ONLY
  // `tryFieldScopedStructuralFallback` -- not the unrelated helpers (`recordedOptionLikeCandidate`,
  // `resolveRecordedOptionAfterPreparatoryOwner`) that happen to sit before `resolveActionTarget`.
  const end = source.indexOf("\n/**\n * Reads the exact recorded option identity", start);
  assert.ok(end > start, "expected the function to end before the next top-level declaration");
  return source.slice(start, end);
}

test("1/noAnchor + 2/anchorNoContainer. diagnostics are logged whenever present, regardless of which failure stage produced them", () => {
  const fn = fallbackFunctionSource();
  assert.match(fn, /if \(shouldLog\)/);
  assert.match(fn, /else if \(d\) \{/);
});

test("3/success. the diagnostics log path runs unconditionally on `d` truthiness -- not gated behind a specific container/materializer outcome", () => {
  const fn = fallbackFunctionSource();
  const diagnosticBlockStart = fn.indexOf("if (shouldLog)");
  const scopeCheckStart = fn.indexOf("if (!evidence?.diagnostics.containerAccepted)");
  assert.ok(diagnosticBlockStart >= 0 && scopeCheckStart > diagnosticBlockStart, "diagnostics must be evaluated BEFORE the scope-accepted check, so success is logged too");
});

test("4/ambiguity. the diagnostic log for a genuinely-thrown evaluate error is distinct from a legitimate empty result", () => {
  const fn = fallbackFunctionSource();
  assert.match(fn, /result=evaluate_threw/);
  assert.match(fn, /errorMessage=\$\{JSON\.stringify\(evaluateError\)\}/);
});

test("5/bounded. identical consecutive diagnostics for the SAME associatedField are deduped via a fingerprint cache, never logged unconditionally on every call", () => {
  const fn = fallbackFunctionSource();
  assert.match(fn, /lastFieldScopeDiagnosticFingerprint\.get\(associatedField\) !== fingerprint/);
  assert.match(fn, /lastFieldScopeDiagnosticFingerprint\.set\(associatedField, fingerprint\)/);
});

test("6/secretSafe. no dataset value or arbitrary DOM text is ever interpolated into the diagnostic/error logs -- only counts, tags, booleans, and the error's own message", () => {
  const fn = fallbackFunctionSource();
  assert.doesNotMatch(fn, /\$\{.*\.value\}/);
  assert.doesNotMatch(fn, /\$\{.*textContent.*\}/i);
  assert.doesNotMatch(fn, /\$\{.*recordedValue.*\}/i);
});

test("7/behaviorUnchanged. the certification/materializer/reconfirmation logic itself is untouched -- only the SCOPE-vs-CERTIFICATION gate condition changed (a separate, later ticket's own fix)", () => {
  const fn = fallbackFunctionSource();
  assert.match(fn, /if \(!evidence\?\.diagnostics\.containerAccepted\) \{/);
  assert.match(fn, /console\.log\(`\[field-scoped-fallback\] status=field_container_not_resolved associatedField=\$\{JSON\.stringify\(associatedField\)\}`\);/);
  assert.match(fn, /return undefined;/);
  assert.match(fn, /materializeFieldScopedTechnicalTarget\(\{/);
  assert.match(fn, /resolveRecordedTechnicalTarget\(page, \[materialization\.target\], recordedMode, undefined\)/);
});

test("8/multiproject. no app/business hardcode was introduced by this observability fix", () => {
  const fn = fallbackFunctionSource();
  assert.doesNotMatch(fn, /portal-comercial/i);
  assert.doesNotMatch(fn, /solicitud multiproducto/i);
  assert.doesNotMatch(fn, /numero.de.identificacion/i);
});

test("evaluateError capture: the .catch() handler no longer silently discards the rejection reason", () => {
  const fn = fallbackFunctionSource();
  assert.match(fn, /\.catch\(\(err\) => \{/);
  assert.match(fn, /evaluateError = err instanceof Error \? err\.message : String\(err\);/);
  assert.doesNotMatch(fn, /\.catch\(\(\) => undefined\)/, "the old silent-discard catch handler must no longer exist");
});
