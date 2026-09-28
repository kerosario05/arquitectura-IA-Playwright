import assert from "node:assert/strict";
import test from "node:test";
import { extractFieldScopedDomEvidence, type FieldScopedDomElement, type FieldScopedDomRoot } from "./field-scoped-live-discovery";

/**
 * FIRST_LOSS (run 354fe8f4-6108-4fc5-b3d8-d2c12c25637a, recording cd227d7b, kiosko step 4
 * `Presionar "Tarjeta Crédito Visa Clásica"`): the product card is a plain <div> with a React
 * onClick and no <button> inside. The climb saw 0 actionable candidates on the card and on the
 * card grid, then accepted the page wrapper (depth=2) whose only button was "Volver" -- which was
 * clicked, and the app navigated back instead of opening the product.
 *
 * The DOM below mirrors the shape inspected on the live page:
 *   main > div > div(wrapper) > [ div(grid) > div(card, onclick) > [div, h3], button "Volver" ]
 */

class FakeElement implements FieldScopedDomElement {
  tagName: string;
  id: string;
  textContent: string | null;
  children: FieldScopedDomElement[] = [];
  parentElement: FieldScopedDomElement | null = null;
  disabled?: boolean;
  hidden?: boolean;
  onclick?: unknown;
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

const TARGET = "Tarjeta Crédito Visa Clásica";

function card(title: string, options: { clickable: boolean; innerButton?: string }): FakeElement {
  const el = new FakeElement("div").append(new FakeElement("div"), new FakeElement("h3", {}, title));
  if (options.innerButton) el.append(new FakeElement("button", {}, options.innerButton));
  if (options.clickable) el.onclick = () => undefined;
  return el;
}

function productPage(options: { clickableCards: boolean; innerButton?: string }) {
  const target = card(TARGET, { clickable: options.clickableCards, innerButton: options.innerButton });
  const grid = new FakeElement("div").append(
    target,
    card("Tarjeta Crédito Visa Gold", { clickable: options.clickableCards }),
    card("Tarjeta Multicrédito", { clickable: options.clickableCards }),
  );
  const wrapper = new FakeElement("div").append(grid, new FakeElement("button", {}, "Volver"));
  const main = new FakeElement("main").append(new FakeElement("div").append(wrapper));
  const body = new FakeElement("body").append(new FakeElement("button", { "aria-label": "" }), main);
  return { root: fakeRoot(body), target };
}

test("a card with its own click handler is the click owner -- 'Volver' is never reached", () => {
  const { root, target } = productPage({ clickableCards: true });
  const evidence = extractFieldScopedDomEvidence(root, TARGET, "actionable");

  assert.ok(evidence);
  assert.equal(evidence.diagnostics.containerAccepted, true);
  assert.deepEqual(evidence.diagnostics.ancestorTrace.map((s) => s.scopeDecision), ["accepted"]);
  assert.equal(evidence.scopeContainer?.selfOwner, true);
  const actionable = evidence.candidates.filter((c) => c.actionable);
  assert.equal(actionable.length, 1);
  assert.equal(actionable[0].tag, "div");
  assert.ok(target.onclick);
});

test("without a detectable card handler, an unrelated 'Volver' two levels up is rejected, not clicked", () => {
  const { root } = productPage({ clickableCards: false });
  const evidence = extractFieldScopedDomEvidence(root, TARGET, "actionable");

  assert.ok(evidence);
  assert.equal(evidence.diagnostics.containerAccepted, false);
  assert.equal(evidence.diagnostics.rejectReason, "unrelated_owner");
  assert.deepEqual(
    evidence.diagnostics.ancestorTrace.map((s) => s.scopeDecision),
    ["continue", "continue", "unrelated_owner"],
  );
  assert.deepEqual(evidence.candidates, []);
});

test("a real button inside the clickable card still wins over the card's own handler", () => {
  const { root } = productPage({ clickableCards: true, innerButton: "Solicitar" });
  const evidence = extractFieldScopedDomEvidence(root, TARGET, "actionable");

  assert.ok(evidence);
  assert.equal(evidence.diagnostics.containerAccepted, true);
  assert.notEqual(evidence.scopeContainer?.selfOwner, true);
  const actionable = evidence.candidates.filter((c) => c.actionable);
  assert.equal(actionable.length, 1);
  assert.equal(actionable[0].tag, "button");
});

test("a differently named button close to the anchor (same item) is still accepted", () => {
  const { root } = productPage({ clickableCards: false, innerButton: "Solicitar" });
  const evidence = extractFieldScopedDomEvidence(root, TARGET, "actionable");

  assert.ok(evidence);
  assert.equal(evidence.diagnostics.containerAccepted, true);
  assert.deepEqual(evidence.diagnostics.ancestorTrace.map((s) => s.scopeDecision), ["accepted"]);
});

test("an unlabeled icon button far from the anchor keeps the existing structural behavior", () => {
  const h3 = new FakeElement("h3", {}, TARGET);
  const wrapper = new FakeElement("div").append(
    new FakeElement("div").append(new FakeElement("div").append(h3)),
    new FakeElement("button", {}),
  );
  const evidence = extractFieldScopedDomEvidence(fakeRoot(new FakeElement("body").append(wrapper)), TARGET, "actionable");

  assert.ok(evidence);
  assert.equal(evidence.diagnostics.containerAccepted, true);
  assert.deepEqual(evidence.diagnostics.ancestorTrace.map((s) => s.scopeDecision), ["continue", "continue", "accepted"]);
});

test("a click handler never turns a container into an owner for a fill", () => {
  const span = new FakeElement("span", {}, "Número de identificación");
  const field = new FakeElement("div").append(span);
  field.onclick = () => undefined;
  const section = new FakeElement("section").append(field, new FakeElement("input", {}));
  const evidence = extractFieldScopedDomEvidence(fakeRoot(new FakeElement("body").append(section)), "Número de identificación", "editable");

  assert.ok(evidence);
  assert.equal(evidence.scopeContainer?.selfOwner, undefined);
  assert.deepEqual(evidence.candidates.map((c) => c.tag), ["input"]);
});
