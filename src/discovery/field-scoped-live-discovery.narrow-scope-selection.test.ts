import assert from "node:assert/strict";
import test from "node:test";
import { extractFieldScopedDomEvidence, type FieldScopedDomElement, type FieldScopedDomRoot } from "./field-scoped-live-discovery";

/**
 * FIRST_LOSS (real physical evidence, recording 52849d4b-bfa5-4842-850a-a43e6460dcaf, job
 * e203d1b6-812f-4ca4-83b4-356df8539b95): the field-scope container search correctly found the
 * anchor, the ancestor chain, and a container -- but the acceptance rule ("must have a stable
 * attribute") skipped straight past the field's own narrow, unattributed wrapper (containing
 * exactly one real input) and climbed all the way to a broad, stable page section containing 6+
 * unrelated editable controls. `materializerResult` was therefore always `ambiguous`
 * (`materializerCandidateCount=9`, `materializerCompatibleCount=6`, growing as the page kept
 * loading more of its own unrelated fields).
 *
 * FIELD SCOPE is now selected independently of certification identity: climbing from the anchor,
 * the FIRST ancestor whose subtree contains EXACTLY ONE candidate compatible with the requested
 * action intent (editable for fill, actionable for click) is the scope -- regardless of whether
 * it carries a stable attribute. A SEPARATE, later climb from that scope looks for the nearest
 * stable ancestor purely for certification identity (`FieldContainerEvidence`), which may be the
 * scope itself or something broader; when broader, `textAnchor` (the field's own known, recorded
 * name) disambiguates the resulting CSS from unrelated sibling fields the broader ancestor also
 * contains -- never positional, never invented.
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

function otherField(name: string, inputCount = 1): FakeElement {
  const span = new FakeElement("span", {}, name);
  const inputs = Array.from({ length: inputCount }, () => new FakeElement("input", {}));
  return new FakeElement("div", { class: "other-field" } as any).append(span, ...inputs);
}

/** The exact fixture shape described in the ticket's own "TEST PRINCIPAL" section. */
function buildTicketFixture(): { root: FakeElement; input: FakeElement; button: FakeElement } {
  const span = new FakeElement("span", {}, "FIELD");
  const label = new FakeElement("label", {}).append(span);
  const input = new FakeElement("input", {});
  const button = new FakeElement("button", {});
  const innerRow = new FakeElement("div", {}).append(input, button);
  const fieldWrapper = new FakeElement("div", {}).append(label, innerRow); // NO stable attrs anywhere
  const root = new FakeElement("section", { "data-stable": "large-container" })
    .append(otherField("OTHER A"), fieldWrapper, otherField("OTHER B", 9));
  return { root, input, button };
}

test("1/narrowNoStable. the narrow wrapper with exactly one fill-compatible input is accepted as scope, even without any stable attribute", () => {
  const { root } = buildTicketFixture();
  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "FIELD", "editable");
  assert.ok(evidence, "expected evidence");
  assert.equal(evidence!.diagnostics.containerAccepted, true);
  // `candidates` is the full owner pool WITHIN the accepted scope (button included) --
  // compatibility filtering is the materializer's job downstream. The scope-selection
  // invariant this ticket fixes is that EXACTLY ONE of them is fill-compatible.
  assert.equal(evidence!.candidates.filter((c) => c.editable).length, 1, "the button must never count as fill-compatible");
  assert.ok(evidence!.candidates.some((c) => c.tag === "input" && c.editable));
});

test("2/inputPlusButton. for actionIntent=fill, the sibling icon button is observed but never counted as fill-compatible", () => {
  const { root } = buildTicketFixture();
  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "FIELD", "editable");
  assert.equal(evidence?.candidates.filter((c) => c.editable).length, 1);
  assert.ok(evidence?.candidates.some((c) => c.tag === "button" && !c.editable), "the button is observed inside the scope but never editable");
});

test("3/outerStableManyInputs. the outer stable section (9+ unrelated inputs) is never selected as scope when a narrower unique scope exists", () => {
  const { root } = buildTicketFixture();
  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "FIELD", "editable");
  assert.equal(evidence?.candidates.filter((c) => c.editable).length, 1, "must never include the unrelated OTHER A / OTHER B inputs");
});

test("4/disabled. a local disabled input still resolves the scope -- relation preserved, executability is a separate concern", () => {
  const span = new FakeElement("span", {}, "FIELD");
  const label = new FakeElement("label", {}).append(span);
  const input = new FakeElement("input", {});
  input.disabled = true;
  const fieldWrapper = new FakeElement("div", {}).append(label, input);
  const root = new FakeElement("section", { "data-stable": "large-container" }).append(fieldWrapper);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "FIELD", "editable");
  assert.equal(evidence?.diagnostics.containerAccepted, true, "the relation must resolve even while the control is disabled");
  assert.equal(evidence?.candidates.length, 1);
  assert.equal(evidence?.candidates[0].disabled, true, "reported disabled, never silently dropped");
});

test("5/disabledThenEnabled. a fresh re-extraction after the SAME input becomes enabled reports it enabled, from the SAME structural scope", () => {
  const span = new FakeElement("span", {}, "FIELD");
  const label = new FakeElement("label", {}).append(span);
  const input = new FakeElement("input", {});
  input.disabled = true;
  const fieldWrapper = new FakeElement("div", {}).append(label, input);
  const root = new FakeElement("section", { "data-stable": "large-container" }).append(fieldWrapper);

  const before = extractFieldScopedDomEvidence(fakeRoot(root), "FIELD", "editable");
  assert.equal(before?.candidates[0].disabled, true);

  input.disabled = false; // the DOM changes in place -- no caching, a fresh call must reflect it
  const after = extractFieldScopedDomEvidence(fakeRoot(root), "FIELD", "editable");
  assert.equal(after?.candidates[0].disabled, false);
  assert.equal(after?.diagnostics.containerAccepted, true);
});

test("6/localAmbiguous. a local wrapper with TWO fill-compatible inputs is ambiguous at that scope -- never silently widened, never guessed", () => {
  const span = new FakeElement("span", {}, "FIELD");
  const label = new FakeElement("label", {}).append(span);
  const inputA = new FakeElement("input", {});
  const inputB = new FakeElement("input", {});
  const fieldWrapper = new FakeElement("div", {}).append(label, inputA, inputB);
  const root = new FakeElement("section", { "data-stable": "large-container" }).append(fieldWrapper);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "FIELD", "editable");
  assert.equal(evidence?.container, undefined);
  assert.equal(evidence?.diagnostics.containerAccepted, false);
  assert.equal(evidence?.diagnostics.rejectReason, "scope_ambiguous");
});

test("7/zeroThenClimb. a wrapper with ZERO local candidates keeps climbing until a level with exactly one is found", () => {
  const span = new FakeElement("span", {}, "FIELD");
  const label = new FakeElement("label", {}).append(span); // label alone: zero owner candidates
  const emptyWrapper = new FakeElement("div", {}).append(label); // still zero
  const input = new FakeElement("input", {});
  const outerWrapper = new FakeElement("div", {}).append(emptyWrapper, input); // exactly one, here
  const root = new FakeElement("section", { "data-stable": "s" }).append(outerWrapper);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "FIELD", "editable");
  assert.equal(evidence?.diagnostics.containerAccepted, true);
  assert.equal(evidence?.diagnostics.ancestorTrace.length, 3, "label -> emptyWrapper -> outerWrapper");
  assert.deepEqual(evidence?.diagnostics.ancestorTrace.map((s) => s.scopeDecision), ["continue", "continue", "accepted"]);
});

test("8/duplicateLabels. the SAME field name appearing in a different, unrelated section never becomes a false global winner", () => {
  const { root } = buildTicketFixture();
  // Plant a decoy field with the identical name "FIELD" far away, with its OWN unique input --
  // multiproject-safe (arbitrary duplicate names), never resolved via global text search alone.
  const decoySpan = new FakeElement("span", {}, "FIELD");
  const decoyLabel = new FakeElement("label", {}).append(decoySpan);
  const decoyInput = new FakeElement("input", {});
  const decoyWrapper = new FakeElement("div", {}).append(decoyLabel, decoyInput);
  root.append(decoyWrapper);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "FIELD", "editable");
  // Exactly one fill-compatible candidate is still returned, scoped to the FIRST matching
  // anchor's own scope -- the extractor never merges or picks among multiple textual matches
  // arbitrarily, and the decoy's own input never leaks into this scope's candidate pool.
  assert.equal(evidence?.candidates.filter((c) => c.editable).length, 1);
});

test("9/certifiedFillRegression. an already-id-bearing narrow scope is unaffected -- certification uses its OWN attributes, no textAnchor needed", () => {
  const span = new FakeElement("span", {}, "Identificado");
  const label = new FakeElement("label", {}).append(span);
  const input = new FakeElement("input", { id: "doc-input" });
  const wrapper = new FakeElement("div", { id: "field-identificado" }).append(label, input);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(wrapper), "Identificado", "editable");
  assert.equal(evidence?.container?.stableDirectAttributes?.id, "field-identificado");
  assert.equal(evidence?.container?.textAnchor, undefined, "the scope IS the certification ancestor here -- no disambiguator needed");
});

test("10/labelForRegression. label[for] + unnamed input inside an id-bearing container: unaffected by the field-scope rewrite", () => {
  const input = new FakeElement("input", { id: "doc-number-input" });
  const label = new FakeElement("label", { for: "doc-number-input" }, "Identificación");
  const container = new FakeElement("div", { id: "field-identificacion" }).append(label, input);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(container), "Identificación", "editable");
  assert.equal(evidence?.container?.stableDirectAttributes?.id, "field-identificacion");
  assert.equal(evidence?.candidates.length, 1);
});

test("11/ariaRegression. aria-labelledby relation is unaffected by the field-scope rewrite", () => {
  const labelNode = new FakeElement("span", { id: "lbl-1" }, "Correo");
  const input = new FakeElement("input", { id: "email-input", "aria-labelledby": "lbl-1" });
  const container = new FakeElement("div", { id: "field-email" }).append(labelNode, input);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(container), "Correo", "editable");
  assert.equal(evidence?.candidates.length, 1);
  assert.equal(evidence?.candidates[0].stableDirectAttributes?.id, "email-input");
});

test("13/clickRegression. actionIntent=click scopes on actionable candidates instead -- a sibling input never competes with a button target", () => {
  const span = new FakeElement("span", {}, "FIELD");
  const label = new FakeElement("label", {}).append(span);
  const input = new FakeElement("input", {});
  const button = new FakeElement("button", {});
  const fieldWrapper = new FakeElement("div", {}).append(label, input, button);
  const root = new FakeElement("section", { "data-stable": "s" }).append(fieldWrapper);
  const evidence = extractFieldScopedDomEvidence(fakeRoot(root), "FIELD", "actionable");
  assert.equal(evidence?.diagnostics.containerAccepted, true);
  assert.equal(evidence?.candidates.filter((c) => c.actionable).length, 1);
  assert.ok(evidence?.candidates.some((c) => c.tag === "button" && c.actionable));
  assert.ok(evidence?.candidates.some((c) => c.tag === "input" && !c.actionable), "the input must never count as actionable for a click intent");
});

test("15/noPosition. reordering the other-field siblings never changes which candidate is found", () => {
  const build = (reorder: boolean) => {
    const span = new FakeElement("span", {}, "FIELD");
    const label = new FakeElement("label", {}).append(span);
    const input = new FakeElement("input", { id: "target-input" });
    const fieldWrapper = new FakeElement("div", {}).append(label, input);
    const siblings = reorder
      ? [otherField("Z"), fieldWrapper, otherField("A")]
      : [otherField("A"), fieldWrapper, otherField("Z")];
    return new FakeElement("section", { "data-stable": "s" }).append(...siblings);
  };
  const e1 = extractFieldScopedDomEvidence(fakeRoot(build(false)), "FIELD", "editable");
  const e2 = extractFieldScopedDomEvidence(fakeRoot(build(true)), "FIELD", "editable");
  assert.equal(e1?.candidates[0]?.stableDirectAttributes?.id, "target-input");
  assert.equal(e2?.candidates[0]?.stableDirectAttributes?.id, "target-input");
});

test("17/multiproject. the narrow-scope-selection fix generalizes to an arbitrary field name -- no app/business hardcode", () => {
  for (const field of ["Campo Totalmente Arbitrario", "Otro Campo Distinto"]) {
    const span = new FakeElement("span", {}, field);
    const label = new FakeElement("label", {}).append(span);
    const input = new FakeElement("input", {});
    const fieldWrapper = new FakeElement("div", {}).append(label, input);
    const root = new FakeElement("section", { "data-stable": "s" }).append(otherField("OTHER"), fieldWrapper);
    const evidence = extractFieldScopedDomEvidence(fakeRoot(root), field, "editable");
    assert.equal(evidence?.candidates.length, 1, `expected resolution for field=${field}`);
  }
});
