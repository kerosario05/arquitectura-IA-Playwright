import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * FIRST_LOSS (jobId 0ffc2349-d13a-4c6d-8e68-acaf80019c1d): once the container-scoped retry
 * (`target-resolver.container-scope-retry-wiring.test.ts`) ALSO failed to reconfirm at runtime --
 * because its container came from `findCertificationAncestor` climbing past the already-accepted
 * field scope to a broader, not-verifiably-unique ancestor -- `tryFieldScopedStructuralFallback`
 * gave up entirely, even though the exact accepted scope (`evidence.scopeContainer`, always
 * `fromAcceptedFieldScope: true`) had already proven exactly one compatible candidate within its
 * own bounded subtree. Fixed by retrying ONE more time with that scope's own identity, through the
 * SAME shared `materializeFieldScopedTechnicalTarget`/`resolveRecordedTechnicalTarget` pipeline --
 * never a second resolver, never skipped when the broader container already WAS the scope.
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

test("1/scopeRetryAttempted. a scopeContainer retry is attempted through the SAME materializeFieldScopedTechnicalTarget, requireContainerScope true", () => {
  const fn = fallbackFunctionSource();
  const scopeRetryIndex = fn.indexOf("const scopeContainer = evidence.scopeContainer;");
  assert.ok(scopeRetryIndex > 0, "expected the scope-authority retry to read evidence.scopeContainer");
  const after = fn.slice(scopeRetryIndex);
  assert.match(after, /materializeFieldScopedTechnicalTarget\(\s*\{ associatedField, candidates: evidence\.candidates, requiredCompatibility, fieldContainerEvidence: scopeContainer \},\s*\{ requireContainerScope: true \},\s*\)/);
});

test("2/skippedWhenRedundant. the scope retry is never attempted when the container already IS the accepted scope (fromAcceptedFieldScope already true) -- never a duplicate attempt", () => {
  const fn = fallbackFunctionSource();
  assert.match(fn, /if \(scopeContainer && !evidence\.container\?\.fromAcceptedFieldScope\) \{/);
});

test("3/reconfirmedBeforeReturn. the scope-authority retry result is itself reconfirmed at runtime, RELATIVE to the accepted container, before ever being returned -- never trusted blindly, never re-flattened into a page-global count", () => {
  const fn = fallbackFunctionSource();
  const scopeRetryIndex = fn.indexOf("const scopeScoped = materializeFieldScopedTechnicalTarget");
  assert.ok(scopeRetryIndex > 0);
  const after = fn.slice(scopeRetryIndex);
  // The container itself must be re-resolved to a live Locator and proven unique (count === 1)
  // before it is trusted as the search root -- an unverifiable/ambiguous container never falls
  // back to a page-wide search.
  assert.match(after, /const containerRoot = scopeContainerLocatorDef\s*\?\s*recordedLocatorFactory\(page, scopeContainerLocatorDef, false\)\s*:\s*undefined;/);
  assert.match(after, /const containerCount = containerRoot \? await containerRoot\.count\(\)\.catch\(\(\) => 0\) : 0;/);
  // The descendant is still resolved through the SAME shared resolveRecordedTechnicalTarget
  // pipeline, only now scoped to containerRoot instead of the page -- reconfirmed at runtime,
  // never trusted blindly, and only when the container itself proved unique.
  assert.match(
    after,
    /const reconfirmedScope = containerRoot && containerCount === 1 && containerEligible && scopedDescendantLocatorDef\s*\?\s*await resolveRecordedTechnicalTarget\(\s*page,\s*\[\{ \.\.\.scopeScoped\.target, locatorCandidates: \[scopedDescendantLocatorDef\] \}\],\s*recordedMode,\s*undefined,\s*undefined,[\s\S]*?scopeScoped\.selfOwner \? undefined : containerRoot,\s*\)\s*:\s*undefined;/,
  );
});

test("4/failsClosedWhenScopeRetryAlsoFails. no fabricated wider locator -- the function still returns undefined and logs certified_target_runtime_ambiguous when every retry fails", () => {
  const fn = fallbackFunctionSource();
  const scopeRetryIndex = fn.indexOf("const scopeContainer = evidence.scopeContainer;");
  const ambiguousLogIndex = fn.indexOf("status=certified_target_runtime_ambiguous");
  assert.ok(scopeRetryIndex > 0 && ambiguousLogIndex > scopeRetryIndex, "the fail-closed log must come after the scope retry was attempted, not before");
  assert.match(fn.slice(ambiguousLogIndex, ambiguousLogIndex + 240), /return failClosed\(\);/);
});

test("5/sharedCoreOnly. no second/parallel resolver introduced for the scope retry -- same materializeFieldScopedTechnicalTarget/resolveRecordedTechnicalTarget, no new pipeline", () => {
  const fn = fallbackFunctionSource();
  const materializerCalls = fn.match(/materializeFieldScopedTechnicalTarget\(/g) ?? [];
  const resolveCalls = fn.match(/resolveRecordedTechnicalTarget\(/g) ?? [];
  assert.equal(materializerCalls.length, 3);
  assert.equal(resolveCalls.length, 3);
  assert.doesNotMatch(fn, /click-field-resolver-v2|associated-button-resolver|scope-resolver-v2/i);
});

test("6/noPosition + 7/noSleep. no positional selector or sleep introduced by this fix", () => {
  const fn = fallbackFunctionSource();
  const scopeRetryIndex = fn.indexOf("const scopeContainer = evidence.scopeContainer;");
  const scopeBlock = fn.slice(scopeRetryIndex);
  assert.doesNotMatch(scopeBlock, /\.nth\(/);
  assert.doesNotMatch(scopeBlock, /\.first\(\)/);
  assert.doesNotMatch(scopeBlock, /\.last\(\)/);
  assert.doesNotMatch(scopeBlock, /waitForTimeout/);
});

test("8/multiproject. no app/business hardcode in the scope retry logic", () => {
  const fn = fallbackFunctionSource();
  const scopeRetryIndex = fn.indexOf("const scopeContainer = evidence.scopeContainer;");
  const scopeBlock = fn.slice(scopeRetryIndex);
  assert.doesNotMatch(scopeBlock, /portal-comercial/i);
  assert.doesNotMatch(scopeBlock, /categoria.de.producto/i);
});
