import assert from "node:assert/strict";
import test from "node:test";
import { extractFieldScopedDomEvidence, type FieldScopedDomElement, type FieldScopedDomRoot } from "./field-scoped-live-discovery";

/**
 * FIRST_LOSS (jobId 0ffc2349-d13a-4c6d-8e68-acaf80019c1d): `findFieldScope` accepts a scope
 * (exactly one compatible descendant in that specific subtree) with no stable attribute of its
 * own, but `findCertificationAncestor` then climbs PAST that already-proven-unique scope to the
 * nearest ancestor carrying ANY `id`/`name`/`data-*` attribute -- even one that is not actually
 * page-unique (e.g. a framework's scoped-style hash shared by every instance of a repeated
 * component). That broader container became the ONLY container evidence returned, and the exact
 * accepted scope's own authority (`fromAcceptedFieldScope: true`) was silently discarded.
 * `scopeContainer` now always carries that authority alongside `container`, regardless of what
 * `findCertificationAncestor` found, so a caller can retry against it once the broader container
 * proves ambiguous at runtime.
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

/** accepted scope = plain div (no stable attr); a BROADER ancestor beyond it carries a data-* attribute. */
function buildBroaderCertificationAncestorFixture() {
  const anchorSpan = new FakeElement("span", {}, "Categoria de producto");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const dropdown = new FakeElement("div", { "aria-haspopup": "listbox", "aria-expanded": "false" });
  const acceptedDiv = new FakeElement("div", {}).append(label, dropdown); // accepted scope, no stable attr
  const broaderAncestor = new FakeElement("div", { "data-v-shared-component-hash": "x" }).append(acceptedDiv);
  const root = new FakeElement("section", {}).append(broaderAncestor);
  return { root, acceptedDiv, broaderAncestor };
}

test("1/scopeContainerAlwaysCarriesAuthority. when findCertificationAncestor climbs past the accepted scope, scopeContainer still preserves fromAcceptedFieldScope=true", () => {
  const { root } = buildBroaderCertificationAncestorFixture();
  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Categoria de producto", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, true);

  // The broader container is what gets returned as `container` -- carries the (not verifiably
  // unique) data-* attribute, never the accepted-scope authority.
  assert.ok(evidence?.container?.stableDirectAttributes);
  assert.equal(evidence!.container!.fromAcceptedFieldScope, undefined);

  // scopeContainer is the exact accepted scope's own identity -- always present, always trusted.
  assert.ok(evidence?.scopeContainer);
  assert.equal(evidence!.scopeContainer!.tag, "div");
  assert.equal(evidence!.scopeContainer!.fromAcceptedFieldScope, true);
  assert.equal(evidence!.scopeContainer!.textAnchor, "Categoria de producto");
  assert.equal(evidence!.scopeContainer!.stableDirectAttributes, undefined);
});

test("2/scopeContainerMatchesContainerWhenNoBroaderAncestor. when no ancestor beyond the scope carries a stable attribute, container and scopeContainer describe the SAME node", () => {
  const anchorSpan = new FakeElement("span", {}, "Categoria de producto");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const dropdown = new FakeElement("div", { "aria-haspopup": "listbox", "aria-expanded": "false" });
  const acceptedDiv = new FakeElement("div", {}).append(label, dropdown);
  const root = new FakeElement("section", {}).append(acceptedDiv); // no stable attr anywhere in the climb

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Categoria de producto", "actionable");
  assert.equal(evidence?.container?.fromAcceptedFieldScope, true);
  assert.equal(evidence?.scopeContainer?.fromAcceptedFieldScope, true);
  assert.equal(evidence?.container?.tag, evidence?.scopeContainer?.tag);
});

test("3/multipleCompatibleWithinScopeStillFailsClosed. a broader certification ancestor never changes the scope's own uniqueness verdict -- 2 compatible owners in the accepted scope stays ambiguous", () => {
  const anchorSpan = new FakeElement("span", {}, "Categoria de producto");
  const label = new FakeElement("label", {}).append(anchorSpan);
  const dropdownOne = new FakeElement("div", { "aria-haspopup": "listbox", "aria-expanded": "false" });
  const dropdownTwo = new FakeElement("div", { "aria-haspopup": "listbox", "aria-expanded": "false" });
  const acceptedDiv = new FakeElement("div", {}).append(label, dropdownOne, dropdownTwo);
  const broaderAncestor = new FakeElement("div", { "data-v-shared-component-hash": "x" }).append(acceptedDiv);
  const root = new FakeElement("section", {}).append(broaderAncestor);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Categoria de producto", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, false);
  assert.equal(evidence?.diagnostics.rejectReason, "scope_ambiguous");
  assert.equal(evidence?.scopeContainer, undefined);
});
