import assert from "node:assert/strict";
import test from "node:test";
import { extractFieldScopedDomEvidence, type FieldScopedDomElement, type FieldScopedDomRoot } from "./field-scoped-live-discovery";

/**
 * FIRST_LOSS (real physical shape, recordingId 52849d4b-bfa5-4842-850a-a43e6460dcaf, execution
 * e134f548-e2e8-4fc6-9222-352a933bb960): `extractFieldScopedDomEvidence` only ever recognized a
 * field's visible name via `<label>`/`<legend>` text or `aria-labelledby` -- never a plain text
 * node (`<span>`/`<div>`/`<p>`, no `for`/`aria-labelledby` at all). The real page's field name
 * ("Número de identificación") rendered as a bare `<span>` immediately followed by its actual
 * editable input (`class="p-inputmask p-inputtext p-component"`, visible, no `disabled`
 * attribute) as a sibling inside one shared wrapper carrying its own stable `id` -- NEITHER
 * `<label>` NOR `aria-labelledby` existed anywhere in that DOM. The extractor therefore found no
 * container at all, `tryFieldScopedStructuralFallback` returned `undefined`, and the generic
 * resolver's own span-text match (correctly rejected as non-editable) was the only thing left --
 * 33 polls, ~15s, always the same `<span>` "Número de identificación", the real input never once
 * considered.
 *
 * Fixed by adding a third, generic anchor mechanism, tried only after `<label>`/`<legend>` and
 * `aria-labelledby` both find nothing: any LEAF element (no children -- so a wrapper whose
 * aggregate text merely happens to equal the target because its only text-bearing descendant IS
 * the real label leaf is never mistaken for the anchor itself) that is not itself an owner
 * candidate and whose own text matches the target exactly (the SAME normalized-text comparison
 * already used for `<label>`/`<legend>`) anchors the SAME existing container-climb. Never a new
 * resolver, never app/CSS-specific, never positional.
 */

class FakeElement implements FieldScopedDomElement {
  tagName: string;
  id: string;
  textContent: string | null;
  children: FieldScopedDomElement[] = [];
  parentElement: FieldScopedDomElement | null = null;
  disabled?: boolean;
  hidden?: boolean;
  private attrs: Record<string, string>;

  constructor(tagName: string, attrs: Record<string, string> = {}, text: string | null = null) {
    this.tagName = tagName;
    this.attrs = attrs;
    this.id = attrs.id ?? "";
    this.textContent = text;
  }

  getAttribute(name: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }

  getAttributeNames(): string[] {
    return Object.keys(this.attrs);
  }

  append(...children: FakeElement[]): this {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
    return this;
  }
}

function fakeRoot(body: FakeElement): FieldScopedDomRoot {
  function findById(node: FieldScopedDomElement, id: string): FieldScopedDomElement | null {
    if (node.id === id) return node;
    for (let i = 0; i < node.children.length; i++) {
      const found = findById(node.children[i], id);
      if (found) return found;
    }
    return null;
  }
  return {
    body,
    getElementById: (id: string) => findById(body, id),
  };
}

/** The exact shape confirmed against the real physical page's step-5 snapshot. */
function realShapeFieldWrapper() {
  const span = new FakeElement("span", {}, "Número de identificación");
  const input = new FakeElement("input", { class: "p-inputmask p-inputtext p-component" });
  const wrapper = new FakeElement("div", { id: "pv_id_20" }).append(span, input);
  return { span, input, wrapper };
}

test("1/realShapeTextAnchor. a bare <span> label with no for/aria-labelledby, sibling input inside an id-bearing wrapper: resolves", () => {
  const { wrapper } = realShapeFieldWrapper();
  const evidence = extractFieldScopedDomEvidence(fakeRoot(wrapper), "Número de identificación");
  assert.ok(evidence, "expected the generic text-anchor mechanism to find a container");
  assert.equal(evidence!.container!.stableDirectAttributes?.id, "pv_id_20");
  assert.equal(evidence!.candidates.length, 1);
  assert.equal(evidence!.candidates[0].tag, "input");
  assert.equal(evidence!.candidates[0].editable, true);
});

test("2/disabledRelation. the same shape but the input is currently disabled: relation still found, candidate reported disabled -- never discarded", () => {
  const span = new FakeElement("span", {}, "Número de identificación");
  const input = new FakeElement("input", {});
  input.disabled = true;
  const wrapper = new FakeElement("div", { id: "pv_id_20" }).append(span, input);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(wrapper), "Número de identificación");
  assert.ok(evidence, "the field relation must be found even while the control is disabled");
  assert.equal(evidence!.candidates.length, 1);
  assert.equal(evidence!.candidates[0].disabled, true, "reported disabled, never silently dropped");
});

test("3/inputPlusButton. a text-anchor field with both an input and an icon button: both observed, resolver later distinguishes by role", () => {
  const span = new FakeElement("span", {}, "Número de identificación");
  const input = new FakeElement("input", {});
  const button = new FakeElement("button", {});
  const wrapper = new FakeElement("div", { id: "field-doc" }).append(span, input, button);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(wrapper), "Número de identificación");
  assert.ok(evidence);
  assert.equal(evidence!.candidates.length, 2);
  assert.ok(evidence!.candidates.some((c) => c.tag === "input" && c.editable));
  assert.ok(evidence!.candidates.some((c) => c.tag === "button" && c.actionable));
});

test("4/wrapperAggregateTextIgnored. a wrapper whose AGGREGATE text happens to equal the target is never itself picked as the anchor -- the leaf span is", () => {
  // The wrapper's own textContent is never populated from descendants in this fake (unlike a
  // real DOM), so this test instead proves the leaf-only filter directly: a non-leaf element
  // with matching textContent set explicitly must still be skipped in favor of finding no
  // container, never mistaken as a valid (and wrong-level) anchor.
  const span = new FakeElement("span", {}, "Número de identificación");
  const input = new FakeElement("input", {});
  const wrapper = new FakeElement("div", { id: "pv_id_20" }, "Número de identificación").append(span, input);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(wrapper), "Número de identificación");
  // The wrapper itself carries a stable id and matching aggregate text, but it has children, so
  // it must never be treated as the leaf anchor -- the real leaf (the span) is what anchors the
  // climb, landing on the SAME wrapper as CONTAINER via the climb (never as the anchor itself).
  assert.ok(evidence, "the leaf span must still anchor correctly");
  assert.equal(evidence!.container!.stableDirectAttributes?.id, "pv_id_20");
});

test("5/otherFieldIsolation. a same-shaped input in a DIFFERENT field never pollutes this field's candidate pool", () => {
  const { wrapper } = realShapeFieldWrapper();
  const otherSpan = new FakeElement("span", {}, "Otro campo");
  const otherInput = new FakeElement("input", {});
  const otherWrapper = new FakeElement("div", { id: "pv_id_21" }).append(otherSpan, otherInput);
  const root = new FakeElement("div", { id: "root" }).append(wrapper, otherWrapper);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Número de identificación");
  assert.ok(evidence);
  assert.equal(evidence!.container!.stableDirectAttributes?.id, "pv_id_20");
  assert.equal(evidence!.candidates.length, 1);
});

test("6/spanOnly. only the span exists, no related input anywhere in the container: fails closed with an empty candidate list, never invented", () => {
  const span = new FakeElement("span", {}, "Número de identificación");
  const wrapper = new FakeElement("div", { id: "pv_id_20" }).append(span);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(wrapper), "Número de identificación");
  assert.ok(evidence);
  assert.equal(evidence!.candidates.length, 0);
});

test("7/semanticLabelStillWins. a real <label> takes priority over the generic text-anchor mechanism when both exist", () => {
  const input = new FakeElement("input", { id: "doc-input" });
  const label = new FakeElement("label", { for: "doc-input" }, "Campo");
  // A decoy leaf span with the SAME text, elsewhere, must never be used instead of the real label.
  const decoySpan = new FakeElement("span", {}, "Campo");
  const decoyWrapper = new FakeElement("div", { id: "decoy" }).append(decoySpan);
  const container = new FakeElement("div", { id: "field-real" }).append(label, input);
  const root = new FakeElement("div", { id: "root" }).append(container, decoyWrapper);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Campo");
  assert.ok(evidence);
  assert.equal(evidence!.container!.stableDirectAttributes?.id, "field-real", "the real label's container must win, never the decoy");
});

test("8/noOwnerAsAnchor. an owner element (input/button) whose own text happens to equal the field name is never treated as a label anchor", () => {
  // A <button>Número de identificación</button> is itself an owner candidate -- it must never
  // be used as the ANCHOR for its own relation (isOwnerCandidate excludes it).
  const button = new FakeElement("button", {}, "Número de identificación");
  const wrapper = new FakeElement("div", { id: "pv_id_20" }).append(button);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(wrapper), "Número de identificación");
  // No leaf non-owner text anchor exists here, so no container is found -- correct fail-closed
  // (the extractor now always returns a diagnostics-carrying object rather than bare
  // `undefined`, so a physical run can see WHY -- fail-closed behavior itself is unchanged).
  assert.equal(evidence?.container, undefined);
  assert.equal(evidence?.diagnostics.anchorFound, false);
});

test("9/multiproject. no app/field hardcode: the mechanism generalizes to an arbitrary field/container pair", () => {
  for (const field of ["Campo Totalmente Arbitrario", "Otro Campo Distinto"]) {
    const span = new FakeElement("span", {}, field);
    const input = new FakeElement("input", {});
    const wrapper = new FakeElement("div", { id: "any-wrapper" }).append(span, input);
    const evidence = extractFieldScopedDomEvidence(fakeRoot(wrapper), field);
    assert.ok(evidence, `expected resolution for field=${field}`);
    assert.equal(evidence!.candidates[0].tag, "input");
  }
});
