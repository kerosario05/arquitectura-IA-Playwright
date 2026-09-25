import assert from "node:assert/strict";
import test from "node:test";
import { extractFieldScopedDomEvidence, type FieldScopedDomElement, type FieldScopedDomRoot } from "./field-scoped-live-discovery";
import { materializeFieldScopedTechnicalTarget } from "../automations/technical-target-materializer";

/**
 * FIRST_LOSS (jobId ed54dc9a-71bf-4347-b299-f45bb4088526): a unique text anchor `<h3>` whose direct
 * containing element is itself the actionable owner (`<button>`) was never considered, because
 * `scopeCandidateStats`/the candidate pool only walked DESCENDANTS (`walkAll` visits `node.children`
 * but never `node`). At depth=0 the button reported 0 compatible candidates, so the climb ascended
 * to the parent `<div>` where two sibling buttons appeared -> `action_owner_ambiguous` ->
 * `field_container_not_resolved`. The scope node itself is now included under the SAME owner/
 * compatibility predicates (without changing `walkAll`'s semantics), and a self-owner scope makes
 * the exact node the runtime target instead of a descendant of itself.
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
  getAttribute(name: string): string | null { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  getAttributeNames(): string[] { return Object.keys(this.attrs); }
  setAttribute(name: string, value: string): void { this.attrs[name] = value; }
  append(...children: FakeElement[]): this { for (const child of children) { child.parentElement = this; this.children.push(child); } return this; }
}

function fakeRoot(body: FakeElement): FieldScopedDomRoot {
  function findById(node: FieldScopedDomElement, id: string): FieldScopedDomElement | null {
    if (node.id === id) return node;
    for (let i = 0; i < node.children.length; i++) { const found = findById(node.children[i], id); if (found) return found; }
    return null;
  }
  return { body, getElementById: (id: string) => findById(body, id) };
}

/** unique anchor h3 -> direct parent button (the actionable owner) inside a wrapper div. */
function selfOwnerFixture() {
  const anchor = new FakeElement("h3", {}, "Field");
  const button = new FakeElement("button", {}).append(anchor);
  const wrapper = new FakeElement("div", {}).append(button);
  const body = new FakeElement("body", {}).append(wrapper);
  return { body, button, wrapper };
}

test("1/selfOwnerAccepted. the unique anchor's direct containing actionable button is accepted at depth=0", () => {
  const { body, button } = selfOwnerFixture();
  const evidence = extractFieldScopedDomEvidence(fakeRoot(body), "Field", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, true);
  assert.equal(evidence?.diagnostics.ancestorTrace[0]?.tag, "button", "the climb stops at the button (depth 0), never ascending");
  assert.equal(evidence?.diagnostics.ancestorTrace[0]?.compatibleCandidateCount, 1, "self button counted as the single compatible candidate");
  assert.equal(evidence?.scopeContainer?.selfOwner, true);
  assert.equal(evidence?.scopeContainer?.tag, "button");
  assert.equal(evidence?.scopeContainer?.acceptedScopeRuntimeMarker !== undefined, true);
  assert.equal((button as unknown as { getAttribute(n: string): string | null }).getAttribute("data-codex-accepted-field-scope"), evidence?.scopeContainer?.acceptedScopeRuntimeMarker);
});

test("2/candidatePoolIncludesSelf. the accepted scope being the button yields a pool containing exactly that same button", () => {
  const { body, button } = selfOwnerFixture();
  const evidence = extractFieldScopedDomEvidence(fakeRoot(body), "Field", "actionable");
  assert.equal(evidence?.candidates.length, 1);
  assert.equal(evidence?.candidates[0]?.tag, "button");
  assert.equal(evidence?.candidates[0]?.actionable, true);
  assert.equal(evidence?.scopeContainer?.selfOwner, true, "the pool is never empty for a self-owner scope");
  assert.ok(button);
});

test("3/parentAmbiguityAvoided. a parent div with two sibling buttons never competes once the self button is accepted", () => {
  const anchor = new FakeElement("h3", {}, "Field");
  const selfButton = new FakeElement("button", {}).append(anchor);
  const siblingButton = new FakeElement("button", {}, "Other");
  const wrapper = new FakeElement("div", {}).append(selfButton, siblingButton);
  const body = new FakeElement("body", {}).append(wrapper);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(body), "Field", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, true);
  assert.equal(evidence?.scopeContainer?.tag, "button");
  assert.equal(evidence?.diagnostics.ancestorTrace[0]?.compatibleCandidateCount, 1);
  assert.equal(evidence?.diagnostics.ancestorTrace.length, 1, "never ascends to the ambiguous parent div");
});

test("4/normalContainerRegression. a non-actionable container with one descendant owner is unchanged", () => {
  const label = new FakeElement("label", {}, "Field");
  const input = new FakeElement("input", { type: "text" });
  const wrapper = new FakeElement("div", {}).append(label, input);
  const body = new FakeElement("body", {}).append(wrapper);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(body), "Field", "editable");
  assert.equal(evidence?.diagnostics.containerAccepted, true);
  assert.equal(evidence?.scopeContainer?.tag, "div");
  assert.equal(evidence?.scopeContainer?.selfOwner, undefined, "a plain container is never a self-owner");
  assert.deepEqual(evidence?.candidates.map((candidate) => candidate.tag), ["input"]);
});

test("5/incompatibleSelfNotCounted. a self node incompatible with the intent is not counted; the climb continues to the real owner", () => {
  const anchor = new FakeElement("h3", {}, "Field");
  const selfButton = new FakeElement("button", {}).append(anchor); // actionable, NOT editable
  const input = new FakeElement("input", { type: "text" });
  const wrapper = new FakeElement("div", {}).append(selfButton, input);
  const body = new FakeElement("body", {}).append(wrapper);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(body), "Field", "editable");
  assert.equal(evidence?.diagnostics.containerAccepted, true);
  assert.equal(evidence?.scopeContainer?.tag, "div", "the incompatible self button is never accepted for an editable intent");
  assert.equal(evidence?.scopeContainer?.selfOwner, undefined);
});

test("6/selfPlusDescendantAmbiguous. a self owner AND a compatible descendant -> ambiguous, fail closed", () => {
  const anchor = new FakeElement("h3", {}, "Field");
  const innerButton = new FakeElement("button", {}, "Inner");
  const selfButton = new FakeElement("button", {}).append(anchor, innerButton);
  const body = new FakeElement("body", {}).append(selfButton);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(body), "Field", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, false);
  assert.equal(evidence?.diagnostics.rejectReason, "scope_ambiguous");
  assert.equal(evidence?.scopeContainer, undefined);
});

test("7/ambiguousAnchorNoAuthority. a target with no unique anchor gains no new authority", () => {
  const { body } = selfOwnerFixture();
  const evidence = extractFieldScopedDomEvidence(fakeRoot(body), "Nonexistent Field", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, false);
  assert.equal(evidence?.diagnostics.anchorFound, false);
  assert.equal(evidence?.scopeContainer, undefined);
});

test("integration/selfOwnerMaterializes. extract -> materializer marks selfOwner and returns the exact-node marker locators", () => {
  const { body } = selfOwnerFixture();
  const evidence = extractFieldScopedDomEvidence(fakeRoot(body), "Field", "actionable");
  assert.ok(evidence?.scopeContainer);
  const materialized = materializeFieldScopedTechnicalTarget(
    { associatedField: "Field", candidates: evidence!.candidates, requiredCompatibility: "actionable", fieldContainerEvidence: evidence!.scopeContainer },
    { requireContainerScope: true },
  );
  assert.equal(materialized.status, "certified");
  if (materialized.status === "certified") {
    assert.equal((materialized as any).selfOwner, true);
    const marker = evidence!.scopeContainer!.acceptedScopeRuntimeMarker;
    assert.equal((materialized as any).scopeContainerLocator?.value, `[data-codex-accepted-field-scope="${marker}"]`);
    assert.deepEqual((materialized as any).scopedDescendantLocator, (materialized as any).scopeContainerLocator, "a self-owner target is the exact node, never a descendant of itself");
  }
});
