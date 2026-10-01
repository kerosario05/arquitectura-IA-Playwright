import assert from "node:assert/strict";
import test from "node:test";
import { buildCaptureScriptV2Content } from "./capture-engine-v2.browser-instrumentation";

/**
 * FIRST_LOSS: `alt` is a native, explicit accessible-name source (img/area/input type=image)
 * per the standard HTML/ARIA accessible-name computation, but `explicitAccessibleName` never
 * read it -- a trusted click on an unlabeled clickable <img> had no explicit name to classify,
 * so Capture V2 recorded it only as an unlabeled structural "control" instead of a semantic
 * role+name identifier (confirmed against a real recording where the same element resolved
 * correctly and uniquely at runtime via its native image role and alt-derived name).
 *
 * Generic by attribute, never by tag: fixed by reading `alt` for any element that carries it,
 * matching the same pattern already used for input[type=submit].value.
 */

type FakeEl = {
  nodeType: 1;
  tagName: string;
  id: string;
  disabled: boolean;
  textContent: string;
  value?: string;
  children: FakeEl[];
  parentElement: FakeEl | null;
  labels?: FakeEl[];
  attrs: Record<string, string>;
  getAttribute: (name: string) => string | null;
  hasAttribute: (name: string) => boolean;
  getBoundingClientRect: () => { width: number; height: number };
  querySelectorAll: (selector: string) => FakeEl[];
  closest: (selector: string) => FakeEl | null;
  contains: (other: FakeEl) => boolean;
};

function fakeEl(opts: { tag: string; attrs?: Record<string, string>; value?: string }): FakeEl {
  const el: FakeEl = {
    nodeType: 1,
    tagName: opts.tag.toUpperCase(),
    id: "",
    disabled: false,
    textContent: "",
    value: opts.value,
    children: [],
    parentElement: null,
    labels: [],
    attrs: opts.attrs ?? {},
    getAttribute: (name) => (opts.attrs ?? {})[name] ?? null,
  hasAttribute: (name: string) => Object.prototype.hasOwnProperty.call(opts.attrs ?? {}, name),
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    querySelectorAll: () => [],
    closest: () => null,
    contains: () => false,
  };
  return el;
}

/** Evaluates the REAL generated V2 script and fires a click on `target`. */
function evalCaptureScriptAndFireClick(target: FakeEl): { accessibleName?: string; role?: string } {
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
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function("document", "window", content);
  run(fakeDocument, fakeWindow);
  listeners.click({ composedPath: () => [target], detail: 1 });
  const message = sent.find((m) => m.type === "click") as unknown as { composedPath: Array<{ accessibleName?: string; role?: string }> };
  return message.composedPath[0];
}

test("img with an alt attribute is named from alt, not left as an unlabeled control", () => {
  const img = fakeEl({ tag: "img", attrs: { alt: "Tarjeta Producto Ejemplo" } });
  const candidate = evalCaptureScriptAndFireClick(img);
  assert.equal(candidate.accessibleName, "Tarjeta Producto Ejemplo");
});

test("img with no alt at all still falls through with no fabricated name", () => {
  const img = fakeEl({ tag: "img", attrs: {} });
  const candidate = evalCaptureScriptAndFireClick(img);
  assert.ok(!candidate.accessibleName);
});

test("aria-label still wins over alt when both are present", () => {
  const img = fakeEl({ tag: "img", attrs: { alt: "alt text", "aria-label": "aria label text" } });
  const candidate = evalCaptureScriptAndFireClick(img);
  assert.equal(candidate.accessibleName, "aria label text");
});

test("a decorative, non-interactive img click still carries structural evidence, not a fabricated business identity", () => {
  const img = fakeEl({ tag: "img", attrs: { alt: "decorative" } });
  const candidate = evalCaptureScriptAndFireClick(img);
  // The alt-derived name must be the real accessible name, never coordinate/positional authority.
  assert.equal(candidate.accessibleName, "decorative");
});
