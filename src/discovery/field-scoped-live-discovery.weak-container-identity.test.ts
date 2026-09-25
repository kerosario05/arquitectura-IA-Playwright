import assert from "node:assert/strict";
import test from "node:test";
import { extractFieldScopedDomEvidence, type FieldScopedDomElement, type FieldScopedDomRoot } from "./field-scoped-live-discovery";
import { materializeFieldScopedTechnicalTarget } from "../automations/technical-target-materializer";

/**
 * FIRST_LOSS (real physical evidence, job a9987be8-1b7c-46c6-9f66-47dcf1b47f28, actionIndex=8,
 * target="Continuar", next structured target associatedField="Categoría de producto"): the
 * field-scoped CORE already proved everything -- anchor found, scope accepted, exactly ONE
 * materializer candidate, exactly ONE compatible candidate, candidate certified (Tier 1, own
 * stable attribute). But that Tier-1 locator, built from the candidate's OWN attribute, re-
 * resolved AMBIGUOUSLY page-wide at runtime (`certified_target_runtime_ambiguous`) -- confirmed
 * as hypothesis B (a genuinely-unique-in-scope owner whose GLOBAL locator collides with an
 * identical sibling field's owner elsewhere on the page, e.g. a UI-library-generated attribute
 * shared across every dropdown instance of the same component type), not hypothesis A (the field
 * scope itself was never actually multiple). The pre-existing container-scoped retry
 * (`materializeFieldScopedTechnicalTarget({ requireContainerScope: true })`) could not engage
 * because NO ancestor up the chain carried a stable id/name/data-* attribute at all -- the field's
 * own `fieldset` had none either.
 *
 * The fix: when the field's own SCOPE is itself a genuine field-grouping boundary (fieldset,
 * role=group, role=radiogroup), a container+textAnchor combination (weaker than a stable
 * attribute, but still real, bounded, structural evidence -- never "any element", never
 * positional) is now attached and accepted, at reduced confidence, so execution can proceed on
 * this run using the field-scope-proven-unique candidate while technical/promotion readiness
 * (governed elsewhere, unchanged) remains separately gated by that lower confidence.
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

test("1/uniqueScopedGlobalAmbiguous. a fieldset-scoped, structurally-unique dropdown with NO stable ancestor attribute now certifies via container+textAnchor at reduced confidence", () => {
  const anchorSpan = new FakeElement("span", {}, "Categoria de producto");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const dropdown = new FakeElement("div", { class: "p-dropdown p-component p-inputwrapper p-dropdown-clearable", "aria-haspopup": "listbox", "aria-expanded": "false" });
  const fieldset = new FakeElement("fieldset", {}).append(label, dropdown); // no id/data-* anywhere
  const root = new FakeElement("section", {}).append(fieldset); // no stable attrs on the section either

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Categoria de producto", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, true);
  assert.ok(evidence?.container, "a container fallback is attached for a fieldset-shaped scope");
  assert.equal(evidence!.container!.tag, "fieldset");
  assert.equal(evidence!.container!.textAnchor, "Categoria de producto");
  assert.equal(evidence!.container!.stableDirectAttributes, undefined, "never fabricates a stable attribute that does not exist");

  const materialized = materializeFieldScopedTechnicalTarget(
    { associatedField: "Categoria de producto", candidates: evidence!.candidates, requiredCompatibility: "actionable", fieldContainerEvidence: evidence!.container },
    { requireContainerScope: true },
  );
  assert.equal(materialized.status, "certified");
  if (materialized.status === "certified") {
    assert.equal(materialized.target.certificationTier, 3);
    assert.ok(materialized.target.confidence < 0.6, "confidence is lowered so downstream promotion/technical-readiness thresholds naturally treat this as execution-only");
    assert.match(materialized.target.locatorCandidates[0].value, /^fieldset :has-text\("Categoria de producto"\) div/);
  }
});

test("2/multipleScopedFailsClosed. two compatible dropdowns inside the SAME fieldset stay ambiguous -- never guessed, unaffected by the weak-container fallback", () => {
  const anchorSpan = new FakeElement("span", {}, "Categoria de producto");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const dropdownOne = new FakeElement("div", { "aria-haspopup": "listbox", "aria-expanded": "false" });
  const dropdownTwo = new FakeElement("div", { "aria-haspopup": "listbox", "aria-expanded": "false" });
  const fieldset = new FakeElement("fieldset", {}).append(label, dropdownOne, dropdownTwo);
  const root = new FakeElement("section", {}).append(fieldset);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Categoria de producto", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, false);
  assert.equal(evidence?.diagnostics.rejectReason, "scope_ambiguous");
});

test("3/unrelatedSiblingRejected. a broad section with the correct fieldset-scoped dropdown plus an unrelated sibling button only ever certifies the related dropdown", () => {
  const anchorSpan = new FakeElement("span", {}, "Categoria de producto");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const dropdown = new FakeElement("div", { "aria-haspopup": "listbox", "aria-expanded": "false" });
  const fieldset = new FakeElement("fieldset", {}).append(label, dropdown);
  const unrelatedButton = new FakeElement("button", { id: "add-related" });
  const root = new FakeElement("section", {}).append(fieldset, unrelatedButton);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Categoria de producto", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, true);
  assert.equal(evidence?.candidates.length, 1);
  assert.equal(evidence?.candidates[0]?.tag, "div");
});

test("4/globalUniqueRegression. when the scope's certification ancestor DOES carry a real stable attribute, the existing strong-identity path is completely unchanged (no confidence reduction, no tag-only fallback)", () => {
  const anchorSpan = new FakeElement("span", {}, "Categoria de producto");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const dropdown = new FakeElement("div", { "aria-haspopup": "listbox", "aria-expanded": "false" });
  const fieldset = new FakeElement("fieldset", { id: "categoria-fieldset" }).append(label, dropdown);
  const root = new FakeElement("section", {}).append(fieldset);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Categoria de producto", "actionable");
  assert.ok(evidence?.container?.stableDirectAttributes);
  assert.equal(evidence!.container!.textAnchor, undefined, "no textAnchor needed when the container IS the scope with a real stable attribute");

  const materialized = materializeFieldScopedTechnicalTarget(
    { associatedField: "Categoria de producto", candidates: evidence!.candidates, requiredCompatibility: "actionable", fieldContainerEvidence: evidence!.container },
    { requireContainerScope: true },
  );
  assert.equal(materialized.status, "certified");
  if (materialized.status === "certified") {
    assert.equal(materialized.target.confidence, 0.75, "unchanged default confidence for a real stable-attribute container");
  }
});

test("5/wrongClickRegression. the previous false-positive shape (owner not recognized at all, unrelated outer button) still fails closed", () => {
  const anchorSpan = new FakeElement("span", {}, "Categoria de producto");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const comboSpan = new FakeElement("span", { role: "combobox" }); // no ARIA disclosure attrs -- still unrecognized
  const fieldset = new FakeElement("fieldset", {}).append(label, comboSpan);
  const unrelatedButton = new FakeElement("button", { id: "add-related" });
  const root = new FakeElement("section", {}).append(fieldset, unrelatedButton);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Categoria de producto", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, false);
  assert.equal(evidence?.diagnostics.rejectReason, "climb_exhausted");
  assert.equal(evidence?.candidates.length ?? 0, 0);
});

test("6/fillRegression. Número de identificación (plain input, no fieldset, real id-bearing wrapper) is completely unaffected", () => {
  const anchorSpan = new FakeElement("span", {}, "Numero de identificacion");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const input = new FakeElement("input", {});
  const wrapper = new FakeElement("div", { id: "numero-wrapper" }).append(label, input);
  const root = new FakeElement("section", {}).append(wrapper);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Numero de identificacion", "editable");
  assert.equal(evidence?.diagnostics.containerAccepted, true);
  assert.equal(evidence?.container?.textAnchor, undefined);
  const materialized = materializeFieldScopedTechnicalTarget(
    { associatedField: "Numero de identificacion", candidates: evidence!.candidates, requiredCompatibility: "editable", fieldContainerEvidence: evidence!.container },
    { requireContainerScope: true },
  );
  assert.equal(materialized.status, "certified");
  if (materialized.status === "certified") {
    assert.equal(materialized.target.confidence, 0.75);
    assert.equal(materialized.target.locatorCandidates[0].value, '[id="numero-wrapper"] input');
  }
});

test("7/noPositionOrIndex. reordering unrelated sibling fields never changes which candidate certifies", () => {
  function otherField(name: string): FakeElement {
    const span = new FakeElement("span", {}, name);
    const otherFieldset = new FakeElement("fieldset", {}).append(span, new FakeElement("input", {}));
    return otherFieldset;
  }
  const anchorSpan = new FakeElement("span", {}, "Categoria de producto");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const dropdown = new FakeElement("div", { "aria-haspopup": "listbox", "aria-expanded": "false" });
  const fieldset = new FakeElement("fieldset", {}).append(label, dropdown);
  const rootOrderA = new FakeElement("section", {}).append(otherField("Other A"), fieldset, otherField("Other B"));
  const rootOrderB = new FakeElement("section", {}).append(fieldset, otherField("Other A"), otherField("Other B"));

  const evidenceA = extractFieldScopedDomEvidence(fakeRoot(rootOrderA), "Categoria de producto", "actionable");
  const evidenceB = extractFieldScopedDomEvidence(fakeRoot(rootOrderB), "Categoria de producto", "actionable");
  assert.equal(evidenceA?.candidates.length, 1);
  assert.equal(evidenceB?.candidates.length, 1);
  assert.equal(evidenceA?.candidates[0]?.tag, evidenceB?.candidates[0]?.tag);
});
