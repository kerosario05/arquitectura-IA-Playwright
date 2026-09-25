import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { materializeTechnicalTarget, normalizeRecordingEvidence } from "./technical-target-materializer";
import type { RecordedTechnicalTarget } from "../recording/session-trace.types";

/**
 * Cross-boundary proof for scenarioStepIndex=4 (recording d8dbd8f9-b353-4175-b365-e5f8957bae36):
 * reads the REAL, unedited trace.json this recording produced and drives it through the exact
 * same real functions spec-execution-contract.ts uses in production —
 * `technicalTargetCandidates.find(c => c.validatedByInteraction) ?? [0]` then
 * `normalizeRecordingEvidence` then `materializeTechnicalTarget` — never a synthetic
 * reimplementation. If either function regresses (stops normalizing, or starts fabricating an
 * unmaterializable locator), this test fails against the same real evidence that produced the
 * original incident.
 *
 * IMPORTANT correction versus an earlier report: the raw trace.json byte for this attribute is
 * U+00E9 ("é", a single, CORRECTLY encoded character) — not U+FFFD. There is no information loss
 * in the raw evidence itself; the double-mojibake ("CrÃ©dito") seen in the generated
 * candidate.spec.ts was introduced downstream, between this contract and the AI's own output,
 * which is outside what this materializer stage can fix. This test verifies precisely what the
 * materializer stage is responsible for: passing the real evidence through cleanly, with no
 * corruption of its own, and never regressing to embed a broken selector.
 */

const RECORDING_TRACE_PATH = path.resolve(
  __dirname,
  "../../automations/apps/kiosko/recordings/d8dbd8f9-b353-4175-b365-e5f8957bae36/trace.json",
);

function loadStep4RealCandidate(): RecordedTechnicalTarget {
  const raw = fs.readFileSync(RECORDING_TRACE_PATH, "utf-8");
  const trace = JSON.parse(raw) as { events: Array<{ url?: string; target?: { technicalTargetCandidates?: unknown[] } }> };
  // event 23 is the real "tap" event whose post-navigation URL
  // (product-extended?product=tarjeta-credito-visa-clasica) matches scenarioStepIndex=4's
  // recorded, physically-proven business transition.
  const event = trace.events.find((e) => e.url?.includes("product=tarjeta-credito-visa-clasica") && Array.isArray(e.target?.technicalTargetCandidates));
  assert.ok(event, "trace.json must still contain the real scenarioStepIndex=4 tap event — if this fails, the fixture recording changed, not just the code under test");
  const candidates = event!.target!.technicalTargetCandidates as Array<Record<string, unknown>>;
  const selected = candidates.find((c) => c.validatedByInteraction === true) ?? candidates[0];
  return selected as unknown as RecordedTechnicalTarget;
}

test("ENCODING_TRACE: the real raw evidence attribute is correctly-encoded UTF-8 (é, U+00E9), not U+FFFD", () => {
  const raw = fs.readFileSync(RECORDING_TRACE_PATH, "utf-8");
  assert.equal(raw.includes("�"), false, "trace.json must not contain the Unicode replacement character anywhere");
  assert.equal(raw.includes("Tarjeta Crédito"), true, "trace.json must contain the correctly-encoded attribute text");
});

test("cross-boundary Step 4 test: real recording evidence -> real materializer -> CertifiedTechnicalTarget carries no mojibake and no U+FFFD", () => {
  const rawCandidate = loadStep4RealCandidate();

  // Sanity: prove the REAL input as read from disk is what earlier analysis found — owner div,
  // one descendant img anchor, correctly-encoded (not U+FFFD).
  const structuralContext = rawCandidate.structuralContext as { owner?: { tag?: string }; stableDescendants?: Array<{ tag?: string; stableAttributes?: Record<string, string> }> } | undefined;
  assert.equal(structuralContext?.owner?.tag, "div");
  const anchorAttrs = structuralContext?.stableDescendants?.[0]?.stableAttributes ?? {};
  assert.equal(anchorAttrs.alt, "Tarjeta Crédito Visa Clásica");
  assert.equal(anchorAttrs.alt.includes("�"), false);

  const normalized = normalizeRecordingEvidence(rawCandidate, { operation: "click" });
  assert.ok(normalized);
  const certified = materializeTechnicalTarget(normalized!);

  assert.ok(certified, "the real evidence must still materialize a certified target");
  assert.equal(certified!.certificationTier, 3);
  assert.equal(certified!.locatorCandidates[0].strategy, "role");
  assert.equal(certified!.locatorCandidates[0].value, 'div|[alt="Tarjeta Crédito Visa Clásica"][src="/assets/images/tarjetas-de-credito-visa-clasica.png"]');

  const flat = JSON.stringify(certified);
  assert.equal(flat.includes("�"), false, "the certified target must never carry U+FFFD");
  assert.equal(flat.includes("CrÃ©dito"), false, "the certified target must never carry the double-mojibake corruption seen in the generated candidate");
  assert.equal(flat.includes("ClÃ¡sica"), false);
});

test("FAIL_CLOSED: an attribute that genuinely contains U+FFFD (irrecoverable) is discarded from the exact-match selector, not embedded broken", () => {
  const rawCandidate = loadStep4RealCandidate();
  const structuralContext = rawCandidate.structuralContext as { owner: { tag: string }; stableDescendants: Array<{ relation: "descendant"; tag: string; stableAttributes: Record<string, string> }> };
  // Simulate the one shape this real recording never actually produced: a byte sequence already
  // lost before it reached this codebase (U+FFFD), on top of the same real owner/anchor shape.
  const corrupted: RecordedTechnicalTarget = {
    ...rawCandidate,
    structuralContext: {
      ...structuralContext,
      stableDescendants: [
        {
          ...structuralContext.stableDescendants[0],
          stableAttributes: {
            alt: "Tarjeta Cr�dito Visa Cl�sica", // genuinely irrecoverable
            src: structuralContext.stableDescendants[0].stableAttributes.src,
          },
        },
      ],
    },
  };
  const normalized = normalizeRecordingEvidence(corrupted, { operation: "click" });
  const certified = materializeTechnicalTarget(normalized!);

  // The unsafe `alt` must be dropped; `src` (still safe) must survive, and Tier 3 must never
  // fabricate a bare "div|img" tag-pair as if it were still a unique tier-3 identity.
  assert.ok(certified);
  const flat = JSON.stringify(certified);
  assert.equal(flat.includes("�"), false, "no locator-authoritative field may carry U+FFFD");
  assert.equal(certified!.locatorCandidates[0].value, 'div|[src="/assets/images/tarjetas-de-credito-visa-clasica.png"]');
});

test("FAIL_CLOSED: TARGET_NOT_MATERIALIZABLE when every stable attribute is irrecoverable and no weaker tier applies", () => {
  const normalized = normalizeRecordingEvidence({
    targetType: "structural",
    locatorCandidates: [],
    structuralContext: {
      stableDirectAttributes: { alt: "���" },
    },
    confidence: 0.9,
    validatedByInteraction: true,
  } as unknown as RecordedTechnicalTarget);
  const certified = materializeTechnicalTarget(normalized!);
  assert.equal(certified, undefined, "with the only attribute irrecoverable and no owner/descendant/display-label evidence, the target must fail closed rather than fabricate an empty or non-unique selector");
});

test("generic rule: applies to any exact textual attribute, not just alt/Kiosko-specific values", () => {
  const normalized = normalizeRecordingEvidence({
    targetType: "structural",
    locatorCandidates: [],
    structuralContext: {
      stableDirectAttributes: {
        "data-product-name": "Producto de �horro",
        "aria-label": "Etiqueta segura",
      },
    },
    confidence: 0.9,
    validatedByInteraction: true,
  } as unknown as RecordedTechnicalTarget);
  const certified = materializeTechnicalTarget(normalized!);
  assert.ok(certified);
  assert.equal(certified!.certificationTier, 1);
  assert.equal(certified!.locatorCandidates[0].value, '[aria-label="Etiqueta segura"]');
  assert.ok(!certified!.locatorCandidates[0].value.includes("data-product-name"));
});
