import assert from "node:assert/strict";
import test from "node:test";
import { deriveNativeAriaRole } from "./capture-engine-v2.native-owner-semantics";

/**
 * Physical evidence: a real recording's `[capture-v2] action ... ownerRole=unknown` for EVERY
 * captured edit/click proved the browser instrumentation only ever read an EXPLICIT `role`
 * attribute -- a real `<input>`/`<button>` almost never has one. `deriveNativeAriaRole` is the
 * fix: the same standard implicit-ARIA-role mapping the browser script now calls (via
 * `.toString()` interpolation, `DERIVE_NATIVE_ARIA_ROLE_SOURCE`), independently testable here.
 */

test("1. a native <input> with no explicit role -> \"textbox\" (the real-world shape: no role attribute at all)", () => {
  assert.equal(deriveNativeAriaRole({ tag: "input", type: "text" }), "textbox");
  assert.equal(deriveNativeAriaRole({ tag: "input" }), "textbox", "type defaults to text, same as the browser's own default");
  assert.equal(deriveNativeAriaRole({ tag: "input", type: "password" }), "textbox");
});

test("2. a native <button> with no explicit role -> \"button\" (the real-world shape)", () => {
  assert.equal(deriveNativeAriaRole({ tag: "button" }), "button");
});

test("input type=checkbox -> checkbox, type=radio -> radio", () => {
  assert.equal(deriveNativeAriaRole({ tag: "input", type: "checkbox" }), "checkbox");
  assert.equal(deriveNativeAriaRole({ tag: "input", type: "radio" }), "radio");
});

test("input type=submit/button/reset -> button (a native submit button has no role attribute either)", () => {
  assert.equal(deriveNativeAriaRole({ tag: "input", type: "submit" }), "button");
  assert.equal(deriveNativeAriaRole({ tag: "input", type: "button" }), "button");
  assert.equal(deriveNativeAriaRole({ tag: "input", type: "reset" }), "button");
});

test("select -> combobox by default, listbox when multiple or size>1", () => {
  assert.equal(deriveNativeAriaRole({ tag: "select" }), "combobox");
  assert.equal(deriveNativeAriaRole({ tag: "select", multiple: true }), "listbox");
  assert.equal(deriveNativeAriaRole({ tag: "select", size: 4 }), "listbox");
});

test("a[href] -> link; a bare <a> with no href has no native interactive role", () => {
  assert.equal(deriveNativeAriaRole({ tag: "a", hasHref: true }), "link");
  assert.equal(deriveNativeAriaRole({ tag: "a", hasHref: false }), undefined);
});

test("textarea -> textbox, option -> option, summary -> button", () => {
  assert.equal(deriveNativeAriaRole({ tag: "textarea" }), "textbox");
  assert.equal(deriveNativeAriaRole({ tag: "option" }), "option");
  assert.equal(deriveNativeAriaRole({ tag: "summary" }), "button");
});

test("input type=file/image has no genuine text/action-like native role invented for it", () => {
  assert.equal(deriveNativeAriaRole({ tag: "input", type: "file" }), undefined);
  assert.equal(deriveNativeAriaRole({ tag: "input", type: "image" }), undefined);
});

test("a generic container tag (div/span) never gets a role invented for it -- no semantics to derive from", () => {
  assert.equal(deriveNativeAriaRole({ tag: "div" }), undefined);
  assert.equal(deriveNativeAriaRole({ tag: "span" }), undefined);
});

test("no app-specific/positional logic: the function's decision depends only on tag/type/hasHref/multiple/size, nothing else", () => {
  assert.equal(deriveNativeAriaRole.length, 1);
});
