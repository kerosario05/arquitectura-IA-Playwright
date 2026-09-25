import assert from "node:assert/strict";
import test from "node:test";
import { buildCaptureScriptV2Content } from "./capture-engine-v2.browser-instrumentation";

/**
 * FIRST_LOSS (this ticket): `toCandidate()` computed `associatedField` for EVERY candidate,
 * regardless of whether it already had a real, usable `accessibleName` -- so a genuinely named
 * owner (a real "Iniciar sesión" button, a real aria-label="Depurar" button) still had an
 * unrelated nearby label's text attached as its `associatedField`. The prior ticket's
 * `resolveRecordedField` precedence fix (semantic-recording.ts) stopped that false relation from
 * WINNING downstream, but the false relation itself was still captured and stored. Fixed at the
 * source: `associatedField` is now only ever computed (data-field-owner OR the structural
 * ancestor walk) when `accessibleName` is falsy ("" -- no usable own name at all).
 *
 * These tests execute the REAL generated browser script (via `new Function`, with a minimal fake
 * DOM implementing only what `toCandidate`/`computeAccessibleName`/`computeAssociatedField` call:
 * getAttribute/getBoundingClientRect/children/parentElement/querySelectorAll/contains/labels) --
 * not just a structural/regex check -- so this is genuine behavioral coverage of the
 * DOM-dependent logic, not merely a source-text assertion.
 */

type FakeEl = {
  nodeType: 1;
  tagName: string;
  id: string;
  disabled: boolean;
  textContent: string;
  children: FakeEl[];
  parentElement: FakeEl | null;
  labels?: FakeEl[];
  getAttribute: (name: string) => string | null;
  getBoundingClientRect: () => { width: number; height: number };
  querySelectorAll: () => FakeEl[];
  contains: (other: FakeEl) => boolean;
};

function fakeEl(opts: {
  tag: string;
  attrs?: Record<string, string>;
  id?: string;
  textContent?: string;
  visible?: boolean;
  hasLabels?: boolean;
}): FakeEl {
  const el: FakeEl = {
    nodeType: 1,
    tagName: opts.tag.toUpperCase(),
    id: opts.id ?? "",
    disabled: false,
    textContent: opts.textContent ?? "",
    children: [],
    parentElement: null,
    labels: opts.hasLabels === false ? undefined : [],
    getAttribute: (name) => (opts.attrs ?? {})[name] ?? null,
    getBoundingClientRect: () => (opts.visible === false ? { width: 0, height: 0 } : { width: 10, height: 10 }),
    querySelectorAll: () => [],
    contains: (other) => other === el,
  };
  return el;
}

/** Wires a container as the parent of each child and gives it a fixed interactive-descendant count. */
function container(children: FakeEl[], interactiveDescendants: FakeEl[]): FakeEl {
  const el = fakeEl({ tag: "div" });
  el.children = children;
  el.querySelectorAll = () => interactiveDescendants;
  for (const child of children) child.parentElement = el;
  return el;
}

/** Evaluates the REAL generated V2 script against a minimal fake document/window and exposes a way to fire a click. */
function evalCaptureScriptAndFireClick(target: FakeEl): { composedPath: Array<{ accessibleName?: string; associatedField?: string; tag: string }>; sent: Array<Record<string, unknown>> } {
  const content = buildCaptureScriptV2Content("test-instance");
  const listeners: Record<string, (event: unknown) => void> = {};
  const fakeDocument = {
    addEventListener(type: string, handler: (event: unknown) => void) {
      listeners[type] = handler;
    },
    getElementById() {
      return null;
    },
  };
  const sent: Array<Record<string, unknown>> = [];
  const fakeWindow = {
    __qaRecordV2: (message: Record<string, unknown>) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- exact same mechanism the prior ticket used to smoke-test parse validity; here also used to actually execute it.
  const run = new Function("document", "window", content);
  run(fakeDocument, fakeWindow);
  listeners.pointerdown?.({ isTrusted: true });
  // The script fires its own "document_ready" message synchronously right after registering
  // listeners -- sent[0] is that, never the click.
  listeners.click({ composedPath: () => [target], detail: 1 });
  const click = sent.find((message) => message.type === "click") as unknown as { composedPath: Array<{ accessibleName?: string; associatedField?: string; tag: string }> };
  return { ...click, sent };
}

test("Capture V2 document readiness coexists with pointer and click transport", () => {
  const result = evalCaptureScriptAndFireClick(fakeEl({ tag: "button", textContent: "Action" }));
  assert.ok(result.sent.some((message) => message.type === "document_ready"));
  const revision = result.sent.find((message) => message.type === "capture_trace" && message.stage === "instrumentation_revision") as { diagnostic?: { instrumentationRevision?: string } } | undefined;
  assert.equal(revision?.diagnostic?.instrumentationRevision, "capture-v2-structural-provenance-v1");
  assert.ok(result.sent.findIndex((message) => message.type === "capture_trace" && message.stage === "instrumentation_revision") < result.sent.findIndex((message) => message.type === "document_ready"));
  assert.ok(result.sent.some((message) => message.type === "capture_trace" && message.stage === "listener_installed"));
  assert.ok(result.sent.some((message) => message.type === "capture_trace" && message.stage === "pointer_observed"));
  assert.ok(result.sent.some((message) => message.type === "capture_trace" && message.stage === "click_handler_entered"));
  assert.ok(result.sent.some((message) => message.type === "click"));
  const pointer = result.sent.find((message) => message.type === "pointer") as { interactionId?: string } | undefined;
  const click = result.sent.find((message) => message.type === "click") as { interactionId?: string } | undefined;
  assert.ok(pointer?.interactionId);
  assert.equal(click?.interactionId, pointer?.interactionId);
});

test("1. named Login button: real accessibleName present -- associatedField is NOT computed at all", () => {
  const btn = fakeEl({ tag: "button", textContent: "Iniciar sesión" });
  container([fakeEl({ tag: "label", textContent: "Usuario" }), btn], [btn]);
  const message = evalCaptureScriptAndFireClick(btn);
  assert.equal(message.composedPath[0].accessibleName, "Iniciar sesión");
  assert.equal(message.composedPath[0].associatedField, undefined, "must never carry the nearby 'Usuario' label -- the physically-observed regression");
});

test("2. aria-named Depurar button inside a noisy ancestor: associatedField is NOT computed at all", () => {
  const btn = fakeEl({ tag: "button", attrs: { "aria-label": "Depurar" } });
  container([fakeEl({ tag: "span", textContent: "Salir" }), fakeEl({ tag: "span", textContent: "Cancelar" }), btn], [btn]);
  const message = evalCaptureScriptAndFireClick(btn);
  assert.equal(message.composedPath[0].accessibleName, "Depurar");
  assert.equal(message.composedPath[0].associatedField, undefined, "must never carry 'Salir'/'Cancelar' -- the physically-observed regression");
});

test("3. named Aceptar/Cancelar/Continuar buttons: none ever get a structural associatedField", () => {
  for (const label of ["Aceptar", "Cancelar", "Continuar"]) {
    const btn = fakeEl({ tag: "button", textContent: label });
    container([fakeEl({ tag: "label", textContent: "Some Nearby Field" }), btn], [btn]);
    const message = evalCaptureScriptAndFireClick(btn);
    assert.equal(message.composedPath[0].accessibleName, label);
    assert.equal(message.composedPath[0].associatedField, undefined, `"${label}" must never inherit a nearby unrelated label`);
  }
});

test("4. option's own text is untouched: a named option never gets a structural associatedField from a sibling", () => {
  const option = fakeEl({ tag: "option", textContent: "DOP" });
  container([fakeEl({ tag: "label", textContent: "Moneda" }), option], [option]);
  const message = evalCaptureScriptAndFireClick(option);
  assert.equal(message.composedPath[0].accessibleName, "DOP");
  assert.equal(message.composedPath[0].associatedField, undefined);
});

test("5. named custom combobox (aria-label): no structural associatedField", () => {
  const combo = fakeEl({ tag: "span", attrs: { role: "combobox", "aria-label": "Producto" }, hasLabels: false });
  container([fakeEl({ tag: "label", textContent: "Tipo" }), combo], [combo]);
  const message = evalCaptureScriptAndFireClick(combo);
  assert.equal(message.composedPath[0].accessibleName, "Producto");
  assert.equal(message.composedPath[0].associatedField, undefined);
});

test("6. unnamed input: associatedField still resolves structurally (fallback preserved)", () => {
  const input = fakeEl({ tag: "input" });
  container([fakeEl({ tag: "label", textContent: "Número de identificación" }), input], [input]);
  const message = evalCaptureScriptAndFireClick(input);
  assert.equal(message.composedPath[0].accessibleName, undefined);
  assert.equal(message.composedPath[0].associatedField, "Número de identificación");
});

test("7. unnamed icon-only button: associatedField still resolves structurally (fallback preserved)", () => {
  const iconBtn = fakeEl({ tag: "button", textContent: "" });
  const input = fakeEl({ tag: "input" });
  container([fakeEl({ tag: "label", textContent: "Número de identificación" }), input, iconBtn], [input, iconBtn]);
  const message = evalCaptureScriptAndFireClick(iconBtn);
  assert.equal(message.composedPath[0].accessibleName, undefined);
  assert.equal(message.composedPath[0].associatedField, "Número de identificación");
});

test("8. unnamed custom combobox: associatedField still resolves structurally (fallback preserved)", () => {
  const combo = fakeEl({ tag: "span", attrs: { role: "combobox" }, hasLabels: false });
  container([fakeEl({ tag: "label", textContent: "Tipo de producto" }), combo], [combo]);
  const message = evalCaptureScriptAndFireClick(combo);
  assert.equal(message.composedPath[0].accessibleName, undefined);
  assert.equal(message.composedPath[0].associatedField, "Tipo de producto");
});

test("9. accessibleName and associatedField remain separate fields -- never merged/copied into one another, for either a named or unnamed owner", () => {
  const named = fakeEl({ tag: "button", textContent: "Aceptar" });
  container([fakeEl({ tag: "label", textContent: "Campo Vecino" }), named], [named]);
  const namedMessage = evalCaptureScriptAndFireClick(named);
  assert.notEqual(namedMessage.composedPath[0].accessibleName, namedMessage.composedPath[0].associatedField);
  assert.equal(namedMessage.composedPath[0].accessibleName, "Aceptar");

  const unnamed = fakeEl({ tag: "input" });
  container([fakeEl({ tag: "label", textContent: "Número de identificación" }), unnamed], [unnamed]);
  const unnamedMessage = evalCaptureScriptAndFireClick(unnamed);
  assert.equal(unnamedMessage.composedPath[0].accessibleName, undefined);
  assert.equal(unnamedMessage.composedPath[0].associatedField, "Número de identificación");
});

test("12. no app/project-specific hardcode: the gating logic is generic (usable(accessibleName) ? undefined : structural), verified with arbitrary unrelated strings", () => {
  const btn = fakeEl({ tag: "button", textContent: "Cualquier Etiqueta Real" });
  container([fakeEl({ tag: "label", textContent: "Cualquier Campo Cercano" }), btn], [btn]);
  const message = evalCaptureScriptAndFireClick(btn);
  assert.equal(message.composedPath[0].accessibleName, "Cualquier Etiqueta Real");
  assert.equal(message.composedPath[0].associatedField, undefined);
});
