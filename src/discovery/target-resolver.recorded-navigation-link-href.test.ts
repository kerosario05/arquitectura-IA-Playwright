import assert from "node:assert/strict";
import test from "node:test";
import { resolveActionTarget } from "./target-resolver";

const baseUrl = "https://app.test/";
const targetName = "Solicitud multiproducto";
const recordedHref = "/requests/create/multiproduct";

function locator(options: { count?: number; href?: string | null; visible?: boolean; enabled?: boolean; scopedCount?: number } = {}, isMainScope = false) {
  return {
    count: async () => isMainScope ? 1 : options.count ?? 0,
    isVisible: async () => options.visible ?? false,
    isEnabled: async () => options.enabled ?? false,
    getAttribute: async (name: string) => name === "href" ? options.href ?? null : null,
    filter: () => locator(options),
    locator: (selector: string) => isMainScope && selector === "a"
      ? locator({ ...options, count: options.scopedCount ?? 1 })
      : locator(),
  };
}

function page(
  options: { count?: number; href?: string | null; visible?: boolean; enabled?: boolean } = {},
  currentBaseUrl = baseUrl,
  liveHref = recordedHref,
) {
  const effectiveOptions = {
    ...options,
    count: options.count ?? 1,
    href: options.href ?? liveHref,
    visible: options.visible ?? true,
    enabled: options.enabled ?? true,
  };
  const liveLink = locator(effectiveOptions);
  return {
    url: () => currentBaseUrl,
    getByRole: () => locator(),
    getByText: () => locator(),
    locator: (selector: string) => selector === "a" ? liveLink : selector === "main" ? locator(effectiveOptions, true) : locator(),
  } as any;
}

function snapshot(currentBaseUrl = baseUrl, currentHref = recordedHref, overrides: Record<string, unknown> = {}) {
  return {
    version: "1.0",
    url: currentBaseUrl,
    title: "Portal",
    capturedAt: "2026-10-07T15:06:51.000Z",
    elements: [{
      id: "link-1",
      type: "link",
      role: "link",
      tagName: "a",
      text: targetName,
      accessibleName: targetName,
      visible: true,
      disabled: false,
      href: new URL(currentHref, currentBaseUrl).href,
      candidateLocators: [],
      dataHints: [],
    }],
    summary: { totalElements: 1, buttons: 0, links: 1, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
    ...overrides,
  } as any;
}

function recordedTarget(href = recordedHref) {
  return {
    targetType: "structural",
    locatorCandidates: [{ strategy: "role", value: `link|${targetName}`, confidence: 0.9 }],
    structuralContext: {
      owner: { tag: "a" },
      stableDirectAttributes: { href },
      stableDescendants: [],
      semanticShape: ["span"],
      landmarkAncestor: { tag: "main" },
      deterministicStructuralIdentity: true,
      identityAmbiguous: false,
    },
    stableAttributes: {},
    interactionEvidence: ["click"],
    confidence: 0.9,
    validatedByInteraction: true,
  } as any;
}

async function resolve(input: {
  baseUrl?: string;
  href?: string;
  page?: ReturnType<typeof page>;
  snapshot?: ReturnType<typeof snapshot>;
  target?: any;
} = {}) {
  const currentBaseUrl = input.baseUrl ?? baseUrl;
  const currentHref = input.href ?? recordedHref;
  const currentPage = input.page ?? page({}, currentBaseUrl, currentHref);
  return resolveActionTarget(currentPage, input.snapshot ?? snapshot(currentBaseUrl, currentHref), targetName, {
    expectedRouteBefore: currentPage.url(),
    actionType: "action_click",
    recordingActionType: "click",
    recordedTechnicalTargetRefs: [`role:link|${targetName}`],
    recordedTechnicalTargets: [input.target ?? recordedTarget(currentHref)],
  });
}

test("a recorded anchor recovers within its recorded landmark when the page has a duplicate outside it", async () => {
  const one = snapshot().elements[0];
  const result = await resolve({
    page: page({ count: 2, scopedCount: 1 }),
    snapshot: snapshot(baseUrl, recordedHref, { elements: [one, { ...one, id: "link-outside-main" }] }),
  });
  assert.equal(result.status, "resolved");
  assert.equal(result.locatorStrategy, "recorded:link-exact-name-href");
  assert.equal(result.matchReason, "recorded_navigation_link_current_dom_href");
});

test("a recorded anchor recovers after its landmark changes when exact name and same-origin href remain unique", async () => {
  const result = await resolve();
  assert.equal(result.status, "resolved");
  assert.equal(result.locatorStrategy, "recorded:link-exact-name-href");
  assert.equal(result.matchReason, "recorded_navigation_link_current_dom_href");
});

test("the same recorded-link contract works on a second independent app origin", async () => {
  const secondOrigin = "https://qa1.santacruz.do/onlinebanking/";
  const secondHref = "/onlinebanking/Empresarial";
  const secondTarget = recordedTarget(secondHref);
  secondTarget.locatorCandidates = [{ strategy: "role", value: `link|${targetName}`, confidence: 0.9 }];
  const result = await resolve({ baseUrl: secondOrigin, href: secondHref, target: secondTarget });
  assert.equal(result.status, "resolved");
  assert.equal(result.locatorStrategy, "recorded:link-exact-name-href");
});

test("a link with the exact name but a different destination is rejected", async () => {
  const result = await resolve({ snapshot: snapshot(baseUrl, recordedHref, { elements: [{
    ...snapshot().elements[0], href: "https://app.test/requests/create/other",
  }] }) });
  assert.equal(result.status, "not_found");
});

test("a duplicate exact-name live anchor remains ambiguous", async () => {
  const one = snapshot().elements[0];
  const result = await resolve({
    page: page({ count: 2, scopedCount: 2 }),
    snapshot: snapshot(baseUrl, recordedHref, { elements: [one, { ...one, id: "link-2" }] }),
  });
  assert.equal(result.status, "not_found");
});

test("a recorded external href cannot authorize same-name link fallback", async () => {
  const result = await resolve({ target: recordedTarget("https://other.test/requests/create/multiproduct") });
  assert.equal(result.status, "not_found");
});

test("a recorded button does not enter the navigation-link fallback", async () => {
  const buttonTarget = recordedTarget();
  buttonTarget.structuralContext.owner = { tag: "button" };
  buttonTarget.locatorCandidates = [{ strategy: "role", value: `button|${targetName}`, confidence: 0.9 }];
  const result = await resolve({ target: buttonTarget });
  assert.equal(result.status, "not_found");
});

test("a uniquely named link with a changed live href is rejected after locator resolution", async () => {
  const result = await resolve({ page: page({ href: "/requests/create/other" }) });
  assert.equal(result.status, "not_found");
});
