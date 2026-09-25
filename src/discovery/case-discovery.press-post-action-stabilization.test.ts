import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * FIRST_LOSS: the `action_press` branch's success path (`case-discovery.ts`, right before its
 * own `continue`) never invoked ANY shared post-action stabilization -- it only re-scanned the
 * page immediately after `.press()` and moved on. Click's own branch, much further down in the
 * same loop, reaches `waitForStableInteractiveScreen` (`../runner/execution-plan-executor.ts`) --
 * the project's ONE universal/adaptive post-action wait (idle ~8s via `LOADING_STABILITY_TIMEOUT_MS`,
 * hard deadline ~120s via `ASYNC_OPERATION_HARD_SAFETY_CAP_MS`, signal-driven: pending
 * request/response, DOM loading indicators, `progressProbe`/`completionProbe` when supplied) --
 * but press's branch sits earlier in the function, before the per-iteration state
 * (`actionNetworkObservation`, `postActionCompletionProbe`, etc.) click's call depends on is even
 * constructed, so it could not reuse click's exact call. A press-caused transition (e.g. Enter
 * submitting a login form) could therefore still be mid-flight when the NEXT action's target
 * resolution ran against the STALE pre-transition snapshot, producing a false
 * `recorded_target_wrong_expected_surface`/`not_found` for a target that would have resolved
 * fine once the page actually settled -- exactly the physically observed evidence.
 *
 * Fixed by calling the exact same `waitForStableInteractiveScreen` (bare, no custom probes --
 * its own built-in network/DOM/loading-indicator signals are already generic and multiproject)
 * right after a successful press, before `continue`, then re-scanning the page so the snapshot
 * carried into the NEXT loop iteration reflects the POST-stabilization surface. No new wait
 * system, no fixed sleep, no login/project-specific special case.
 *
 * The live-Playwright-page runtime behavior of this ~11500-line execution loop is not
 * independently testable here (no browser allowed, matching this session's established
 * disclosure convention for this file -- see
 * `case-discovery.press-technical-target-lineage.test.ts`). What IS verified here, statically,
 * is the actual code-level claim the ticket cares about: the press branch reuses the existing
 * function by name (never a second/duplicate wait implementation), and introduces no fixed
 * sleep/`page.waitForTimeout`/login-specific literal anywhere near it.
 */

const SOURCE_PATH = path.resolve(__dirname, "case-discovery.ts");
const source = fs.readFileSync(SOURCE_PATH, "utf8");

function pressBranchSource(): string {
  const start = source.indexOf('if (actionTarget.actionType === "action_press")');
  assert.ok(start >= 0, "expected to find the action_press branch");
  // The branch's own closing brace is the next top-level `continue;\n    }` after its start --
  // slicing a generous window around it is enough to inspect what runs before its `continue`.
  const windowEnd = source.indexOf('if (actionTarget.valueSource === "literal"', start);
  assert.ok(windowEnd > start, "expected the branch to end before the literal-fill branch begins");
  return source.slice(start, windowEnd);
}

test("12/noDuplicateWait. the press branch reuses waitForStableInteractiveScreen by name -- no parallel wait function is defined for it", () => {
  const branch = pressBranchSource();
  assert.match(branch, /waitForStableInteractiveScreen/, "expected the press branch to call the shared stabilization function");
  assert.doesNotMatch(branch, /function\s+waitAfterPress/i);
  assert.doesNotMatch(branch, /function\s+pressStabiliz/i);
});

test("11/noSleep. no fixed sleep/setTimeout/page.waitForTimeout was introduced in the press branch", () => {
  const branch = pressBranchSource();
  assert.doesNotMatch(branch, /waitForTimeout/);
  assert.doesNotMatch(branch, /\bsetTimeout\s*\(/);
  assert.doesNotMatch(branch, /\bsleep\s*\(\s*\d/);
});

test("13/generic. no login/auth/project-specific literal was introduced in the press branch's stabilization CALL itself (the explanatory comment above it may reference the reported example; the executable code must not)", () => {
  const branch = pressBranchSource();
  const executableTail = branch.slice(branch.indexOf("const { waitForStableInteractiveScreen }"));
  assert.doesNotMatch(executableTail, /\/login/);
  assert.doesNotMatch(executableTail, /api\/auth/);
  assert.doesNotMatch(executableTail, /portal-comercial/i);
  assert.doesNotMatch(executableTail, /solicitud multiproducto/i);
});

test("the same import path used by click's own stabilization call is reused, not a new module", () => {
  const branch = pressBranchSource();
  assert.match(branch, /await import\("\.\.\/runner\/execution-plan-executor"\)/);
  const clickUsage = source.slice(source.indexOf("// End of standard click else block"));
  assert.match(clickUsage.slice(0, 2000), /await import\("\.\.\/runner\/execution-plan-executor"\)/, "click's own call site should still import from the same module");
});

test("the press branch re-scans the page after stabilizing, so the next iteration never resolves against the pre-transition snapshot", () => {
  const branch = pressBranchSource();
  const afterWait = branch.slice(branch.indexOf("waitForStableInteractiveScreen"));
  assert.match(afterWait, /scanAndCollectObjects/, "expected a re-scan after the stabilization wait, before continue");
  assert.match(afterWait, /currentSnapshot\s*=/);
});
