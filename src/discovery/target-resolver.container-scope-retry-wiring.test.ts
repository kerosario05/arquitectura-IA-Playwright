import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * FIRST_LOSS (jobId 2949de20-78b9-4ab8-a20c-c9396d4e00dc): `tryFieldScopedStructuralFallback`
 * gave up entirely as soon as a Tier-1 (own-evidence) certified target failed runtime
 * revalidation (`certified_target_runtime_ambiguous`), discarding the same field-scope evidence
 * that could produce a genuinely container-scoped Tier-3 locator instead. Fixed by retrying with
 * `materializeFieldScopedTechnicalTarget(..., { requireContainerScope: true })` before failing
 * closed. See `technical-target-materializer.container-scope-retry.test.ts` for the executable
 * proof of the materializer option itself; this file only proves the wiring, matching this
 * ~6000-line resolver's established "no browser" static-source convention (see
 * `target-resolver.click-field-scoped-fallback-gate.test.ts`).
 */

const SOURCE_PATH = path.resolve(__dirname, "target-resolver.ts");
const source = fs.readFileSync(SOURCE_PATH, "utf8");

function fallbackFunctionSource(): string {
  const start = source.indexOf("async function tryFieldScopedStructuralFallback(");
  assert.ok(start >= 0, "expected tryFieldScopedStructuralFallback to be defined");
  const end = source.indexOf("\n/**\n * Public entry point.", start);
  assert.ok(end > start, "expected the function to end before resolveActionTarget's doc comment");
  return source.slice(start, end);
}

test("1/retryOnAmbiguousTier1. a runtime-ambiguous Tier-1 result triggers a container-scoped retry, gated on tier and container availability", () => {
  const fn = fallbackFunctionSource();
  assert.match(fn, /if \(materialization\.target\.certificationTier === 1 && containerAvailable\) \{/);
  assert.match(fn, /requireContainerScope: true/);
});

test("2/reconfirmedBeforeReturn. the container-scoped retry is itself reconfirmed at runtime before ever being returned -- never trusted blindly", () => {
  const fn = fallbackFunctionSource();
  const retryStart = fn.indexOf("requireContainerScope: true");
  const afterRetry = fn.slice(retryStart);
  assert.match(afterRetry, /const reconfirmedScoped = await resolveRecordedTechnicalTarget\(page, \[containerScoped\.target\], recordedMode, undefined\);/);
});

test("3/noFabricationOnFailure. when the retry also fails (or no container exists), the function still fails closed -- never fabricates a wider locator", () => {
  const fn = fallbackFunctionSource();
  assert.match(fn, /status=certified_target_runtime_ambiguous tier=\$\{materialization\.target\.certificationTier\}/);
  const ambiguousLogIndex = fn.indexOf("status=certified_target_runtime_ambiguous");
  assert.ok(ambiguousLogIndex > 0);
  assert.match(fn.slice(ambiguousLogIndex, ambiguousLogIndex + 240), /return failClosed\(\);/);
});

test("4/successPathUntouched. the original success path (Tier-1 or any tier reconfirmed on the FIRST attempt) is completely unchanged by this fix", () => {
  const fn = fallbackFunctionSource();
  assert.match(fn, /const reconfirmed = await resolveRecordedTechnicalTarget\(page, \[materialization\.target\], recordedMode, undefined\);\s*\n\s*if \(!reconfirmed\) \{/);
});

test("5/sharedCoreReused. no second/parallel resolver introduced -- same materializeFieldScopedTechnicalTarget and resolveRecordedTechnicalTarget reused for every retry, including the accepted-scope-authority retry", () => {
  const fn = fallbackFunctionSource();
  const materializerCalls = fn.match(/materializeFieldScopedTechnicalTarget\(/g) ?? [];
  assert.equal(materializerCalls.length, 3, "expected the original call, the container-scoped retry, and the accepted-scope fallback retry -- all through the SAME shared function, no third pipeline");
  assert.doesNotMatch(fn, /click-field-resolver-v2|associated-button-resolver/i);
});

test("6/noPosition + 7/noSleep. no positional selector or sleep introduced by this fix", () => {
  const fn = fallbackFunctionSource();
  assert.doesNotMatch(fn, /\.nth\(/);
  assert.doesNotMatch(fn, /\.first\(\)/);
  assert.doesNotMatch(fn, /\.last\(\)/);
  assert.doesNotMatch(fn, /waitForTimeout/);
});

test("8/multiproject. no app/business hardcode in the retry logic", () => {
  const fn = fallbackFunctionSource();
  assert.doesNotMatch(fn, /portal-comercial/i);
  assert.doesNotMatch(fn, /numero.de.identificacion/i);
});

test("9/acceptedScopeClicksContainerNotDescendant. once the accepted-scope retry certifies via its scoped descendant, the RETURNED click target is the container root (non-self-owner), never the descendant used only to prove uniqueness -- the exact wrong-owner regression from job 7af1bdaf", () => {
  const fn = fallbackFunctionSource();
  const certifiedIndex = fn.indexOf("acceptedScopeActuallyUsed=true`);", fn.indexOf("recoveredFromAmbiguousTier1=true acceptedScopeActuallyUsed=true"));
  assert.ok(certifiedIndex > 0, "expected the acceptedScopeActuallyUsed certified log line");
  const afterCertified = fn.slice(certifiedIndex, certifiedIndex + 1300);
  assert.match(
    afterCertified,
    /const clickTarget = scopeScoped\.selfOwner \? reconfirmedScope\.locator : \(containerRoot \?\? reconfirmedScope\.locator\);/,
    "self-owner scopes click their own resolved node; non-self-owner scopes must click the proven-unique container, not the scoped descendant",
  );
  assert.match(
    afterCertified,
    /return withMarker\(\{ \.\.\.reconfirmedScope, locator: clickTarget, certifiedTechnicalTarget: scopeScoped\.target \}\);/,
    "the returned locator must be clickTarget, never reconfirmedScope.locator directly",
  );
});
