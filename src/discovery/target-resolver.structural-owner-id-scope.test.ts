import assert from "node:assert/strict";
import test from "node:test";
import { resolveRecordedStructuralOwner } from "./target-resolver";
import type { RecordedTechnicalTarget } from "../recording/session-trace.types";

/**
 * FIRST_LOSS (roke, historical discovery job e8520cc1-fda5-45f3-819d-55c2384bd373):
 * `resolveRecordedStructuralOwner`'s scoped-owner branch built a CSS attribute-selector STRING
 * (e.g. `[id="root"]`) but kept `strategy: scopeIdentity.strategy` ("id"/"data-testid") when
 * handing it to `recordedLocatorFactory`, which has no "id"/"data-testid" dispatch (only "css").
 * The factory therefore returned `undefined` for every scoped owner using an id/data-testid
 * scope, always reporting `scopeMatchCount=0` regardless of whether the scope actually existed
 * live (e.g. `#root`, always present). `resolveSemanticRuntimeTarget` already carries the correct
 * fix (`strategy: "css"`, documented inline) -- this proves the same fix in the sibling function.
 */

class FakeLocator {
  constructor(
    private countValue: number,
    private readonly opts: { attachesAfterMs?: number } = {},
  ) {}
  locator(): FakeLocator {
    return new FakeLocator(0);
  }
  first(): this {
    return this;
  }
  async count(): Promise<number> {
    return this.countValue;
  }
  async waitFor(options: { state?: string; timeout?: number }): Promise<void> {
    if (this.countValue >= 1) return;
    const delay = this.opts.attachesAfterMs;
    if (delay === undefined || delay > (options.timeout ?? 0)) {
      throw new Error("timeout");
    }
    this.countValue = 1;
  }
}

class FakePage {
  constructor(private readonly registered: Map<string, FakeLocator>) {}
  locator(selector: string): FakeLocator {
    return this.registered.get(selector) ?? new FakeLocator(0);
  }
}

function idScopedTarget(): RecordedTechnicalTarget {
  return {
    targetType: "structural",
    locatorCandidates: [],
    interactionEvidence: [],
    confidence: 1,
    validatedByInteraction: true,
    structuralContext: {
      owner: { tag: "div" },
      deterministicStructuralIdentity: true,
      stableDirectAttributes: { "data-field": "x" },
      scopeIdentity: { strategy: "id", value: "root" },
      targetFingerprint: "fp",
      captureScopeUnique: true,
      captureTargetMatchCount: 1,
    },
  };
}

test("resolveRecordedStructuralOwner: an id-strategy scope that exists live is recognized as unique, not reported as scopeMatchCount=0", async () => {
  const page = new FakePage(new Map([["[id=\"root\"]", new FakeLocator(1)]]));
  let reason: string | undefined;
  let matchCount: number | undefined;
  await resolveRecordedStructuralOwner(page as any, idScopedTarget(), (r, details) => {
    reason = r;
    matchCount = details?.matchCount;
  });
  assert.notEqual(reason, "scoped_scope_not_unique", "the id scope must resolve, not be misreported as scoped_scope_not_unique");
  assert.notEqual(matchCount, 0, "a live, unique id scope must never surface as scopeMatchCount=0");
});

test("resolveRecordedStructuralOwner: an id-strategy scope that attaches shortly after navigation is still recognized as unique, not misreported as scopeMatchCount=0", async () => {
  const page = new FakePage(new Map([["[id=\"root\"]", new FakeLocator(0, { attachesAfterMs: 5000 })]]));
  let reason: string | undefined;
  let matchCount: number | undefined;
  await resolveRecordedStructuralOwner(page as any, idScopedTarget(), (r, details) => {
    reason = r;
    matchCount = details?.matchCount;
  });
  assert.notEqual(reason, "scoped_scope_not_unique", "a scope that attaches within the bounded wait window must not be misreported as scoped_scope_not_unique");
  assert.notEqual(matchCount, 0, "a scope that attaches shortly after navigation must never surface as scopeMatchCount=0");
});

test("resolveRecordedStructuralOwner: an id-strategy scope that is genuinely absent still fails closed as scoped_scope_not_unique with matchCount=0", async () => {
  const page = new FakePage(new Map());
  let reason: string | undefined;
  let matchCount: number | undefined;
  await resolveRecordedStructuralOwner(page as any, idScopedTarget(), (r, details) => {
    reason = r;
    matchCount = details?.matchCount;
  });
  assert.equal(reason, "scoped_scope_not_unique");
  assert.equal(matchCount, 0);
});
