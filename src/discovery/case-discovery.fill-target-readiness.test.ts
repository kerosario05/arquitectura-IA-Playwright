import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * FIRST_LOSS: SCREEN STABLE != NEXT REQUIRED TARGET READY. Physical evidence (Portal Comercial,
 * "Número de identificación") showed the recorded fill step (`resolutionState:
 * "runtime_resolution_required"`, real `associatedField`, zero technical target refs -- i.e.
 * `structuralRuntimeEligible`) failing with `fill_target_not_editable`, with the resolver's own
 * text-scan fallback reporting a `<span>` "Número de identificación" as the (non-editable)
 * matched candidate. Both fill branches in `case-discovery.ts` called `resolveFillTarget` exactly
 * ONCE after only a page-wide `waitForStablePageState` -- no re-observation of the SPECIFIC
 * target's own enabled/editable state, and no retry, before declaring the step failed. The target
 * app keeps this field's real input disabled while dependent lists/config are still loading, well
 * after the page itself looks settled.
 *
 * Fixed by `waitForFillTargetReadiness`: reuses the SAME shared adaptive wait
 * (`waitForStableInteractiveScreen`, already used for post-click/post-navigate/post-press
 * stabilization -- see `case-discovery.press-post-action-stabilization.test.ts`) via its existing
 * `completionProbe` hook, re-snapshotting and re-resolving the SAME fill target on every poll
 * until it resolves or the existing idle/hard-deadline budget is exhausted. Scoped to fields
 * carrying real recorded evidence (`associatedField`, filtered through the shared
 * `isGenericUnresolvedLabel` -- the same sentinel check used elsewhere in this codebase) so it
 * never engages for an ordinary target with no such evidence, and never falls back to the span
 * itself as a fill target.
 *
 * The live-Playwright-page runtime behavior of this ~11500-line execution loop is not
 * independently testable here (no browser allowed, matching this session's established
 * disclosure convention -- see `case-discovery.press-post-action-stabilization.test.ts`). The
 * underlying primitive (`waitForStableInteractiveScreen`'s `completionProbe` polling: immediate
 * completion, disabled-then-enabled, permanently-disabled-to-hard-deadline) is exhaustively
 * covered, unmodified, by `execution-plan-executor.next-action-readiness.test.ts`. What IS
 * verified here, statically, is the actual code-level claim this ticket cares about: both fill
 * branches gate the retry on real evidence, reuse the existing wait by name (never a duplicate/
 * parallel wait or a fixed sleep), never resolve via a stale locator (each poll re-resolves), and
 * never fabricate/accept the span as the final fill target.
 */

const SOURCE_PATH = path.resolve(__dirname, "case-discovery.ts");
const source = fs.readFileSync(SOURCE_PATH, "utf8");

function helperSource(): string {
  const start = source.indexOf("async function waitForFillTargetReadiness(");
  assert.ok(start >= 0, "expected waitForFillTargetReadiness to be defined");
  const end = source.indexOf("\nexport type CaseDiscoveryOptions", start);
  assert.ok(end > start, "expected the helper to end before CaseDiscoveryOptions");
  return source.slice(start, end);
}

function fillBranchesUsingHelper(): string[] {
  const branches: string[] = [];
  let cursor = 0;
  for (;;) {
    const idx = source.indexOf("await waitForFillTargetReadiness(", cursor);
    if (idx < 0) break;
    branches.push(source.slice(Math.max(0, idx - 900), idx + 600));
    cursor = idx + 1;
  }
  return branches;
}

test("1/reuse. waitForFillTargetReadiness reuses the shared waitForStableInteractiveScreen via completionProbe -- no parallel wait system", () => {
  const helper = helperSource();
  assert.match(helper, /await import\("\.\.\/runner\/execution-plan-executor"\)/);
  assert.match(helper, /waitForStableInteractiveScreen/);
  assert.match(helper, /completionProbe/);
  assert.doesNotMatch(helper, /function\s+waitForPortal/i);
});

test("2/reResolve. each poll re-snapshots the live DOM and re-resolves through resolveFillTarget -- never a stale locator", () => {
  const helper = helperSource();
  assert.match(helper, /scanCurrentPage\(page\)/);
  assert.match(helper, /resolveFillTarget\(page, snapshot, target, activeContainer, fillContext/);
});

test("3/noSleep. no fixed sleep/setTimeout/page.waitForTimeout was introduced in the readiness helper", () => {
  const helper = helperSource();
  assert.doesNotMatch(helper, /waitForTimeout/);
  assert.doesNotMatch(helper, /\bsetTimeout\s*\(/);
  assert.doesNotMatch(helper, /\bsleep\s*\(\s*\d/);
});

test("4/noPosition. no positional selector (nth/first/last) was introduced in the readiness helper", () => {
  const helper = helperSource();
  assert.doesNotMatch(helper, /\.nth\(/);
  assert.doesNotMatch(helper, /\.first\(\)/);
  assert.doesNotMatch(helper, /\.last\(\)/);
});

test("5/multiproject. no app/business/route hardcode was introduced in the readiness helper", () => {
  const helper = helperSource();
  assert.doesNotMatch(helper, /portal-comercial/i);
  assert.doesNotMatch(helper, /solicitud multiproducto/i);
  assert.doesNotMatch(helper, /numero.de.identificacion/i);
});

test("6/gated. both fill branches only retry when real recorded evidence exists (associatedField, non-generic) -- never a blanket retry", () => {
  const branches = fillBranchesUsingHelper();
  assert.equal(branches.length, 2, "expected exactly two fill call sites to use the readiness helper (data-key sourced + literal-value sourced)");
  for (const branch of branches) {
    assert.match(branch, /isGenericUnresolvedLabel\(/, "expected the generic-label gate before retrying");
    assert.match(branch, /associatedField/);
    assert.match(
      branch,
      /resolution\.status === "not_found" \|\| resolution\.status === "not_editable" \|\| resolution\.status === "fill_target_not_editable"/,
      "expected the retry to be scoped to exactly the recoverable resolution statuses",
    );
  }
});

test("7/noSpanFallback. the readiness helper never returns/accepts the span match as a substitute fill target -- it only trusts resolveFillTarget's own 'resolved' status", () => {
  const helper = helperSource();
  assert.doesNotMatch(helper, /nonEditableMatch/, "the helper must never reach into the span/label candidate itself");
  assert.match(helper, /resolution\.status === "resolved"/);
});

test("8/noNewLatencyOnAlreadyResolved. the retry block only runs when the initial single-shot resolution was NOT already resolved", () => {
  const branches = fillBranchesUsingHelper();
  for (const branch of branches) {
    // The gate condition excludes "resolved" implicitly by listing only failure statuses --
    // confirm "resolved" is never one of the statuses that triggers the wait.
    const gateMatch = branch.match(/if \(\s*\(([^)]+)\)/s);
    assert.ok(gateMatch, "expected a status-checking if-condition guarding the retry");
    assert.doesNotMatch(gateMatch![1], /"resolved"/);
  }
});
