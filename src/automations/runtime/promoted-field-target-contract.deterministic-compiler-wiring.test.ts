import assert from "node:assert/strict";
import test from "node:test";
import { resolvePromotedFieldIdentityFromPersistedContract } from "./promoted-field-target-contract";

/**
 * Proves the EXISTING persisted-contract lookup (already wired into
 * clickPromotedTarget/fillPromotedField -- no new resolver, no Record/MCP/
 * Discovery changes) genuinely finds real step6's certifiedTechnicalTarget
 * from the real, already-persisted PREVIEW-001 plan.json, once APP_SLUG/
 * SECTION_SLUG/SCENARIO_ID are set -- exactly what the deterministic
 * compiler must now emit for `runtime_resolution_required` steps to have any
 * chance of reaching resolveActionTarget's structural-owner/field-scoped
 * resolution instead of a bare, unscoped locator. No browser, no mutation of
 * plan.json -- read-only.
 */

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) previous[key] = process.env[key];
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("real PREVIEW-001 step6: persisted-contract lookup finds the ambiguous certifiedTechnicalTarget as recordedTechnicalTargets, given the same env vars the compiler now emits", () => {
  const identity = withEnv(
    { APP_SLUG: "portal-comercial", SECTION_SLUG: "default-section", SCENARIO_ID: "PREVIEW-001" },
    () => resolvePromotedFieldIdentityFromPersistedContract(6, "Número de identificación"),
  );

  assert.ok(identity, "persisted-contract lookup must find scenarioStepIndex=6 in the real plan.json");
  assert.ok(identity!.recordedTechnicalTargets?.length, "certifiedTechnicalTarget must be propagated as recordedTechnicalTargets -- the exact evidence resolveActionTarget's structural-owner/field-scoped resolution consumes");
  const target = identity!.recordedTechnicalTargets![0] as any;
  assert.equal(target.targetType, "structural");
  assert.equal(target.certificationTier, 4);
  assert.equal(target.structuralContext?.identityAmbiguous, true);
});

test("without APP_SLUG set, the persisted-contract lookup finds nothing (confirms the missing wiring this ticket fixes)", () => {
  const identity = withEnv(
    { APP_SLUG: undefined, SECTION_SLUG: undefined, SCENARIO_ID: undefined },
    () => resolvePromotedFieldIdentityFromPersistedContract(6, "Número de identificación"),
  );
  assert.equal(identity, undefined);
});
