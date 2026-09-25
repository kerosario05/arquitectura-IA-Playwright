import assert from "node:assert/strict";
import test from "node:test";
import { buildCaptureScriptV2Content } from "./capture-engine-v2.browser-instrumentation";

/**
 * FIRST_LOSS (producer-side, follow-up to the landmark-recertification tickets): a resolved
 * click's `CaptureAction` never carried `technicalEvidence` at all -- `onClick`
 * (capture-engine-v2.shadow-bridge.ts) only ever set `identity`/`owner`, so
 * `technicalTargetCandidates`/`structuralContext`/`landmarkAncestor` never reached
 * `RecordedEvent`/`CanonicalInteraction`/`RecordingExecutionContract`, even though the adapter
 * already knew how to transport them. A fresh physical recording confirmed this exactly: the
 * persisted "Solicitud multiproducto" interaction had only a bare `technicalTargetRefs` ref
 * string, no `technicalTargetCandidates` at all.
 *
 * Fixed at the point closest to the real DOM/actionable owner: `toCandidate` (browser-instrumentation.ts)
 * now computes `structuralIdentity` (stable attributes/descendants/semantic shape/landmark
 * ancestor/cross-page match count -- the SAME `StructuralOwnerIdentity` concept
 * `structural-owner-identity.ts` already defines and `target-resolver.ts` already knows how to
 * consume) for every actionable/editable composed-path candidate, `resolveCaptureOwner` carries
 * it through unchanged onto whichever candidate it picks as owner, and `onClick` builds
 * `technicalEvidence` from it via the new, pure `buildOwnerTechnicalEvidence`
 * (capture-engine-v2.action-owner-resolver.ts).
 *
 * These tests execute the REAL generated V2 browser script (`new Function`, matching this
 * session's established real-execution harness -- see `capture-engine-v2.grid-column-identity.test.ts`)
 * against a minimal fake DOM. `resolveCaptureOwner`/`onClick`/`buildOwnerTechnicalEvidence`
 * themselves run in Node and are exercised separately in `capture-engine-v2.shadow-bridge.test.ts`.
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
  // Eligibility-filter fixture surface (structural-evidence match-count fix): a REAL rendered,
  // connected, visible element always has these -- defaults below model exactly that, so every
  // pre-existing test (none of which asserts on these fields) is unaffected; only tests that
  // explicitly override them exercise the hidden/disconnected/inert exclusion paths.
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

function fakeEl(opts: {
  tag: string;
  attrs?: Record<string, string>;
  id?: string;
  isConnected?: boolean;
  hidden?: boolean;
  offsetWidth?: number;
  offsetHeight?: number;
  computedStyle?: FakeEl["computedStyle"];
}): FakeEl {
  const el: FakeEl = {
    nodeType: 1,
    tagName: opts.tag.toUpperCase(),
    id: opts.id ?? "",
    disabled: false,
    textContent: "",
    children: [],
    parentElement: null,
    attrs: { ...(opts.attrs ?? {}), ...(opts.id ? { id: opts.id } : {}) },
    isConnected: opts.isConnected ?? true,
    hidden: opts.hidden ?? false,
    offsetWidth: opts.offsetWidth ?? 10,
    offsetHeight: opts.offsetHeight ?? 10,
    getClientRects: () => [{ width: el.offsetWidth, height: el.offsetHeight }],
    computedStyle: opts.computedStyle ?? {},
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

/** `event.composedPath()`'s real shape: the target followed by every ancestor up to the root. */
function ancestorChain(el: FakeEl): FakeEl[] {
  const chain: FakeEl[] = [];
  let node: FakeEl | null = el;
  while (node) {
    chain.push(node);
    node = node.parentElement;
  }
  return chain;
}

/** Evaluates the REAL generated V2 script and fires a click on `target`, within a full `root` page tree. */
function evalCaptureScriptAndFireClick(root: FakeEl, target: FakeEl, trusted = false): Record<string, unknown> {
  const content = buildCaptureScriptV2Content("test-instance");
  const listeners: Record<string, (event: unknown) => void> = {};
  const allNodes = [root, ...collectAll(root)];
  const fakeDocument = {
    addEventListener(type: string, handler: (event: unknown) => void) {
      listeners[type] = handler;
    },
    getElementById() {
      return null;
    },
    getElementsByTagName(tag: string) {
      return allNodes.filter((node) => node.tagName.toLowerCase() === tag.toLowerCase());
    },
    querySelectorAll(selector: string) {
      return allNodes.filter((node) => matches(node, selector));
    },
  };
  const sent: Array<Record<string, unknown>> = [];
  const diagnostics: Array<{ prefix: string; payload: Record<string, unknown> }> = [];
  const fakeWindow = {
    __qaRecordV2: (message: Record<string, unknown>) => {
      sent.push(message);
      return Promise.resolve();
    },
    getComputedStyle: (node: FakeEl) => ({
      cursor: "pointer",
      pointerEvents: "auto",
      display: node?.computedStyle?.display ?? "block",
      visibility: node?.computedStyle?.visibility ?? "visible",
      opacity: node?.computedStyle?.opacity ?? "1",
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fakeConsole = {
    info(prefix: string, payload: Record<string, unknown>) {
      if (prefix.startsWith("[structural-identity-")) diagnostics.push({ prefix, payload });
    },
  };
  const run = new Function("document", "window", "console", content);
  run(fakeDocument, fakeWindow, fakeConsole);
  listeners.click({ target, composedPath: () => ancestorChain(target), detail: 1, isTrusted: trusted });
  const bridgedDiagnostics = sent
    .filter((message) => message.type === "structural_identity_diagnostic")
    .map((message) => ({
      prefix: message.diagnosticKind === "summary" ? "[structural-identity-candidates]" : "[structural-identity-candidate]",
      payload: message.payload as Record<string, unknown>,
    }));
  const captureDiagnostics = sent
    .filter((message) => message.type === "capture_trace" && typeof message.stage === "string" && message.stage.startsWith("structural_"))
    .map((message) => ({ stage: message.stage as string, payload: message.diagnostic as Record<string, unknown> }));
  return { ...sent.find((message) => message.type === "click")!, __structuralDiagnostics: bridgedDiagnostics.length > 0 ? bridgedDiagnostics : diagnostics, __captureDiagnostics: captureDiagnostics };
}

function clickedCandidate(message: Record<string, unknown>): any {
  return (message.composedPath as any[])[0];
}

function structuralDiagnostics(message: Record<string, unknown>): Array<{ prefix: string; payload: Record<string, unknown> }> {
  return message.__structuralDiagnostics as Array<{ prefix: string; payload: Record<string, unknown> }>;
}

function captureDiagnostics(message: Record<string, unknown>): Array<{ stage: string; payload: Record<string, unknown> }> {
  return message.__captureDiagnostics as Array<{ stage: string; payload: Record<string, unknown> }>;
}

test("1/namedLinkClick + 10/rawInteraction. a named link click carries a structuralIdentity with a real technical ref", () => {
  const link = fakeEl({ tag: "a", id: "solicitud-link", attrs: { "aria-label": "Solicitud multiproducto", href: "/requests/create/multiproduct" } });
  const root = fakeEl({ tag: "div" });
  append(root, link);
  const message = evalCaptureScriptAndFireClick(root, link);
  const candidate = clickedCandidate(message);
  assert.equal(candidate.actionable, true);
  assert.ok(candidate.technicalRefs?.some((ref: string) => ref === "id:solicitud-link"));
  assert.ok(candidate.structuralIdentity, "an actionable candidate must carry structural evidence");
  assert.equal(candidate.structuralIdentity.deterministicStructuralIdentity, true);
});

test("2/candidateStructuralContext + 3/landmarkPresent. clicking the CARD link (inside <main>) records landmarkAncestor=main", () => {
  const sidebarLink = fakeEl({ tag: "a", attrs: { "aria-label": "Solicitud multiproducto", href: "/requests/create/multiproduct" } });
  const nav = fakeEl({ tag: "nav" });
  append(nav, sidebarLink);

  const cardLink = fakeEl({ tag: "a", attrs: { "aria-label": "Solicitud multiproducto", href: "/requests/create/multiproduct" } });
  const main = fakeEl({ tag: "main" });
  append(main, cardLink);

  const root = fakeEl({ tag: "div" });
  append(root, nav, main);

  const message = evalCaptureScriptAndFireClick(root, cardLink);
  const candidate = clickedCandidate(message);
  assert.equal(candidate.structuralIdentity.landmarkAncestor?.tag, "main");
});

test("5/duplicateOwnerDistinct. sidebar and card links with the SAME name/href but DIFFERENT landmarks are never counted as duplicates of each other", () => {
  const sidebarLink = fakeEl({ tag: "a", attrs: { "aria-label": "Solicitud multiproducto", href: "/requests/create/multiproduct" } });
  const nav = fakeEl({ tag: "nav" });
  append(nav, sidebarLink);

  const cardLink = fakeEl({ tag: "a", attrs: { "aria-label": "Solicitud multiproducto", href: "/requests/create/multiproduct" } });
  const main = fakeEl({ tag: "main" });
  append(main, cardLink);

  const root = fakeEl({ tag: "div" });
  append(root, nav, main);

  const cardMessage = evalCaptureScriptAndFireClick(root, cardLink);
  const cardCandidate = clickedCandidate(cardMessage);
  // Scoped to its own landmark, the card link is the ONLY match for its (owner + landmark)
  // fingerprint -- the sidebar link, sharing the same name/href but a different landmark, is
  // never counted, so this stays deterministic instead of ambiguous.
  assert.equal(cardCandidate.structuralIdentity.structuralIdentityMatchCount, 1);
  assert.equal(cardCandidate.structuralIdentity.identityAmbiguous, undefined);
  assert.equal(cardCandidate.structuralIdentity.deterministicStructuralIdentity, true);
});

test("6/sameLandmarkAmbiguous. two structurally-identical owners in the SAME landmark are correctly flagged ambiguous -- never resolved by position", () => {
  const linkA = fakeEl({ tag: "a", attrs: { "aria-label": "Duplicado", href: "/same" } });
  const linkB = fakeEl({ tag: "a", attrs: { "aria-label": "Duplicado", href: "/same" } });
  const main = fakeEl({ tag: "main" });
  append(main, linkA, linkB);
  const root = fakeEl({ tag: "div" });
  append(root, main);

  const message = evalCaptureScriptAndFireClick(root, linkA);
  const candidate = clickedCandidate(message);
  assert.equal(candidate.structuralIdentity.structuralIdentityMatchCount, 2);
  assert.equal(candidate.structuralIdentity.identityAmbiguous, true);
  assert.equal(candidate.structuralIdentity.deterministicStructuralIdentity, false);
});

test("4/landmarkAbsentGracefully. a page with no semantic landmark at all still computes the rest of structuralIdentity", () => {
  const button = fakeEl({ tag: "button", id: "plain-btn", attrs: { "aria-label": "Aceptar" } });
  const root = fakeEl({ tag: "div" });
  append(root, button);
  const message = evalCaptureScriptAndFireClick(root, button);
  const candidate = clickedCandidate(message);
  assert.equal(candidate.structuralIdentity.landmarkAncestor, undefined);
  assert.equal(candidate.structuralIdentity.deterministicStructuralIdentity, true);
});

test("7/rawChildOwner. a click physically on an inner span still attributes structural evidence to the actionable <button> ancestor, never the span", () => {
  const icon = fakeEl({ tag: "span" });
  const button = fakeEl({ tag: "button", id: "icon-btn" });
  append(button, icon);
  const root = fakeEl({ tag: "div" });
  append(root, button);
  const message = evalCaptureScriptAndFireClick(root, icon);
  const composedPath = message.composedPath as any[];
  // The span itself is never actionable and gets no structural evidence; the button (further up
  // the composed path) is the real owner and does.
  assert.equal(composedPath[0].actionable, false);
  assert.equal(composedPath[0].structuralIdentity, undefined);
  const buttonCandidate = composedPath.find((c) => c.tag === "button");
  assert.ok(buttonCandidate.structuralIdentity);
});

test("8/iconOnlyButton + 9/noFakeAccessibleName. an icon-only button (no accessible name) still carries structural evidence, never a fabricated name", () => {
  const button = fakeEl({ tag: "button", id: "search-icon-btn" });
  const root = fakeEl({ tag: "div" });
  append(root, button);
  const message = evalCaptureScriptAndFireClick(root, button);
  const candidate = clickedCandidate(message);
  assert.equal(candidate.accessibleName, undefined, "no accessible name is ever fabricated for an unnamed icon button");
  assert.ok(candidate.structuralIdentity, "structural evidence must still be preserved");
  assert.equal(candidate.structuralIdentity.deterministicStructuralIdentity, true);
});

test("11/noPosition. no nth/first/last/positional concept appears anywhere in the computed structural identity", () => {
  const link = fakeEl({ tag: "a", id: "x", attrs: { href: "/y" } });
  const root = fakeEl({ tag: "div" });
  append(root, link);
  const message = evalCaptureScriptAndFireClick(root, link);
  const serialized = JSON.stringify(clickedCandidate(message).structuralIdentity);
  assert.doesNotMatch(serialized, /nth|first|last|index/i);
});

test("12/generic. no app/project/business hardcode -- an arbitrary field/landmark shape works identically", () => {
  const link = fakeEl({ tag: "a", attrs: { "aria-label": "Cualquier acción", href: "/cualquier/ruta" } });
  const aside = fakeEl({ tag: "aside" });
  append(aside, link);
  const root = fakeEl({ tag: "div" });
  append(root, aside);
  const message = evalCaptureScriptAndFireClick(root, link);
  const candidate = clickedCandidate(message);
  assert.equal(candidate.structuralIdentity.landmarkAncestor?.tag, "aside");
});

test("scoped custom owner. a trusted unresolved target carries only stable scope and local fingerprint evidence", () => {
  const target = fakeEl({ tag: "div", attrs: { "data-field": "custom-control" } });
  const scope = fakeEl({ tag: "form", id: "stable-scope" });
  append(scope, target);
  const root = fakeEl({ tag: "div" });
  append(root, scope);
  const content = buildCaptureScriptV2Content("test-instance");
  const listeners: Record<string, (event: unknown) => void> = {};
  const allNodes = [root, ...collectAll(root)];
  const sent: Array<Record<string, unknown>> = [];
  const fakeDocument = {
    addEventListener(type: string, handler: (event: unknown) => void) { listeners[type] = handler; },
    getElementById() { return null; },
    getElementsByTagName(tag: string) { return allNodes.filter((node) => node.tagName.toLowerCase() === tag.toLowerCase()); },
    querySelectorAll(selector: string) { return allNodes.filter((node) => matches(node, selector)); },
  };
  const fakeWindow = {
    __qaRecordV2: (message: Record<string, unknown>) => { sent.push(message); return Promise.resolve(); },
    getComputedStyle: (node: FakeEl) => ({ cursor: "pointer", pointerEvents: "auto", display: node.computedStyle.display ?? "block", visibility: node.computedStyle.visibility ?? "visible", opacity: node.computedStyle.opacity ?? "1" }),
  };
  const run = new Function("document", "window", "console", content);
  run(fakeDocument, fakeWindow, { info() {} });
  listeners.click({ isTrusted: true, target, composedPath: () => ancestorChain(target), detail: 1 });
  const message = sent.find((entry) => entry.type === "click") as any;
  const candidate = message.composedPath[0];
  assert.equal(candidate.structuralIdentity.scopeIdentity.strategy, "id");
  assert.equal(candidate.structuralIdentity.captureScopeUnique, true);
  assert.equal(candidate.structuralIdentity.captureTargetMatchCount, 1);
  assert.equal(typeof candidate.structuralIdentity.targetFingerprint, "string");
});

test("scoped local fingerprint survives a global collision when the stable ancestor contains one target", () => {
  const target = fakeEl({ tag: "div", attrs: { "data-field": "custom-control" } });
  const scope = fakeEl({ tag: "form", id: "stable-scope" });
  append(scope, target);
  const globalDuplicate = fakeEl({ tag: "div", attrs: { "data-field": "custom-control" } });
  const otherScope = fakeEl({ tag: "form", id: "other-scope" });
  append(otherScope, globalDuplicate);
  const root = fakeEl({ tag: "div" });
  append(root, scope, otherScope);
  const message = evalCaptureScriptAndFireClick(root, target, true);
  const candidate = clickedCandidate(message);
  assert.equal(candidate.structuralIdentity.scopeIdentity.value, "stable-scope");
  assert.equal(candidate.structuralIdentity.captureTargetMatchCount, 1);
  assert.equal(candidate.structuralIdentity.structuralIdentityMatchCount, 1);
  assert.equal(candidate.structuralIdentity.deterministicStructuralIdentity, true);
  assert.equal(typeof candidate.structuralIdentity.targetFingerprint, "string");
});

test("scoped local fingerprint remains fail-closed when the same scope contains two matching targets", () => {
  const target = fakeEl({ tag: "div", attrs: { "data-field": "custom-control" } });
  const duplicate = fakeEl({ tag: "div", attrs: { "data-field": "custom-control" } });
  const scope = fakeEl({ tag: "form", id: "stable-scope" });
  append(scope, target, duplicate);
  const root = fakeEl({ tag: "div" });
  append(root, scope);
  const message = evalCaptureScriptAndFireClick(root, target, true);
  const candidate = clickedCandidate(message);
  assert.equal(candidate.structuralIdentity.captureTargetMatchCount, 2);
  assert.equal(candidate.structuralIdentity.deterministicStructuralIdentity, false);
});

test("scoped structural diagnostics report scope, fingerprint, and redacted attachment inputs", () => {
  const target = fakeEl({ tag: "div", attrs: { "data-field": "diagnostic-only" } });
  append(target, fakeEl({ tag: "span", id: "diagnostic-target" }));
  const scope = fakeEl({ tag: "form", id: "diagnostic-scope-value" });
  append(scope, target);
  const root = fakeEl({ tag: "div" });
  append(root, scope);
  const message = evalCaptureScriptAndFireClick(root, target, true);
  const diagnostics = captureDiagnostics(message);
  const scopeDiagnostic = diagnostics.find((entry) => entry.stage === "structural_scope_diagnostic")!.payload;
  const fingerprintDiagnostic = diagnostics.find((entry) => entry.stage === "structural_target_fingerprint_diagnostic")!.payload;
  assert.equal(scopeDiagnostic.scopeTechnicalRefPresent, true);
  assert.equal(scopeDiagnostic.scopeIdentitySufficient, true);
  assert.equal(fingerprintDiagnostic.fingerprintCandidateCreated, true);
  assert.equal(JSON.stringify(diagnostics).includes("diagnostic-only"), false);
  assert.equal(JSON.stringify(diagnostics).includes("diagnostic-scope-value"), false);
});

test("scoped structural diagnostics expose missing-scope and missing-fingerprint reasons without changing click payload", () => {
  const target = fakeEl({ tag: "div" });
  const root = fakeEl({ tag: "div" });
  append(root, target);
  const message = evalCaptureScriptAndFireClick(root, target);
  const diagnostics = captureDiagnostics(message);
  const scopeDiagnostic = diagnostics.find((entry) => entry.stage === "structural_scope_diagnostic")!.payload;
  const fingerprintDiagnostic = diagnostics.find((entry) => entry.stage === "structural_target_fingerprint_diagnostic")!.payload;
  assert.equal(scopeDiagnostic.scopeTechnicalRefPresent, false);
  assert.equal(scopeDiagnostic.scopeRejectedReason, "no_technical_identity");
  assert.equal(fingerprintDiagnostic.fingerprintCandidateCreated, false);
  assert.equal(fingerprintDiagnostic.fingerprintRejectedReason, "no_structural_evidence");
  assert.equal((message.composedPath as any[])[0].structuralIdentity, undefined);
});

test("performance guard: structural evidence is never computed for a non-actionable/non-editable candidate", () => {
  const container = fakeEl({ tag: "div", attrs: { "data-testid": "wrapper" } });
  const link = fakeEl({ tag: "a", attrs: { href: "/z" } });
  append(container, link);
  const root = fakeEl({ tag: "div" });
  append(root, container);
  const message = evalCaptureScriptAndFireClick(root, link);
  const composedPath = message.composedPath as any[];
  const wrapperCandidate = composedPath.find((c) => c.tag === "div");
  assert.equal(wrapperCandidate.structuralIdentity, undefined, "a plain, non-actionable/non-editable container never gets the expensive structural scan");
});

/**
 * FIRST_LOSS fix (jobId fbec8e45-ce2d-43b0-affc-ea5646bea9c7): `structuralIdentityMatchCount`
 * counted every same-tag node in the WHOLE document sharing the candidate's fingerprint, with no
 * eligibility filtering at all -- a hidden overlay, a disconnected/removed node, or an inert
 * duplicate could inflate the count past 1 even though only ONE node is actually a live,
 * competing structural candidate. `buildCandidateStructuralIdentity` (structural-evidence.ts) now
 * requires any OTHER same-fingerprint node (never the clicked owner itself, which always counts)
 * to be connected, not `hidden`, not behind an `aria-hidden`/`inert` ancestor, and have a real
 * rendered box (computed style display/visibility/opacity + offsetWidth/offsetHeight/
 * getClientRects) before it can compete. Genuinely ambiguous, fully-visible duplicates (test
 * "6/sameLandmarkAmbiguous" above) must still fail closed -- this only removes ineligible noise,
 * never relaxes real ambiguity.
 */
test("13/hiddenDuplicateExcluded. a hidden (display:none) duplicate with the identical fingerprint does not inflate matchCount", () => {
  // A generic stable attribute (shared by both) so deterministicStructuralIdentity can
  // legitimately become true once matchCount correctly drops to 1 -- see structural-owner-identity.ts.
  const clicked = fakeEl({ tag: "button", attrs: { "aria-label": "toggle" } });
  const hiddenDup = fakeEl({ tag: "button", attrs: { "aria-label": "toggle" }, computedStyle: { display: "none" } });
  const main = fakeEl({ tag: "main" });
  append(main, clicked, hiddenDup);
  const root = fakeEl({ tag: "div" });
  append(root, main);
  const message = evalCaptureScriptAndFireClick(root, clicked);
  const candidate = clickedCandidate(message);
  assert.equal(candidate.structuralIdentity.structuralIdentityMatchCount, 1);
  assert.equal(candidate.structuralIdentity.identityAmbiguous, undefined);
  assert.equal(candidate.structuralIdentity.deterministicStructuralIdentity, true);
  const diagnostics = structuralDiagnostics(message);
  assert.equal(diagnostics.find((entry) => entry.prefix === "[structural-identity-candidates]")!.payload.eligibleFingerprintMatchCount, 1);
  assert.equal(diagnostics.find((entry) => entry.prefix === "[structural-identity-candidate]" && entry.payload.display === "none")!.payload.eligible, false);
});

test("14/disconnectedDuplicateExcluded. a disconnected (isConnected:false) duplicate does not inflate matchCount", () => {
  const clicked = fakeEl({ tag: "button", attrs: { "aria-label": "toggle" } });
  const detached = fakeEl({ tag: "button", attrs: { "aria-label": "toggle" }, isConnected: false });
  const main = fakeEl({ tag: "main" });
  append(main, clicked, detached);
  const root = fakeEl({ tag: "div" });
  append(root, main);
  const message = evalCaptureScriptAndFireClick(root, clicked);
  const candidate = clickedCandidate(message);
  assert.equal(candidate.structuralIdentity.structuralIdentityMatchCount, 1);
  assert.equal(candidate.structuralIdentity.deterministicStructuralIdentity, true);
  assert.equal(structuralDiagnostics(message).find((entry) => entry.prefix === "[structural-identity-candidate]" && entry.payload.connected === false)!.payload.eligible, false);
});

test("15/inertDuplicateExcluded. a duplicate behind an aria-hidden ancestor does not inflate matchCount", () => {
  const clicked = fakeEl({ tag: "button", attrs: { "aria-label": "toggle" } });
  const inertWrapper = fakeEl({ tag: "div", attrs: { "aria-hidden": "true" } });
  const inertDup = fakeEl({ tag: "button", attrs: { "aria-label": "toggle" } });
  append(inertWrapper, inertDup);
  const main = fakeEl({ tag: "main" });
  append(main, clicked, inertWrapper);
  const root = fakeEl({ tag: "div" });
  append(root, main);
  const message = evalCaptureScriptAndFireClick(root, clicked);
  const candidate = clickedCandidate(message);
  assert.equal(candidate.structuralIdentity.structuralIdentityMatchCount, 1);
  assert.equal(candidate.structuralIdentity.deterministicStructuralIdentity, true);
  assert.equal(structuralDiagnostics(message).find((entry) => entry.prefix === "[structural-identity-candidate]" && entry.payload.ariaHiddenOrInert === true)!.payload.eligible, false);
});

test("16/twoVisibleDuplicatesStillAmbiguous. two genuinely visible/connected/actionable duplicates still fail closed -- eligibility filtering never relaxes real ambiguity", () => {
  // No id/stable attribute on EITHER element -- matching fingerprints requires identical
  // stableDirectAttributes too, same as "6/sameLandmarkAmbiguous" above.
  const clicked = fakeEl({ tag: "button" });
  const visibleDup = fakeEl({ tag: "button" });
  const main = fakeEl({ tag: "main" });
  append(main, clicked, visibleDup);
  const root = fakeEl({ tag: "div" });
  append(root, main);
  const message = evalCaptureScriptAndFireClick(root, clicked);
  const candidate = clickedCandidate(message);
  assert.equal(candidate.structuralIdentity.structuralIdentityMatchCount, 2);
  assert.equal(candidate.structuralIdentity.identityAmbiguous, true);
  assert.equal(candidate.structuralIdentity.deterministicStructuralIdentity, false);
  const diagnostics = structuralDiagnostics(message);
  assert.equal(diagnostics.find((entry) => entry.prefix === "[structural-identity-candidates]")!.payload.eligibleFingerprintMatchCount, 2);
  assert.equal(diagnostics.filter((entry) => entry.prefix === "[structural-identity-candidate]").length, 2);
});

test("structural diagnostics report the single eligible owner without serializing attribute values", () => {
  const button = fakeEl({ tag: "button", attrs: { "aria-label": "fixture-only-value" } });
  const main = fakeEl({ tag: "main" });
  append(main, button);
  const root = fakeEl({ tag: "div" });
  append(root, main);
  const message = evalCaptureScriptAndFireClick(root, button);
  const diagnostics = structuralDiagnostics(message);
  const summary = diagnostics.find((entry) => entry.prefix === "[structural-identity-candidates]")!.payload;
  assert.deepEqual([summary.fingerprintMatchCountBeforeEligibility, summary.eligibleFingerprintMatchCount], [1, 1]);
  assert.equal(JSON.stringify(diagnostics).includes("fixture-only-value"), false);
});

test("17/structural diagnostics are bounded, redact values, and report unique versus ineligible duplicates without changing identity", () => {
  const clicked = fakeEl({ tag: "button", attrs: { "aria-label": "fixture-value-9f81c2" } });
  const hiddenDup = fakeEl({ tag: "button", attrs: { "aria-label": "fixture-value-9f81c2" }, computedStyle: { display: "none" } });
  const main = fakeEl({ tag: "main" });
  append(main, clicked, hiddenDup);
  const root = fakeEl({ tag: "div" });
  append(root, main);
  const message = evalCaptureScriptAndFireClick(root, clicked);
  const diagnostics = structuralDiagnostics(message);
  const summary = diagnostics.find((entry) => entry.prefix === "[structural-identity-candidates]")!.payload;
  const candidates = diagnostics.filter((entry) => entry.prefix === "[structural-identity-candidate]").map((entry) => entry.payload);
  assert.deepEqual([summary.fingerprintMatchCountBeforeEligibility, summary.eligibleFingerprintMatchCount], [2, 1]);
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every((candidate) => candidate.tag === "button"));
  assert.equal(candidates.find((candidate) => candidate.display === "none")!.eligible, false);
  assert.ok(candidates.every((candidate) => !JSON.stringify(candidate).includes("fixture-value-9f81c2")));
  assert.equal(clickedCandidate(message).structuralIdentity.structuralIdentityMatchCount, 1);
});

test("18/structural diagnostics retain two visible eligible candidates and browser serialization stays helper-safe", () => {
  const clicked = fakeEl({ tag: "button" });
  const duplicate = fakeEl({ tag: "button" });
  const main = fakeEl({ tag: "main" });
  append(main, clicked, duplicate);
  const root = fakeEl({ tag: "div" });
  append(root, main);
  const message = evalCaptureScriptAndFireClick(root, clicked);
  const diagnostics = structuralDiagnostics(message);
  const summary = diagnostics.find((entry) => entry.prefix === "[structural-identity-candidates]")!.payload;
  const candidates = diagnostics.filter((entry) => entry.prefix === "[structural-identity-candidate]").map((entry) => entry.payload);
  assert.deepEqual([summary.fingerprintMatchCountBeforeEligibility, summary.eligibleFingerprintMatchCount], [2, 2]);
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every((candidate) => candidate.eligible === true));
  assert.equal(clickedCandidate(message).structuralIdentity.structuralIdentityMatchCount, 2);
  assert.equal(clickedCandidate(message).structuralIdentity.deterministicStructuralIdentity, false);
  assert.doesNotMatch(buildCaptureScriptV2Content("test-instance"), /__name/);
});

test("19/structural diagnostics expose bounded topology and attribute names, never their values", () => {
  const clicked = fakeEl({ tag: "button" });
  const duplicate = fakeEl({ tag: "button" });
  append(clicked, fakeEl({ tag: "span" }), fakeEl({ tag: "svg" }));
  append(duplicate, fakeEl({ tag: "span" }), fakeEl({ tag: "svg" }));
  const section = fakeEl({ tag: "section", attrs: { "data-testid": "fixture-scope-9f81c2" } });
  const main = fakeEl({ tag: "main" });
  append(section, clicked, duplicate);
  append(main, section);
  const root = fakeEl({ tag: "div" });
  append(root, main);

  const message = evalCaptureScriptAndFireClick(root, clicked);
  const diagnostics = structuralDiagnostics(message);
  const clickedDiagnostic = diagnostics.find((entry) => entry.prefix === "[structural-identity-candidate]" && entry.payload.sameClickedOwner)!.payload;
  assert.deepEqual(clickedDiagnostic.nearestAncestorTags, ["section", "main", "div"]);
  assert.deepEqual(clickedDiagnostic.nearestStableAncestorAttributeNames, ["data-testid"]);
  assert.deepEqual(clickedDiagnostic.childTagCounts, { span: 1, svg: 1 });
  assert.deepEqual(clickedDiagnostic.descendantTagCounts, { span: 1, svg: 1 });
  assert.equal(clickedDiagnostic.formOrSectionOwnership, "section");
  assert.equal(JSON.stringify(diagnostics).includes("fixture-scope-9f81c2"), false);
  assert.equal(clickedCandidate(message).structuralIdentity.structuralIdentityMatchCount, 2);
});

function topologyButton(extraSvgChild: "path" | "rect"): FakeEl {
  const button = fakeEl({ tag: "button" });
  const visual = fakeEl({ tag: "div" });
  const svg = fakeEl({ tag: "svg" });
  append(svg, fakeEl({ tag: "path" }));
  if (extraSvgChild === "rect") append(svg, fakeEl({ tag: "rect" }));
  append(visual, svg);
  append(button, visual, fakeEl({ tag: "h3" }), fakeEl({ tag: "p" }));
  return button;
}

test("20/topologyTieBreak. two eligible base-fingerprint collisions resolve only when bounded descendant topology uniquely identifies the clicked actionable owner", () => {
  const clicked = topologyButton("path");
  const distinctTopology = topologyButton("rect");
  const main = fakeEl({ tag: "main" });
  append(main, clicked, distinctTopology);
  const root = fakeEl({ tag: "div" });
  append(root, main);

  const message = evalCaptureScriptAndFireClick(root, clicked);
  const candidate = clickedCandidate(message);
  const summary = structuralDiagnostics(message).find((entry) => entry.prefix === "[structural-identity-candidates]")!.payload;
  assert.equal(summary.eligibleFingerprintMatchCount, 2, "topology is strictly post-collision evidence");
  assert.equal(summary.topologyTieBreakMatchCount, 1);
  assert.equal(summary.topologyTieBreakApplied, true);
  assert.equal(candidate.structuralIdentity.structuralIdentityMatchCount, 1);
  assert.equal(candidate.structuralIdentity.topologyTieBreakUnique, true);
  assert.equal(candidate.structuralIdentity.deterministicStructuralIdentity, true);
});

test("21/topologyTieBreakFailClosed. equal bounded topology remains ambiguous despite different child insertion order", () => {
  const clicked = topologyButton("rect");
  const sameTopology = fakeEl({ tag: "button" });
  const visual = fakeEl({ tag: "div" });
  const svg = fakeEl({ tag: "svg" });
  append(svg, fakeEl({ tag: "rect" }), fakeEl({ tag: "path" }));
  append(visual, svg);
  // The direct child order differs, but the normalized structural shape and tag counts are identical.
  append(sameTopology, fakeEl({ tag: "p" }), fakeEl({ tag: "h3" }), visual);
  const main = fakeEl({ tag: "main" });
  append(main, clicked, sameTopology);
  const root = fakeEl({ tag: "div" });
  append(root, main);

  const message = evalCaptureScriptAndFireClick(root, clicked);
  const candidate = clickedCandidate(message);
  const summary = structuralDiagnostics(message).find((entry) => entry.prefix === "[structural-identity-candidates]")!.payload;
  assert.equal(summary.eligibleFingerprintMatchCount, 2);
  assert.equal(summary.topologyTieBreakMatchCount, 2);
  assert.equal(summary.topologyTieBreakApplied, false);
  assert.equal(candidate.structuralIdentity.structuralIdentityMatchCount, 2);
  assert.equal(candidate.structuralIdentity.identityAmbiguous, true);
  assert.equal(candidate.structuralIdentity.deterministicStructuralIdentity, false);
});
