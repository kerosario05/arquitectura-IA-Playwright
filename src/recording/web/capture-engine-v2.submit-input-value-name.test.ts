import assert from "node:assert/strict";
import test from "node:test";
import { buildCaptureScriptV2Content } from "./capture-engine-v2.browser-instrumentation";

/**
 * FIRST_LOSS (recordingId=efff98e2-...): <input type="submit" value="Continuar"> is a void
 * element -- it can never have textContent -- so `explicitAccessibleName` (which only ever
 * checked aria-label/aria-labelledby/label[for]) always returned "", and the button fell all the
 * way through to the generic "control" sentinel label regardless of its real, visible value.
 * Confirmed against a real recording whose Continuar button used exactly this markup.
 *
 * Fixed by reading `.value` for input[type=submit|button|reset] as the accessible name, matching
 * the standard HTML accessible-name computation for these void, text-less input types.
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
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    querySelectorAll: () => [],
    closest: () => null,
    contains: () => false,
  };
  return el;
}

/** Evaluates the REAL generated V2 script and fires a click on `target`. */
function evalCaptureScriptAndFireClick(target: FakeEl): { accessibleName?: string } {
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
  const message = sent.find((m) => m.type === "click") as unknown as { composedPath: Array<{ accessibleName?: string }> };
  return message.composedPath[0];
}

test("input[type=submit] with a value attribute is named from value, not left as a generic sentinel", () => {
  const button = fakeEl({ tag: "input", attrs: { type: "submit", class: "new-btn new-btn-primary" }, value: "Continuar" });
  const candidate = evalCaptureScriptAndFireClick(button);
  assert.equal(candidate.accessibleName, "Continuar");
});

test("input[type=text] value is never treated as an accessible name", () => {
  const input = fakeEl({ tag: "input", attrs: { type: "text" }, value: "some typed value" });
  const candidate = evalCaptureScriptAndFireClick(input);
  assert.notEqual(candidate.accessibleName, "some typed value");
});

test("input[type=submit] with no value at all still falls through with no fabricated name", () => {
  const button = fakeEl({ tag: "input", attrs: { type: "submit" } });
  const candidate = evalCaptureScriptAndFireClick(button);
  assert.ok(!candidate.accessibleName);
});
