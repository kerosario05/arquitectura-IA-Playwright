import assert from "node:assert/strict";
import test from "node:test";
import { extractFieldScopedDomEvidence, type FieldScopedDomElement, type FieldScopedDomRoot } from "./field-scoped-live-discovery";
import { materializeFieldScopedTechnicalTarget } from "../automations/technical-target-materializer";

/**
 * FIRST_LOSS (real physical evidence, job f6f21433-26c7-4332-8c0d-592940f29292, actionIndex=8,
 * target="Continuar", next structured target associatedField="Categoría de producto"): the prior
 * ticket's fix only attached a tag+textAnchor fallback container when the accepted SCOPE was a
 * native/ARIA field-grouping boundary (fieldset/role=group/role=radiogroup). This run's physical
 * accepted scope was a plain `<div>` at depth=3 (`ancestorDepth=3 div stableAttribute=false
 * fillCompatibleCandidates=1 scopeDecision=accepted`) -- `isFieldGroupingBoundary(div)` is false,
 * so the fallback never engaged, `container` stayed undefined, the Tier-1 global locator
 * re-resolved ambiguously, and `Continuar` stalled to `loading_timeout`.
 *
 * The real authority was never the container's TAG -- it is whether `findFieldScope` itself
 * already accepted this exact node as the field's unique, compatible, anchor-related owner
 * container. That authority is now transported explicitly (`fromAcceptedFieldScope: true`, set
 * ONLY by field-scoped-live-discovery.ts's own scope-fallback, never by a caller constructing
 * evidence by hand), and the materializer trusts THAT flag instead of guessing from the tag name.
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

/** The exact physical shape: label -> div -> div -> div(accepted scope, no stable attr, 1 dropdown). */
function buildPhysicalDivScopeFixture() {
  const anchorSpan = new FakeElement("span", {}, "Categoria de producto");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const dropdown = new FakeElement("div", { class: "p-dropdown p-component p-inputwrapper p-dropdown-clearable", "aria-haspopup": "listbox", "aria-expanded": "false" });
  const acceptedDiv = new FakeElement("div", {}).append(label, dropdown); // depth=3, accepted, no stable attr
  const midDiv2 = new FakeElement("div", {}).append(acceptedDiv);
  const midDiv1 = new FakeElement("div", {}).append(midDiv2);
  const root = new FakeElement("section", {}).append(midDiv1); // section wrapper, no stable attrs anywhere
  return { root, acceptedDiv };
}

test("1/acceptedDivRuntimeUnique. an accepted plain-div field scope (no fieldset, no stable attribute) with exactly one compatible owner now certifies via container+textAnchor at reduced confidence", () => {
  const { root } = buildPhysicalDivScopeFixture();
  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Categoria de producto", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, true);
  assert.ok(evidence?.container, "the accepted div scope itself becomes the fallback container");
  assert.equal(evidence!.container!.tag, "div");
  assert.equal(evidence!.container!.fromAcceptedFieldScope, true);
  assert.equal(evidence!.container!.stableDirectAttributes, undefined);

  const materialized = materializeFieldScopedTechnicalTarget(
    { associatedField: "Categoria de producto", candidates: evidence!.candidates, requiredCompatibility: "actionable", fieldContainerEvidence: evidence!.container },
    { requireContainerScope: true },
  );
  assert.equal(materialized.status, "certified");
  if (materialized.status === "certified") {
    assert.equal(materialized.target.certificationTier, 3);
    assert.ok(materialized.target.confidence < 0.6, "execution-only confidence, not a full durable certification");
    assert.match(materialized.target.locatorCandidates[0].value, /^div :has-text\("Categoria de producto"\) div/);
  }
});

test("2/unacceptedDivRejected. a caller-supplied div+textAnchor WITHOUT fromAcceptedFieldScope (never derived from a real findFieldScope acceptance) is never trusted -- preserves 4/textAnchorNeverAlone's own invariant for an arbitrary div too", () => {
  const materialized = materializeFieldScopedTechnicalTarget({
    associatedField: "Categoria de producto",
    candidates: [{ tag: "div", role: undefined, visible: true, disabled: false, actionable: true }],
    requiredCompatibility: "actionable",
    fieldContainerEvidence: { tag: "div", textAnchor: "Categoria de producto" }, // no fromAcceptedFieldScope
  });
  assert.equal(materialized.status, "not_materializable");
});

test("3/multipleCompatibleFailsClosed. the same accepted-div shape with TWO compatible owners inside it stays ambiguous -- never guessed", () => {
  const anchorSpan = new FakeElement("span", {}, "Categoria de producto");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const dropdownOne = new FakeElement("div", { "aria-haspopup": "listbox", "aria-expanded": "false" });
  const dropdownTwo = new FakeElement("div", { "aria-haspopup": "listbox", "aria-expanded": "false" });
  const acceptedDiv = new FakeElement("div", {}).append(label, dropdownOne, dropdownTwo);
  const root = new FakeElement("section", {}).append(acceptedDiv);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Categoria de producto", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, false);
  assert.equal(evidence?.diagnostics.rejectReason, "scope_ambiguous");
});

test("4/broadSiblingScopeRejected. a broad div containing the dropdown PLUS Añadir relacionado/Guardar/Continuar, with no field-local accepted scope narrower than that broad div, still fails closed", () => {
  // The broad div itself is never "accepted" as scope by findFieldScope because it contains more
  // than one compatible actionable candidate (the dropdown AND the three unrelated buttons) --
  // this is the SAME wrong-click prevention as the earlier grouping-boundary ticket, now proven
  // for a broad DIV ancestor too, not just a broad section.
  const anchorSpan = new FakeElement("span", {}, "Categoria de producto");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const dropdown = new FakeElement("div", { "aria-haspopup": "listbox", "aria-expanded": "false" });
  const addRelated = new FakeElement("button", { id: "add-related" });
  const guardar = new FakeElement("button", { id: "guardar" });
  const continuar = new FakeElement("button", { id: "continuar" });
  const broadDiv = new FakeElement("div", {}).append(label, dropdown, addRelated, guardar, continuar);
  const root = new FakeElement("section", {}).append(broadDiv);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Categoria de producto", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, false);
  assert.equal(evidence?.diagnostics.rejectReason, "scope_ambiguous", "the broad div itself contains 4 compatible actionable candidates -- never accepted as scope");
});

test("7/technicalReadinessNotPromoted. a weak (fromAcceptedFieldScope) certification never reaches the same confidence as a real stable-attribute certification -- promotion/technical-readiness thresholds stay separate", () => {
  const { root } = buildPhysicalDivScopeFixture();
  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Categoria de producto", "actionable");
  const weak = materializeFieldScopedTechnicalTarget(
    { associatedField: "Categoria de producto", candidates: evidence!.candidates, requiredCompatibility: "actionable", fieldContainerEvidence: evidence!.container },
    { requireContainerScope: true },
  );
  assert.equal(weak.status, "certified");

  const strongFieldset = new FakeElement("fieldset", { id: "categoria-fieldset" });
  const strongEvidence = { tag: "fieldset", stableDirectAttributes: { id: "categoria-fieldset" } };
  const strong = materializeFieldScopedTechnicalTarget(
    { associatedField: "Categoria de producto", candidates: evidence!.candidates, requiredCompatibility: "actionable", fieldContainerEvidence: strongEvidence },
    { requireContainerScope: true },
  );
  void strongFieldset;
  assert.equal(strong.status, "certified");
  if (weak.status === "certified" && strong.status === "certified") {
    assert.ok(weak.target.confidence < strong.target.confidence, "the accepted-scope fallback is always strictly weaker than a real stable-attribute container");
  }
});
