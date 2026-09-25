import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { SpecExecutionContract } from "../spec-execution-contract";
import { ACTION_RUNTIME_METHOD_BY_OPERATION } from "../../types/pom-ownership";
import { compileDeterministicSpec as compileDeterministicSpecRaw } from "./deterministic-spec-compiler";

// Real, previously-persisted pipeline artifact (not a synthetic fixture).
// This is the same scenario/plan this session's DIAGNOSE tickets have been
// tracing physically (PREVIEW-001 / Segunta Prueba, portal-comercial).
const REAL_PLAN_PATH = path.resolve(
  __dirname,
  "../../../automations/apps/portal-comercial/sections/default-section/cases/preview-001-segunta-prueba/plan.json",
);
// The real case.spec.ts location this contract's plan.json actually lives beside.
const REAL_TARGET_SPEC_PATH = path.resolve(path.dirname(REAL_PLAN_PATH), "case.spec.ts");

function compileDeterministicSpec(contract: SpecExecutionContract) {
  return compileDeterministicSpecRaw(contract, { targetSpecPath: REAL_TARGET_SPEC_PATH });
}

function loadRealExecutionContract(): SpecExecutionContract {
  const plan = JSON.parse(fs.readFileSync(REAL_PLAN_PATH, "utf8"));
  assert.ok(plan.executionContract, "fixture plan.json has no executionContract to reuse");
  // No adapter: the persisted contract is passed through as-is. It already
  // carries only key/ref dataset identifiers (usuario/contrasena/...), never
  // literal secret values, so no redaction is needed here.
  return plan.executionContract as SpecExecutionContract;
}

test("real contract: compileDeterministicSpec does not throw on a real persisted SpecExecutionContract", () => {
  const contract = loadRealExecutionContract();
  assert.doesNotThrow(() => compileDeterministicSpec(contract));
});

test("real contract: ordering is preserved for every action step that produces a binding", () => {
  const contract = loadRealExecutionContract();
  const result = compileDeterministicSpec(contract);
  const indices = result.bindings.map((b) => b.scenarioStepIndex);
  const sorted = [...indices].sort((a, b) => a - b);
  assert.deepEqual(indices, sorted, "bindings must stay in scenarioStepIndex order");
});

test("real contract: runtime authority for each binding comes from the existing CORE table", () => {
  const contract = loadRealExecutionContract();
  const result = compileDeterministicSpec(contract);
  for (const binding of result.bindings) {
    if (binding.runtimeMethod === "expectPromotedVisible") continue; // oracle, not an operation binding
    assert.equal(
      binding.runtimeMethod,
      ACTION_RUNTIME_METHOD_BY_OPERATION[binding.operation],
      `binding for scenarioStepIndex=${binding.scenarioStepIndex} must reuse ACTION_RUNTIME_METHOD_BY_OPERATION`,
    );
  }
});

test("real contract: fill runtime values stay key/ref based, never literal dataset values", () => {
  const contract = loadRealExecutionContract();
  const result = compileDeterministicSpec(contract);
  const fillSteps = contract.steps.filter((s) => s.operation === "fill" && s.required !== false);
  for (const step of fillSteps) {
    if (!step.valueKey) continue;
    const binding = result.bindings.find((b) => b.scenarioStepIndex === step.scenarioStepIndex);
    assert.equal(binding?.dataRef, step.valueKey);
    assert.match(result.source, new RegExp(`PROMOTED_${step.valueKey.toUpperCase()}`));
  }
  // Guard against the actual literal display values that exist in this real contract.
  assert.doesNotMatch(result.source, /'hunter2'|process\.env\.APP_PASSWORD/);
});

test("real contract: press preserves operation=press and the step's key, never substitutes click", () => {
  const contract = loadRealExecutionContract();
  const result = compileDeterministicSpec(contract);
  const pressStep = contract.steps.find((s) => s.operation === "press");
  assert.ok(pressStep, "fixture must contain a press step");
  const binding = result.bindings.find((b) => b.scenarioStepIndex === pressStep!.scenarioStepIndex);
  assert.ok(binding, "press step must produce a binding");
  assert.equal(binding?.runtimeMethod, "pressPromotedTarget");
  assert.match(result.source, /pageObject\.press\(\{[\s\S]*?key: 'Enter'/);
});

test("real contract: the AI/registry-invented page_object.executeAction implementation is never consulted", () => {
  const contract = loadRealExecutionContract();
  const pressStep = contract.steps.find((s) => s.operation === "press");
  // Ground truth: this real contract carries the exact corrupt AI-path
  // implementation this session has been tracing (ProductListPage.executeAction,
  // classification B drift). The deterministic compiler must never read
  // `implementation.kind==="page_object"` to derive its runtime call.
  assert.equal((pressStep as any)?.implementation?.kind, "page_object");
  assert.equal((pressStep as any)?.implementation?.method, "executeAction");

  const result = compileDeterministicSpec(contract);
  assert.doesNotMatch(result.source, /executeAction/);
  assert.doesNotMatch(result.source, /ProductListPage/);
});

test("real contract: no browser/AI/POM-registry access occurs during compilation (pure function, no I/O)", () => {
  const contract = loadRealExecutionContract();
  // Purity proof: the compiler is a synchronous, side-effect-free function --
  // calling it twice must not touch the filesystem, page-objects.index.json,
  // or any network/provider call. Structural proxy: identical output twice.
  const first = compileDeterministicSpec(contract);
  const second = compileDeterministicSpec(contract);
  assert.deepEqual(first, second);
});

test("real contract: Record <-> Spec parity -- 6/7 required actions have valid spec authority; step6 fails closed on ambiguous certification", () => {
  const contract = loadRealExecutionContract();
  const result = compileDeterministicSpec(contract);

  const requiredActionSteps = contract.steps.filter(
    (s) => s.required !== false && ["fill", "press", "click"].includes(s.operation),
  );
  assert.equal(requiredActionSteps.length, 7, "fixture must contain 7 required executable actions");

  const actionBindings = result.bindings.filter((b) => b.runtimeMethod !== "expectPromotedVisible");
  // step6 (click, scenarioStepIndex=6) has no technicalTargetRef and its
  // certifiedTechnicalTarget is a "structural" tier-4 candidate the materializer's
  // own evidence marks ambiguous (identityAmbiguous=true, structuralIdentityMatchCount=2,
  // bare role:button with no discriminating name) -- per that module's own documented
  // intent, ambiguous structural evidence is a fail-closed concern, never silently
  // promoted into a locator. This is the one required action without valid spec
  // authority; the other 6 (including step5's tier-5 display fallback) remain valid.
  assert.equal(actionBindings.length, 6, "6 of 7 required actions have valid spec authority; step6 fails closed");
  assert.deepEqual(
    actionBindings.map((b) => b.scenarioStepIndex),
    requiredActionSteps.map((s) => s.scenarioStepIndex).filter((i) => i !== 6),
    "record.operation identity must match compiled.operation identity for every action with valid authority, in order",
  );

  assert.deepEqual(result.unsupportedCapabilities, ["scenarioStepIndex=6:click_insufficient_authority:ambiguous_structural_certification"]);

  // step5: no technicalTargetRef, but certifiedTechnicalTarget.targetType="display"
  // (tier 5) -- the materializer's own weakest-but-certified fallback, identical in
  // shape to target.strategy/value already used. Must remain valid, unchanged.
  const step5Binding = result.bindings.find((b) => b.scenarioStepIndex === 5);
  assert.ok(step5Binding, "step5 (tier-5 display authority) must still compile");
  assert.equal(step5Binding?.runtimeMethod, "fillPromotedField");

  const actionWithOracleStep = contract.steps.find(
    (s) => s.oracle?.type === "navigation_transition" && s.operation !== "assertUrl" && s.operation !== "assertVisible",
  );
  assert.ok(actionWithOracleStep, "fixture must contain a required action step carrying a navigation_transition oracle");

  const actionBinding = result.bindings.find(
    (b) => b.scenarioStepIndex === actionWithOracleStep!.scenarioStepIndex && b.runtimeMethod !== "expectPromotedVisible",
  );
  const oracleBinding = result.bindings.find(
    (b) => b.scenarioStepIndex === actionWithOracleStep!.scenarioStepIndex && b.runtimeMethod === "expectPromotedVisible",
  );

  assert.ok(actionBinding, "click action for step7 must be emitted, not dropped");
  assert.equal(actionBinding?.runtimeMethod, "clickPromotedTarget");
  assert.ok(oracleBinding, "oracle for step7 must still be preserved");

  const oracleIdx = result.source.indexOf("expectPromotedVisible");
  const clickIdx = result.source.lastIndexOf("pageObject.click(", oracleIdx);
  assert.ok(clickIdx !== -1 && clickIdx < oracleIdx, "action must be emitted before its attached oracle");
});

test("real contract: targetAuthorityPreserved -- technicalTargetRef is carried through verbatim when no competing valid certification exists; a fresh, non-ambiguous certified structural target wins when one coexists (jobId 25a2af2e-1ef3-4661-b156-5417c8783fe1 fix)", () => {
  const contract = loadRealExecutionContract();
  const result = compileDeterministicSpec(contract);

  const stepsWithTechnicalRef = contract.steps.filter((s) => s.required !== false && typeof s.technicalTargetRef === "string");
  assert.ok(stepsWithTechnicalRef.length > 0, "fixture must contain at least one step with an authoritative technicalTargetRef");

  for (const s of stepsWithTechnicalRef) {
    const binding = result.bindings.find((b) => b.scenarioStepIndex === s.scenarioStepIndex && b.runtimeMethod !== "expectPromotedVisible");
    assert.ok(binding, `scenarioStepIndex=${s.scenarioStepIndex} must produce an action binding`);
    // Re-derives the SAME validity/ambiguity check resolveCertifiedStructuralAuthority applies,
    // independently from the contract fixture's own fields -- not importing the private
    // function -- to state the expected authority for each real step generically.
    const cert = s.certifiedTechnicalTarget as {
      targetType?: string;
      structuralContext?: { identityAmbiguous?: boolean; structuralIdentityMatchCount?: number };
      locatorCandidates?: Array<{ strategy?: string; value?: string }>;
    } | undefined;
    const ambiguous = cert?.structuralContext?.identityAmbiguous === true
      || (typeof cert?.structuralContext?.structuralIdentityMatchCount === "number" && cert.structuralContext.structuralIdentityMatchCount > 1);
    const candidate = cert?.locatorCandidates?.[0];
    const certValid = cert?.targetType === "structural" && !ambiguous && Boolean(candidate?.strategy && candidate?.value);
    if (certValid) {
      assert.equal(
        binding?.targetRef, `${candidate!.strategy}:${candidate!.value}`,
        `a valid, non-ambiguous certified structural target must win over the coexisting technicalTargetRef for scenarioStepIndex=${s.scenarioStepIndex}`,
      );
    } else {
      assert.equal(binding?.targetRef, s.technicalTargetRef, `compiledTargetAuthority must equal contract.technicalTargetRef for scenarioStepIndex=${s.scenarioStepIndex} (no valid competing certification)`);
    }
  }

  // step3: press, authoritative technicalTargetRef="role:textbox|Contraseña" -- exact, not double-encoded.
  const step3 = contract.steps.find((s) => s.scenarioStepIndex === 3)!;
  assert.equal(step3.technicalTargetRef, "role:textbox|Contraseña");
  assert.match(result.source, /target: 'role:textbox\|Contraseña',\n\s*key: 'Enter'/);
  assert.doesNotMatch(result.source, /text:role:textbox\|Contraseña/);

  // step7: click. Fixture carries technicalTargetRef="role:button|Depurar" AND a valid,
  // non-ambiguous certified structural target -- per this fix, the fresher certified authority
  // wins (same precedence proven for step4 above), no getByText reconstruction either way.
  const step7 = contract.steps.find((s) => s.scenarioStepIndex === 7)!;
  assert.equal(step7.technicalTargetRef, "role:button|Depurar");
  assert.match(result.source, /parseSerializedTechnicalTargetString\('css:\[aria-label="Depurar"\]'\)/);
  assert.doesNotMatch(result.source, /getByText\('Depurar'\)/);

  const clickBinding = result.bindings.find((b) => b.scenarioStepIndex === 7 && b.runtimeMethod === "clickPromotedTarget");
  const oracleBinding = result.bindings.find((b) => b.scenarioStepIndex === 7 && b.runtimeMethod === "expectPromotedVisible");
  assert.ok(clickBinding, "step7 click must be emitted");
  assert.ok(oracleBinding, "step7 oracle must be emitted");
});
