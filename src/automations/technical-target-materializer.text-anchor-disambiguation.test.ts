import assert from "node:assert/strict";
import test from "node:test";
import { materializeFieldScopedTechnicalTarget, type FieldScopedOwnerCandidate } from "./technical-target-materializer";
import { extractFieldScopedDomEvidence, type FieldScopedDomElement, type FieldScopedDomRoot } from "../discovery/field-scoped-live-discovery";

/**
 * FIRST_LOSS (field-scope selection ticket): once the narrow field wrapper is correctly accepted
 * as SCOPE (see `field-scoped-live-discovery.narrow-scope-selection.test.ts`), certification
 * still needs a real stable identity to build a locator -- and the narrow scope itself often has
 * none (that is exactly the real physical shape). Climbing further to the nearest STABLE
 * ancestor (e.g. a page-level `<section data-stable>`) is unsafe on its own: a CSS locator built
 * from that broader container's attributes alone (`[data-stable="..."] input`) would match every
 * OTHER field's input the same broad container also happens to hold.
 *
 * `FieldContainerEvidence.textAnchor` (the field's own known, recorded name -- never invented,
 * never positional) lets `materializeFieldScopedTechnicalTarget` add a `:has-text()` scoping
 * clause, so the resulting CSS only matches inputs inside a sub-tree that actually contains this
 * field's own text -- exactly the boundary the narrow scope already proved structurally unique.
 */

function candidate(overrides: Partial<FieldScopedOwnerCandidate> & Pick<FieldScopedOwnerCandidate, "tag">): FieldScopedOwnerCandidate {
  return { visible: true, disabled: false, ...overrides };
}

test("1/textAnchorDisambiguation. a broad stable container combined with textAnchor produces a :has-text()-scoped CSS locator", () => {
  const result = materializeFieldScopedTechnicalTarget({
    associatedField: "FIELD",
    candidates: [candidate({ tag: "input", role: "textbox", editable: true })],
    requiredCompatibility: "editable",
    fieldContainerEvidence: { tag: "section", stableDirectAttributes: { "data-stable": "large-container" }, textAnchor: "FIELD" },
  });
  assert.equal(result.status, "certified");
  if (result.status === "certified") {
    assert.equal(result.target.certificationTier, 3);
    assert.match(result.target.locatorCandidates[0].value, /\[data-stable="large-container"\] :has-text\("FIELD"\) input/);
  }
});

test("2/noTextAnchorUnchanged. certification without textAnchor is byte-identical to before this fix (the scope IS the certification ancestor)", () => {
  const result = materializeFieldScopedTechnicalTarget({
    associatedField: "FIELD",
    candidates: [candidate({ tag: "input", role: "textbox", editable: true })],
    requiredCompatibility: "editable",
    fieldContainerEvidence: { tag: "div", stableDirectAttributes: { id: "field-wrapper" } },
  });
  assert.equal(result.status, "certified");
  if (result.status === "certified") {
    assert.equal(result.target.locatorCandidates[0].value, '[id="field-wrapper"] input', "no :has-text() clause when textAnchor is absent");
  }
});

test("3/textAnchorEscaped. a field name containing quote characters is safely escaped in the CSS :has-text() clause", () => {
  const result = materializeFieldScopedTechnicalTarget({
    associatedField: 'Campo "raro"',
    candidates: [candidate({ tag: "input", role: "textbox", editable: true })],
    requiredCompatibility: "editable",
    fieldContainerEvidence: { tag: "section", stableDirectAttributes: { "data-stable": "s" }, textAnchor: 'Campo "raro"' },
  });
  assert.equal(result.status, "certified");
  if (result.status === "certified") {
    assert.match(result.target.locatorCandidates[0].value, /:has-text\("Campo \\"raro\\""\)/);
  }
});

test("4/textAnchorNeverAlone. textAnchor alone, with no stable container attributes, never certifies anything -- it is a disambiguator, never a standalone identity", () => {
  const result = materializeFieldScopedTechnicalTarget({
    associatedField: "FIELD",
    candidates: [candidate({ tag: "input", role: "textbox", editable: true })],
    requiredCompatibility: "editable",
    fieldContainerEvidence: { tag: "section", textAnchor: "FIELD" }, // no stableDirectAttributes
  });
  assert.equal(result.status, "not_materializable");
});

// ── End-to-end: the exact "TEST PRINCIPAL" fixture from the ticket ──

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
function otherField(name: string, count = 1): FakeElement {
  const span = new FakeElement("span", {}, name);
  const inputs = Array.from({ length: count }, () => new FakeElement("input", {}));
  return new FakeElement("div", {}).append(span, ...inputs);
}

test("5/endToEndResolved. the exact ticket fixture reaches a certified, uniquely-scoped target -- outer stable section never wins alone, narrow scope decides uniqueness", () => {
  const span = new FakeElement("span", {}, "FIELD");
  const label = new FakeElement("label", {}).append(span);
  const input = new FakeElement("input", {});
  const button = new FakeElement("button", {});
  const innerRow = new FakeElement("div", {}).append(input, button);
  const fieldWrapper = new FakeElement("div", {}).append(label, innerRow); // no stable attrs anywhere
  const root = new FakeElement("section", { "data-stable": "large-container" })
    .append(otherField("OTHER A"), fieldWrapper, otherField("OTHER B", 9));

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "FIELD", "editable");
  assert.ok(evidence?.container, "certification must reach the outer stable section");
  assert.equal(evidence!.container!.textAnchor, "FIELD");

  const result = materializeFieldScopedTechnicalTarget({
    associatedField: "FIELD",
    candidates: evidence!.candidates,
    requiredCompatibility: "editable",
    fieldContainerEvidence: evidence!.container,
  });
  assert.equal(result.status, "certified", "the full pipeline (scope selection + certification) must resolve end to end");
  if (result.status === "certified") {
    assert.match(result.target.locatorCandidates[0].value, /\[data-stable="large-container"\] :has-text\("FIELD"\) input/);
  }
});

test("6/gridRegression. grid-shaped field container evidence (no textAnchor) is unaffected by this fix", () => {
  const result = materializeFieldScopedTechnicalTarget({
    associatedField: "Cualquier Campo",
    candidates: [candidate({ tag: "select", role: "combobox", editable: true })],
    requiredCompatibility: "editable",
    fieldContainerEvidence: { tag: "section", stableDirectAttributes: { "data-scope": "cualquier-seccion" } },
  });
  assert.equal(result.status, "certified");
  if (result.status === "certified") assert.doesNotMatch(result.target.locatorCandidates[0].value, /:has-text/);
});
