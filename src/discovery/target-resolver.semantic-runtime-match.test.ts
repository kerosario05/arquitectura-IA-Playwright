import assert from "node:assert/strict";
import test from "node:test";
import { matchSemanticRuntimeCandidate } from "./target-resolver";

/**
 * DEFINITIVE FIX (recordingId=e224287e-...): `matchSemanticRuntimeCandidate` is the in-page
 * matcher `resolveSemanticRuntimeTarget` serializes via `Locator.evaluate` -- within a scope
 * element, keeps only VISIBLE elements of the recorded tag whose normalized accessible
 * name/visible text equals the recorded value. 0/>1 matches return that count and mark nothing;
 * exactly 1 match is tagged with the caller's shared marker attribute. Never nth/first/last/index.
 */

function fakeDomNode(opts: { tag: string; text?: string; ariaLabel?: string; width?: number; height?: number }) {
  const node: any = {
    tagName: opts.tag.toUpperCase(),
    textContent: opts.text ?? "",
    attributes: {} as Record<string, string>,
    getAttribute(name: string) {
      if (name === "aria-label") return opts.ariaLabel ?? null;
      return this.attributes[name] ?? null;
    },
    setAttribute(name: string, value: string) { this.attributes[name] = value; },
    getBoundingClientRect() { return { width: opts.width ?? 10, height: opts.height ?? 10 }; },
  };
  return node;
}

function fakeScope(candidates: any[]) {
  return {
    querySelectorAll: (selector: string) =>
      selector === "*" ? candidates : candidates.filter((node) => node.tagName.toLowerCase() === selector.toLowerCase()),
  } as unknown as Element;
}

test("1/uniqueMatch. exactly one visible candidate with the recorded value -> marked, returns 1", () => {
  const target = fakeDomNode({ tag: "div", text: "SMS" });
  const decoy = fakeDomNode({ tag: "div", text: "Correo" });
  const scope = fakeScope([target, decoy]);
  const result = matchSemanticRuntimeCandidate(scope, { tag: "div", value: "SMS", attributeName: "data-marker", markerValue: "m1" });
  assert.equal(result, 1);
  assert.equal(target.attributes["data-marker"], "m1");
  assert.equal(decoy.attributes["data-marker"], undefined);
});

test("2/zeroMatch. no candidate has the recorded value -> returns 0, marks nothing", () => {
  const decoy = fakeDomNode({ tag: "div", text: "Correo" });
  const scope = fakeScope([decoy]);
  const result = matchSemanticRuntimeCandidate(scope, { tag: "div", value: "SMS", attributeName: "data-marker", markerValue: "m1" });
  assert.equal(result, 0);
  assert.equal(decoy.attributes["data-marker"], undefined);
});

test("3/ambiguousMatch. two candidates share the recorded value -> returns 2, marks nothing (never picks one arbitrarily)", () => {
  const a = fakeDomNode({ tag: "div", text: "SMS" });
  const b = fakeDomNode({ tag: "div", text: "SMS" });
  const scope = fakeScope([a, b]);
  const result = matchSemanticRuntimeCandidate(scope, { tag: "div", value: "SMS", attributeName: "data-marker", markerValue: "m1" });
  assert.equal(result, 2);
  assert.equal(a.attributes["data-marker"], undefined);
  assert.equal(b.attributes["data-marker"], undefined);
});

test("4/hiddenExcluded. a hidden (zero-rect) duplicate never inflates the match count", () => {
  const visible = fakeDomNode({ tag: "div", text: "SMS" });
  const hidden = fakeDomNode({ tag: "div", text: "SMS", width: 0, height: 0 });
  const scope = fakeScope([visible, hidden]);
  const result = matchSemanticRuntimeCandidate(scope, { tag: "div", value: "SMS", attributeName: "data-marker", markerValue: "m1" });
  assert.equal(result, 1);
  assert.equal(visible.attributes["data-marker"], "m1");
});

test("5/ariaLabelPreferred. aria-label wins over textContent when both are present", () => {
  const el = fakeDomNode({ tag: "div", text: "raw text", ariaLabel: "SMS" });
  const scope = fakeScope([el]);
  const result = matchSemanticRuntimeCandidate(scope, { tag: "div", value: "SMS", attributeName: "data-marker", markerValue: "m1" });
  assert.equal(result, 1);
});

test("6/tagFiltered. a same-text element of a DIFFERENT tag is never counted as a candidate", () => {
  const wrongTag = fakeDomNode({ tag: "span", text: "SMS" });
  const scope = fakeScope([wrongTag]);
  const result = matchSemanticRuntimeCandidate(scope, { tag: "div", value: "SMS", attributeName: "data-marker", markerValue: "m1" });
  assert.equal(result, 0);
});
