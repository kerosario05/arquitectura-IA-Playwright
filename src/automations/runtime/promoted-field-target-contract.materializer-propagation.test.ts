import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolvePromotedFieldIdentityFromPersistedContract } from "./promoted-field-target-contract";

/**
 * FASE 6/8 coverage: a NEW spec's contract already carries the CORE-materialized
 * certifiedTechnicalTarget (see technical-target-materializer.ts / spec-execution-contract.ts).
 * These tests prove the binding layer reads it directly — with NO recording file present at
 * all — and only falls back to a live Recording-file lookup for LEGACY contracts that predate
 * the materializer wiring.
 */

const APP_SLUG = "test-materializer-propagation";
const SECTION_SLUG = "default-section";

function appRoot(): string {
  return path.join("automations", "apps", APP_SLUG);
}

function caseDir(caseId: string): string {
  return path.join(appRoot(), "sections", SECTION_SLUG, "cases", caseId);
}

function cleanup(): void {
  fs.rmSync(appRoot(), { recursive: true, force: true });
}

function withEnv(vars: Record<string, string>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test.beforeEach(() => cleanup());
test.after(() => cleanup());

test("bindingCandidatePropagationTest: a new spec's certifiedTechnicalTarget resolves with NO recording file present (newSpecDependsOnRecordingLookup=false)", () => {
  const dir = caseDir("case-new");
  fs.mkdirSync(dir, { recursive: true });
  const plan = {
    scenario: { externalId: "TEST-NEW", title: "New spec" },
    executionContract: {
      steps: [
        {
          scenarioStepIndex: 1,
          target: { strategy: "text", value: "Visa Gold" },
          valueKey: "card_test",
          certifiedTechnicalTarget: {
            targetType: "structural",
            locatorCandidates: [{ strategy: "role", value: "div|[data-testid=\"visa-gold-card\"]", confidence: 0.95 }],
            structuralContext: { stableDirectAttributes: { "data-testid": "visa-gold-card" } },
            interactionEvidence: [],
            confidence: 0.95,
            validatedByInteraction: false,
            certifiedFrom: "discovery",
            certificationTier: 1,
          },
        },
      ],
    },
  };
  fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(plan, null, 2), "utf8");
  // Deliberately NOT writing any semantic-recording.json / recordings/ directory anywhere.

  withEnv({ APP_SLUG, SECTION_SLUG, SCENARIO_ID: "TEST-NEW" }, () => {
    const identity = resolvePromotedFieldIdentityFromPersistedContract(1, "Visa Gold");
    assert.ok(identity, "identity must resolve purely from the contract");
    assert.equal(identity!.valueKey, "card_test");
    assert.ok(identity!.recordedTechnicalTargets?.length === 1);
    assert.equal(identity!.recordedTechnicalTargets![0].structuralContext?.stableDirectAttributes?.["data-testid"], "visa-gold-card");
    assert.equal((identity!.recordedTechnicalTargets![0] as any).certifiedFrom, "discovery");
  });
});

test("legacyFallbackTest: a legacy contract with only a valueKey (no certifiedTechnicalTarget) still falls back to the recording lookup", () => {
  const dir = caseDir("case-legacy");
  fs.mkdirSync(dir, { recursive: true });
  const plan = {
    scenario: { externalId: "TEST-LEGACY", title: "Legacy spec" },
    executionContract: {
      steps: [
        { scenarioStepIndex: 1, target: { strategy: "text", value: "Tarjetas" }, valueKey: "legacy_test" },
      ],
    },
  };
  fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(plan, null, 2), "utf8");

  const recDir = path.join(appRoot(), "recordings", "legacy-rec");
  fs.mkdirSync(recDir, { recursive: true });
  const recording = {
    recordingId: "legacy-rec",
    canonicalInteractions: [
      {
        valueKey: "legacy_test",
        action: "click",
        semanticField: "Tarjetas",
        technicalTargetRefs: ["role:button|Tarjetas"],
      },
    ],
  };
  fs.writeFileSync(path.join(recDir, "semantic-recording.json"), JSON.stringify(recording, null, 2), "utf8");

  withEnv({ APP_SLUG, SECTION_SLUG, SCENARIO_ID: "TEST-LEGACY" }, () => {
    const identity = resolvePromotedFieldIdentityFromPersistedContract(1, "Tarjetas");
    assert.ok(identity, "legacy identity must still resolve via the recording fallback");
    assert.equal(identity!.valueKey, "legacy_test");
    assert.ok(identity!.technicalTargetRefs.includes("role:button|Tarjetas"));
  });
});

test("targetMismatchCannotReplaceCurrentValueKey: an ordinal collision with a different target keeps the current call valueKey", () => {
  const dir = caseDir("case-cross-binding");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify({
    scenario: { externalId: "TEST-CROSS" },
    executionContract: { steps: [{ scenarioStepIndex: 1, target: { value: "persisted target" }, valueKey: "persisted_key" }] },
  }), "utf8");

  withEnv({ APP_SLUG, SECTION_SLUG, SCENARIO_ID: "TEST-CROSS" }, () => {
    const identity = resolvePromotedFieldIdentityFromPersistedContract(1, "current target", {
      valueKey: "current_key",
    });
    assert.equal(identity?.valueKey, "current_key");
    assert.deepEqual(identity?.technicalTargetRefs, []);
  });
});
