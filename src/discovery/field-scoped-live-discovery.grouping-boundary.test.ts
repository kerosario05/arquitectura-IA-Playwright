import assert from "node:assert/strict";
import test from "node:test";
import { extractFieldScopedDomEvidence, type FieldScopedDomElement, type FieldScopedDomRoot } from "./field-scoped-live-discovery";

/**
 * FIRST_LOSS (real physical evidence, job c210b7a0-0016-4ded-bd75-baef96b16223, actionIndex=9,
 * target="Categoría de producto"): the field-scope ancestor climb walked PAST a `fieldset`
 * boundary (0 actionable candidates found within it -- the recorded owner is a `span[role=
 * combobox]`, not recognized by this extractor's actionable-candidate check) and kept climbing
 * into a much broader, page-level `<section>` that happened to contain exactly one actionable
 * control belonging to a completely unrelated feature ("Añadir relacionado"). That control was
 * certified as the field's owner and physically clicked, opening the wrong modal.
 *
 * A native/ARIA field-grouping boundary (`fieldset`, `role="group"`, `role="radiogroup"`) now
 * stops the climb: if no compatible candidate exists anywhere within it, the search fails closed
 * there (`climb_exhausted`) rather than manufacturing a relation to something outside it.
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
  return { body, getElementById: (id: string) => findById(body, id) };
}

test("1/relatedOwnerCertified. a compatible button INSIDE the fieldset is certified normally -- the boundary check never blocks a genuine same-wrapper owner", () => {
  const anchorSpan = new FakeElement("span", {}, "Field label");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const ownButton = new FakeElement("button", { id: "own-button" });
  const fieldset = new FakeElement("fieldset", {}).append(label, ownButton);
  const root = new FakeElement("section", { "data-stable": "page-section" }).append(fieldset);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Field label", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, true);
  assert.equal(evidence?.candidates.length, 1);
});

test("2/unrelatedSiblingRejected. zero compatible candidates inside the fieldset -- a sibling actionable button in a much broader outer section is never certified", () => {
  const anchorSpan = new FakeElement("span", {}, "Categoria de producto");
  const label = new FakeElement("label", {}).append(anchorSpan);
  // The real owner is a span[role=combobox] -- not tag input/select/button and role "combobox"
  // is not among ACTIONABLE_ROLES, so it never counts as a compatible candidate for click intent.
  const comboSpan = new FakeElement("span", { role: "combobox" });
  const fieldset = new FakeElement("fieldset", {}).append(label, comboSpan);
  const unrelatedButton = new FakeElement("button", { id: "add-related" }); // "Añadir relacionado"-shaped
  const root = new FakeElement("section", { "data-stable": "page-section" }).append(fieldset, unrelatedButton);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Categoria de producto", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, false);
  assert.equal(evidence?.diagnostics.rejectReason, "climb_exhausted");
  assert.equal(evidence?.candidates.length ?? 0, 0, "the unrelated button must never appear as a candidate for this field");
});

test("3/persistedCssOutsideFieldRejected. even a UNIQUE actionable candidate outside the fieldset boundary is rejected, not just an ambiguous one", () => {
  const anchorSpan = new FakeElement("span", {}, "Categoria de producto");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const comboSpan = new FakeElement("span", { role: "combobox" });
  const fieldset = new FakeElement("fieldset", {}).append(label, comboSpan);
  // Exactly ONE actionable candidate anywhere in the broader section -- the pre-fix code would
  // have accepted this as "unique enough"; the fix rejects it purely on structural relation.
  const onlyOuterButton = new FakeElement("button", { id: "add-related" });
  const root = new FakeElement("section", {}).append(fieldset, onlyOuterButton);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Categoria de producto", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, false);
  assert.equal(evidence?.candidates.length ?? 0, 0);
});

test("4/ariaGroupBoundaryEquivalent. role=\"group\" is treated the same as a native fieldset boundary", () => {
  const anchorSpan = new FakeElement("span", {}, "Field label");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const comboSpan = new FakeElement("span", { role: "combobox" });
  const group = new FakeElement("div", { role: "group" }).append(label, comboSpan);
  const unrelatedButton = new FakeElement("button", { id: "add-related" });
  const root = new FakeElement("section", {}).append(group, unrelatedButton);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Field label", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, false);
  assert.equal(evidence?.diagnostics.rejectReason, "climb_exhausted");
});

test("5/ambiguousInsideFieldsetStillAmbiguous. two compatible candidates INSIDE the fieldset stay ambiguous, unaffected by the boundary check", () => {
  const anchorSpan = new FakeElement("span", {}, "Field label");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const buttonOne = new FakeElement("button", { id: "one" });
  const buttonTwo = new FakeElement("button", { id: "two" });
  const fieldset = new FakeElement("fieldset", {}).append(label, buttonOne, buttonTwo);
  const root = new FakeElement("section", {}).append(fieldset);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Field label", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, false);
  assert.equal(evidence?.diagnostics.rejectReason, "scope_ambiguous");
});

test("6/noBoundaryUnaffected. an ancestor chain with no fieldset/group at all climbs exactly as before (regression guard)", () => {
  const anchorSpan = new FakeElement("span", {}, "Numero de identificacion");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const input = new FakeElement("input", {});
  const wrapper = new FakeElement("div", {}).append(label, input); // no stable attrs, no fieldset/group
  const root = new FakeElement("section", { "data-stable": "page-section" }).append(wrapper);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Numero de identificacion", "editable");
  assert.equal(evidence?.diagnostics.containerAccepted, true);
  assert.equal(evidence?.candidates.length, 1);
});
