import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { PromotedSpecRuntime } from "./promoted-spec-runtime";
import { EvidenceRecorder } from "../../evidence/evidence-recorder";
import { recordedLocatorFactory } from "../../discovery/target-resolver";

/**
 * Regression guard for a real incident: a stale, pre-existing `promoted-spec-runtime.js` /
 * `evidence-recorder.js` twin sat next to the edited `.ts` source. Node's default extensionless
 * module resolution tries `.js` before Playwright's own TS transform gets a chance, so the
 * candidate functional-execution child silently ran the STALE compiled `.js` (missing the
 * `phase=runtime` telemetry and the CASE D `alreadyReady` fix) while every source-level
 * inspection of the `.ts` file looked correct. Proven via `require.resolve` under the exact
 * same `playwright.config.apps.candidate.ts` loading path the real candidate uses (see the
 * ticket's module-resolution probe). The fix was to delete the two stale `.js` twins — not to
 * hand-port the fix into them — so there is exactly one physical source of truth. These tests
 * fail again the moment either twin is regenerated and starts shadowing its `.ts` source.
 *
 * jobId e367a223-b3c2-4d2e-afc2-8b5f8f036be0 proved the SAME hazard class for a third module:
 * `src/discovery/target-resolver.js` (stale, missing `recordedLocatorFactory`'s export) shadowed
 * `target-resolver.ts` for the Playwright child running `.candidate-validation-*.spec.ts`, so
 * `pressPromotedTarget` (promoted-spec-runtime.ts) threw
 * `TypeError: recordedLocatorFactory is not a function` even though the current `.ts` source
 * exports it correctly. Same fix, same pattern: delete the stale twin, never hand-port into it.
 */

const PROMOTED_RUNTIME_JS = path.resolve(__dirname, "promoted-spec-runtime.js");
const PROMOTED_RUNTIME_TS = path.resolve(__dirname, "promoted-spec-runtime.ts");
const EVIDENCE_RECORDER_JS = path.resolve(__dirname, "../../evidence/evidence-recorder.js");
const EVIDENCE_RECORDER_TS = path.resolve(__dirname, "../../evidence/evidence-recorder.ts");
const TARGET_RESOLVER_JS = path.resolve(__dirname, "../../discovery/target-resolver.js");
const TARGET_RESOLVER_TS = path.resolve(__dirname, "../../discovery/target-resolver.ts");
const PROMOTED_FIELD_TARGET_CONTRACT_JS = path.resolve(__dirname, "promoted-field-target-contract.js");
const PROMOTED_FIELD_TARGET_CONTRACT_TS = path.resolve(__dirname, "promoted-field-target-contract.ts");
const EXECUTION_PLAN_EXECUTOR_JS = path.resolve(__dirname, "../../runner/execution-plan-executor.js");
const EXECUTION_PLAN_EXECUTOR_TS = path.resolve(__dirname, "../../runner/execution-plan-executor.ts");

test("1/7. no stale .js twin shadows promoted-spec-runtime.ts (canonical source is the only physical file)", () => {
  assert.equal(fs.existsSync(PROMOTED_RUNTIME_JS), false, "a promoted-spec-runtime.js twin would shadow the .ts source under Node's default extensionless module resolution");
  assert.equal(fs.existsSync(PROMOTED_RUNTIME_TS), true);
});

test("2/7. no stale .js twin shadows evidence-recorder.ts (canonical source is the only physical file)", () => {
  assert.equal(fs.existsSync(EVIDENCE_RECORDER_JS), false, "an evidence-recorder.js twin would shadow the .ts source under Node's default extensionless module resolution");
  assert.equal(fs.existsSync(EVIDENCE_RECORDER_TS), true);
});

test("3. the canonical promoted-spec-runtime.ts source contains the phase=runtime telemetry line", () => {
  const source = fs.readFileSync(PROMOTED_RUNTIME_TS, "utf8");
  assert.match(source, /\[promoted-initial-navigation\] phase=runtime/);
});

test("4. the canonical promoted-spec-runtime.ts passes { alreadyReady: true } into captureInitialScreen", () => {
  const source = fs.readFileSync(PROMOTED_RUNTIME_TS, "utf8");
  assert.match(source, /captureInitialScreen\([^)]*\{\s*alreadyReady:\s*true\s*\}/s);
});

test("5. loaded EvidenceRecorder (imported module, not source text) trusts alreadyReady=true instead of re-deriving readiness", async () => {
  const root = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "module-authority-alreadyready-"));
  try {
    const recorder = new EvidenceRecorder(
      { appSlug: "generic-app", sectionSlug: "generic-section", scenarioId: "MODULE-AUTHORITY", scenarioTitle: "probe", outputRoot: root },
      { docxEnabled: false, perScenarioDocx: false },
    );
    const page = {
      isClosed: () => false,
      // If the independent DOM poll ran instead of trusting alreadyReady, this would report
      // not-ready and the loop would spend up to timeoutMs polling before giving up.
      waitForLoadState: async () => undefined,
      evaluate: async () => false,
      screenshot: async () => undefined,
    } as any;
    const ready = await recorder.captureInitialScreen(page, "promoted_reuse", 20, { alreadyReady: true });
    assert.equal(ready, true, "alreadyReady=true must not fall through to the independent readiness poll while the page is open");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("6. PromotedSpecRuntime is constructible from the canonical module and exposes the runtime surface the candidate imports", () => {
  const page = { on: () => undefined, url: () => "https://example.test/", isClosed: () => false } as any;
  const runtime = new PromotedSpecRuntime(page, { captureDiagnostics: false });
  assert.equal(typeof (runtime as any).ensureInitialEvidence, "function");
  assert.equal(typeof (runtime as any).ensureInitialNavigation, "function");
});

test("7/10. no stale .js twin shadows target-resolver.ts (canonical source is the only physical file)", () => {
  assert.equal(fs.existsSync(TARGET_RESOLVER_JS), false, "a target-resolver.js twin would shadow the .ts source under Node's default extensionless module resolution, exactly like the promoted-spec-runtime.js/evidence-recorder.js incident");
  assert.equal(fs.existsSync(TARGET_RESOLVER_TS), true);
});

test("8/11. no stale .js twin shadows promoted-field-target-contract.ts", () => {
  assert.equal(fs.existsSync(PROMOTED_FIELD_TARGET_CONTRACT_JS), false, "a promoted-field-target-contract.js twin would shadow semanticNameFromRef in the promoted runtime");
  assert.equal(fs.existsSync(PROMOTED_FIELD_TARGET_CONTRACT_TS), true);
});

test("9/12. no stale .js twin shadows the shared execution-plan-executor authority", () => {
  assert.equal(fs.existsSync(EXECUTION_PLAN_EXECUTOR_JS), false, "an execution-plan-executor.js twin would shadow completion-probe-authoritative TS behavior in FunctionalExecution");
  assert.equal(fs.existsSync(EXECUTION_PLAN_EXECUTOR_TS), true);
  const runtimeSource = fs.readFileSync(PROMOTED_RUNTIME_TS, "utf8");
  assert.match(runtimeSource, /from ["']\.\.\/\.\.\/runner\/execution-plan-executor["']/);
});

test("8/10. the imported target-resolver module (not source text) actually exports recordedLocatorFactory as a real function -- the exact call promoted-spec-runtime.ts's pressPromotedTarget makes", () => {
  assert.equal(typeof recordedLocatorFactory, "function", "recordedLocatorFactory must be a real, callable export -- this is the exact TypeError physically observed when the stale .js twin shadowed it");
});

test("9/10. the canonical promoted-spec-runtime.ts imports recordedLocatorFactory from the shared CORE target-resolver module, not a second/duplicated implementation", () => {
  const source = fs.readFileSync(PROMOTED_RUNTIME_TS, "utf8");
  const importMatches = source.match(/from ["']\.\.\/\.\.\/discovery\/target-resolver["']/g) ?? [];
  assert.ok(importMatches.length >= 1, "expected promoted-spec-runtime.ts to import from the shared target-resolver module");
  assert.match(source, /import\s*\{[^}]*recordedLocatorFactory[^}]*\}\s*from\s*["']\.\.\/\.\.\/discovery\/target-resolver["']/);
});

test("10/10. recordedLocatorFactory resolves a real role-strategy locator through the imported module -- proving the export is not just typeof-callable but functionally correct end to end", () => {
  const calls: string[] = [];
  const fakePage = {
    getByRole: (role: string, opts?: { name?: string }) => {
      calls.push(`getByRole:${role}:${opts?.name ?? ""}`);
      return { role, name: opts?.name };
    },
  } as any;
  const locator = recordedLocatorFactory(fakePage, { strategy: "role", value: "textbox|Contraseña" });
  assert.deepEqual(calls, ["getByRole:textbox:Contraseña"]);
  assert.ok(locator);
});
