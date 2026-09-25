import assert from "node:assert/strict";
import test from "node:test";
import { extractFieldScopedDomEvidence, type FieldScopedDomElement, type FieldScopedDomRoot } from "./field-scoped-live-discovery";

/**
 * FIRST_LOSS: the field-scoped materializer (`resolveFieldScopedOwner` /
 * `materializeFieldScopedTechnicalTarget`) already certifies safely, but nothing built the
 * `FieldScopedOwnerCandidate[]`/`FieldContainerEvidence` it needs FROM the live DOM during
 * Recording Replay -- the fallback existed as an unreachable, uncalled capability. This module
 * closes that gap with a bounded, evidence-only extractor: real label[for]/wrapping-label/
 * fieldset+legend/aria-labelledby relations only, climbing a bounded number of ancestors to the
 * first one carrying its own stable attribute -- never text-based ancestor matching, never a
 * positional/nearest-div guess. It only OBSERVES; the shared materializer still alone decides
 * certified/ambiguous/not_materializable.
 *
 * These tests exercise `extractFieldScopedDomEvidence` directly against a minimal hand-built
 * fake DOM (no jsdom -- only the `parentElement`/`children`/`getAttribute` surface the function
 * itself declares it needs), mirroring the "real execution against a fake document" precedent
 * already used elsewhere in this codebase for browser-injected logic.
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

test("1/textbox. label[for] + unnamed input inside an id-bearing container: certifiable evidence extracted", () => {
  const input = new FakeElement("input", { id: "doc-number-input" });
  const label = new FakeElement("label", { for: "doc-number-input" }, "Identificación");
  const container = new FakeElement("div", { id: "field-identificacion" }).append(label, input);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(container), "Identificación");
  assert.ok(evidence);
  assert.equal(evidence!.container!.stableDirectAttributes?.id, "field-identificacion");
  assert.equal(evidence!.candidates.length, 1);
  assert.equal(evidence!.candidates[0].tag, "input");
  assert.equal(evidence!.candidates[0].editable, true);
});

test("2/iconButton. wrapping label with an unnamed icon button inside an id-bearing container", () => {
  const button = new FakeElement("button", {});
  const label = new FakeElement("label", { id: "clear-label" }, "Limpiar campo").append(button);
  const root = new FakeElement("div", {}).append(label);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Limpiar campo");
  assert.ok(evidence);
  assert.equal(evidence!.container!.stableDirectAttributes?.id, "clear-label");
  assert.equal(evidence!.candidates.length, 1);
  assert.equal(evidence!.candidates[0].tag, "button");
  assert.equal(evidence!.candidates[0].actionable, true);
  assert.equal(evidence!.candidates[0].editable, false);
});

test("3. textbox and button in the same field: both observed, role compatibility distinguishes them later", () => {
  const input = new FakeElement("input", { id: "doc-number" });
  const button = new FakeElement("button", { id: "doc-number-clear" });
  const label = new FakeElement("label", { for: "doc-number" }, "Identificación");
  const container = new FakeElement("div", { id: "field-identificacion" }).append(label, input, button);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(container), "Identificación");
  assert.equal(evidence?.candidates.length, 2);
  assert.equal(evidence?.candidates.find((c) => c.tag === "input")?.editable, true);
  assert.equal(evidence?.candidates.find((c) => c.tag === "button")?.actionable, true);
});

test("5/multipleWithinField. two compatible inputs in the same field: both observed -- ambiguity is the materializer's decision, not this extractor's", () => {
  const inputA = new FakeElement("input", {});
  const inputB = new FakeElement("input", {});
  const label = new FakeElement("label", { id: "field-a" }, "Campo").append(inputA, inputB);
  const root = new FakeElement("div", {}).append(label);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Campo");
  assert.equal(evidence?.candidates.length, 2);
});

test("6/otherFieldIsolation. a same-shaped input in a DIFFERENT field never pollutes this field's candidate pool", () => {
  const inputA = new FakeElement("input", {});
  const fieldA = new FakeElement("label", { id: "field-a" }, "Campo A").append(inputA);
  const inputB = new FakeElement("input", {});
  const fieldB = new FakeElement("label", { id: "field-b" }, "Campo B").append(inputB);
  const root = new FakeElement("div", {}).append(fieldA, fieldB);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Campo A");
  assert.equal(evidence?.candidates.length, 1);
  assert.notEqual(evidence?.container?.stableDirectAttributes?.id, "field-b");
});

test("7/missingContainer (superseded invariant, twice). a label with no for/wrapped-owner/id but a genuinely unique sibling input resolves the SCOPE via structural uniqueness, and that scope now becomes its own (weaker, textAnchor-backed) container", () => {
  // FIRST_LOSS fix (field-scope selection ticket, then superseded again by the field-scope
  // runtime-uniqueness ticket): this fixture used to be treated as unresolvable because NOTHING
  // in it carried an id/name/data-* attribute. Field scope is proven by structural uniqueness
  // (exactly one compatible candidate), never by stable-attribute presence. That structural proof
  // is now ALSO real enough to serve as (weaker, execution-only) container evidence on its own --
  // `container` is no longer left undefined just because nothing nearby has a stable attribute.
  const input = new FakeElement("input", {});
  const label = new FakeElement("label", {}, "Campo Sin Contenedor").append(); // no `for`, no wrapped owner, no id
  const root = new FakeElement("div", {}).append(label, input);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Campo Sin Contenedor");
  assert.equal(evidence?.diagnostics.containerAccepted, true, "the scope must resolve via structural uniqueness");
  assert.ok(evidence?.container, "the accepted scope itself now becomes the fallback container");
  assert.equal(evidence!.container!.fromAcceptedFieldScope, true);
  assert.equal(evidence!.container!.stableDirectAttributes, undefined, "no stable attribute exists anywhere -- never fabricated");
  assert.equal(evidence?.candidates.length, 1);
  assert.equal(evidence?.candidates[0].tag, "input");
});

test("7b/genuinelyUnresolvable. two candidate inputs with no id anywhere near a label: scope stays ambiguous, never a guess", () => {
  const inputA = new FakeElement("input", {});
  const inputB = new FakeElement("input", {});
  const label = new FakeElement("label", {}, "Campo Sin Contenedor").append();
  const root = new FakeElement("div", {}).append(label, inputA, inputB);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Campo Sin Contenedor");
  assert.equal(evidence?.container, undefined);
  assert.equal(evidence?.diagnostics.containerAccepted, false);
  assert.equal(evidence?.diagnostics.rejectReason, "scope_ambiguous");
});

test("8/zeroOwner. container resolved but has no owner descendants: empty candidate list, never invented", () => {
  const label = new FakeElement("label", { id: "field-empty" }, "Campo Vacio");
  const root = new FakeElement("div", {}).append(label);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Campo Vacio");
  assert.ok(evidence);
  assert.deepEqual(evidence!.candidates, []);
});

test("9/hidden. a hidden owner is still reported, flagged non-visible -- filtering is the materializer's job", () => {
  const input = new FakeElement("input", { id: "hidden-input" });
  input.hidden = true;
  const label = new FakeElement("label", { for: "hidden-input" }, "Campo").append();
  const container = new FakeElement("div", { id: "field-x" }).append(label, input);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(container), "Campo");
  assert.equal(evidence?.candidates[0]?.visible, false);
});

test("10/disabled. a disabled owner is still reported, flagged disabled -- filtering is the materializer's job", () => {
  const button = new FakeElement("button", { id: "disabled-btn" });
  button.disabled = true;
  const label = new FakeElement("label", { id: "field-y" }, "Campo").append(button);
  const root = new FakeElement("div", {}).append(label);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Campo");
  assert.equal(evidence?.candidates[0]?.disabled, true);
});

test("13/noFakeRoleName. associatedField text never becomes a role or leaks into candidate identity", () => {
  const input = new FakeElement("input", { id: "real-id" });
  const label = new FakeElement("label", { for: "real-id" }, "Numero de Identificacion").append();
  const container = new FakeElement("div", { id: "field-z" }).append(label, input);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(container), "Numero de Identificacion");
  const candidate = evidence?.candidates[0];
  assert.notEqual(candidate?.role, "Numero de Identificacion");
  assert.ok(!JSON.stringify(candidate?.stableDirectAttributes ?? {}).includes("Numero de Identificacion"));
});

test("14/noPosition. reordering children never changes which candidates are found", () => {
  const inputA = new FakeElement("input", { id: "a" });
  const inputB = new FakeElement("input", { id: "b" });
  const label1 = new FakeElement("label", { for: "a" }, "Campo").append();
  const container1 = new FakeElement("div", { id: "field-order" }).append(label1, inputA, inputB);
  const evidence1 = extractFieldScopedDomEvidence(fakeRoot(container1), "Campo");

  const inputA2 = new FakeElement("input", { id: "a" });
  const inputB2 = new FakeElement("input", { id: "b" });
  const label2 = new FakeElement("label", { for: "a" }, "Campo").append();
  const container2 = new FakeElement("div", { id: "field-order" }).append(inputB2, inputA2, label2);
  const evidence2 = extractFieldScopedDomEvidence(fakeRoot(container2), "Campo");

  assert.equal(evidence1?.candidates.length, evidence2?.candidates.length);
  assert.deepEqual(
    evidence1?.candidates.map((c) => c.stableDirectAttributes?.id).sort(),
    evidence2?.candidates.map((c) => c.stableDirectAttributes?.id).sort(),
  );
});

test("fieldset/legend relation: legend text anchors the fieldset as container when the fieldset itself carries a stable attribute", () => {
  const radio = new FakeElement("input", { id: "opt-1", type: "radio" });
  const legend = new FakeElement("legend", {}, "Tipo de Cuenta");
  const fieldset = new FakeElement("fieldset", { id: "tipo-cuenta-group" }).append(legend, radio);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(fieldset), "Tipo de Cuenta");
  assert.ok(evidence);
  assert.equal(evidence!.container!.tag, "fieldset");
  assert.equal(evidence!.container!.stableDirectAttributes?.id, "tipo-cuenta-group");
});

test("aria-labelledby relation: an owner referencing a matching label id is discovered without label[for]/wrapping", () => {
  const labelNode = new FakeElement("span", { id: "lbl-1" }, "Correo");
  const input = new FakeElement("input", { id: "email-input", "aria-labelledby": "lbl-1" });
  const container = new FakeElement("div", { id: "field-email" }).append(labelNode, input);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(container), "Correo");
  assert.ok(evidence);
  assert.equal(evidence!.candidates.length, 1);
  assert.equal(evidence!.candidates[0].stableDirectAttributes?.id, "email-input");
});

test("18/generic. no app/project hardcode: the mechanism generalizes to an arbitrary field/container pair", () => {
  const select = new FakeElement("select", { id: "arbitrary-select" });
  const label = new FakeElement("label", { for: "arbitrary-select" }, "Cualquier Campo Generico").append();
  const container = new FakeElement("section", { "data-scope": "cualquier-seccion" }).append(label, select);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(container), "Cualquier Campo Generico");
  assert.ok(evidence);
  assert.equal(evidence!.container!.stableDirectAttributes?.["data-scope"], "cualquier-seccion");
  assert.equal(evidence!.candidates[0].tag, "select");
});

test("blank/whitespace associatedField never matches by accident", () => {
  const input = new FakeElement("input", { id: "x" });
  const label = new FakeElement("label", { for: "x" }, "").append();
  const container = new FakeElement("div", { id: "field-blank" }).append(label, input);
  assert.equal(extractFieldScopedDomEvidence(fakeRoot(container), ""), undefined);
  assert.equal(extractFieldScopedDomEvidence(fakeRoot(container), "   "), undefined);
});
