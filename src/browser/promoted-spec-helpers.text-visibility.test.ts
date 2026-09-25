import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "@playwright/test";
import { capturePageDiagnostics } from "./promoted-spec-helpers";

/**
 * FIRST_LOSS fix (runId=17aad15e-...): `scanPageTexts`'s old visibility check only inspected a
 * text node's IMMEDIATE parent's own `getComputedStyle().display`/`.visibility` -- `display` is
 * never inherited, so an ANCESTOR wrapper hidden via `display: none` (the common way a
 * modal/dialog is toggled hidden while its own inner text-holding elements keep their normal
 * `display`) never made the inner text's own computed `display` become "none". That inner text
 * was reported as visible even though nothing on screen actually shows it -- a real
 * false-positive source for any `visibleTexts`-based detection (e.g.
 * `detectHomeResetOrInactivity`'s `session_expiring_warning`/`inactivity_message` patterns).
 *
 * A minimal fake DOM (element/style graph only, no real jsdom) drives the exact ancestor-walk
 * added to `scanPageTexts`, via `page.evaluate` executing the real closure against these stubs.
 */

type FakeElement = {
  tagName: string;
  parentElement: FakeElement | null;
  style: { display: string; visibility: string };
  childNodes: FakeTextNode[];
};

type FakeTextNode = {
  nodeType: 3;
  textContent: string;
  parentElement: FakeElement;
};

function makeElement(tag: string, parent: FakeElement | null, style: Partial<{ display: string; visibility: string }> = {}): FakeElement {
  return {
    tagName: tag,
    parentElement: parent,
    style: { display: style.display ?? "block", visibility: style.visibility ?? "visible" },
    childNodes: [],
  };
}

function fakePageWithDom(build: () => { body: FakeElement; textNodes: FakeTextNode[] }): Page {
  return {
    evaluate: async (fn: () => unknown) => {
      const { body, textNodes } = build();
      const previousDocument = (globalThis as any).document;
      const previousWindow = (globalThis as any).window;
      const previousNodeFilter = (globalThis as any).NodeFilter;
      (globalThis as any).NodeFilter = { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2 };
      (globalThis as any).window = {
        getComputedStyle: (el: FakeElement) => ({ display: el.style.display, visibility: el.style.visibility }),
      };
      (globalThis as any).document = {
        body,
        createTreeWalker: (_root: FakeElement, _type: number, filter: { acceptNode: (node: FakeTextNode) => number }) => {
          const accepted = textNodes.filter((node) => filter.acceptNode(node) === 1);
          let index = -1;
          return {
            nextNode: () => {
              index += 1;
              return index < accepted.length ? accepted[index] : null;
            },
          };
        },
      };
      try {
        return await (fn as () => unknown)();
      } finally {
        (globalThis as any).document = previousDocument;
        (globalThis as any).window = previousWindow;
        (globalThis as any).NodeFilter = previousNodeFilter;
      }
    },
    url: () => "https://example.test/app",
    title: async () => "",
    isClosed: () => false,
    context: () => ({}),
    locator: () => ({
      all: async () => [],
      filter() { return this; },
      count: async () => 0,
    }),
  } as unknown as Page;
}

test("1/ancestorHiddenTextExcluded. text whose ANCESTOR wrapper is display:none is excluded, even though its own direct parent has a normal display", async () => {
  const page = fakePageWithDom(() => {
    const body = makeElement("body", null);
    const dialogWrapper = makeElement("div", body, { display: "none" }); // the dialog itself is hidden
    const innerParagraph = makeElement("p", dialogWrapper, { display: "block" }); // inner text's OWN parent looks normal
    const textNode: FakeTextNode = { nodeType: 3, textContent: "Sesion a punto de expirar", parentElement: innerParagraph };
    return { body, textNodes: [textNode] };
  });

  const diag = await capturePageDiagnostics(page);
  assert.deepEqual(diag.visibleTexts, [], "text hidden by an ancestor's display:none must never be reported as visible");
});

test("2/genuinelyVisibleDialogTextStillDetected. a genuinely visible dialog's text is still reported -- regression guard", async () => {
  const page = fakePageWithDom(() => {
    const body = makeElement("body", null);
    const dialogWrapper = makeElement("div", body, { display: "block" }); // the dialog IS shown
    const innerParagraph = makeElement("p", dialogWrapper, { display: "block" });
    const textNode: FakeTextNode = { nodeType: 3, textContent: "Sesion a punto de expirar", parentElement: innerParagraph };
    return { body, textNodes: [textNode] };
  });

  const diag = await capturePageDiagnostics(page);
  assert.deepEqual(diag.visibleTexts, ["Sesion a punto de expirar"], "a genuinely visible dialog's own text must still be detected, unchanged");
});

test("3/ancestorVisibilityHiddenExcluded. text under an ancestor with visibility:hidden is excluded", async () => {
  const page = fakePageWithDom(() => {
    const body = makeElement("body", null);
    const dialogWrapper = makeElement("div", body, { visibility: "hidden" });
    const innerParagraph = makeElement("p", dialogWrapper, { visibility: "visible" });
    const textNode: FakeTextNode = { nodeType: 3, textContent: "hidden via visibility", parentElement: innerParagraph };
    return { body, textNodes: [textNode] };
  });

  const diag = await capturePageDiagnostics(page);
  assert.deepEqual(diag.visibleTexts, []);
});
