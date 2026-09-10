import assert from "node:assert/strict";
import test from "node:test";
import { validateGenerationProfile, type GenerationProfile } from "./generation-profile";

const profile = (overrides: Partial<GenerationProfile> = {}): GenerationProfile => ({
  semanticType: "money",
  generationMode: "synthetic",
  ...overrides,
});

test("validates generation profiles against field capability without inferring semantics", () => {
  assert.equal(validateGenerationProfile({ fieldCapability: { kind: "number" }, generationProfile: profile() }).valid, true);
  assert.equal(validateGenerationProfile({ fieldCapability: { kind: "email" }, generationProfile: profile() }).valid, false);
  assert.equal(validateGenerationProfile({ fieldCapability: { kind: "tel" }, generationProfile: profile({ semanticType: "phone", phone: { allowedPrefixes: ["7"], totalDigits: 10 } }) }).valid, true);
  assert.equal(validateGenerationProfile({ fieldCapability: { kind: "text" }, generationProfile: profile({ semanticType: "document_identifier", generationMode: "configured_pool" }) }).valid, false);
  assert.equal(validateGenerationProfile({ fieldCapability: { kind: "text" }, generationProfile: profile({ semanticType: "document_identifier", generationMode: "configured_pool", poolRef: "fixture_pool" }) }).valid, true);
  assert.equal(validateGenerationProfile({ fieldCapability: { kind: "text" }, generationProfile: profile({ semanticType: "job_title", generationMode: "configured_dictionary", dictionaryRef: "fixture_dictionary" }) }).valid, true);
  assert.equal(validateGenerationProfile({ fieldCapability: { kind: "number" }, generationProfile: profile({ numeric: { min: 5, max: 2 } }) }).valid, false);
  assert.equal(validateGenerationProfile({ fieldCapability: { kind: "number" }, generationProfile: profile({ numeric: { decimalScale: -1 } }) }).valid, false);
  assert.equal(validateGenerationProfile({ fieldCapability: { kind: "tel" }, generationProfile: profile({ semanticType: "phone", phone: { allowedPrefixes: [] } }) }).valid, false);
  assert.equal(validateGenerationProfile({ fieldCapability: { kind: "date" }, generationProfile: profile({ semanticType: "date" }) }).valid, true);
  assert.equal(validateGenerationProfile({ fieldCapability: { kind: "text" }, generationProfile: profile({ semanticType: "unknown", generationMode: "manual" }) }).valid, false);
  assert.equal(validateGenerationProfile({ fieldCapability: { kind: "text" }, generationProfile: profile({ semanticType: "person_name" }) }).valid, true);
});

test("uses technical traits as the authoritative generation profile contract", () => {
  const technicalProfile = {
    valueKind: "number",
    sourceMode: "synthetic",
    constraints: { integerOnly: true, decimalScale: 0, min: 10, max: 20 },
  };
  assert.equal(validateGenerationProfile({ fieldCapability: { kind: "number" }, generationProfile: technicalProfile as never }).valid, true);
  assert.equal(validateGenerationProfile({ fieldCapability: { kind: "number" }, generationProfile: { ...technicalProfile, semanticHint: "money" } as never }).valid, true);
  assert.equal(validateGenerationProfile({ fieldCapability: { kind: "number" }, generationProfile: { ...technicalProfile, semanticHint: "age" } as never }).valid, true);
  assert.equal(validateGenerationProfile({ fieldCapability: { kind: "number" }, generationProfile: { ...technicalProfile, constraints: { integerOnly: true, decimalScale: 2 } } as never }).valid, false);
});
