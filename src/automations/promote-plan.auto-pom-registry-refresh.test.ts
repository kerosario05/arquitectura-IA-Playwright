import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * FIRST_LOSS (jobId 31ac3b67-36ed-4793-9f37-4695bd2ef87a): Auto-POM approved and PERSISTED
 * FormPage/FormPage.fillField() to disk (`savePageObjectRegistry`, inside `runAutoPomPipeline`),
 * but `registryForSpecValidation` in `promote-plan.ts` was a snapshot taken BEFORE that pipeline
 * ran and was never refreshed. `runHybridSpecGeneration` then validated the AI candidate's
 * imports against that stale in-memory authority and rejected the same-job-approved Page Object
 * (`imported_unknown_page_object:FormPage`) -- one authority (the persisted registry) had already
 * moved on; the validator was still reading the old one.
 *
 * Fixed by reloading `registryForSpecValidation` from the SAME persisted source
 * (`loadPageObjectRegistry`) immediately after the Auto-POM pipeline completes, before it is
 * handed to `runHybridSpecGeneration`. No parallel registry, no symbol-name allowlist, no
 * app-specific special case -- this file's own established "no browser" static-source convention
 * is used here too, since `promote-plan.ts` is a large orchestrator with heavy IO dependencies
 * (`loadPageObjectRegistry`, `runAutoPomPipeline`, `runHybridSpecGeneration`) not practical to
 * exercise end-to-end in a focused unit test.
 */

const SOURCE_PATH = path.resolve(__dirname, "promote-plan.ts");
const source = fs.readFileSync(SOURCE_PATH, "utf8");

function autoPomBlockSource(): string {
  const start = source.indexOf("if (shouldRunAutoPom(specResult.pomStatus, promotionPolicy)) {");
  assert.ok(start >= 0, "expected the Auto-POM pipeline block to be present");
  const end = source.indexOf("\n  } else {", start);
  assert.ok(end > start, "expected the Auto-POM block to end before the inline-mode else branch");
  return source.slice(start, end);
}

test("1/refreshAfterAutoPom. registryForSpecValidation is reloaded from the persisted source after Auto-POM completes", () => {
  const block = autoPomBlockSource();
  assert.match(block, /registryForSpecValidation = await loadPageObjectRegistry\(appProfile, input\.outputRoot\)/);
});

test("2/refreshIsLastStatementInBlock. the reload happens at the END of the Auto-POM block -- after every approval/persist step, not racing them", () => {
  const block = autoPomBlockSource();
  const reloadIndex = block.indexOf("registryForSpecValidation = await loadPageObjectRegistry");
  const strategyDiagnosticsIndex = block.lastIndexOf("strategyDiagnostics.fallbackUsed");
  assert.ok(reloadIndex > strategyDiagnosticsIndex, "the reload must come after all Auto-POM result processing, not before");
});

test("3/reloadedBeforeValidation. the refreshed registry is what actually reaches runHybridSpecGeneration -- no second variable shadowing it", () => {
  const hybridCallStart = source.indexOf("const specGenerationResult = await runHybridSpecGeneration({");
  const hybridCallEnd = source.indexOf("});", hybridCallStart);
  const call = source.slice(hybridCallStart, hybridCallEnd);
  assert.match(call, /pageObjectRegistry: registryForSpecValidation,/);
  const reloadStatementEnd = source.indexOf(".catch(() => registryForSpecValidation);") + ".catch(() => registryForSpecValidation);".length;
  const reassignedBetween = source.slice(reloadStatementEnd, hybridCallStart)
    .match(/registryForSpecValidation\s*=/g) ?? [];
  assert.equal(reassignedBetween.length, 0, "registryForSpecValidation must not be reassigned again between the refresh and its use");
});

test("4/sameAuthoritativeLoader. the refresh reuses the exact same loadPageObjectRegistry used for the initial snapshot -- no parallel/duplicate registry source", () => {
  const loaderCalls = source.match(/await loadPageObjectRegistry\(appProfile, input\.outputRoot\)/g) ?? [];
  assert.ok(loaderCalls.length >= 2, "expected at least the initial load plus the post-Auto-POM refresh, both via the same function");
});

test("5/multiproject. no page-object class name or app-specific hardcode was introduced by this fix", () => {
  const block = autoPomBlockSource();
  assert.doesNotMatch(block, /FormPage/);
  assert.doesNotMatch(block, /portal-comercial/i);
});
