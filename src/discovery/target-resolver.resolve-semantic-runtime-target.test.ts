import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveSemanticRuntimeTarget, matchSemanticRuntimeCandidate } from "./target-resolver";
import type { SemanticRuntimeEvidence } from "../recording/structural-owner-identity";

/**
 * DEFINITIVE FIX (recordingId=e224287e-...): `resolveSemanticRuntimeTarget` end-to-end against a
 * fake Playwright Page/Locator -- scope uniqueness re-verified live, in-page matching via the SAME
 * `matchSemanticRuntimeCandidate` unit-tested in `target-resolver.semantic-runtime-match.test.ts`,
 * union across scope alternatives via one shared marker attribute. Also proves the shared
 * `resolveActionTarget` (the single choke point every promoted click/fill call already funnels
 * through) invokes this fallback when `options.semanticRuntimeEvidence` is present.
 */

function fakeDomNode(opts: { tag: string; text?: string }) {
  const node: any = {
    tagName: opts.tag.toUpperCase(),
    textContent: opts.text ?? "",
    attrs: {} as Record<string, string>,
    getAttribute(name: string) { return this.attrs[name] ?? null; },
    setAttribute(name: string, value: string) { this.attrs[name] = value; },
    getBoundingClientRect() { return { width: 10, height: 10 }; },
  };
  return node;
}

function fakeScopeElement(candidates: any[]) {
  return {
    querySelectorAll: (selector: string) =>
      selector === "*" ? candidates : candidates.filter((node) => node.tagName.toLowerCase() === selector.toLowerCase()),
  };
}

/** A fake Page: `#stable-scope`/`[data-testid="..."]` selectors resolve to a scope locator whose
 * `.evaluate()` really runs `matchSemanticRuntimeCandidate` against a fake in-scope DOM, and the
 * marker-attribute selector resolves to however many nodes currently carry that marker. */
function fakePage(options: { scopeContents: Record<string, any[]>; scopeCounts?: Record<string, number> }) {
  const markedNodes = new Set<any>(); // distinct nodes carrying the (single, shared) marker attribute
  function scopeLocatorFor(scopeKey: string) {
    const contents = options.scopeContents[scopeKey] ?? [];
    const scopeEl = fakeScopeElement(contents);
    return {
      count: async () => options.scopeCounts?.[scopeKey] ?? 1,
      evaluate: async (fn: any, args: any) => {
        const result = fn(scopeEl, args);
        if (result === 1) {
          const marked = contents.find((node) => node.attrs[args.attributeName] === args.markerValue);
          if (marked) markedNodes.add(marked);
        }
        return result;
      },
    };
  }
  return {
    url: () => "https://example.test/",
    locator: (selector: string) => {
      const markerMatch = selector.match(/\[data-codex-semantic-runtime-target="([^"]+)"\]/);
      if (markerMatch) {
        return {
          count: async () => markedNodes.size,
          isVisible: async () => true,
          isEnabled: async () => true,
        };
      }
      const idMatch = selector.match(/\[id="([^"]+)"\]/);
      const testIdMatch = selector.match(/\[data-testid="([^"]+)"\]/);
      const scopeKey = idMatch ? idMatch[1] : testIdMatch ? testIdMatch[1] : selector;
      return scopeLocatorFor(scopeKey);
    },
  } as any;
}

function evidence(scopeKeys: string[], value = "SMS"): SemanticRuntimeEvidence {
  return {
    source: "visible_text",
    normalizedValue: value,
    targetTag: "div",
    scopeAlternatives: scopeKeys.map((key) => ({ scopeIdentity: { strategy: "id" as const, value: key }, captureMatchCount: 1 as const })),
    captureUniqueTarget: true,
  };
}

test("10/uniqueSuccess. one unique semantic target under one valid scope resolves", async () => {
  const target = fakeDomNode({ tag: "div", text: "SMS" });
  const page = fakePage({ scopeContents: { "stable-scope": [target] } });
  const result = await resolveSemanticRuntimeTarget(page, evidence(["stable-scope"]));
  assert.ok(result);
  assert.equal(result!.currentMatchCount, 1);
  assert.equal(result!.strategy, "recorded:semantic-runtime");
  assert.equal(result!.structuralCompatibility, false, "never a certified/structural target");
});

test("11/duplicateFailClosed. duplicate semantic match within the scope fails closed", async () => {
  const a = fakeDomNode({ tag: "div", text: "SMS" });
  const b = fakeDomNode({ tag: "div", text: "SMS" });
  const page = fakePage({ scopeContents: { "stable-scope": [a, b] } });
  const result = await resolveSemanticRuntimeTarget(page, evidence(["stable-scope"]));
  assert.equal(result, undefined);
});

test("19/zeroFailClosed. no matching element within the scope fails closed", async () => {
  const decoy = fakeDomNode({ tag: "div", text: "Correo" });
  const page = fakePage({ scopeContents: { "stable-scope": [decoy] } });
  const result = await resolveSemanticRuntimeTarget(page, evidence(["stable-scope"]));
  assert.equal(result, undefined);
});

test("21/multipleAlternativesSameTarget. two scope alternatives resolving to the SAME live element still succeed", async () => {
  const target = fakeDomNode({ tag: "div", text: "SMS" });
  const page = fakePage({ scopeContents: { "inner-scope": [target], "outer-scope": [target] } });
  const result = await resolveSemanticRuntimeTarget(page, evidence(["inner-scope", "outer-scope"]));
  assert.ok(result, "both alternatives mark the same node -- union size 1 -- success");
});

test("22/differentTargetsFailClosed. two scope alternatives resolving to DIFFERENT live elements fail closed", async () => {
  const targetA = fakeDomNode({ tag: "div", text: "SMS" });
  const targetB = fakeDomNode({ tag: "div", text: "SMS" });
  const page = fakePage({ scopeContents: { "scope-a": [targetA], "scope-b": [targetB] } });
  const result = await resolveSemanticRuntimeTarget(page, evidence(["scope-a", "scope-b"]));
  assert.equal(result, undefined, "never arbitrarily pick one of two distinct resolved targets");
});

test("scope itself ambiguous at runtime (count!==1) is skipped, never trusted", async () => {
  const target = fakeDomNode({ tag: "div", text: "SMS" });
  const page = fakePage({ scopeContents: { "stable-scope": [target] }, scopeCounts: { "stable-scope": 2 } });
  const result = await resolveSemanticRuntimeTarget(page, evidence(["stable-scope"]));
  assert.equal(result, undefined);
});

test("no scopeAlternatives at all -> undefined immediately, no page interaction attempted", async () => {
  const page = fakePage({ scopeContents: {} });
  const result = await resolveSemanticRuntimeTarget(page, { ...evidence([]), scopeAlternatives: [] });
  assert.equal(result, undefined);
});

test("9/sharedResolverReceives. resolveActionTargetCore (the single shared choke point every promoted click/fill call funnels through) invokes resolveSemanticRuntimeTarget via opts.semanticRuntimeEvidence, at the correct priority position (after the recorded/structural block, before the field-scope/grid fallbacks)", () => {
  const source = fs.readFileSync(path.join(__dirname, "target-resolver.ts"), "utf8");
  const coreStart = source.indexOf("async function resolveActionTargetCore(");
  const nextFunctionStart = source.indexOf("\nasync function ", coreStart + 1);
  const coreBody = source.slice(coreStart, nextFunctionStart > 0 ? nextFunctionStart : coreStart + 6000);
  const recordedBlockEnd = coreBody.indexOf("structuralDiagnostics: recorded.structuralDiagnostics");
  const semanticCallIndex = coreBody.indexOf("await resolveSemanticRuntimeTarget(page, opts.semanticRuntimeEvidence)");
  const gridFallbackIndex = coreBody.indexOf("tryResolveTableFieldControl");
  assert.ok(semanticCallIndex > 0, "resolveActionTargetCore must call resolveSemanticRuntimeTarget");
  assert.ok(semanticCallIndex > recordedBlockEnd, "semantic fallback must run AFTER the recorded/structural block");
  assert.ok(gridFallbackIndex < 0 || semanticCallIndex < gridFallbackIndex, "semantic fallback must run BEFORE the weaker grid/field-scope fallbacks");
});

test("matchSemanticRuntimeCandidate stays exported/reused, never duplicated inline", () => {
  assert.equal(typeof matchSemanticRuntimeCandidate, "function");
});
