import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * Structural regression guard for POST /api/runs/:jobId/rerun's three-way dispatch. Mirrors the
 * established pattern in runs.rerun-promoted-spec-dispatch.test.ts — the runtime behavior of
 * each branch is already covered by mixed-rerun-orchestrator.test.ts and
 * rerun-runner.promoted-spec-reuse.test.ts; this pins the dispatch contract itself: allReusable
 * and noneReusable dispatch exactly as before, and mixed goes to startMixedRerun before ever
 * reaching either of the other two.
 */
const source = fs.readFileSync(path.join(__dirname, "runs.ts"), "utf-8");

test("1. allReusable dispatch is unchanged: still checked, still dispatches startReuseExistingPromotedSpecRun, still returns", () => {
  assert.ok(source.includes("if (prepared.allReusable) {"));
  assert.ok(source.includes("setImmediate(() => startReuseExistingPromotedSpecRun(reuseJob.id));"));
});

test("2. noneReusable dispatch is unchanged: the original scenario-preview fallback dispatch line still exists verbatim", () => {
  assert.ok(source.includes("setImmediate(() => startScenarioPreviewRun(newJob.id));"));
});

test("3. a mixed batch (some reusable, some not) dispatches startMixedRerun, before the allReusable branch and before the noneReusable fallback block", () => {
  const mixedIdx = source.indexOf("classification=MIXED_RERUN dispatch=mixed_rerun_orchestrator");
  const startMixedCallIdx = source.indexOf("setImmediate(() => startMixedRerun(", mixedIdx);
  const allReusableIdx = source.indexOf("if (prepared.allReusable) {", mixedIdx);
  const fallbackBuildPayloadIdx = source.indexOf("// 4. Build new job payload");
  assert.ok(mixedIdx !== -1 && startMixedCallIdx !== -1 && allReusableIdx !== -1 && fallbackBuildPayloadIdx !== -1);
  assert.ok(mixedIdx < startMixedCallIdx, "the mixed classification must precede its own dispatch");
  assert.ok(startMixedCallIdx < allReusableIdx, "mixed must be handled (and return) before the allReusable check below it");
  assert.ok(startMixedCallIdx < fallbackBuildPayloadIdx, "mixed must return before ever reaching the scenario-preview payload/dispatch block");
});

test("4. the mixed branch never calls startScenarioPreviewRun or startReuseExistingPromotedSpecRun directly — only the orchestrator", () => {
  const mixedIdx = source.indexOf("classification=MIXED_RERUN dispatch=mixed_rerun_orchestrator");
  const returnIdx = source.indexOf("return;", source.indexOf("setImmediate(() => startMixedRerun(", mixedIdx));
  const mixedBlock = source.slice(mixedIdx, returnIdx);
  assert.ok(!mixedBlock.includes("startScenarioPreviewRun("));
  assert.ok(!mixedBlock.includes("startReuseExistingPromotedSpecRun("));
  assert.ok(mixedBlock.includes("startMixedRerun("));
});

test("5. the mixed branch's reuse subset is built from promotedSpecReuse entries with reuse=true only, using canonical scenarioId — never title/index", () => {
  assert.ok(source.includes("const reuseEntries = prepared.promotedSpecReuse.filter((e) => e.reuse);"));
  assert.ok(source.includes("scenarioId: entry.scenarioId,"));
});

test("6. the mixed branch's fallback subset excludes exactly the reusable scenarioIds from prepared.scenarios", () => {
  assert.ok(source.includes("const fallbackScenarios = prepared.scenarios.filter((s) => !s.scenarioId || !reuseIds.has(s.scenarioId));"));
});
