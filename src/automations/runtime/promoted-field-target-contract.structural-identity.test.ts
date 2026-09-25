import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  resolvePromotedFieldIdentityFromPersistedContract,
} from "./promoted-field-target-contract";

/**
 * Regression coverage for the Kiosko2 / Step 4 / "Visa Gold" failure class.
 *
 * Uses a dedicated, disposable app slug with synthetic fixtures shaped exactly like the real
 * ones captured from the live kiosko case + a1dcf6a5 recording during diagnosis this session
 * (plan.json step 4: valueKey present, no technicalTargetRefs, mojibake-corrupted target text;
 * semantic-recording.json: matching canonicalInteraction with the real structural owner —
 * div, stable img[alt/src] descendant, semanticShape=[div,h3]) — not the live, mutable
 * production files, which this repo's own discovery/promotion pipeline can overwrite at any
 * time from an unrelated concurrent run. A hermetic fixture is required for a stable test.
 */

const APP_SLUG = "test-structural-identity-fix";
const SECTION_SLUG = "default-section";
const VALUE_KEY = "tarjeta_credito_visa_gold_test";
const MOJIBAKE_TARGET = "Tarjeta CrÃ©dito Visa Gold Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Mayor plazo para pagar: 26 dÃ­as despuÃ©s de la fe";

function appRoot(): string {
  return path.join("automations", "apps", APP_SLUG);
}

function writePlan(): void {
  const caseDir = path.join(appRoot(), "sections", SECTION_SLUG, "cases", "case1");
  fs.mkdirSync(caseDir, { recursive: true });
  const plan = {
    scenario: { externalId: "TEST-001", title: "Kiosko2Test" },
    executionContract: {
      steps: [
        { scenarioStepIndex: 2, target: { strategy: "text", value: "Tarjetas" }, valueKey: "tarjetas_test" },
        {
          scenarioStepIndex: 4,
          // Same shape as the real bug: only a concatenated text target, no technicalTargetRefs.
          target: { strategy: "text", value: MOJIBAKE_TARGET },
          valueKey: VALUE_KEY,
        },
      ],
    },
  };
  fs.writeFileSync(path.join(caseDir, "plan.json"), JSON.stringify(plan, null, 2), "utf8");
}

function writeRecording(): void {
  const recDir = path.join(appRoot(), "recordings", "rec1");
  fs.mkdirSync(recDir, { recursive: true });
  const recording = {
    recordingId: "rec1",
    // Deliberately no primaryScenario field — matches the real recording, and exercises the
    // title-fallback-absent path when RECORDING_ID is also not set.
    canonicalInteractions: [
      { valueKey: "tarjetas_test", action: "click", semanticField: "Tarjetas", technicalTargetRefs: ["role:button|Tarjetas"] },
      {
        valueKey: VALUE_KEY,
        action: "click",
        semanticField: "Tarjeta Crédito Visa Gold Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Mayor plazo para pagar: 26 días después de la fe",
        technicalTargetRefs: ["role:div|Tarjeta Crédito Visa Gold Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Mayor plazo para pagar: 26 días después de la fe"],
        technicalTargetCandidates: [
          {
            targetType: "display",
            semanticRole: "display",
            locatorCandidates: [
              { strategy: "role", value: "div|Tarjeta Crédito Visa Gold Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Mayor plazo para pagar: 26 días después de la fe", confidence: 0.85 },
            ],
            structuralContext: {
              owner: { tag: "div" },
              stableDescendants: [
                { relation: "descendant", tag: "img", stableAttributes: { alt: "Tarjeta Crédito Visa Gold", src: "/assets/images/tarjetas-de-credito-visa-gold.png" } },
              ],
              semanticShape: ["div", "h3"],
              stableDirectAttributes: {},
              deterministicStructuralIdentity: true,
              structuralIdentityMatchCount: 1,
            },
            stableAttributes: {},
            confidence: 0.45,
            validatedByInteraction: true,
          },
        ],
      },
    ],
  };
  fs.writeFileSync(path.join(recDir, "semantic-recording.json"), JSON.stringify(recording, null, 2), "utf8");
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

test.beforeEach(() => {
  cleanup();
  writePlan();
  writeRecording();
});

test.after(() => {
  cleanup();
});

test("CASE 1/2/8: step 4 resolves the recorded structural owner via valueKey, no RECORDING_ID needed, mojibake target does not veto it", () => {
  withEnv({ APP_SLUG, SECTION_SLUG, SCENARIO_ID: "TEST-001" }, () => {
    const identity = resolvePromotedFieldIdentityFromPersistedContract(4, MOJIBAKE_TARGET);
    assert.ok(identity, "identity must be resolved for step 4");
    assert.equal(identity!.valueKey, VALUE_KEY);

    const recorded = identity!.recordedTechnicalTargets;
    assert.ok(recorded && recorded.length > 0, "recordedTechnicalTargets must be populated — this is the fix");

    const structuralContext = recorded![0].structuralContext as any;
    assert.equal(structuralContext?.owner?.tag, "div");
    assert.equal(structuralContext?.deterministicStructuralIdentity, true);
    assert.equal(structuralContext?.structuralIdentityMatchCount, 1);
    const descendant = structuralContext?.stableDescendants?.[0];
    assert.equal(descendant?.tag, "img");
    // CASE 3: the stable descendant's own attributes are correctly encoded even though the
    // display label passed as `target` above is mojibake-corrupted.
    assert.equal(descendant?.stableAttributes?.alt, "Tarjeta Crédito Visa Gold");
    assert.deepEqual(structuralContext?.semanticShape, ["div", "h3"]);
  });
});

// CASE 5: role-target steps (short labels) keep resolving exactly as before — the fix is
// additive (a new field), it does not change technicalTargetRefs derivation.
test("CASE 5: a short-label step (Tarjetas) is unaffected by the structural-identity fix", () => {
  withEnv({ APP_SLUG, SECTION_SLUG, SCENARIO_ID: "TEST-001" }, () => {
    const identity = resolvePromotedFieldIdentityFromPersistedContract(2, "Tarjetas");
    assert.ok(identity, "identity must still be resolved for step 2");
    assert.equal(identity!.valueKey, "tarjetas_test");
  });
});

// CASE 6/7: recordedTechnicalTargets carries only recorded structural metadata — no
// nth/first/last/positional data, and it is plain-JSON-serializable.
test("CASE 6/7: recordedTechnicalTargets has no positional/index fields and survives JSON round-trip", () => {
  withEnv({ APP_SLUG, SECTION_SLUG, SCENARIO_ID: "TEST-001" }, () => {
    const identity = resolvePromotedFieldIdentityFromPersistedContract(4, MOJIBAKE_TARGET);
    const recorded = identity!.recordedTechnicalTargets!;
    const serialized = JSON.parse(JSON.stringify(recorded));
    assert.deepEqual(serialized, recorded);
    const flat = JSON.stringify(recorded);
    for (const forbidden of ["nth", "first(", "last(", "childIndex", "nthChild"]) {
      assert.ok(!flat.includes(forbidden), `must not contain positional hint "${forbidden}"`);
    }
  });
});

// CASE 4 (data-integrity half): the structural-owner ambiguity gate itself is preserved
// verbatim from the recording, ready for resolveRecordedStructuralOwner's own fail-closed
// check (covered by src/discovery/target-surface-fidelity.test.ts) — this resolver never
// overrides or strips it.
test("CASE 4: the ambiguity gate fields are passed through unmodified for downstream fail-closed resolution", () => {
  withEnv({ APP_SLUG, SECTION_SLUG, SCENARIO_ID: "TEST-001" }, () => {
    const identity = resolvePromotedFieldIdentityFromPersistedContract(4, MOJIBAKE_TARGET);
    const structuralContext = identity!.recordedTechnicalTargets![0].structuralContext as any;
    assert.equal(typeof structuralContext.deterministicStructuralIdentity, "boolean");
    assert.equal(typeof structuralContext.structuralIdentityMatchCount, "number");
  });
});
