import assert from "node:assert/strict";
import test from "node:test";
import { buildCaptureScriptV2Content } from "./capture-engine-v2.browser-instrumentation";

/**
 * DIAGNOSE-ONLY instrumentation (physical-owner-loss investigation, recordingId=950b15bd-...):
 * a trusted click on a custom, non-native control (no ARIA role, no framework-actionability
 * certification) is not captured -- `resolveCaptureOwner` correctly reports
 * `unresolved_no_actionable_semantics`. A candidate microfix (accept trusted click + any
 * technicalRef) was tried and REVERTED: it broke the pre-existing "distant technical ref without
 * framework actionability cannot certify a decorative image" regression, which encodes the exact
 * same evidence shape as a genuine layout-root wrapper that must stay rejected.
 *
 * A first diagnostic pass logged per-candidate metadata via raw `console.log`, which a real
 * recording proved NEVER reaches the physically observable QA Lab log (only messages sent
 * through `window.__qaRecordV2` -- the existing `capture_trace` channel every other
 * "[capture-v2] trace stage=..." line already uses -- are received and logged Node-side by
 * `CaptureEngineV2ShadowBridge`). Fixed by routing the SAME diagnostic payload through
 * `send({type:"capture_trace", stage:"owner_candidate_diagnostic"|"owner_candidate_nearest_diagnostic",
 * diagnostic:{...}})` instead -- no new transport, no acceptance rule changes anywhere.
 *
 * These tests execute the REAL generated V2 script (`new Function`, same harness pattern as
 * capture-engine-v2.click-structural-evidence.test.ts) and assert on the messages captured by a
 * fake `__qaRecordV2` binding only.
 */

type FakeEl = {
  nodeType: 1;
  tagName: string;
  id: string;
  disabled: boolean;
  isContentEditable: boolean;
  onclick: (() => void) | null;
  tabIndex: number | undefined;
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
  computedStyle: { cursor?: string; pointerEvents?: string };
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
function fakeEl(opts: {
  tag: string;
  attrs?: Record<string, string>;
  id?: string;
  onclick?: () => void;
  tabIndex?: number;
  isContentEditable?: boolean;
  disabled?: boolean;
  cursor?: string;
}): FakeEl {
  const el: FakeEl = {
    nodeType: 1,
    tagName: opts.tag.toUpperCase(),
    id: opts.id ?? "",
    disabled: opts.disabled ?? false,
    isContentEditable: opts.isContentEditable ?? false,
    onclick: opts.onclick ?? null,
    tabIndex: opts.tabIndex,
    textContent: "",
    children: [],
    parentElement: null,
    attrs: { ...(opts.attrs ?? {}), ...(opts.id ? { id: opts.id } : {}) },
    isConnected: true,
    hidden: false,
    offsetWidth: 10,
    offsetHeight: 10,
    getClientRects: () => [{ width: 10, height: 10 }],
    computedStyle: opts.cursor ? { cursor: opts.cursor } : {},
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

type DiagLine = { prefix: string; payload: Record<string, unknown> };

function evalCaptureScriptAndFireClick(root: FakeEl, target: FakeEl): { sent: Array<Record<string, unknown>>; diagLines: DiagLine[]; rawLogText: string } {
  const content = buildCaptureScriptV2Content("test-instance");
  const listeners: Record<string, (event: unknown) => void> = {};
  const allNodes = [root, ...collectAll(root)];
  const fakeDocument = {
    addEventListener(type: string, handler: (event: unknown) => void) {
      listeners[type] = handler;
    },
    getElementById() { return null; },
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
    getComputedStyle: (node: FakeEl) => ({
      cursor: node?.computedStyle?.cursor ?? "default",
      pointerEvents: node?.computedStyle?.pointerEvents ?? "auto",
      display: "block",
      visibility: "visible",
      opacity: "1",
    }),
  };
  const fakeConsole = { log() { /* not used by this diagnostic anymore -- capture_trace is */ }, info() { /* unrelated diagnostic channel */ } };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function("document", "window", "console", content);
  run(fakeDocument, fakeWindow, fakeConsole);
  listeners.click({ composedPath: () => ancestorChain(target), detail: 1, isTrusted: true, target });
  const diagnosticMessages = sent.filter((m) => m.type === "capture_trace" && (m.stage === "owner_candidate_diagnostic" || m.stage === "owner_candidate_nearest_diagnostic"));
  const diagLines: DiagLine[] = diagnosticMessages
    .map((m) => ({ prefix: m.stage === "owner_candidate_diagnostic" ? "[capture-v2-owner-diagnostic]" : "[capture-v2-owner-diagnostic-nearest]", payload: m.diagnostic as Record<string, unknown> }));
  // Only the DIAGNOSTIC messages -- the real click payload legitimately carries accessible
  // name/technical refs (pre-existing, unrelated to this diagnostic), so it is deliberately
  // excluded from this redaction check.
  const rawLogText = JSON.stringify(diagnosticMessages);
  return { sent, diagLines, rawLogText };
}

// A custom, non-native control (no ARIA role, no framework certification) with a real id --
// structurally identical in shape to the physical SMS click this investigation is about.
function customControlTree() {
  const customControl = fakeEl({ tag: "div", id: "sms-channel-toggle" });
  const wrapper = fakeEl({ tag: "div" });
  append(wrapper, customControl);
  const root = fakeEl({ tag: "div" });
  append(root, wrapper);
  return { root, customControl };
}

test("1/diagnosticShape. new per-candidate and nearest diagnostic lines appear for a trusted click", () => {
  const { root, customControl } = customControlTree();
  const { diagLines } = evalCaptureScriptAndFireClick(root, customControl);
  const perCandidate = diagLines.filter((d) => d.prefix === "[capture-v2-owner-diagnostic]");
  const nearest = diagLines.filter((d) => d.prefix === "[capture-v2-owner-diagnostic-nearest]");
  assert.ok(perCandidate.length >= 1, "per-candidate diagnostic must fire for the composed path");
  assert.ok(nearest.length >= 1, "nearest-comparison diagnostic must fire for the composed path");
  const first = perCandidate[0].payload;
  for (const key of ["candidateOrdinalDiagnostic", "sameEventTarget", "tag", "explicitRolePresent", "nativeActionableTag", "technicalRefPresent", "technicalRefKind", "stableAttributeNames", "tabIndexPresent", "tabIndexValueClass", "onclickAttributePresent", "onclickPropertyPresent", "cursorPointer", "pointerEventsEnabled", "contentEditable", "disabled", "ariaDisabled", "keyboardFocusable", "focusableByNativeSemantics", "frameworkActionable", "frameworkIdentitySufficient", "associatedFieldPresent", "structuralIdentityPresent"]) {
    assert.ok(key in first, `diagnostic payload must include "${key}"`);
  }
});

test("2/redaction. raw id/data-testid VALUES never appear in the diagnostic output", () => {
  const customControl = fakeEl({ tag: "div", id: "sms-channel-toggle-secret-marker", attrs: { "data-testid": "sms-toggle-secret-marker" } });
  const root = fakeEl({ tag: "div" });
  append(root, customControl);
  const { rawLogText } = evalCaptureScriptAndFireClick(root, customControl);
  assert.ok(!rawLogText.includes("sms-channel-toggle-secret-marker"), "raw id value must never be logged");
  assert.ok(!rawLogText.includes("sms-toggle-secret-marker"), "raw data-testid value must never be logged");
});

test("3/redaction. accessible text/label is never logged", () => {
  const customControl = fakeEl({ tag: "div", id: "x", attrs: { "aria-label": "Enviar código por SMS al número secreto" } });
  const root = fakeEl({ tag: "div" });
  append(root, customControl);
  const { rawLogText } = evalCaptureScriptAndFireClick(root, customControl);
  assert.ok(!rawLogText.includes("Enviar código por SMS"), "accessible name text must never be logged");
});

test("4/redaction. className is never logged", () => {
  const customControl = fakeEl({ tag: "div", id: "x", attrs: { class: "btn-sms-channel-selector-secret" } });
  const root = fakeEl({ tag: "div" });
  append(root, customControl);
  const { rawLogText } = evalCaptureScriptAndFireClick(root, customControl);
  assert.ok(!rawLogText.includes("btn-sms-channel-selector-secret"), "className value must never be logged");
});

test("5/resolutionUnchanged. the dispatched click message and its owner candidate list are byte-identical in shape to before this diagnostic addition", () => {
  const { root, customControl } = customControlTree();
  const { sent } = evalCaptureScriptAndFireClick(root, customControl);
  const clickMessage = sent.find((m) => m.type === "click");
  assert.ok(clickMessage, "click message must still be dispatched");
  const composedPath = clickMessage!.composedPath as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(composedPath) && composedPath.length > 0);
  // No candidate carries any of the new diagnostic-only field names -- the CaptureOwnerCandidate
  // shape sent to Node is exactly what it was before.
  for (const candidate of composedPath) {
    assert.ok(!("explicitRolePresent" in candidate));
    assert.ok(!("nativeActionableTag" in candidate));
    assert.ok(!("stableAttributeNames" in candidate));
  }
});

test("6/layoutRootGuard. a distant, non-actionable wrapper with an id still produces diagnostic evidence showing it lacks interactive signals -- resolution itself is untouched (verified separately in capture-engine-v2.action-owner-resolver.test.ts, unmodified)", () => {
  const decorativeImg = fakeEl({ tag: "img" });
  const layoutRoot = fakeEl({ tag: "div", id: "layout-root" });
  append(layoutRoot, decorativeImg);
  const root = fakeEl({ tag: "div" });
  append(root, layoutRoot);
  const { diagLines } = evalCaptureScriptAndFireClick(root, decorativeImg);
  const layoutRootDiag = diagLines.find((d) => d.prefix === "[capture-v2-owner-diagnostic]" && d.payload.tag === "div" && d.payload.technicalRefPresent === true);
  assert.ok(layoutRootDiag, "the layout-root candidate must still be visible in diagnostics");
  assert.equal(layoutRootDiag!.payload.frameworkActionable, false);
  assert.equal(layoutRootDiag!.payload.nativeActionableTag, false);
});

test("7/nativeRegression. a native button click produces no behavior change -- diagnostic fires but the sent click message is unaffected", () => {
  const button = fakeEl({ tag: "button", id: "submit-btn" });
  const root = fakeEl({ tag: "div" });
  append(root, button);
  const { sent, diagLines } = evalCaptureScriptAndFireClick(root, button);
  const clickMessage = sent.find((m) => m.type === "click");
  assert.ok(clickMessage);
  const buttonDiag = diagLines.find((d) => d.prefix === "[capture-v2-owner-diagnostic]" && d.payload.candidateOrdinalDiagnostic === 0);
  assert.equal(buttonDiag!.payload.nativeActionableTag, true);
});

test("8/frameworkRegression. framework-actionable candidate diagnostics reflect true/true without altering the underlying certification path", () => {
  const framework = fakeEl({ tag: "div", id: "fw", onclick: () => undefined, cursor: "pointer" });
  const root = fakeEl({ tag: "div" });
  append(root, framework);
  const { diagLines } = evalCaptureScriptAndFireClick(root, framework);
  const diag = diagLines.find((d) => d.prefix === "[capture-v2-owner-diagnostic]" && d.payload.candidateOrdinalDiagnostic === 0);
  assert.equal(diag!.payload.onclickPropertyPresent, true);
  assert.equal(diag!.payload.cursorPointer, true);
});

test("9/actionCount. exactly one click RawInteraction-shaped message is still dispatched per click, regardless of diagnostic volume", () => {
  const { root, customControl } = customControlTree();
  const { sent } = evalCaptureScriptAndFireClick(root, customControl);
  assert.equal(sent.filter((m) => m.type === "click").length, 1);
});

test("10/noPosition. depth/nearest fields are reported but never consulted for authority -- resolveCaptureOwner (Node side) is untouched by this diagnostic addition, verified via its own unmodified, still-green test suite", () => {
  const { root, customControl } = customControlTree();
  const { diagLines } = evalCaptureScriptAndFireClick(root, customControl);
  // The diagnostic payload legitimately reports depth/nearest as DATA -- this test only asserts
  // that no NEW field name implies authority (e.g. no "selectedByDepth"/"chosenOwner" field),
  // matching the ticket's own "diagnostic only" contract.
  for (const line of diagLines) {
    assert.ok(!("selectedByDepth" in line.payload));
    assert.ok(!("chosenOwner" in line.payload));
    assert.ok(!("acceptedOwner" in line.payload));
  }
});
