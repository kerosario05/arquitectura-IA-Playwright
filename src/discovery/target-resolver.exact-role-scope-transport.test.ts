import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * FIRST_LOSS (jobId 64b4bb67-a2eb-42be-8231-3316b9feaaa7, step=7 target="4"): an exact recorded:role
 * resolution (matchCount=1) short-circuited `resolveActionTarget`'s non-not_found branch WITHOUT
 * producing the accepted field-scope marker, so the click boundary's diagnostic related observer
 * reported `relatedAuthority=insufficient` (`observerScope=owner`) while the field-scoped path
 * (action 4) reported `owner+accepted_field_scope`. The fix certifies the related scope
 * DIAGNOSTIC-ONLY within the same resolution pass, reusing the existing field-scope infrastructure,
 * and attaches `acceptedScopeRuntimeMarker` WITHOUT changing the execution locator/status/strategy.
 */

const source = fs.readFileSync(path.resolve(__dirname, "target-resolver.ts"), "utf8");

function resolveActionTargetBody(): string {
  const start = source.indexOf("export async function resolveActionTarget(");
  const next = source.indexOf("async function trySemanticFallback(", start);
  return source.slice(start, next);
}

const body = resolveActionTargetBody();

function nonNotFoundBranch(): string {
  const start = body.indexOf('if (result.status !== "not_found") {');
  const end = body.indexOf("\n  const opts = options ?? {};", start);
  return body.slice(start, end);
}

test("1/exactRoleWithCertifiedScope. the exact-resolution branch reuses the field-scope infra and transports the marker", () => {
  const branch = nonNotFoundBranch();
  assert.match(branch, /tryFieldScopedStructuralFallback\(page, opts\.associatedField, requiredCompatibility, "action"\)/);
  assert.match(branch, /return \{ \.\.\.result, acceptedScopeRuntimeMarker: diagnosticScope\.acceptedScopeRuntimeMarker \};/);
});

test("2/executionAuthorityUnchanged. the related scope only adds the marker; locator/status/strategy stay the exact recorded result", () => {
  const branch = nonNotFoundBranch();
  assert.match(branch, /return \{ \.\.\.result, acceptedScopeRuntimeMarker:/);
  assert.doesNotMatch(branch, /locatorStrategy:/);
  assert.doesNotMatch(branch, /status:\s*"resolved"/);
  assert.doesNotMatch(branch, /locator:\s*fallback\.locator/);
});

test("3/exactRoleWithoutScope. no certified scope -> returns the result unchanged (fail closed diagnostically)", () => {
  const branch = nonNotFoundBranch();
  assert.match(branch, /if \(diagnosticScope\?\.acceptedScopeRuntimeMarker\)/);
  assert.match(branch, /return result;/);
});

test("4/samePass. the field-scope certification is invoked within resolveActionTarget, never as a downstream second resolver", () => {
  assert.ok(body.indexOf("tryFieldScopedStructuralFallback(page, opts.associatedField") >= 0);
  assert.doesNotMatch(body, /resolveActionTarget\(page, snapshot, target/);
});

test("5/noBroadSearch. the diagnostic certification never does a body/document text lookup", () => {
  assert.doesNotMatch(body, /document\.body|querySelectorAll\(|getElementsByTagName/);
});

test("6/completionUnchanged. resolveActionTarget does not read or set any completion signal", () => {
  assert.doesNotMatch(body, /resolvePostActionSynchronization|completionProbeSatisfied|structuredStateMutation/);
});

test("7/associatedFieldGuard. no structural associatedField -> no extra certification work", () => {
  assert.match(body, /if \(opts\.associatedField\?\.trim\(\)\) \{/);
});

test("8/markerSurvivesToClickBoundary. the marker is part of the returned resolution (read by case-discovery)", () => {
  assert.match(body, /acceptedScopeRuntimeMarker/);
});
