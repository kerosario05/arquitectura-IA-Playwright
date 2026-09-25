import assert from "node:assert/strict";
import test from "node:test";
import { extractFieldScopedDomEvidence, type FieldScopedDomElement, type FieldScopedDomRoot } from "./field-scoped-live-discovery";

/**
 * FIRST_LOSS (real physical evidence, job 5365ac89-e2b4-4e68-a17e-c4dd19af98a6, actionIndex=8,
 * target="Continuar", next structured target associatedField="Categoría de producto"): the
 * physically-visible, visible+enabled+clickable dropdown owner (`<div class="p-dropdown
 * p-component p-inputwrapper p-dropdown-clearable">`) was invisible to `isOwnerCandidate` --
 * neither its tag (div) nor role (none) qualified it as an owner at all, so the field-scope climb
 * found ZERO compatible candidates at every depth up through the field's own `fieldset` and
 * correctly (per the prior ticket's fix) failed closed with `field_container_not_resolved`,
 * stalling `Continuar` to `loading_timeout` for ~33s -- never reaching actionIndex=9 at all.
 *
 * A non-native disclosure/listbox trigger (a UI-library dropdown/combobox wrapper rendered as a
 * plain div/span, e.g. PrimeVue/MUI-style widgets) declares itself via standard ARIA disclosure
 * attributes (`aria-haspopup`, `aria-expanded`, `aria-controls`) even with no recognized tag/role.
 * This is the SAME generic ARIA-attribute signal already used elsewhere in this codebase (grid
 * editor rematerialization) for an equivalent purpose -- never a library-specific class name,
 * never "any clickable div in scope".
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

/** The physically-observed dropdown shape: a plain div, no tag/role signal, but real ARIA disclosure attributes. */
function ariaDropdown(idSuffix = ""): FakeElement {
  return new FakeElement("div", {
    class: "p-dropdown p-component p-inputwrapper p-dropdown-clearable",
    "aria-haspopup": "listbox",
    "aria-expanded": "false",
    ...(idSuffix ? { id: `dropdown-${idSuffix}` } : {}),
  });
}

test("1/relatedDropdownCertified. a field label with its own related ARIA-disclosure dropdown wrapper inside a fieldset is certified", () => {
  const anchorSpan = new FakeElement("span", {}, "Categoria de producto");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const dropdown = ariaDropdown();
  const fieldset = new FakeElement("fieldset", {}).append(label, dropdown);
  const root = new FakeElement("section", { "data-stable": "page-section" }).append(fieldset);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Categoria de producto", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, true);
  assert.equal(evidence?.candidates.length, 1);
});

test("2/comboboxCertified. a native accessible combobox (role=combobox + aria-expanded, the real WAI-ARIA disclosure pattern) is certified via the same ARIA-disclosure signal", () => {
  const anchorSpan = new FakeElement("span", {}, "Categoria de producto");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const combobox = new FakeElement("span", { role: "combobox", "aria-expanded": "false" });
  const fieldset = new FakeElement("fieldset", {}).append(label, combobox);
  const root = new FakeElement("section", {}).append(fieldset);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Categoria de producto", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, true);
  assert.equal(evidence?.candidates.length, 1);
});

test("3/unrelatedButtonRejected. an unrelated plain button (no ARIA disclosure attributes) outside the fieldset is still never certified", () => {
  const anchorSpan = new FakeElement("span", {}, "Categoria de producto");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const dropdown = ariaDropdown();
  const fieldset = new FakeElement("fieldset", {}).append(label, dropdown);
  const unrelatedButton = new FakeElement("button", { id: "add-related" }); // "Añadir relacionado"-shaped, no aria-haspopup/expanded/controls
  const root = new FakeElement("section", {}).append(fieldset, unrelatedButton);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Categoria de producto", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, true, "the fieldset's own related dropdown is still found");
  assert.equal(evidence?.candidates.length, 1, "the unrelated outer button never becomes a candidate");
  assert.equal(evidence?.candidates[0]?.tag, "div", "the certified candidate is the dropdown wrapper, not the unrelated button");
});

test("4/broadSectionSafe. a broad section containing the correct dropdown plus several unrelated actionable siblings only ever admits the related dropdown as a candidate", () => {
  const anchorSpan = new FakeElement("span", {}, "Categoria de producto");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const dropdown = ariaDropdown();
  const fieldset = new FakeElement("fieldset", {}).append(label, dropdown);
  const addRelated = new FakeElement("button", { id: "add-related" });
  const guardar = new FakeElement("button", { id: "guardar" });
  const continuar = new FakeElement("button", { id: "continuar" });
  const root = new FakeElement("section", {}).append(fieldset, addRelated, guardar, continuar);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Categoria de producto", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, true);
  assert.equal(evidence?.candidates.length, 1);
});

test("5/ambiguousFailsClosed. two ARIA-disclosure owners related to the SAME field stay ambiguous -- never guessed", () => {
  const anchorSpan = new FakeElement("span", {}, "Categoria de producto");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const dropdownOne = ariaDropdown("one");
  const dropdownTwo = ariaDropdown("two");
  const fieldset = new FakeElement("fieldset", {}).append(label, dropdownOne, dropdownTwo);
  const root = new FakeElement("section", {}).append(fieldset);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Categoria de producto", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, false);
  assert.equal(evidence?.diagnostics.rejectReason, "scope_ambiguous");
});

test("6/wrongClickRegression. the exact previous false-positive shape (zero compatible candidates inside the fieldset, unrelated outer button) still fails closed, unaffected by the ARIA-disclosure addition", () => {
  const anchorSpan = new FakeElement("span", {}, "Categoria de producto");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const comboSpan = new FakeElement("span", { role: "combobox" }); // NOT actionable under the old rules, and no ARIA disclosure attrs either
  const fieldset = new FakeElement("fieldset", {}).append(label, comboSpan);
  const unrelatedButton = new FakeElement("button", { id: "add-related" });
  const root = new FakeElement("section", { "data-stable": "page-section" }).append(fieldset, unrelatedButton);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Categoria de producto", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, false);
  assert.equal(evidence?.diagnostics.rejectReason, "climb_exhausted");
  assert.equal(evidence?.candidates.length ?? 0, 0);
});

test("7/noBoundaryAriaDisclosureUnaffectedByFillIntent. an ARIA-disclosure owner is observed but never counted as fill-compatible for editable intent -- role compatibility still distinguishes it", () => {
  const anchorSpan = new FakeElement("span", {}, "Numero de identificacion");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const input = new FakeElement("input", {});
  const dropdown = ariaDropdown();
  const wrapper = new FakeElement("div", {}).append(label, input, dropdown);
  const root = new FakeElement("section", { "data-stable": "page-section" }).append(wrapper);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Numero de identificacion", "editable");
  assert.equal(evidence?.diagnostics.containerAccepted, true);
  const editableCandidates = evidence?.candidates.filter((c) => c.editable === true) ?? [];
  assert.equal(editableCandidates.length, 1, "only the real input is editable-compatible, not the dropdown");
});

test("8/numeroIdentificacionRegression. the pre-existing plain-input fill fixture is completely unaffected by the ARIA-disclosure addition", () => {
  const anchorSpan = new FakeElement("span", {}, "Numero de identificacion");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const input = new FakeElement("input", {});
  const wrapper = new FakeElement("div", {}).append(label, input);
  const root = new FakeElement("section", { "data-stable": "page-section" }).append(wrapper);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Numero de identificacion", "editable");
  assert.equal(evidence?.diagnostics.containerAccepted, true);
  assert.equal(evidence?.candidates.length, 1);
});
