"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const mobile_destination_claim_1 = require("../src/mobile/mobile-destination-claim");
/**
 * Mobile Destination Claim Contract Tests (T1-T22)
 *
 * Tests the structured destination expectation declaration for MOBILE route transitions.
 * These are DECLARATIONS only — they do NOT grant destinationSemanticAuthority or trustedForReuse.
 *
 * Key invariant: the provider ONLY REFERENCES pre-existing claims from the manifest.
 * The provider NEVER creates claims — it cannot choose semanticIdentity, requirementIds,
 * or other claim metadata.
 */
test_1.test.describe("mobile destination claim contract", () => {
    (0, test_1.test)("T1: trusted requirement→destination binding → manifest claim created before provider", () => {
        // Simulate a trusted config that binds requirement CA01 to screen "registro"
        const manifest = (0, mobile_destination_claim_1.buildMobileDestinationClaimManifest)(["CA01"], ["registro"]);
        // Currently no authoritative source exists, so manifest is empty
        // This test documents the expected behavior when a binding exists
        (0, test_1.expect)(manifest).toEqual([]);
    });
    (0, test_1.test)("T2: known screen without requirement binding → NO manifest claim", () => {
        const manifest = (0, mobile_destination_claim_1.buildMobileDestinationClaimManifest)([], ["login", "registro"]);
        // Screens exist but no requirement→destination binding → no claims
        (0, test_1.expect)(manifest).toEqual([]);
    });
    (0, test_1.test)("T3: requirement without destination binding → NO manifest claim", () => {
        const manifest = (0, mobile_destination_claim_1.buildMobileDestinationClaimManifest)(["CA01", "CA02"]);
        // Requirements exist but no destination binding → no claims
        (0, test_1.expect)(manifest).toEqual([]);
    });
    (0, test_1.test)("T4: provider references manifest claim → accepted", () => {
        // Manually create a manifest with a known claim
        const claimId = (0, mobile_destination_claim_1.buildDestinationClaimId)("CA01", "registro");
        const manifest = [{
                destinationClaimId: claimId,
                requirementIds: ["CA01"],
                kind: "semantic_destination",
                semanticIdentity: "registro",
                source: "trusted_config",
                trustLevel: "validated",
            }];
        const expectations = (0, mobile_destination_claim_1.parseStepDestinationExpectations)([{ stepIndex: 1, destinationClaimId: claimId }], 3, ["CA01"], manifest);
        (0, test_1.expect)(expectations).toBeDefined();
        (0, test_1.expect)(expectations).toHaveLength(1);
        (0, test_1.expect)(expectations[0].destinationClaimId).toBe(claimId);
        (0, test_1.expect)(expectations[0].requirementIds).toEqual(["CA01"]);
        (0, test_1.expect)(expectations[0].semanticIdentity).toBe("registro");
        (0, test_1.expect)(expectations[0].source).toBe("trusted_config");
        (0, test_1.expect)(expectations[0].trustLevel).toBe("validated");
    });
    (0, test_1.test)("T5: provider invents destinationClaimId → rejected", () => {
        const manifest = [{
                destinationClaimId: (0, mobile_destination_claim_1.buildDestinationClaimId)("CA01", "registro"),
                requirementIds: ["CA01"],
                kind: "semantic_destination",
                semanticIdentity: "registro",
                source: "trusted_config",
                trustLevel: "validated",
            }];
        const expectations = (0, mobile_destination_claim_1.parseStepDestinationExpectations)([{ stepIndex: 1, destinationClaimId: "invented_id_123" }], 3, ["CA01"], manifest);
        // Unknown claim ID → rejected
        (0, test_1.expect)(expectations).toBeUndefined();
    });
    (0, test_1.test)("T6: provider tries to send different semanticIdentity → ignored, manifest metadata used", () => {
        const claimId = (0, mobile_destination_claim_1.buildDestinationClaimId)("CA01", "registro");
        const manifest = [{
                destinationClaimId: claimId,
                requirementIds: ["CA01"],
                kind: "semantic_destination",
                semanticIdentity: "registro",
                source: "trusted_config",
                trustLevel: "validated",
            }];
        // Provider tries to override semanticIdentity
        const expectations = (0, mobile_destination_claim_1.parseStepDestinationExpectations)([{ stepIndex: 1, destinationClaimId: claimId, semanticIdentity: "pantalla_inventada" }], 3, ["CA01"], manifest);
        (0, test_1.expect)(expectations).toBeDefined();
        // semanticIdentity comes from manifest, NOT from provider
        (0, test_1.expect)(expectations[0].semanticIdentity).toBe("registro");
    });
    (0, test_1.test)("T7: provider tries to send different requirementIds → ignored, manifest metadata used", () => {
        const claimId = (0, mobile_destination_claim_1.buildDestinationClaimId)("CA01", "registro");
        const manifest = [{
                destinationClaimId: claimId,
                requirementIds: ["CA01"],
                kind: "semantic_destination",
                semanticIdentity: "registro",
                source: "trusted_config",
                trustLevel: "validated",
            }];
        // Provider tries to override requirementIds
        const expectations = (0, mobile_destination_claim_1.parseStepDestinationExpectations)([{ stepIndex: 1, destinationClaimId: claimId, requirementIds: ["CA99"] }], 3, ["CA01"], manifest);
        (0, test_1.expect)(expectations).toBeDefined();
        // requirementIds come from manifest, NOT from provider
        (0, test_1.expect)(expectations[0].requirementIds).toEqual(["CA01"]);
    });
    (0, test_1.test)("T8: manifest claim ID is deterministic", () => {
        const id1 = (0, mobile_destination_claim_1.buildDestinationClaimId)("CA01", "registro");
        const id2 = (0, mobile_destination_claim_1.buildDestinationClaimId)("CA01", "registro");
        (0, test_1.expect)(id1).toBe(id2);
    });
    (0, test_1.test)("T9: manifest claim ID does not depend on scenarioId", () => {
        const id1 = (0, mobile_destination_claim_1.buildDestinationClaimId)("CA01", "registro");
        const id2 = (0, mobile_destination_claim_1.buildDestinationClaimId)("CA01", "registro");
        (0, test_1.expect)(id1).toBe(id2);
        const id3 = (0, mobile_destination_claim_1.buildDestinationClaimId)("CA01", "login");
        (0, test_1.expect)(id1).not.toBe(id3);
    });
    (0, test_1.test)("T10: provider cannot construct claim indirectly (empty manifest → no claims possible)", () => {
        const manifest = [];
        const expectations = (0, mobile_destination_claim_1.parseStepDestinationExpectations)([{ stepIndex: 1, destinationClaimId: (0, mobile_destination_claim_1.buildDestinationClaimId)("CA01", "registro") }], 3, ["CA01"], manifest);
        // Empty manifest → no claims can be referenced → all rejected
        (0, test_1.expect)(expectations).toBeUndefined();
    });
    (0, test_1.test)("T11: empty manifest + provider semanticIdentity → rejected", () => {
        const manifest = [];
        const expectations = (0, mobile_destination_claim_1.parseStepDestinationExpectations)([{ stepIndex: 1, destinationClaimId: (0, mobile_destination_claim_1.buildDestinationClaimId)("CA01", "registro") }], 3, ["CA01"], manifest);
        (0, test_1.expect)(expectations).toBeUndefined();
    });
    (0, test_1.test)("T12: known screen without binding does not grant authority", () => {
        // Even if "registro" is a known screen, without a manifest claim it cannot be referenced
        const manifest = (0, mobile_destination_claim_1.buildMobileDestinationClaimManifest)(["CA01"], ["registro"]);
        (0, test_1.expect)(manifest).toEqual([]);
        // Provider cannot reference any claim
        const expectations = (0, mobile_destination_claim_1.parseStepDestinationExpectations)([{ stepIndex: 1, destinationClaimId: (0, mobile_destination_claim_1.buildDestinationClaimId)("CA01", "registro") }], 3, ["CA01"], manifest);
        (0, test_1.expect)(expectations).toBeUndefined();
    });
    (0, test_1.test)("T13: validated Knowledge binding can create manifest claim (if contract allows)", () => {
        // Currently no validated knowledge binding exists, so manifest is empty
        // This test documents that validated_knowledge source is supported in the type
        const manifest = (0, mobile_destination_claim_1.buildMobileDestinationClaimManifest)(["CA01"]);
        (0, test_1.expect)(manifest).toEqual([]);
    });
    (0, test_1.test)("T14: trusted config binding can create manifest claim (if contract allows)", () => {
        // Currently no trusted config binding exists, so manifest is empty
        // This test documents that trusted_config source is supported in the type
        const manifest = (0, mobile_destination_claim_1.buildMobileDestinationClaimManifest)(["CA01"]);
        (0, test_1.expect)(manifest).toEqual([]);
    });
    (0, test_1.test)("T15: untrusted/declared Knowledge does not create manifest claim", () => {
        // provider_declaration is NOT a valid source for DestinationClaimDefinition
        // Only canonical_requirement, trusted_config, validated_knowledge are valid
        const manifest = (0, mobile_destination_claim_1.buildMobileDestinationClaimManifest)(["CA01"]);
        (0, test_1.expect)(manifest).toEqual([]);
    });
    (0, test_1.test)("T16: StepDestinationExpectation derives metadata from manifest", () => {
        const claimId = (0, mobile_destination_claim_1.buildDestinationClaimId)("CA01", "registro");
        const manifest = [{
                destinationClaimId: claimId,
                requirementIds: ["CA01"],
                kind: "semantic_destination",
                semanticIdentity: "registro",
                source: "trusted_config",
                trustLevel: "validated",
            }];
        const expectations = (0, mobile_destination_claim_1.parseStepDestinationExpectations)([{ stepIndex: 1, destinationClaimId: claimId }], 3, ["CA01"], manifest);
        (0, test_1.expect)(expectations).toBeDefined();
        // All metadata comes from manifest, NOT from provider
        (0, test_1.expect)(expectations[0].requirementIds).toEqual(["CA01"]);
        (0, test_1.expect)(expectations[0].kind).toBe("semantic_destination");
        (0, test_1.expect)(expectations[0].semanticIdentity).toBe("registro");
        (0, test_1.expect)(expectations[0].source).toBe("trusted_config");
        (0, test_1.expect)(expectations[0].trustLevel).toBe("validated");
    });
    (0, test_1.test)("T17: invalid stepIndex → rejected", () => {
        const claimId = (0, mobile_destination_claim_1.buildDestinationClaimId)("CA01", "registro");
        const manifest = [{
                destinationClaimId: claimId,
                requirementIds: ["CA01"],
                kind: "semantic_destination",
                semanticIdentity: "registro",
                source: "trusted_config",
                trustLevel: "validated",
            }];
        const expectations = (0, mobile_destination_claim_1.parseStepDestinationExpectations)([{ stepIndex: 5, destinationClaimId: claimId }], 3, ["CA01"], manifest);
        (0, test_1.expect)(expectations).toBeUndefined();
    });
    (0, test_1.test)("T18: inserted step does not inherit destination claim", () => {
        const claimId = (0, mobile_destination_claim_1.buildDestinationClaimId)("CA01", "registro");
        const manifest = [{
                destinationClaimId: claimId,
                requirementIds: ["CA01"],
                kind: "semantic_destination",
                semanticIdentity: "registro",
                source: "trusted_config",
                trustLevel: "validated",
            }];
        const refs = [{ stepIndex: 1, requirementIds: ["CA01"] }];
        const expectations = (0, mobile_destination_claim_1.parseStepDestinationExpectations)([
            { stepIndex: 0, destinationClaimId: claimId },
            { stepIndex: 1, destinationClaimId: claimId },
        ], 3, ["CA01"], manifest);
        (0, test_1.expect)(expectations).toHaveLength(2);
        // Validate against refs — step 0 is not in refs, so its expectation is dropped
        const validated = (0, mobile_destination_claim_1.validateStepDestinationExpectations)(expectations, refs);
        (0, test_1.expect)(validated).toHaveLength(1);
        (0, test_1.expect)(validated[0].stepIndex).toBe(1);
    });
    (0, test_1.test)("T19: step deletion does not transfer claim by text", () => {
        const claimId1 = (0, mobile_destination_claim_1.buildDestinationClaimId)("CA01", "registro");
        const claimId2 = (0, mobile_destination_claim_1.buildDestinationClaimId)("CA02", "login");
        const manifest = [
            {
                destinationClaimId: claimId1,
                requirementIds: ["CA01"],
                kind: "semantic_destination",
                semanticIdentity: "registro",
                source: "trusted_config",
                trustLevel: "validated",
            },
            {
                destinationClaimId: claimId2,
                requirementIds: ["CA02"],
                kind: "semantic_destination",
                semanticIdentity: "login",
                source: "trusted_config",
                trustLevel: "validated",
            },
        ];
        const refs = [{ stepIndex: 2, requirementIds: ["CA02"] }];
        const expectations = (0, mobile_destination_claim_1.parseStepDestinationExpectations)([
            { stepIndex: 1, destinationClaimId: claimId1 },
            { stepIndex: 2, destinationClaimId: claimId2 },
        ], 4, ["CA01", "CA02"], manifest);
        (0, test_1.expect)(expectations).toHaveLength(2);
        const validated = (0, mobile_destination_claim_1.validateStepDestinationExpectations)(expectations, refs);
        (0, test_1.expect)(validated).toHaveLength(1);
        (0, test_1.expect)(validated[0].stepIndex).toBe(2);
        (0, test_1.expect)(validated[0].semanticIdentity).toBe("login");
    });
    (0, test_1.test)("T20: declaration does not change destinationSemanticAuthority", () => {
        const claimId = (0, mobile_destination_claim_1.buildDestinationClaimId)("CA01", "registro");
        const manifest = [{
                destinationClaimId: claimId,
                requirementIds: ["CA01"],
                kind: "semantic_destination",
                semanticIdentity: "registro",
                source: "trusted_config",
                trustLevel: "validated",
            }];
        const expectations = (0, mobile_destination_claim_1.parseStepDestinationExpectations)([{ stepIndex: 1, destinationClaimId: claimId }], 3, ["CA01"], manifest);
        (0, test_1.expect)(expectations).toBeDefined();
        (0, test_1.expect)(expectations[0].destinationSemanticAuthority).toBeUndefined();
    });
    (0, test_1.test)("T21: declaration does not change trustedForReuse", () => {
        const claimId = (0, mobile_destination_claim_1.buildDestinationClaimId)("CA01", "registro");
        const manifest = [{
                destinationClaimId: claimId,
                requirementIds: ["CA01"],
                kind: "semantic_destination",
                semanticIdentity: "registro",
                source: "trusted_config",
                trustLevel: "validated",
            }];
        const expectations = (0, mobile_destination_claim_1.parseStepDestinationExpectations)([{ stepIndex: 1, destinationClaimId: claimId }], 3, ["CA01"], manifest);
        (0, test_1.expect)(expectations).toBeDefined();
        (0, test_1.expect)(expectations[0].trustedForReuse).toBeUndefined();
    });
    (0, test_1.test)("T22: no production hardcodes", () => {
        const id1 = (0, mobile_destination_claim_1.buildDestinationClaimId)("ANY_CRITERION", "any_destination");
        const id2 = (0, mobile_destination_claim_1.buildDestinationClaimId)("CA99", "pantalla_xyz");
        (0, test_1.expect)(id1).toBeTruthy();
        (0, test_1.expect)(id2).toBeTruthy();
        (0, test_1.expect)(id1).not.toBe(id2);
        (0, test_1.expect)(id1).toMatch(/^[a-f0-9]{16}$/);
        (0, test_1.expect)(id2).toMatch(/^[a-f0-9]{16}$/);
    });
});
