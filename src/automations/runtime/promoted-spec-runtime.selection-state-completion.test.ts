import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { hasCausalSelectionTransition } from "../../discovery/selection-state-verification";
import { recordedLocatorFactory } from "../../discovery/target-resolver";
import { parseSerializedTechnicalTargetString } from "./promoted-spec-runtime";

/**
 * FIRST_LOSS (recording 34034233-6dee-4ee9-9fc1-56b276205985, job 8e1ec8ae-8ca8-4eb8-a954-
 * 70870a5982d3): `postActionStability` only ever checked route/DOM-mutation signals
 * (`expectedEffect === "navigation" | "modal_or_form_or_navigation" | else domTransitionObserved`)
 * -- a same-surface selection click ("Web", role=option, no route/DOM change the shared snapshot
 * tracks) always failed with `no_observable_post_action_outcome`. The new `selection_state_change`
 * branch re-reads the SAME already-resolved promoted target's own interactive state and reuses
 * the SAME shared `hasCausalSelectionTransition` CORE Discovery's `target_selection_state_changed`
 * signal already uses -- never a second, hand-rolled false->true comparison.
 *
 * Structural/static verification, matching this class's own established test convention (see
 * promoted-spec-runtime.press-completion-authority.test.ts) -- no browser, no Playwright Page
 * fake needed for a class this deeply coupled to live page state.
 */

const source = fs.readFileSync(path.resolve(__dirname, "promoted-spec-runtime.ts"), "utf8");

function extractFunction(name: string, nextMarker: string): string {
  const start = source.indexOf(name);
  assert.ok(start !== -1, `${name} must exist in promoted-spec-runtime.ts`);
  const end = source.indexOf(nextMarker, start);
  assert.ok(end !== -1, `boundary marker "${nextMarker}" must exist after ${name}`);
  return source.slice(start, end);
}

const fn = extractFunction(
  "private async postActionStability(",
  "\n  async getDebugState(",
);

test("1/reusesSharedCausalCore. postActionStability imports and calls the SAME hasCausalSelectionTransition Discovery already uses, never a second implementation", () => {
  assert.match(source, /import\s*\{\s*hasCausalSelectionTransition,\s*type InteractiveState\s*\}\s*from\s*"\.\.\/\.\.\/discovery\/selection-state-verification";/);
  assert.match(fn, /hasCausalSelectionTransition\(selectionBefore,\s*selectionAfter\)/);
});

test("2/reusesSharedTechnicalResolver. the selection-state branch resolves a certified technical target through Discovery's recordedLocatorFactory before considering field-only resolution", () => {
  assert.match(source, /capturePromotedSelectionStateProbe\(\s*this\.page,\s*options\.target,\s*targetIdentity\s*\)/);
  const probeFn = source.slice(source.indexOf("async function capturePromotedSelectionStateProbe"), source.indexOf("type PromotedActionSurfaceSnapshot"));
  assert.match(probeFn, /recordedLocatorFactory\(page,\s*candidate,\s*true\)/);
  assert.ok(probeFn.indexOf("recordedLocatorFactory") < probeFn.indexOf("resolvePromotedFieldLocator"));
});

test("2a/exactRoleOptionProbe. a role option technical ref becomes one exact actionable probe through the shared Discovery factory", () => {
  const calls: Array<{ role: string; options: { name?: string; exact?: boolean } | undefined }> = [];
  const page = {
    getByRole: (role: string, options?: { name?: string; exact?: boolean }) => {
      calls.push({ role, options });
      return { count: async () => 1, isVisible: async () => true, isEnabled: async () => true };
    },
  } as any;
  const candidate = parseSerializedTechnicalTargetString("role:option|Example");
  assert.ok(candidate);
  assert.ok(recordedLocatorFactory(page, candidate!, true));
  assert.deepEqual(calls, [{ role: "option", options: { name: "Example", exact: true } }]);
});

test("2b/capturesBaselineBeforeDispatch. the causal baseline is captured before any native/callback click and passed unchanged into postActionStability", () => {
  const clickFn = extractFunction("async clickPromotedTarget(options", "\n  async fillPromotedField(");
  const probeIndex = clickFn.indexOf("const selectionStateProbe = resolvedExpectedEffect");
  const nativeDispatchIndex = clickFn.indexOf("nativeClickAttempted = true");
  assert.ok(probeIndex >= 0 && nativeDispatchIndex >= 0 && probeIndex < nativeDispatchIndex, "selection baseline must exist before click dispatch");
  assert.match(clickFn, /options\.target,\s*selectionStateProbe\)/);
});

test("2c/retryKeepsFirstClickBaseline. callback retry reuses the first pre-dispatch probe instead of sampling an already-selected target as a new baseline", () => {
  const clickFn = extractFunction("async clickPromotedTarget(options", "\n  async fillPromotedField(");
  assert.equal((clickFn.match(/options\.target,\s*selectionStateProbe\)/g) ?? []).length, 5);
  assert.equal((clickFn.match(/capturePromotedSelectionStateProbe\(/g) ?? []).length, 1);
});

test("2d/selectionTelemetryIsStructured. runtime observability exposes only state metadata and never the control value", () => {
  assert.match(source, /\[selection-runtime\] phase=before_dispatch/);
  assert.match(fn, /\[selection-runtime\] phase=after_dispatch/);
  assert.match(source, /checked=\$\{state\?\.checked/);
  assert.match(source, /ariaChecked=\$\{state\?\.ariaChecked/);
  assert.doesNotMatch(source.slice(source.indexOf("function selectionRuntimeSnapshot"), source.indexOf("async function capturePromotedSelectionStateProbe")), /value=/);
});

test("3/genericPathUnaffected. the selection_state_change branch is a separate, early continue -- the existing navigation/modal_or_form_or_navigation/ui_change ternary is untouched", () => {
  assert.match(fn, /expectedEffect === "navigation"\s*\n\s*\?\s*routeChanged/);
  assert.match(fn, /:\s*domTransitionObserved;/);
});

test("4/noSilentDowngrade. effectiveExpectedEffect preserves selection_state_change instead of falling through to the ui_change default", () => {
  assert.match(source, /requested === "ui_change" \|\| requested === "selection_state_change"/);
});

// ── Direct semantics of the shared CORE this branch delegates to (already covered in
// selection-state-verification.test.ts; re-asserted here at the promoted-runtime integration
// boundary to prove the SAME function/semantics, not a divergent copy). ──

test("6/promotedFalseToTrue. false -> true is the causal transition the promoted branch waits for", () => {
  assert.equal(hasCausalSelectionTransition({ ariaSelected: undefined, ariaChecked: "false" } as any, { ariaChecked: "true" }), true);
});

test("7/promotedFalseToFalse. false -> false never satisfies completion", () => {
  assert.equal(hasCausalSelectionTransition({ ariaChecked: "false" }, { ariaChecked: "false" }), false);
});

test("8/promotedAlreadySelected. true -> true never satisfies completion -- already selected before this click proves nothing about it", () => {
  assert.equal(hasCausalSelectionTransition({ ariaChecked: "true" }, { ariaChecked: "true" }), false);
});
