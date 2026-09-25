import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = fs.readFileSync(path.join(process.cwd(), "src", "discovery", "target-resolver.ts"), "utf8");
const start = source.indexOf("async function resolveRecordedTechnicalTarget(");
const end = source.indexOf("\n/**\n * PUBLIC", start);
const resolver = source.slice(start, end);

test("unique locator-less structural owners are attempted before locator candidates and field-scoped recovery", () => {
  const structuralOnlyAttempt = resolver.indexOf("for (const technicalTarget of persistedTargets)");
  const locatorAttempt = resolver.indexOf("for (const [candidateIndex, { candidate, technicalTarget, exact, origin }] of candidatesByAuthority.entries())");
  assert.ok(structuralOnlyAttempt >= 0);
  assert.ok(locatorAttempt > structuralOnlyAttempt);
  assert.match(resolver.slice(structuralOnlyAttempt, locatorAttempt), /locatorCandidates \?\? \[\]\)\.length !== 0/);
  assert.match(resolver.slice(structuralOnlyAttempt, locatorAttempt), /v2_framework_actionable_owner/);
  assert.match(resolver.slice(structuralOnlyAttempt, locatorAttempt), /resolveRecordedStructuralOwner\(page, technicalTarget\)/);
  assert.doesNotMatch(resolver.slice(structuralOnlyAttempt, locatorAttempt), /getByText|\.first\(|\.nth\(/);
});

test("the structural-owner branch remains fail-closed and does not turn semantic descendants into locators", () => {
  const structuralStart = source.indexOf("export async function resolveRecordedStructuralOwner(");
  const structuralEnd = source.indexOf("\n/**\n * PRESS compatibility", structuralStart);
  const structuralResolver = source.slice(structuralStart, structuralEnd);
  assert.match(structuralResolver, /deterministicStructuralIdentity !== true/);
  assert.match(structuralResolver, /count !== 1/);
  assert.doesNotMatch(structuralResolver, /getByText|\.first\(|\.nth\(/);
});

test("topology-tiebroken structural owners may use a non-empty semantic shape without fabricating a locator", () => {
  const structuralStart = source.indexOf("export async function resolveRecordedStructuralOwner(");
  const structuralEnd = source.indexOf("\n/**\n * PRESS compatibility", structuralStart);
  const structuralResolver = source.slice(structuralStart, structuralEnd);
  assert.match(structuralResolver, /topologyTieBreakUnique === true/);
  assert.match(structuralResolver, /structuralIdentityMatchCount === 1/);
  assert.match(structuralResolver, /semanticShape\?\.length \?\? 0\) > 0/);
  assert.match(structuralResolver, /semantic_shape_mismatch/);
  assert.doesNotMatch(structuralResolver, /getByText|\.first\(|\.nth\(/);
});

test("locator-less topology authority reaches the shared structural resolver even without framework provenance", () => {
  const structuralStart = source.indexOf("if (!scopeRoot) {");
  const structuralEnd = source.indexOf("\n  for (const [candidateIndex", structuralStart);
  const branch = source.slice(structuralStart, structuralEnd);
  assert.match(branch, /topologyTieBreakUnique === true/);
  assert.match(branch, /deterministicStructuralIdentity === true/);
  assert.match(branch, /structuralIdentityMatchCount === 1/);
  assert.match(branch, /resolveRecordedStructuralOwner\(page, technicalTarget\)/);
});
