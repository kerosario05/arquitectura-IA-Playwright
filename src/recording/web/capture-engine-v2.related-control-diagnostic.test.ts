import assert from "node:assert/strict";
import test from "node:test";
import { buildCaptureScriptV2Content } from "./capture-engine-v2.browser-instrumentation";

/**
 * DIAGNOSE-ONLY (recordingId=bbb29e0a-...): does the ORIGINAL clicked target, or a node in its
 * lineage up to a selected scope-bound ancestor, carry an EXPLICIT, non-positional HTML/ARIA
 * relation to exactly one durable, actionable/editable control inside that same scope. Emitted on
 * the existing `capture_trace` channel as `scope_bound_related_control_diagnostic`. Never
 * consumed by owner resolution, structural evidence, readiness, or the runtime resolver -- these
 * tests only verify the diagnostic's own correctness and that nothing else changes shape.
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
  control?: FakeEl;
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

function fakeEl(opts: { tag: string; attrs?: Record<string, string>; id?: string; control?: FakeEl }): FakeEl {
  const el: FakeEl = {
    nodeType: 1,
    tagName: opts.tag.toUpperCase(),
    id: opts.id ?? "",
    disabled: false,
    textContent: "",
    children: [],
    parentElement: null,
    attrs: { ...(opts.attrs ?? {}), ...(opts.id ? { id: opts.id } : {}) },
    control: opts.control,
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

/** Evaluates the REAL generated V2 script and fires a trusted click on `target`. */
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

function relatedControlDiagnostics(sent: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return sent
    .filter((message) => message.type === "capture_trace" && message.stage === "scope_bound_related_control_diagnostic")
    .map((message) => message.diagnostic as Record<string, unknown>);
}

/** div(scope id=stable-scope) > div(ambiguous target, no attrs) -- the exact physical shape this diagnostic targets. */
function buildAmbiguousTargetUnderScope(): { root: FakeEl; scope: FakeEl; target: FakeEl } {
  const target = fakeEl({ tag: "div" });
  const scope = fakeEl({ tag: "form", id: "stable-scope" });
  append(scope, target);
  const root = fakeEl({ tag: "div" });
  append(root, scope);
  return { root, scope, target };
}

test("1/noRelation. no explicit relation anywhere in lineage -- viable=false", () => {
  const { root, target } = buildAmbiguousTargetUnderScope();
  const { sent } = evalCaptureScriptAndFireClick(root, target);
  const diagnostics = relatedControlDiagnostics(sent);
  assert.ok(diagnostics.length > 0, "diagnostic fires for a trusted click under a unique scope");
  for (const diagnostic of diagnostics) {
    assert.equal(diagnostic.relatedControlCandidateViable, false);
    assert.equal(diagnostic.relationSourceKind, "none");
  }
});

test("2/singleValidRelation. original target has aria-controls to one same-scope technical/actionable control -- diagnostic viable=true, but the dispatched click message is unaffected", () => {
  const control = fakeEl({ tag: "input", id: "control-1" });
  const target = fakeEl({ tag: "div", attrs: { "aria-controls": "control-1" } });
  const scope = fakeEl({ tag: "form", id: "stable-scope" });
  append(scope, target, control);
  const root = fakeEl({ tag: "div" });
  append(root, scope);

  const { sent } = evalCaptureScriptAndFireClick(root, target);
  const diagnostics = relatedControlDiagnostics(sent);
  const viable = diagnostics.find((d) => d.relatedControlCandidateViable === true);
  assert.ok(viable, "an aria-controls relation to a unique same-scope input must be reported viable");
  assert.equal(viable!.relationSourceKind, "original_target");
  assert.equal(viable!.sameScopeReferencedElementCountClass, "one");
  assert.equal(viable!.referencedTechnicalControlCountClass, "one");
  assert.equal(viable!.referencedActionableOrEditable, true);

  const clickMessage = sent.find((message) => message.type === "click")!;
  assert.equal(clickMessage.owner, undefined, "the diagnostic never creates an owner");
});

test("3/missingReferencedElement. aria-controls points at an id that does not exist -- viable=false", () => {
  const target = fakeEl({ tag: "div", attrs: { "aria-controls": "does-not-exist" } });
  const scope = fakeEl({ tag: "form", id: "stable-scope" });
  append(scope, target);
  const root = fakeEl({ tag: "div" });
  append(root, scope);

  const { sent } = evalCaptureScriptAndFireClick(root, target);
  const diagnostics = relatedControlDiagnostics(sent);
  for (const diagnostic of diagnostics) {
    assert.equal(diagnostic.referencedElementCountClass, "zero");
    assert.equal(diagnostic.relatedControlCandidateViable, false);
  }
});

test("4/outsideScope. the referenced control exists but lives outside the selected scope -- viable=false", () => {
  const control = fakeEl({ tag: "input", id: "control-outside" });
  const target = fakeEl({ tag: "div", attrs: { "aria-controls": "control-outside" } });
  const scope = fakeEl({ tag: "form", id: "stable-scope" });
  append(scope, target);
  const root = fakeEl({ tag: "div" });
  append(root, scope, control);

  const { sent } = evalCaptureScriptAndFireClick(root, target);
  const diagnostics = relatedControlDiagnostics(sent);
  for (const diagnostic of diagnostics) {
    assert.equal(diagnostic.referencedElementCountClass, "one");
    assert.equal(diagnostic.sameScopeReferencedElementCountClass, "zero");
    assert.equal(diagnostic.relatedControlCandidateViable, false);
  }
});

test("5/multipleControls. two distinct same-scope technical controls are referenced -- viable=false, never picks one arbitrarily", () => {
  const controlA = fakeEl({ tag: "input", id: "control-a" });
  const controlB = fakeEl({ tag: "input", id: "control-b" });
  const target = fakeEl({ tag: "div", attrs: { "aria-controls": "control-a control-b" } });
  const scope = fakeEl({ tag: "form", id: "stable-scope" });
  append(scope, target, controlA, controlB);
  const root = fakeEl({ tag: "div" });
  append(root, scope);

  const { sent } = evalCaptureScriptAndFireClick(root, target);
  const diagnostics = relatedControlDiagnostics(sent);
  for (const diagnostic of diagnostics) {
    assert.equal(diagnostic.sameScopeReferencedElementCountClass, "many");
    assert.equal(diagnostic.relatedControlCandidateViable, false);
  }
});

test("6/anonymousSource. the relation-bearing node is an ancestor with no durable identity of its own -- viable=false, never reidentifiable at runtime", () => {
  const control = fakeEl({ tag: "input", id: "control-1" });
  const anonymousWrapper = fakeEl({ tag: "div", attrs: { "aria-controls": "control-1" } });
  const target = fakeEl({ tag: "span" });
  append(anonymousWrapper, target);
  const scope = fakeEl({ tag: "form", id: "stable-scope" });
  append(scope, anonymousWrapper, control);
  const root = fakeEl({ tag: "div" });
  append(root, scope);

  const { sent } = evalCaptureScriptAndFireClick(root, target);
  const diagnostics = relatedControlDiagnostics(sent);
  for (const diagnostic of diagnostics) {
    assert.equal(diagnostic.relationSourceKind, "anonymous_ancestor");
    assert.equal(diagnostic.relatedControlCandidateViable, false);
  }
});

test("7/labelOnly. aria-labelledby points only at a plain, non-actionable label/text element -- viable=false", () => {
  const labelOnly = fakeEl({ tag: "span", id: "label-1" });
  const target = fakeEl({ tag: "div", attrs: { "aria-labelledby": "label-1" } });
  const scope = fakeEl({ tag: "form", id: "stable-scope" });
  append(scope, target, labelOnly);
  const root = fakeEl({ tag: "div" });
  append(root, scope);

  const { sent } = evalCaptureScriptAndFireClick(root, target);
  const diagnostics = relatedControlDiagnostics(sent);
  for (const diagnostic of diagnostics) {
    // The referenced <span> has its own id (required to be referenceable at all), so it DOES
    // carry a technicalRef -- but a plain span is neither actionable nor editable, and per the
    // ticket's own separation, technicalRef presence alone must never imply the referenced
    // element is a genuine control.
    assert.equal(diagnostic.referencedActionableOrEditable, false);
    assert.equal(diagnostic.relatedControlCandidateViable, false);
  }
});

test("8/9. the diagnostic never creates an owner or a technicalTarget on the dispatched click message", () => {
  const control = fakeEl({ tag: "input", id: "control-1" });
  const target = fakeEl({ tag: "div", attrs: { "aria-controls": "control-1" } });
  const scope = fakeEl({ tag: "form", id: "stable-scope" });
  append(scope, target, control);
  const root = fakeEl({ tag: "div" });
  append(root, scope);

  const { sent } = evalCaptureScriptAndFireClick(root, target);
  const clickMessage = sent.find((message) => message.type === "click")!;
  assert.equal(clickMessage.owner, undefined);
  assert.equal((clickMessage as any).technicalTarget, undefined);
});

test("10. exactly one click message is still dispatched, regardless of diagnostic volume", () => {
  const control = fakeEl({ tag: "input", id: "control-1" });
  const target = fakeEl({ tag: "div", attrs: { "aria-controls": "control-1" } });
  const scope = fakeEl({ tag: "form", id: "stable-scope" });
  append(scope, target, control);
  const root = fakeEl({ tag: "div" });
  append(root, scope);

  const { sent } = evalCaptureScriptAndFireClick(root, target);
  assert.equal(sent.filter((message) => message.type === "click").length, 1);
});

test("11. no raw id/attribute values ever appear in the related-control diagnostic payload -- redacted booleans/enums/counts only", () => {
  const control = fakeEl({ tag: "input", id: "control-1" });
  const target = fakeEl({ tag: "div", attrs: { "aria-controls": "control-1" } });
  const scope = fakeEl({ tag: "form", id: "stable-scope" });
  append(scope, target, control);
  const root = fakeEl({ tag: "div" });
  append(root, scope);

  const { sent } = evalCaptureScriptAndFireClick(root, target);
  const serialized = JSON.stringify(relatedControlDiagnostics(sent));
  assert.doesNotMatch(serialized, /control-1/);
  assert.doesNotMatch(serialized, /stable-scope/);
});
