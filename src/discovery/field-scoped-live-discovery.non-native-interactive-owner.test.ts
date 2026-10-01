import assert from "node:assert/strict";
import test from "node:test";
import { extractFieldScopedDomEvidence, type FieldScopedDomElement, type FieldScopedDomRoot } from "./field-scoped-live-discovery";

/**
 * FIRST_LOSS fix: a real click owner is often a role-less, attribute-less container div whose
 * click handler is attached via a framework's synthetic event system (e.g. React's onClick),
 * which never sets `el.onclick`, an "onclick" DOM attribute, or an ARIA role -- `isOwnerCandidate`/
 * `isOwnerActionable` previously never recognized it at all, so `field-scoped-fallback` certified
 * a narrower, genuinely-native descendant (e.g. a real `<button>`) that had no navigation handler
 * of its own. Same discipline already used by `frameworkActionable`/`isActionableNode` in the
 * browser-instrumentation capture script: `cursor:pointer` styling ALONE is never sufficient
 * (a whole page section can carry that incidentally) -- only accepted together with a real,
 * same-node click-provenance signal (inline onclick handler/attribute, native tabIndex, or a
 * stable technical identity of its own).
 */

class FakeElement implements FieldScopedDomElement {
  tagName: string;
  id: string;
  textContent: string | null;
  children: FieldScopedDomElement[] = [];
  parentElement: FieldScopedDomElement | null = null;
  disabled?: boolean;
  hidden?: boolean;
  onclick?: () => void;
  tabIndex?: number;
  cursor?: string;
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
  return { body, getElementById: (id) => findById(body, id) };
}

// Real elements expose computed cursor via `window.getComputedStyle`; this module runs both in a
// real browser (where that global is native) and here in Node -- stub it the same way the
// browser-instrumentation capture script's own tests stub `window` for a fake computed style.
(globalThis as unknown as { window: unknown }).window = {
  getComputedStyle: (el: FakeElement) => ({ cursor: el.cursor ?? "auto" }),
};

test("1/nonNativeInteractiveOwnerRecognized. a role-less div with cursor:pointer AND a real click-provenance signal (inline onclick) is now recognized as an actionable owner candidate", () => {
  const clickableDiv = new FakeElement("div", {});
  clickableDiv.cursor = "pointer";
  clickableDiv.onclick = () => {};
  const label = new FakeElement("span", {}, "Tarjeta Ejemplo");
  clickableDiv.append(label);
  const root = new FakeElement("section", { "data-stable": "page-section" }).append(clickableDiv);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Tarjeta Ejemplo", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, true);
  const actionableCandidates = evidence?.candidates.filter((c) => c.actionable === true) ?? [];
  assert.equal(actionableCandidates.length, 1, "the role-less clickable div itself must be recognized as actionable");
});

test("2/cursorPointerAloneNeverEnough. a role-less div with cursor:pointer but NO click-provenance signal stays rejected", () => {
  const div = new FakeElement("div", {});
  div.cursor = "pointer";
  const label = new FakeElement("span", {}, "Tarjeta Ejemplo");
  div.append(label);
  const root = new FakeElement("section", { "data-stable": "page-section" }).append(div);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Tarjeta Ejemplo", "actionable");
  const actionableCandidates = evidence?.candidates.filter((c) => c.actionable === true) ?? [];
  assert.equal(actionableCandidates.length, 0, "cursor:pointer alone must never certify an owner");
});

test("3/technicalRefWithoutOnclickStillQualifies. a role-less div with cursor:pointer plus a stable id (no onclick/tabIndex) still qualifies", () => {
  const div = new FakeElement("div", { id: "card-owner" });
  div.cursor = "pointer";
  const label = new FakeElement("span", {}, "Tarjeta Ejemplo");
  div.append(label);
  const root = new FakeElement("section", { "data-stable": "page-section" }).append(div);

  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "Tarjeta Ejemplo", "actionable");
  const actionableCandidates = evidence?.candidates.filter((c) => c.actionable === true) ?? [];
  assert.equal(actionableCandidates.length, 1);
});
