import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { chromium } from "@playwright/test";
import { createPromotedSpecRuntime } from "./promoted-spec-runtime";

/**
 * FIRST_LOSS fix (jobId 938b796f-a927-49cf-95bd-3ed66d3e49c0): clickPromotedTarget only ever
 * knew how to execute a bare "strategy:value" locator ref -- for certified_structural authority
 * that ref was `locatorCandidates[0]` alone (e.g. a bare CSS attribute fragment), which the
 * physical runtime proved is not standalone-unique. Fixed by giving clickPromotedTarget a
 * SEPARATE, exigent path for a certified structural identity rich enough (owner present) for the
 * shared resolveRecordedStructuralOwner resolver (the SAME one Discovery's own recording replay
 * already uses) -- never a second/parallel structural resolver, never a fabricated fallback.
 *
 * Config `enabled: false` is used so postActionStability/capturePromotedActionSurfaceSnapshot
 * (both already gated on `this.config.enabled`, unmodified) short-circuit immediately -- these
 * tests target the NEW structural-authority wiring in isolation, not the pre-existing evidence/
 * stability machinery. `clickPromotedTargetViaStructuralAuthority` is invoked directly (bypassing
 * the public clickPromotedTarget's markBoundaryProgress/ensureInitialEvidence bootstrap, which is
 * unrelated pre-existing machinery this ticket does not touch) -- a separate structural test
 * verifies clickPromotedTarget's own public dispatch to it.
 */

type StubLocator = {
  count: () => Promise<number>;
  isVisible: () => Promise<boolean>;
  isEnabled: () => Promise<boolean>;
  waitFor: () => Promise<void>;
  click: () => Promise<void>;
};

function buildStructuralStubPage(options: { finalCount: number; finalVisible?: boolean; finalEnabled?: boolean }) {
  const clicks: string[] = [];
  const locatorCalls: string[] = [];
  const page = {
    url: () => "https://example.test/",
    on: () => {},
    locator(selector: string): StubLocator {
      locatorCalls.push(selector);
      // Only the FINAL nearestOwnerSelector query (resolveRecordedStructuralOwner's own
      // uniqueness verdict) includes this CSS syntax marker -- every earlier, progressive
      // narrowing query (owner tag / stable attrs / descendants / semantic shape) just needs a
      // non-zero count to proceed, which this stub gives unconditionally.
      const isFinal = selector.includes(":not(:has(");
      return {
        count: async () => (isFinal ? options.finalCount : 1),
        isVisible: async () => options.finalVisible ?? true,
        isEnabled: async () => options.finalEnabled ?? true,
        waitFor: async () => {},
        click: async () => { clicks.push(selector); },
      };
    },
  } as any;
  return { page, clicks, locatorCalls };
}

const STRUCTURAL_TARGET = {
  targetType: "structural" as const,
  locatorCandidates: [{ strategy: "css", value: '[href="/synthetic/target"]', confidence: 0.9 }],
  structuralContext: {
    owner: { tag: "a" },
    stableDirectAttributes: { href: "/synthetic/target" },
    stableDescendants: [],
    semanticShape: [],
    deterministicStructuralIdentity: true,
    identityAmbiguous: false,
    structuralIdentityMatchCount: 1,
  },
  interactionEvidence: [],
  confidence: 0.9,
  validatedByInteraction: true,
};

test("1/PROMOTED_CLICK_STRUCTURAL_PATH: with a unique structural resolution, the shared resolver's Locator is clicked -- never the bare locatorCandidate", async () => {
  const { page, clicks, locatorCalls } = buildStructuralStubPage({ finalCount: 1 });
  const runtime = createPromotedSpecRuntime(page, { enabled: false });

  await (runtime as any).clickPromotedTargetViaStructuralAuthority({
    stepIndex: 4,
    target: '[href="/synthetic/target"]',
    actionIntent: "click",
    expectedEffect: "none",
    structuralTarget: STRUCTURAL_TARGET,
  });

  assert.equal(clicks.length, 1, "exactly one click must be dispatched");
  assert.ok(locatorCalls.some((selector) => selector.includes("a")), "the structural resolver must query using the owner tag, not a bare attribute-only fragment");
});

test("2/AMBIGUOUS_STRUCTURAL_FAIL_CLOSED: when the shared resolver cannot produce a unique element, the click fails closed -- no fallback to a weaker locator", async () => {
  const { page, clicks } = buildStructuralStubPage({ finalCount: 2 });
  const runtime = createPromotedSpecRuntime(page, { enabled: false });

  await assert.rejects(
    (runtime as any).clickPromotedTargetViaStructuralAuthority({
      stepIndex: 4,
      target: '[href="/synthetic/target"]',
      actionIntent: "click",
      expectedEffect: "none",
      structuralTarget: STRUCTURAL_TARGET,
    }),
    /structural_authority_not_unique_or_unresolved/,
  );
  assert.equal(clicks.length, 0, "no click may be dispatched when the structural authority does not resolve uniquely");
});

test("2b/STRUCTURAL_FAILURE_REASON_TRANSPORT: the resolver's own specific reason (action_owner_ambiguous for a >1 final count) is carried into the thrown error, not just the umbrella code", async () => {
  const { page } = buildStructuralStubPage({ finalCount: 2 });
  const runtime = createPromotedSpecRuntime(page, { enabled: false });

  await assert.rejects(
    (runtime as any).clickPromotedTargetViaStructuralAuthority({
      stepIndex: 4,
      target: '[href="/synthetic/target"]',
      actionIntent: "click",
      expectedEffect: "none",
      structuralTarget: STRUCTURAL_TARGET,
    }),
    /structuralFailureReason=action_owner_ambiguous/,
  );
});

test("3/AMBIGUOUS_STRUCTURAL_FAIL_CLOSED: zero matches also fails closed, never silently no-ops", async () => {
  const { page, clicks } = buildStructuralStubPage({ finalCount: 0 });
  const runtime = createPromotedSpecRuntime(page, { enabled: false });

  await assert.rejects(
    (runtime as any).clickPromotedTargetViaStructuralAuthority({
      stepIndex: 4,
      target: '[href="/synthetic/target"]',
      actionIntent: "click",
      expectedEffect: "none",
      structuralTarget: STRUCTURAL_TARGET,
    }),
    /structural_authority_not_unique_or_unresolved/,
  );
  assert.equal(clicks.length, 0);
});

test("3b/STRUCTURAL_FAILURE_REASON_TRANSPORT: zero matches carries structural_match_not_unique as the specific reason", async () => {
  const { page } = buildStructuralStubPage({ finalCount: 0 });
  const runtime = createPromotedSpecRuntime(page, { enabled: false });

  await assert.rejects(
    (runtime as any).clickPromotedTargetViaStructuralAuthority({
      stepIndex: 4,
      target: '[href="/synthetic/target"]',
      actionIntent: "click",
      expectedEffect: "none",
      structuralTarget: STRUCTURAL_TARGET,
    }),
    /structuralFailureReason=structural_match_not_unique/,
  );
});

test("3d/RECORDED_ROLE_COMPATIBILITY: a changed DOM attribute may use the exact captured role/name when it remains unique and actionable", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><a href="/new" onclick="this.dataset.clicked=\'yes\'; return false"><span>Solicitud multiproducto</span></a></main>');
    const structuralTarget = {
      ...STRUCTURAL_TARGET,
      locatorCandidates: [{ strategy: "css", value: '[href="/requests/create/multiproduct"]', confidence: 0.85 }],
      structuralContext: {
        ...STRUCTURAL_TARGET.structuralContext,
        stableDirectAttributes: { href: "/requests/create/multiproduct" },
        semanticShape: ["span"],
      },
    };
    const runtime = createPromotedSpecRuntime(page as any, { enabled: false });

    await (runtime as any).clickPromotedTargetViaStructuralAuthority({
      stepIndex: 5,
      target: 'css:[href="/requests/create/multiproduct"]',
      actionIntent: "click",
      expectedEffect: "none",
      structuralTarget,
      structuralSemanticFallbackRefs: ["role:link|Solicitud multiproducto"],
    });

    assert.equal(await page.locator("a").getAttribute("data-clicked"), "yes");
    await runtime.finishEvidence();
  } finally {
    await browser.close();
  }
});

test("3e/RECORDED_ROLE_COMPATIBILITY_FAIL_CLOSED: duplicate captured accessible targets are not clicked", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><a href="/new"><span>Solicitud multiproducto</span></a><a href="/other"><span>Solicitud multiproducto</span></a></main>');
    const structuralTarget = {
      ...STRUCTURAL_TARGET,
      locatorCandidates: [{ strategy: "css", value: '[href="/requests/create/multiproduct"]', confidence: 0.85 }],
      structuralContext: {
        ...STRUCTURAL_TARGET.structuralContext,
        stableDirectAttributes: { href: "/requests/create/multiproduct" },
        semanticShape: ["span"],
      },
    };
    const runtime = createPromotedSpecRuntime(page as any, { enabled: false });

    await assert.rejects(
      (runtime as any).clickPromotedTargetViaStructuralAuthority({
        stepIndex: 5,
        target: 'css:[href="/requests/create/multiproduct"]',
        actionIntent: "click",
        expectedEffect: "none",
        structuralTarget,
        structuralSemanticFallbackRefs: ["role:link|Solicitud multiproducto"],
      }),
      /structural_authority_not_unique_or_unresolved/,
    );
    assert.equal(await page.locator("a[data-clicked]").count(), 0);
  } finally {
    await browser.close();
  }
});

test("3f/RECORDED_ROLE_COMPATIBILITY_DOES_NOT_RESOLVE_STRUCTURAL_AMBIGUITY: a unique role ref cannot override multiple exact structural owners", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><a href="/requests/create/multiproduct"><span>Solicitud multiproducto</span></a><a href="/requests/create/multiproduct"><span>Other link</span></a></main>');
    const structuralTarget = {
      ...STRUCTURAL_TARGET,
      locatorCandidates: [{ strategy: "css", value: '[href="/requests/create/multiproduct"]', confidence: 0.85 }],
      structuralContext: {
        ...STRUCTURAL_TARGET.structuralContext,
        stableDirectAttributes: { href: "/requests/create/multiproduct" },
        semanticShape: ["span"],
      },
    };
    const runtime = createPromotedSpecRuntime(page as any, { enabled: false });

    await assert.rejects(
      (runtime as any).clickPromotedTargetViaStructuralAuthority({
        stepIndex: 5,
        target: 'css:[href="/requests/create/multiproduct"]',
        actionIntent: "click",
        expectedEffect: "none",
        structuralTarget,
        structuralSemanticFallbackRefs: ["role:link|Solicitud multiproducto"],
      }),
      /structuralFailureReason=action_owner_ambiguous/,
    );
    assert.equal(await page.locator("a[data-clicked]").count(), 0);
  } finally {
    await browser.close();
  }
});

test("3c/STALE_SCOPE_RUNTIME_HANDOFF: a promoted click uses the unique certified target when its capture-time scope now points elsewhere", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><section id="stale-scope"><a href="#other"><span>Other</span></a></section><nav><a href="#target" onclick="this.dataset.clicked=\'yes\'"><span>Target</span></a></nav></main>');
    const structuralTarget = {
      ...STRUCTURAL_TARGET,
      locatorCandidates: [{ strategy: "css", value: 'a[href="#target"]', confidence: 0.9 }],
      certificationTier: 1,
      structuralContext: {
        ...STRUCTURAL_TARGET.structuralContext,
        stableDirectAttributes: { href: "#target" },
        semanticShape: ["span"],
        targetFingerprint: "captured-link",
        captureScopeUnique: true,
        captureTargetMatchCount: 1,
        scopeIdentity: { strategy: "id", value: "stale-scope" },
        landmarkAncestor: { tag: "main" },
      },
    };
    const runtime = createPromotedSpecRuntime(page as any, { enabled: false });

    await (runtime as any).clickPromotedTargetViaStructuralAuthority({
      stepIndex: 4,
      target: 'a[href="#target"]',
      actionIntent: "click",
      expectedEffect: "none",
      structuralTarget,
    });

    await runtime.finishEvidence();
    assert.equal(await page.locator('nav a[href="#target"]').getAttribute("data-clicked"), "yes");
  } finally {
    await browser.close();
  }
});

test("4/dispatch: clickPromotedTarget's own source routes options.structuralTarget to the structural-authority path BEFORE the legacy native/callback machinery, and only when present", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "promoted-spec-runtime.ts"), "utf8");
  const start = source.indexOf("async clickPromotedTarget(options: PromotedClickOptions)");
  const end = source.indexOf("\n  async fillPromotedField(", start);
  const fn = source.slice(start, end);
  assert.match(
    fn,
    /if \(options\.structuralTarget\) \{\s*\n\s*await this\.clickPromotedTargetViaStructuralAuthority\(options\);\s*\n\s*return;\s*\n\s*\}/,
    "structuralTarget must be checked and delegated to before any native-click/callback logic runs",
  );
});
