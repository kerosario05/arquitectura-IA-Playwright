import assert from "node:assert/strict";
import test from "node:test";
import { buildCaptureScriptV2Content } from "./capture-engine-v2.browser-instrumentation";

/**
 * DEFINITIVE FIX (recordingId=e224287e-...): SemanticRuntimeEvidence, the LAST-RESORT,
 * EXECUTION-ONLY fallback for a click whose owner/structural/related-control authorities all
 * fail. Captured browser-side: the ORIGINAL clicked target's own dynamic accessible name/visible
 * text, proven unique within one or more already-discovered stable technical scopes. Never a
 * hardcode, never scenario.semanticField/step text, never a certified owner/technicalTarget.
 *
 * These tests execute the REAL generated V2 browser script (`new Function`), matching this
 * session's established real-execution harness (see `capture-engine-v2.click-structural-
 * evidence.test.ts`/`capture-engine-v2.related-control-diagnostic.test.ts`).
 */

type FakeEl = {
  nodeType: 1;
  tagName: string;
  id: string;
  disabled: boolean;
  textContent: string;
  children: FakeEl[];
  parentElement: FakeEl | null;
  attrs: Record<string, string>;
  getAttribute: (name: string) => string | null;
  getBoundingClientRect: () => { width: number; height: number };
  querySelectorAll: (selector: string) => FakeEl[];
  closest: (selector: string) => FakeEl | null;
  contains: (other: FakeEl) => boolean;
  isConnected: boolean;
  hidden: boolean;
  offsetWidth: number;
  offsetHeight: number;
  getClientRects: () => Array<{ width: number; height: number }>;
  computedStyle: { display?: string; visibility?: string; opacity?: string };
};

function matchesSimple(el: FakeEl, simple: string): boolean {
  const trimmed = simple.trim();
  if (trimmed === "*") return true;
  const attrMatch = trimmed.match(/^\[([a-z-]+)(?:([*^$])?=("([^"]*)"|'([^']*)'))?\]$/i);
  if (attrMatch) {
    const [, name, op, , dq, sq] = attrMatch;
    const value = el.attrs[name];
    if (value === undefined) return false;
    const expected = dq ?? sq;
    if (expected === undefined) return true;
    if (op === "*") return value.includes(expected);
    if (op === "^") return value.startsWith(expected);
    if (op === "$") return value.endsWith(expected);
    return value === expected;
  }
  return el.tagName.toLowerCase() === trimmed.toLowerCase();
}

function matches(el: FakeEl, selector: string): boolean {
  return selector.split(",").some((part) => matchesSimple(el, part.trim()));
}

function collectAll(root: FakeEl, out: FakeEl[] = []): FakeEl[] {
  for (const child of root.children) {
    out.push(child);
    collectAll(child, out);
  }
  return out;
}

function fakeEl(opts: { tag: string; attrs?: Record<string, string>; id?: string; text?: string }): FakeEl {
  const el: FakeEl = {
    nodeType: 1,
    tagName: opts.tag.toUpperCase(),
    id: opts.id ?? "",
    disabled: false,
    textContent: opts.text ?? "",
    children: [],
    parentElement: null,
    attrs: { ...(opts.attrs ?? {}), ...(opts.id ? { id: opts.id } : {}) },
    isConnected: true,
    hidden: false,
    offsetWidth: 10,
    offsetHeight: 10,
    getClientRects: () => [{ width: 10, height: 10 }],
    computedStyle: {},
    getAttribute: (name) => el.attrs[name] ?? null,
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    querySelectorAll: (selector: string) => collectAll(el).filter((candidate) => matches(candidate, selector)),
    closest: (selector: string) => {
      let node: FakeEl | null = el;
      while (node) {
        if (matches(node, selector)) return node;
        node = node.parentElement;
      }
      return null;
    },
    contains: (other) => {
      let node: FakeEl | null = other;
      while (node) {
        if (node === el) return true;
        node = node.parentElement;
      }
      return false;
    },
  };
  return el;
}

function append(parent: FakeEl, ...children: FakeEl[]): FakeEl {
  for (const child of children) {
    child.parentElement = parent;
    parent.children.push(child);
  }
  return parent;
}

function ancestorChain(el: FakeEl): FakeEl[] {
  const chain: FakeEl[] = [];
  let node: FakeEl | null = el;
  while (node) {
    chain.push(node);
    node = node.parentElement;
  }
  return chain;
}

function evalCaptureScriptAndFireClick(root: FakeEl, target: FakeEl): { sent: Array<Record<string, unknown>> } {
  const content = buildCaptureScriptV2Content("test-instance");
  const listeners: Record<string, (event: unknown) => void> = {};
  const allNodes = [root, ...collectAll(root)];
  const fakeDocument = {
    addEventListener(type: string, handler: (event: unknown) => void) {
      listeners[type] = handler;
    },
    getElementById(id: string) {
      return allNodes.find((node) => node.id === id) ?? null;
    },
    getElementsByTagName(tag: string) {
      return allNodes.filter((node) => node.tagName.toLowerCase() === tag.toLowerCase());
    },
    querySelectorAll(selector: string) {
      return allNodes.filter((node) => matches(node, selector));
    },
  };
  const sent: Array<Record<string, unknown>> = [];
  const fakeWindow = {
    __qaRecordV2: (message: Record<string, unknown>) => {
      sent.push(message);
      return Promise.resolve();
    },
    getComputedStyle: () => ({ cursor: "default", pointerEvents: "auto", display: "block", visibility: "visible", opacity: "1" }),
  };
  const fakeConsole = { info() {} };
  const run = new Function("document", "window", "console", content);
  run(fakeDocument, fakeWindow, fakeConsole);
  listeners.click({ target, composedPath: () => ancestorChain(target), detail: 1, isTrusted: true });
  return { sent };
}

function clickMessage(sent: Array<Record<string, unknown>>): Record<string, unknown> {
  return sent.find((message) => message.type === "click")!;
}

function candidateAt(message: Record<string, unknown>, index: number): any {
  return (message.composedPath as any[])[index];
}

/** div(scope id=stable-scope) > div(clicked, own text "SMS", ambiguous under structural identity). */
function buildPhysicalShape(): { root: FakeEl; scope: FakeEl; target: FakeEl } {
  const target = fakeEl({ tag: "div", text: "SMS" });
  const decoyA = fakeEl({ tag: "div", text: "Correo" });
  const decoyB = fakeEl({ tag: "div", text: "Llamada" });
  const scope = fakeEl({ tag: "form", id: "stable-scope" });
  append(scope, target, decoyA, decoyB);
  const root = fakeEl({ tag: "div" });
  append(root, scope);
  return { root, scope, target };
}

/**
 * TASK A/D (recordingId=dbbf2ab8-...): physical evidence showed `hasAccessibleName=true` for the
 * original clicked div while `semanticRuntimeEvidencePresent=false`/`semanticValueHash=0`. Traced
 * both computations: Node-side `hasAccessibleName` reads `candidate.accessibleName`
 * (browser-instrumentation.ts's `toCandidate`, `strongName || weakName`); `semanticDisplayValueOf`
 * computes `strong` via the IDENTICAL `classifyNativeRoleIdentity(...)` call, then falls back to
 * the IDENTICAL `computeWeakAccessibleName(el)`, THEN an additional own-textContent fallback --
 * strictly a superset of what makes `accessibleName` truthy. There is no second, divergent
 * Accessible-Name algorithm; `semanticDisplayValueOf(originalTarget)` cannot be empty when
 * `candidate.accessibleName` is truthy. The new `semanticValueComputedForOriginalTarget` diagnostic
 * proves this directly and disambiguates "value never computed" from "value computed but no scope
 * produced a unique, matching-target result" -- both previously looked identical from outside
 * (`semanticRuntimeEvidencePresent=false`, `semanticScopeAlternativeCount=0`).
 */
test("A1/physicalShapeValueComputed. a generic, structurally-ambiguous div with an accessible name (own text, no role/technicalRef/associatedField) always has a computable semantic value, even when scope matching later rejects it", () => {
  // Ambiguous scope: TWO divs share the exact same accessible name/text within the same scope --
  // a genuine uniqueness rejection, never a value-sourcing failure.
  const target = fakeEl({ tag: "div", text: "SMS" });
  const duplicate = fakeEl({ tag: "div", text: "SMS" });
  const decoyStructural = fakeEl({ tag: "div", text: "SMS" }); // structurally identical too -- matches the physical "many" shape
  const scope = fakeEl({ tag: "form", id: "stable-scope" });
  append(scope, target, duplicate, decoyStructural);
  const root = fakeEl({ tag: "div" });
  append(root, scope);

  const { sent } = evalCaptureScriptAndFireClick(root, target);
  const candidate = candidateAt(clickMessage(sent), 0);
  assert.equal(candidate.semanticRuntimeEvidence, undefined, "ambiguous same-scope match correctly rejects -- never picks one arbitrarily");
  const diagnostic = sent.find((m) => m.type === "capture_trace" && m.stage === "semantic_runtime_evidence_diagnostic");
  assert.ok(diagnostic);
  const payload = diagnostic!.diagnostic as Record<string, unknown>;
  assert.equal(payload.semanticRuntimeEvidencePresent, false);
  assert.equal(payload.semanticValueHash, 0);
  assert.equal(payload.semanticValueComputedForOriginalTarget, true, "the value WAS computed -- the rejection is uniqueness, never a missing/second accessible-name source");
});

test("A2/physicalShapeUniqueResolves. the SAME physical shape (generic ambiguous div, accessible name via own text, no role/technicalRef/associatedField) resolves to SemanticRuntimeEvidence when the scope-local match is genuinely unique -- owner stays unresolved throughout", () => {
  const target = fakeEl({ tag: "div", text: "SMS" });
  const decoyA = fakeEl({ tag: "div", text: "Correo" });
  const decoyB = fakeEl({ tag: "div", text: "Llamada" });
  const scope = fakeEl({ tag: "form", id: "stable-scope" });
  append(scope, target, decoyA, decoyB);
  const root = fakeEl({ tag: "div" });
  append(root, scope);

  const { sent } = evalCaptureScriptAndFireClick(root, target);
  const message = clickMessage(sent);
  const candidate = candidateAt(message, 0);
  assert.ok(candidate.semanticRuntimeEvidence, "unique scope-local match produces evidence");
  assert.equal(candidate.actionable, false, "owner-certification signals stay untouched by this fix");
  assert.equal(candidate.technicalRefs, undefined, "no technical ref exists for this physical shape");
  assert.equal(candidate.associatedField, undefined, "no associatedField exists for this physical shape");
  assert.equal(message.owner, undefined, "the diagnostic capture itself never certifies an owner");
  const diagnostic = sent.find((m) => m.type === "capture_trace" && m.stage === "semantic_runtime_evidence_diagnostic");
  const payload = diagnostic!.diagnostic as Record<string, unknown>;
  assert.equal(payload.semanticValueComputedForOriginalTarget, true);
  assert.equal(payload.semanticRuntimeEvidencePresent, true);
  assert.notEqual(payload.semanticValueHash, 0);
});

test("1. custom unresolved click + stable unique scope + unique own visible text -> SemanticRuntimeEvidence is captured on the original target's own candidate", () => {
  const { root, scope, target } = buildPhysicalShape();
  const { sent } = evalCaptureScriptAndFireClick(root, target);
  const candidate = candidateAt(clickMessage(sent), 0);
  assert.ok(candidate.semanticRuntimeEvidence, "the original target's own candidate must carry the aggregated evidence");
  assert.equal(candidate.semanticRuntimeEvidence.captureUniqueTarget, true);
  assert.ok(["accessible_name", "visible_text"].includes(candidate.semanticRuntimeEvidence.source));
  assert.equal(candidate.semanticRuntimeEvidence.normalizedValue, "SMS");
  assert.equal(candidate.semanticRuntimeEvidence.scopeAlternatives.length, 1);
  assert.equal(candidate.semanticRuntimeEvidence.scopeAlternatives[0].scopeIdentity.value, "stable-scope");
  assert.equal(candidate.semanticRuntimeEvidence.scopeAlternatives[0].captureMatchCount, 1);
});

test("2. the captured value is never hardcoded -- a differently-labeled physical shape produces a different normalizedValue", () => {
  const target = fakeEl({ tag: "div", text: "Correo electronico" });
  const scope = fakeEl({ tag: "form", id: "stable-scope" });
  append(scope, target);
  const root = fakeEl({ tag: "div" });
  append(root, scope);
  const { sent } = evalCaptureScriptAndFireClick(root, target);
  const candidate = candidateAt(clickMessage(sent), 0);
  assert.equal(candidate.semanticRuntimeEvidence.normalizedValue, "Correo electronico");
});

test("3. semantic value matches two elements within the scope -- reject (no evidence attached)", () => {
  const target = fakeEl({ tag: "div", text: "SMS" });
  const duplicate = fakeEl({ tag: "div", text: "SMS" });
  const scope = fakeEl({ tag: "form", id: "stable-scope" });
  append(scope, target, duplicate);
  const root = fakeEl({ tag: "div" });
  append(root, scope);
  const { sent } = evalCaptureScriptAndFireClick(root, target);
  const candidate = candidateAt(clickMessage(sent), 0);
  assert.equal(candidate.semanticRuntimeEvidence, undefined);
});

test("4. no semantic value at all (empty text, no accessible name) -- reject", () => {
  const target = fakeEl({ tag: "div", text: "" });
  const scope = fakeEl({ tag: "form", id: "stable-scope" });
  append(scope, target);
  const root = fakeEl({ tag: "div" });
  append(root, scope);
  const { sent } = evalCaptureScriptAndFireClick(root, target);
  const candidate = candidateAt(clickMessage(sent), 0);
  assert.equal(candidate.semanticRuntimeEvidence, undefined);
});

test("5. password/sensitive input value is never used as semantic target evidence", () => {
  const target = fakeEl({ tag: "input", attrs: { type: "password" }, text: "" });
  target.attrs.value = "secret-literal";
  const scope = fakeEl({ tag: "form", id: "stable-scope" });
  append(scope, target);
  const root = fakeEl({ tag: "div" });
  append(root, scope);
  const { sent } = evalCaptureScriptAndFireClick(root, target);
  const candidate = candidateAt(clickMessage(sent), 0);
  assert.equal(candidate.semanticRuntimeEvidence, undefined);
  assert.doesNotMatch(JSON.stringify(sent), /secret-literal/);
});

test("6. two scope alternatives resolving the SAME original target are both kept", () => {
  const target = fakeEl({ tag: "div", text: "SMS" });
  const innerScope = fakeEl({ tag: "section", id: "inner-scope" });
  append(innerScope, target);
  const outerScope = fakeEl({ tag: "form", id: "outer-scope" });
  append(outerScope, innerScope);
  const root = fakeEl({ tag: "div" });
  append(root, outerScope);
  const { sent } = evalCaptureScriptAndFireClick(root, target);
  const candidate = candidateAt(clickMessage(sent), 0);
  assert.ok(candidate.semanticRuntimeEvidence, "at least one valid scope alternative must be captured");
  assert.equal(candidate.semanticRuntimeEvidence.scopeAlternatives.length, 2);
  const scopeValues = candidate.semanticRuntimeEvidence.scopeAlternatives.map((alt: any) => alt.scopeIdentity.value).sort();
  assert.deepEqual(scopeValues, ["inner-scope", "outer-scope"]);
});

test("7. a scope whose unique semantic match is a DIFFERENT element than the original target is excluded, not fabricated as an alternative", () => {
  // scope-near: unique match is a DIFFERENT div ("Correo"), never the clicked target.
  const target = fakeEl({ tag: "div", text: "SMS" });
  const otherMatch = fakeEl({ tag: "div", text: "Correo" });
  const nearScope = fakeEl({ tag: "section", id: "near-scope" });
  append(nearScope, otherMatch);
  const farScope = fakeEl({ tag: "form", id: "far-scope" });
  append(farScope, nearScope, target);
  const root = fakeEl({ tag: "div" });
  append(root, farScope);
  const { sent } = evalCaptureScriptAndFireClick(root, target);
  const candidate = candidateAt(clickMessage(sent), 0);
  assert.ok(candidate.semanticRuntimeEvidence);
  // only far-scope (whose unique "SMS" match IS the original target) is kept -- near-scope never
  // even sees "SMS" as a candidate inside its own boundary, so it produces no alternative at all.
  assert.equal(candidate.semanticRuntimeEvidence.scopeAlternatives.length, 1);
  assert.equal(candidate.semanticRuntimeEvidence.scopeAlternatives[0].scopeIdentity.value, "far-scope");
});

test("8. no evidence is attached at all -- reject (no scope with own id/data-testid exists)", () => {
  const target = fakeEl({ tag: "div", text: "SMS" });
  const root = fakeEl({ tag: "div" });
  append(root, target);
  const { sent } = evalCaptureScriptAndFireClick(root, target);
  const candidate = candidateAt(clickMessage(sent), 0);
  assert.equal(candidate.semanticRuntimeEvidence, undefined);
});

test("9. compact diagnostic reports presence/count/hash only -- never the raw semantic value", () => {
  const { root, target } = buildPhysicalShape();
  const { sent } = evalCaptureScriptAndFireClick(root, target);
  const diagnostic = sent.find((message) => message.type === "capture_trace" && message.stage === "semantic_runtime_evidence_diagnostic");
  assert.ok(diagnostic);
  const payload = diagnostic!.diagnostic as Record<string, unknown>;
  assert.equal(payload.semanticRuntimeEvidencePresent, true);
  assert.equal(payload.semanticScopeAlternativeCount, 1);
  assert.equal(typeof payload.semanticValueHash, "number");
  assert.doesNotMatch(JSON.stringify(diagnostic), /SMS/);
});

test("10. owner remains unresolved and no technicalTarget is fabricated by this capture alone", () => {
  const { root, target } = buildPhysicalShape();
  const { sent } = evalCaptureScriptAndFireClick(root, target);
  const message = clickMessage(sent);
  assert.equal(message.owner, undefined);
  assert.equal((message as any).technicalTarget, undefined);
});
