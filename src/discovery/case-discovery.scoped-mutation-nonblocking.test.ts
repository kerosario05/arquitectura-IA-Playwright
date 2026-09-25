import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { transformSync } from "esbuild";

const source = fs.readFileSync(path.resolve(__dirname, "case-discovery.ts"), "utf8");

test("scoped mutation diagnostics do not evaluate a locator without pre-click authority", () => {
  const start = source.indexOf("const scopedDiagnosticStart");
  const block = source.slice(start, start + 900);
  assert.match(block, /scopedMutationObserverInstalled\s*\?/);
  assert.match(block, /authority:\s*"insufficient"/);
});

test("completion probe remains the only completion authority", () => {
  const start = source.indexOf("const scopedDiagnosticStart");
  const block = source.slice(start, start + 1400);
  assert.doesNotMatch(block, /completed\s*:\s*true/);
  assert.doesNotMatch(block, /domTransition|nextTargetSignal/);
});

test("scoped mutation browser callback is self-contained after tsx/esbuild naming transform", () => {
  const callbackStart = source.indexOf("return locator.evaluate((element, marker) => {");
  const callbackEnd = source.indexOf("  }).then(() => ({ installed: true", callbackStart);
  assert.ok(callbackStart >= 0 && callbackEnd > callbackStart, "expected the scoped mutation browser callback");
  const callbackSource = source.slice(callbackStart + "return locator.evaluate(".length, callbackEnd + 3);
  const compiled = transformSync(`(${callbackSource});`, {
    loader: "ts",
    format: "cjs",
    target: "es2022",
    keepNames: true,
  }).code;

  assert.doesNotMatch(compiled, /__name\(/, "a serialized browser callback cannot depend on esbuild's module-scoped __name helper");
  assert.match(callbackSource, /const browserFns:\s*\[/);
  assert.match(callbackSource, /new MutationObserver\(browserFns\[2\]\.bind\(null, counts\)\)/);
});

test("post-click scoped read uses page state instead of re-resolving the pre-click locator", () => {
  const start = source.indexOf("async function readScopedMutationDiagnostic");
  const block = source.slice(start, start + 1100);
  assert.match(block, /page\.evaluate\(/);
  assert.doesNotMatch(block, /locator\.evaluate\(/);
  assert.match(block, /state\.target/);
});

test("accepted field-scope marker is observed only as a diagnostic related surface", () => {
  const start = source.indexOf("async function beginScopedMutationDiagnostic");
  const block = source.slice(start, source.indexOf("async function readScopedMutationDiagnostic", start));
  assert.match(block, /data-codex-accepted-field-scope/);
  assert.match(block, /relatedObserver/);
  assert.match(block, /authority:\s*"accepted_field_scope"/);
  assert.match(block, /relatedPropertyMutations|related:/);
});

test("accepted field-scope marker is passed explicitly when the scope is not an owner ancestor", () => {
  const start = source.indexOf("async function beginScopedMutationDiagnostic");
  const block = source.slice(start, source.indexOf("async function readScopedMutationDiagnostic", start));
  assert.match(block, /acceptedScopeRuntimeMarker\?: string/);
  assert.match(block, /locator\.evaluate\(\(element, marker\)/);
  assert.match(block, /querySelectorAll\('\[data-codex-accepted-field-scope\]'\)/);
  assert.match(block, /getAttribute\('data-codex-accepted-field-scope'\) === marker/);
  assert.match(source, /beginScopedMutationDiagnostic\(finalLocator, acceptedScopeRuntimeMarkerForClick\)/);
});
