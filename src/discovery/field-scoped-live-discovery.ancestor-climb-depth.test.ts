import assert from "node:assert/strict";
import test from "node:test";
import { extractFieldScopedDomEvidence, type FieldScopedDomElement, type FieldScopedDomRoot } from "./field-scoped-live-discovery";

/**
 * FIRST_LOSS (real physical evidence: job 895ad0cc-60a0-4d29-8873-69c8feb7e3ab, recording
 * 52849d4b-bfa5-4842-850a-a43e6460dcaf): even after the prior ticket's fix (a generic leaf-text
 * anchor mechanism), the live resolver reported `field_container_not_resolved` on EVERY one of
 * 48 polls over ~20.9s -- confirming the fix did not close the real gap. `MAX_CONTAINER_CLIMB`
 * was bounded at 6 ancestor hops; component-based UI libraries commonly nest field markup
 * (grid > column > field-group > label-wrapper > control) considerably deeper than that in a
 * real, generic (never app-specific) way. Raised to a still-bounded 12, with new diagnostics
 * (`FieldScopedDiagnostics`) so a future physical run can directly confirm the exact depth
 * reached and where the climb stopped, rather than inferring it.
 *
 * This fix could not be independently confirmed against a live browser in this ticket (no
 * browser real) -- these tests prove the code-level claim: a field wrapper nested deeper than
 * the OLD bound (6) but within the NEW bound (12) now resolves, the diagnostics correctly report
 * ancestor depth/tags/stable-attribute presence at every level inspected, and the climb still
 * fails closed (never invents a container) beyond the new bound.
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

/** Wraps a leaf span + input pair inside `depth` layers of plain, unattributed <div>s before
 *  reaching the id-bearing wrapper -- simulating a component library's real nesting depth. */
function nestedFieldWrapper(depth: number) {
  const span = new FakeElement("span", {}, "Número de identificación");
  const input = new FakeElement("input", {});
  let node: FakeElement = new FakeElement("div", {}).append(span, input);
  for (let i = 0; i < depth; i++) {
    node = new FakeElement("div", {}).append(node);
  }
  const wrapper = new FakeElement("div", { id: "pv_id_20" }).append(node);
  return { wrapper, span, input };
}

test("1/realRuntimeShape. a field nested past the OLD 6-hop bound but within the NEW 12-hop bound now resolves", () => {
  const { wrapper } = nestedFieldWrapper(8); // span/input at depth 9 from the id-bearing wrapper
  const evidence = extractFieldScopedDomEvidence(fakeRoot(wrapper), "Número de identificación");
  assert.ok(evidence?.container, "expected the deeper climb to reach the id-bearing wrapper");
  assert.equal(evidence!.container!.stableDirectAttributes?.id, "pv_id_20");
  assert.equal(evidence!.diagnostics.containerAccepted, true);
});

test("2/ancestorTrace (superseded by field-scope selection). the scope-selection trace reports depth 0 accepted immediately -- structural uniqueness, not stable-attribute presence, decides scope now", () => {
  // FIRST_LOSS fix (field-scope selection ticket): the span/input pair is co-located in the
  // SAME innermost wrapper regardless of how many plain, unattributed divs wrap it above --
  // `ancestorTrace` now tracks the SCOPE climb (candidate-count based), which finds its answer
  // immediately at depth 0, independent of how deep the id-bearing ancestor happens to be. The
  // separate CERTIFICATION climb (untraced, by design -- see the ticket's own logging scope)
  // still correctly reaches the id-bearing wrapper, proven via `container` below.
  const { wrapper } = nestedFieldWrapper(3);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(wrapper), "Número de identificación");
  assert.ok(evidence?.diagnostics);
  const trace = evidence!.diagnostics.ancestorTrace;
  assert.equal(trace.length, 1, "scope is accepted at the very first ancestor -- the input is already unique there");
  assert.equal(trace[0].depth, 0);
  assert.equal(trace[0].scopeDecision, "accepted");
  assert.equal(trace[0].compatibleCandidateCount, 1);
  assert.equal(trace[0].hasStableAttribute, false, "the accepted scope itself has no stable attribute -- that is exactly the point");
  assert.equal(evidence!.container?.stableDirectAttributes?.id, "pv_id_20", "certification still separately reaches the id-bearing ancestor");
  assert.equal(evidence!.container?.textAnchor, "Número de identificación", "a broader certification ancestor than the scope carries the text-anchor disambiguator");
});

test("3/beyondNewBound. scope still resolves regardless of depth; when NO stable ancestor exists within the bound, the accepted SCOPE itself becomes the (weaker, textAnchor-backed) container -- never undefined, never a guess", () => {
  // FIRST_LOSS fix (superseded, field-scope runtime-uniqueness ticket): SCOPE acceptance no
  // longer depends on climb depth at all (see test 2) -- the only thing still bounded by
  // MAX_CONTAINER_CLIMB is the SEPARATE stable-attribute certification climb. Nesting the
  // id-bearing wrapper 21 levels above the scope (`nestedFieldWrapper(20)`) exceeds that bound,
  // so the STABLE-ATTRIBUTE certification path correctly fails to find anything -- but the scope
  // itself was already proven unique/compatible/anchor-related by `findFieldScope`'s own rules,
  // and that authority is real regardless of tag or attributes, so it becomes the container
  // (`fromAcceptedFieldScope: true`, textAnchor attached) instead of leaving nothing at all.
  const { wrapper } = nestedFieldWrapper(20);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(wrapper), "Número de identificación");
  assert.equal(evidence?.diagnostics.containerAccepted, true, "the scope itself is found immediately, independent of the id-bearing ancestor's depth");
  assert.ok(evidence?.container, "the accepted scope itself now becomes the fallback container");
  assert.equal(evidence!.container!.fromAcceptedFieldScope, true);
  assert.equal(evidence!.container!.stableDirectAttributes, undefined, "never fabricates a stable attribute the scope does not have");
  assert.equal(evidence!.container!.textAnchor, "Número de identificación");
  assert.equal(evidence?.candidates.length, 1);
  assert.equal(evidence?.diagnostics.anchorFound, true);
});

test("4/ownVsDescendantText. leafAnchorMatchCount reflects the real leaf, never a non-leaf aggregate-text false positive", () => {
  const { wrapper } = nestedFieldWrapper(2);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(wrapper), "Número de identificación");
  assert.ok(evidence?.diagnostics);
  assert.equal(evidence!.diagnostics.leafAnchorMatchCount, 1);
  assert.equal(evidence!.diagnostics.textAnchorMatchCount, 1);
  assert.equal(evidence!.diagnostics.anchorTag, "span");
});

test("5/nestedLabelSpan. a visual label wrapped one extra element deep (e.g. an inner text-only wrapper) is still found as the leaf anchor", () => {
  const innerSpan = new FakeElement("span", {}, "Número de identificación");
  const outerSpan = new FakeElement("span", {}).append(innerSpan); // NOT itself a leaf -- has one element child
  const input = new FakeElement("input", {});
  const wrapper = new FakeElement("div", { id: "pv_id_20" }).append(outerSpan, input);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(wrapper), "Número de identificación");
  assert.ok(evidence?.container, "the INNER leaf span must still anchor correctly even though it is nested inside a non-leaf outer span");
  assert.equal(evidence!.diagnostics.anchorTag, "span");
  assert.equal(evidence!.diagnostics.leafAnchorMatchCount, 1);
});

test("6/disabledThenEnabledDeepField. a deeply-nested field's disabled input is still reported (relation retained), never discarded", () => {
  const { wrapper, input } = nestedFieldWrapper(7);
  input.disabled = true;
  const evidence = extractFieldScopedDomEvidence(fakeRoot(wrapper), "Número de identificación");
  assert.ok(evidence?.container);
  assert.equal(evidence!.candidates.length, 1);
  assert.equal(evidence!.candidates[0].disabled, true);
});

test("7/multiproject. the depth fix and diagnostics generalize to an arbitrary field/depth pair -- no app hardcode", () => {
  for (const [field, depth] of [["Campo Arbitrario Profundo", 5], ["Otro Campo Anidado", 9]] as const) {
    const span = new FakeElement("span", {}, field);
    const input = new FakeElement("input", {});
    let node: FakeElement = new FakeElement("div", {}).append(span, input);
    for (let i = 0; i < depth; i++) node = new FakeElement("div", {}).append(node);
    const wrapper = new FakeElement("div", { id: "any-wrapper" }).append(node);
    const evidence = extractFieldScopedDomEvidence(fakeRoot(wrapper), field);
    assert.ok(evidence?.container, `expected resolution for field=${field} depth=${depth}`);
  }
});
