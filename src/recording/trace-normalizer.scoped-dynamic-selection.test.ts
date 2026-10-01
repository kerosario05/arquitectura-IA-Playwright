import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions } from "./canonical-recording-contract";
import type { RecordedEvent } from "./session-trace.types";
import { normalizeEvents } from "./trace-normalizer";

test("unique dynamic option text scoped to a select owner becomes a semantic selection", () => {
  const trigger: RecordedEvent = {
    seq: 28,
    t: 73_684,
    kind: "tap",
    interactionId: "pointer-5",
    screenKey: "transfer-screen",
    target: {
      label: "Seleccione una Cuenta / undefined Balance Disponible",
      tag: "div",
      locators: [],
      technicalTargetCandidates: [{
        targetType: "structural",
        locatorCandidates: [],
        structuralContext: {
          owner: { tag: "div" },
          stableDirectAttributes: {},
          stableDescendants: [],
          semanticShape: ["div"],
          deterministicStructuralIdentity: true,
          structuralIdentityMatchCount: 1,
          scopeIdentity: { strategy: "id", value: "account-to-block" },
          captureScopeUnique: true,
          captureTargetMatchCount: 1,
        },
        interactionEvidence: ["v2_click_owner"],
        confidence: 0.85,
        validatedByInteraction: true,
      }],
    },
  };
  const option: RecordedEvent = {
    seq: 29,
    t: 76_091,
    kind: "tap",
    interactionId: "pointer-6",
    screenKey: "transfer-screen",
    target: {
      label: "Savings account / changing account details",
      tag: "span",
      locators: [{ strategy: "css", value: "div:has(select[id=\"account-to-select-input\"])" }],
      semanticRuntimeEvidence: {
        source: "accessible_name",
        normalizedValue: "Savings account / changing account details",
        targetTag: "span",
        scopeAlternatives: [
          { scopeIdentity: { strategy: "css", value: "div:has(select[id=\"account-to-select-input\"])" }, captureMatchCount: 1 },
          { scopeIdentity: { strategy: "id", value: "account-to-block" }, captureMatchCount: 1 },
        ],
        captureUniqueTarget: true,
      },
    },
  };

  const normalized = normalizeEvents([trigger, option]);
  const selected = normalized.find((event) => event.interactionId === "pointer-6");
  assert.equal(selected?.kind, "tap");
  assert.equal(selected?.target?.compoundRole, "selection");
  assert.equal(selected?.target?.interactionType, "select");
  assert.equal(selected?.target?.afterValue, "Savings account / changing account details");
  assert.equal(selected?.target?.associatedField, "Seleccione una Cuenta");

  const canonical = buildCanonicalInteractions(normalized);
  const selection = canonical.find((interaction) => interaction.action === "select");
  assert.equal(selection?.semanticField, "Seleccione una Cuenta");
  assert.equal(selection?.recordedValue, "Savings account / changing account details");
  assert.equal(selection?.valueKey, "seleccione_una_cuenta_seleccion");
});
