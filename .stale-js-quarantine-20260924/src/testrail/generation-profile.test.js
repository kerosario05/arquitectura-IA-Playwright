"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const generation_profile_1 = require("./generation-profile");
const profile = (overrides = {}) => ({
    semanticType: "money",
    generationMode: "synthetic",
    ...overrides,
});
(0, node_test_1.default)("validates generation profiles against field capability without inferring semantics", () => {
    strict_1.default.equal((0, generation_profile_1.validateGenerationProfile)({ fieldCapability: { kind: "number" }, generationProfile: profile() }).valid, true);
    strict_1.default.equal((0, generation_profile_1.validateGenerationProfile)({ fieldCapability: { kind: "email" }, generationProfile: profile() }).valid, false);
    strict_1.default.equal((0, generation_profile_1.validateGenerationProfile)({ fieldCapability: { kind: "tel" }, generationProfile: profile({ semanticType: "phone", phone: { allowedPrefixes: ["7"], totalDigits: 10 } }) }).valid, true);
    strict_1.default.equal((0, generation_profile_1.validateGenerationProfile)({ fieldCapability: { kind: "text" }, generationProfile: profile({ semanticType: "document_identifier", generationMode: "configured_pool" }) }).valid, false);
    strict_1.default.equal((0, generation_profile_1.validateGenerationProfile)({ fieldCapability: { kind: "text" }, generationProfile: profile({ semanticType: "document_identifier", generationMode: "configured_pool", poolRef: "fixture_pool" }) }).valid, true);
    strict_1.default.equal((0, generation_profile_1.validateGenerationProfile)({ fieldCapability: { kind: "text" }, generationProfile: profile({ semanticType: "job_title", generationMode: "configured_dictionary", dictionaryRef: "fixture_dictionary" }) }).valid, true);
    strict_1.default.equal((0, generation_profile_1.validateGenerationProfile)({ fieldCapability: { kind: "number" }, generationProfile: profile({ numeric: { min: 5, max: 2 } }) }).valid, false);
    strict_1.default.equal((0, generation_profile_1.validateGenerationProfile)({ fieldCapability: { kind: "number" }, generationProfile: profile({ numeric: { decimalScale: -1 } }) }).valid, false);
    strict_1.default.equal((0, generation_profile_1.validateGenerationProfile)({ fieldCapability: { kind: "tel" }, generationProfile: profile({ semanticType: "phone", phone: { allowedPrefixes: [] } }) }).valid, false);
    strict_1.default.equal((0, generation_profile_1.validateGenerationProfile)({ fieldCapability: { kind: "date" }, generationProfile: profile({ semanticType: "date" }) }).valid, true);
    strict_1.default.equal((0, generation_profile_1.validateGenerationProfile)({ fieldCapability: { kind: "text" }, generationProfile: profile({ semanticType: "unknown", generationMode: "manual" }) }).valid, false);
    strict_1.default.equal((0, generation_profile_1.validateGenerationProfile)({ fieldCapability: { kind: "text" }, generationProfile: profile({ semanticType: "person_name" }) }).valid, true);
});
(0, node_test_1.default)("uses technical traits as the authoritative generation profile contract", () => {
    const technicalProfile = {
        valueKind: "number",
        sourceMode: "synthetic",
        constraints: { integerOnly: true, decimalScale: 0, min: 10, max: 20 },
    };
    strict_1.default.equal((0, generation_profile_1.validateGenerationProfile)({ fieldCapability: { kind: "number" }, generationProfile: technicalProfile }).valid, true);
    strict_1.default.equal((0, generation_profile_1.validateGenerationProfile)({ fieldCapability: { kind: "number" }, generationProfile: { ...technicalProfile, semanticHint: "money" } }).valid, true);
    strict_1.default.equal((0, generation_profile_1.validateGenerationProfile)({ fieldCapability: { kind: "number" }, generationProfile: { ...technicalProfile, semanticHint: "age" } }).valid, true);
    strict_1.default.equal((0, generation_profile_1.validateGenerationProfile)({ fieldCapability: { kind: "number" }, generationProfile: { ...technicalProfile, constraints: { integerOnly: true, decimalScale: 2 } } }).valid, false);
});
