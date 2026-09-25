import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
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
