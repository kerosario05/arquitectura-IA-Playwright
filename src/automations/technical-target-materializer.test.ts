import assert from "node:assert/strict";
import test from "node:test";
import {
  materializeTechnicalTarget,
  normalizeDiscoveryEvidence,
  normalizeRecordingEvidence,
} from "./technical-target-materializer";

const LONG_PANEL_LABEL =
  "Tarjeta Crédito Visa Gold Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Mayor plazo para pagar: 26 días después de la fe";

test("recordingMaterializerTest: recording evidence with owner + stable descendant materializes tier 3, structural evidence preserved", () => {
  const candidate = {
    targetType: "display",
    locatorCandidates: [{ strategy: "role", value: `div|${LONG_PANEL_LABEL}`, confidence: 0.85 }],
    structuralContext: {
      owner: { tag: "div" },
      stableDescendants: [
        { relation: "descendant", tag: "img", stableAttributes: { alt: "Tarjeta Crédito Visa Gold", src: "/assets/visa-gold.png" } },
      ],
      semanticShape: ["div", "h3"],
      deterministicStructuralIdentity: true,
      structuralIdentityMatchCount: 1,
    },
    confidence: 0.45,
    validatedByInteraction: true,
  };
  const normalized = normalizeRecordingEvidence(candidate, { displayLabel: LONG_PANEL_LABEL, operation: "click" });
  assert.ok(normalized);
  assert.equal(normalized!.source, "recording");
  const certified = materializeTechnicalTarget(normalized!);
  assert.ok(certified, "materializer must certify a target from owner + stable descendant evidence");
  assert.equal(certified!.certifiedFrom, "recording");
  assert.equal(certified!.certificationTier, 3);
  assert.equal(certified!.structuralContext?.owner?.tag, "div");
  assert.equal(certified!.structuralContext?.stableDescendants?.[0]?.stableAttributes.alt, "Tarjeta Crédito Visa Gold");
  assert.deepEqual(certified!.structuralContext?.semanticShape, ["div", "h3"]);
  // The long panel label must never become the primary locator value.
  assert.ok(!certified!.locatorCandidates[0].value.includes(LONG_PANEL_LABEL));
});

test("discoveryMaterializerTest: discovery testid evidence materializes tier 1 (stable direct attribute)", () => {
  const normalized = normalizeDiscoveryEvidence({ strategy: "testid", value: "visa-gold-card" }, { displayLabel: "Visa Gold" });
  assert.ok(normalized);
  assert.equal(normalized!.source, "discovery");
  const certified = materializeTechnicalTarget(normalized!);
  assert.ok(certified);
  assert.equal(certified!.certifiedFrom, "discovery");
  assert.equal(certified!.certificationTier, 1);
  assert.equal(certified!.structuralContext?.stableDirectAttributes?.["data-testid"], "visa-gold-card");
});

test("discoveryMaterializerTest: discovery role+name evidence materializes tier 2", () => {
  const normalized = normalizeDiscoveryEvidence({ strategy: "role", role: "button", name: "Iniciar" });
  assert.ok(normalized);
  const certified = materializeTechnicalTarget(normalized!);
  assert.ok(certified);
  assert.equal(certified!.certifiedFrom, "discovery");
  assert.equal(certified!.certificationTier, 2);
  assert.equal(certified!.locatorCandidates[0].value, "button|Iniciar");
});

test("longLabelNotPrimaryTest: a long display label with no structural evidence at all is NOT certified (fail closed, not a fragile fallback)", () => {
  const normalized = normalizeRecordingEvidence(
    { targetType: "display", locatorCandidates: [], confidence: 0.3, validatedByInteraction: false },
    { displayLabel: LONG_PANEL_LABEL },
  );
  assert.ok(normalized);
  const certified = materializeTechnicalTarget(normalized!);
  assert.equal(certified, undefined, "materializer must not fabricate a long getByText target");
});

test("short unique semantic text is accepted at tier 5 only when nothing stronger exists", () => {
  const normalized = normalizeRecordingEvidence(
    { targetType: "display", locatorCandidates: [], confidence: 0.3, validatedByInteraction: false },
    { displayLabel: "Tarjetas" },
  );
  const certified = materializeTechnicalTarget(normalized!);
  assert.ok(certified);
  assert.equal(certified!.certificationTier, 5);
  assert.equal(certified!.locatorCandidates[0].strategy, "text");
  assert.equal(certified!.locatorCandidates[0].value, "Tarjetas");
});

test("materialized output never contains positional/index hints", () => {
  const owner = normalizeRecordingEvidence({
    targetType: "display",
    locatorCandidates: [],
    structuralContext: { owner: { tag: "div" }, semanticShape: ["div"] },
    confidence: 0.5,
    validatedByInteraction: false,
  });
  const certified = materializeTechnicalTarget(owner!);
  assert.ok(certified);
  assert.equal(certified!.certificationTier, 4);
  const flat = JSON.stringify(certified);
  for (const forbidden of ["nth(", "first(", "last(", "nthChild", "childIndex"]) {
    assert.ok(!flat.includes(forbidden), `must not contain positional hint "${forbidden}"`);
  }
});

test("no evidence at all materializes nothing", () => {
  assert.equal(materializeTechnicalTarget({ source: "discovery" }), undefined);
});

// scenarioStepIndex=4, recording d8dbd8f9-b353-4175-b365-e5f8957bae36: the raw recording
// capture stored this element's alt attribute mojibake-corrupted ("Tarjeta CrÃ©dito Visa
// ClÃ¡sica" instead of "Tarjeta Crédito Visa Clásica"). A faithfully-generated CSS attribute
// selector built from the uncorrected value can never match the live (correctly-encoded) DOM
// attribute, so the candidate resolved to zero elements and hung until its own action timeout.
test("BUG scenarioStepIndex=4 repro: a mojibake-corrupted stable direct attribute (tier 1) is normalized before becoming a CSS locator", () => {
  const normalized = normalizeRecordingEvidence({
    targetType: "structural",
    locatorCandidates: [],
    structuralContext: { stableDirectAttributes: { alt: "Tarjeta CrÃ©dito Visa ClÃ¡sica" } },
    confidence: 0.9,
    validatedByInteraction: true,
  });
  const certified = materializeTechnicalTarget(normalized!);
  assert.ok(certified);
  assert.equal(certified!.certificationTier, 1);
  assert.equal(certified!.locatorCandidates[0].strategy, "css");
  assert.equal(certified!.locatorCandidates[0].value, '[alt="Tarjeta Crédito Visa Clásica"]');
  assert.ok(!certified!.locatorCandidates[0].value.includes("CrÃ©dito"), "the certified CSS locator must never carry the mojibake-corrupted byte sequence");
});

test("BUG scenarioStepIndex=4 repro: a mojibake-corrupted stable descendant anchor attribute (tier 3) is normalized before becoming a CSS locator", () => {
  const normalized = normalizeRecordingEvidence({
    targetType: "structural",
    locatorCandidates: [],
    structuralContext: {
      owner: { tag: "div" },
      stableDescendants: [
        {
          relation: "descendant",
          tag: "img",
          stableAttributes: {
            alt: "Tarjeta CrÃ©dito Visa ClÃ¡sica",
            src: "/assets/images/tarjetas-de-credito-visa-clasica.png",
          },
        },
      ],
    },
    confidence: 0.45,
    validatedByInteraction: true,
  });
  const certified = materializeTechnicalTarget(normalized!);
  assert.ok(certified);
  assert.equal(certified!.certificationTier, 3);
  assert.equal(certified!.locatorCandidates[0].value, 'div|[alt="Tarjeta Crédito Visa Clásica"][src="/assets/images/tarjetas-de-credito-visa-clasica.png"]');
  assert.ok(!certified!.locatorCandidates[0].value.includes("CrÃ©dito"));
  assert.ok(!certified!.locatorCandidates[0].value.includes("ClÃ¡sica"));
});
