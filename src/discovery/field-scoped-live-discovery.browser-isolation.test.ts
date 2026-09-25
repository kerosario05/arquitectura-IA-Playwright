import assert from "node:assert/strict";
import vm from "node:vm";
import test from "node:test";
import { FIELD_SCOPED_DOM_EVIDENCE_SOURCE, extractFieldScopedDomEvidence } from "./field-scoped-live-discovery";

/**
 * FIRST_LOSS (real physical evidence, recording 52849d4b-bfa5-4842-850a-a43e6460dcaf):
 * `[field-scope-diagnostic] ... result=evaluate_threw errorMessage="page.evaluate:
 * ReferenceError: __name is not defined ... at extractFieldScopedDomEvidence ..."`. The extractor
 * never ran inside the browser AT ALL -- `field_container_not_resolved` was actually a silently
 * swallowed thrown exception (the previous ticket's own fix already surfaced that it was throwing;
 * this ticket finds and fixes WHY it throws).
 *
 * `FIELD_SCOPED_DOM_EVIDENCE_SOURCE = "(" + extractFieldScopedDomEvidence.toString() + ")"`
 * captures only the function's own literal text -- never the surrounding MODULE scope. This
 * project's TypeScript/esbuild toolchain (tsx) rewrites every named inner function/arrow
 * declaration into a call to a `__name(fn, "fnName")` helper (pure `.name`-preservation
 * metadata, functionally inert). Those calls live INSIDE the function body, so `.toString()`
 * faithfully includes them -- but the helper itself is defined once in the surrounding module
 * scope the toolchain generates, which a bare `.toString()` snippet never carries with it.
 * Evaluating the raw snippet directly inside THIS SAME Node/tsx process can still happen to
 * succeed (the toolchain's own helper remains reachable there) -- which is exactly why a naive
 * `eval(FIELD_SCOPED_DOM_EVIDENCE_SOURCE)` unit test would give a false green. A REAL browser
 * page (or any environment that never ran this module's own compiled scope) has no such helper
 * at all, so the exact same snippet throws `ReferenceError: __name is not defined` immediately.
 *
 * Fixed by wrapping the injected source in its own IIFE that first defines `__name` as a
 * trivial, LOCAL (never `window`/`globalThis`) identity pass-through before returning the
 * extractor function -- genuinely self-contained, no implicit dependency on anything the
 * toolchain would otherwise need to supply, no per-app/per-field special-casing.
 *
 * These tests reproduce the failure in a Node `vm.createContext({})` -- a fresh, blank V8
 * context with NO closure over this file's own module scope and no `__name` (or any other
 * bundler helper) reachable by any path -- structurally the same isolation boundary a real
 * browser page provides, and explicitly verified empty before each run. The OLD source
 * (reconstructed here exactly as it was: a bare `.toString()`, no wrapper) is proven to throw
 * `ReferenceError: __name is not defined` in this harness; the CURRENT source is proven to run
 * successfully in the exact same harness.
 */

type FakeElement = {
  tagName: string;
  id: string;
  textContent: string | null;
  children: FakeElement[];
  parentElement: FakeElement | null;
};

const DOM_SETUP_SCRIPT = `
function makeEl(tagName, attrs, text) {
  attrs = attrs || {};
  return {
    tagName: tagName,
    id: attrs.id || "",
    textContent: text === undefined ? null : text,
    children: [],
    parentElement: null,
    getAttribute: function(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
    getAttributeNames: function() { return Object.keys(attrs); },
  };
}
function append(parent, child) { child.parentElement = parent; parent.children.push(child); return parent; }
`;

/** A blank V8 context: no closure over this module, no Node globals, no bundler helpers --
 *  structurally equivalent to a fresh browser page for the purpose of this bug. */
function isolatedContext(): vm.Context {
  const context = vm.createContext({});
  vm.runInContext(DOM_SETUP_SCRIPT, context);
  return context;
}

function buildRootWithFieldFixture(context: vm.Context, field: string): void {
  vm.runInContext(
    `var span = makeEl("span", {}, ${JSON.stringify(field)});
     var input = makeEl("input", {});
     var wrapper = makeEl("div", { id: "vm-wrapper" });
     append(wrapper, span); append(wrapper, input);
     var root = { body: wrapper, getElementById: function() { return null; } };`,
    context,
  );
}

/** The OLD, pre-fix source shape: a bare parenthesized `.toString()`, no IIFE wrapper. */
function legacyUnwrappedSource(): string {
  return `(${extractFieldScopedDomEvidence.toString()})`;
}

test("1/isolatedBrowserOrEquivalent + oldCodeWouldFailWithNameReference. the OLD unwrapped source throws ReferenceError: __name is not defined in a context with no closure over this module", () => {
  const context = isolatedContext();
  const hasNameBefore = vm.runInContext("typeof __name", context);
  assert.equal(hasNameBefore, "undefined", "the isolated context must genuinely have no __name reachable, matching a real browser page");
  buildRootWithFieldFixture(context, "Campo Aislado");
  assert.throws(
    () => vm.runInContext(`${legacyUnwrappedSource()}(root, "Campo Aislado")`, context),
    /ReferenceError: __name is not defined/,
    "the OLD source shape must reproduce the exact physical failure",
  );
});

test("2/browserSourceSelfContained. the CURRENT source runs successfully in the exact same isolated context, with no __name reachable beforehand", () => {
  const context = isolatedContext();
  assert.equal(vm.runInContext("typeof __name", context), "undefined");
  buildRootWithFieldFixture(context, "Campo Aislado");
  const result = vm.runInContext(`${FIELD_SCOPED_DOM_EVIDENCE_SOURCE}(root, "Campo Aislado")`, context);
  assert.ok(result, "expected the extractor to run and return a result, not throw");
  assert.equal(result.container?.stableDirectAttributes?.id, "vm-wrapper");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].tag, "input");
});

test("3/globalHelperInjected=false. the fix never leaks __name (or anything else) onto the context's own global object", () => {
  const context = isolatedContext();
  buildRootWithFieldFixture(context, "Campo Aislado");
  vm.runInContext(`${FIELD_SCOPED_DOM_EVIDENCE_SOURCE}(root, "Campo Aislado")`, context);
  assert.equal(vm.runInContext("typeof __name", context), "undefined", "the shim must stay local to the IIFE, never pollute the surrounding global scope");
  assert.equal(vm.runInContext("typeof window", context), "undefined", "no window global was ever referenced or created");
});

test("4/diagnosticsForNoAnchor. no-anchor case still returns diagnostics correctly inside the isolated context", () => {
  const context = isolatedContext();
  vm.runInContext(
    `var wrapper = makeEl("div", { id: "vm-wrapper" });
     var root = { body: wrapper, getElementById: function() { return null; } };`,
    context,
  );
  const result = vm.runInContext(`${FIELD_SCOPED_DOM_EVIDENCE_SOURCE}(root, "Campo Inexistente")`, context);
  assert.equal(result.container, undefined);
  assert.equal(result.diagnostics.anchorFound, false);
  assert.equal(result.diagnostics.containerAccepted, false);
  assert.equal(result.diagnostics.rejectReason, "no_anchor_found");
});

test("5/diagnosticsForAnchorNoContainer. anchor-found-but-climb-exhausted case still returns diagnostics correctly inside the isolated context", () => {
  const context = isolatedContext();
  vm.runInContext(
    `var span = makeEl("span", {}, "Campo Sin Contenedor");
     var wrapper = makeEl("div", {}); // no id/name/data-* anywhere -- the climb must exhaust
     append(wrapper, span);
     var root = { body: wrapper, getElementById: function() { return null; } };`,
    context,
  );
  const result = vm.runInContext(`${FIELD_SCOPED_DOM_EVIDENCE_SOURCE}(root, "Campo Sin Contenedor")`, context);
  assert.equal(result.container, undefined);
  assert.equal(result.diagnostics.anchorFound, true);
  assert.equal(result.diagnostics.rejectReason, "climb_exhausted");
});

test("6/noUnexpectedExternalDependency. the wrapped source references nothing beyond standard JS built-ins available in any context", () => {
  const context = vm.createContext({}); // no DOM setup at all -- proves no accidental dependency on the test harness's own helpers
  let thrown: unknown;
  try {
    vm.runInContext(`${FIELD_SCOPED_DOM_EVIDENCE_SOURCE}(null, "x")`, context);
  } catch (err) {
    thrown = err;
  }
  // A vm-context error belongs to that context's OWN realm (its own Error/TypeError
  // constructors) -- `instanceof Error` against the outer realm's Error would always be false,
  // so this checks the shape (a `message` string) instead, cross-realm-safe.
  const message = thrown && typeof (thrown as { message?: unknown }).message === "string" ? (thrown as { message: string }).message : undefined;
  assert.ok(message, "expected a real error from calling the extractor with a null root");
  assert.ok(
    !message!.includes("__name") && !message!.includes("is not defined"),
    `the only failure with a genuinely absent root must be about using root.body, never a missing external helper -- got: ${message}`,
  );
});

test("7/evaluateThrewLoggingStillAvailable. a genuinely different real error is still distinguishable -- this fix does not swallow future exceptions", () => {
  const context = isolatedContext();
  // A root whose body is null reproduces a DIFFERENT real error shape (not __name-related),
  // proving the fix didn't accidentally suppress or convert other exception types.
  vm.runInContext(`var root = { body: null, getElementById: function() { return null; } };`, context);
  assert.throws(
    () => vm.runInContext(`${FIELD_SCOPED_DOM_EVIDENCE_SOURCE}(root, "Campo")`, context),
    /Cannot read propert(y|ies) of null/,
  );
});

test("8/resolverBehaviorUnchanged. the extractor's own resolution semantics (success shape, candidate fields) are identical to the pre-fix behavior for the same fixture", () => {
  const context = isolatedContext();
  buildRootWithFieldFixture(context, "Campo Aislado");
  const wrapped = vm.runInContext(`${FIELD_SCOPED_DOM_EVIDENCE_SOURCE}(root, "Campo Aislado")`, context);
  function withAttrs(el: FakeElement, attrs: Record<string, string>) {
    return Object.assign(el, {
      getAttribute: (name: string) => (Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null),
      getAttributeNames: () => Object.keys(attrs),
    });
  }
  const span = withAttrs({ tagName: "span", id: "", textContent: "Campo Aislado", children: [], parentElement: null }, {});
  const input = withAttrs({ tagName: "input", id: "", textContent: null, children: [], parentElement: null }, {});
  const wrapper = withAttrs({ tagName: "div", id: "vm-wrapper", textContent: null, children: [span, input], parentElement: null }, { id: "vm-wrapper" });
  span.parentElement = wrapper;
  input.parentElement = wrapper;
  const direct = extractFieldScopedDomEvidence(
    // Re-run the SAME logical fixture directly (in-process, unwrapped) to confirm the IIFE
    // wrapper changes nothing about the actual resolution outcome.
    { body: wrapper as any, getElementById: () => null },
    "Campo Aislado",
  );
  assert.equal(wrapped.container?.stableDirectAttributes?.id, direct?.container?.stableDirectAttributes?.id);
  assert.equal(wrapped.candidates.length, direct?.candidates.length);
  assert.equal(wrapped.candidates[0]?.tag, direct?.candidates[0]?.tag);
});
