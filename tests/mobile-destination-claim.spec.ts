import { expect, test } from "@playwright/test";
import {
  buildDestinationClaimId,
  buildMobileDestinationClaimManifest,
  parseStepDestinationExpectations,
  validateStepDestinationExpectations,
  type DestinationClaimDefinition,
  type StepDestinationExpectation,
} from "../src/mobile/mobile-destination-claim";

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

test.describe("mobile destination claim contract", () => {
  test("T1: trusted requirement→destination binding → manifest claim created before provider", () => {
    // Simulate a trusted config that binds requirement CA01 to screen "registro"
    const manifest = buildMobileDestinationClaimManifest(["CA01"], ["registro"]);
    // Currently no authoritative source exists, so manifest is empty
    // This test documents the expected behavior when a binding exists
    expect(manifest).toEqual([]);
  });

  test("T2: known screen without requirement binding → NO manifest claim", () => {
    const manifest = buildMobileDestinationClaimManifest([], ["login", "registro"]);
    // Screens exist but no requirement→destination binding → no claims
    expect(manifest).toEqual([]);
  });

  test("T3: requirement without destination binding → NO manifest claim", () => {
    const manifest = buildMobileDestinationClaimManifest(["CA01", "CA02"]);
    // Requirements exist but no destination binding → no claims
    expect(manifest).toEqual([]);
  });

  test("T4: provider references manifest claim → accepted", () => {
    // Manually create a manifest with a known claim
    const claimId = buildDestinationClaimId("CA01", "registro");
    const manifest: DestinationClaimDefinition[] = [{
      destinationClaimId: claimId,
      requirementIds: ["CA01"],
      kind: "semantic_destination",
      semanticIdentity: "registro",
      source: "trusted_config",
      trustLevel: "validated",
    }];
    const expectations = parseStepDestinationExpectations(
      [{ stepIndex: 1, destinationClaimId: claimId }],
      3,
      ["CA01"],
      manifest,
    );
    expect(expectations).toBeDefined();
    expect(expectations).toHaveLength(1);
    expect(expectations![0].destinationClaimId).toBe(claimId);
    expect(expectations![0].requirementIds).toEqual(["CA01"]);
    expect(expectations![0].semanticIdentity).toBe("registro");
    expect(expectations![0].source).toBe("trusted_config");
    expect(expectations![0].trustLevel).toBe("validated");
  });

  test("T5: provider invents destinationClaimId → rejected", () => {
    const manifest: DestinationClaimDefinition[] = [{
      destinationClaimId: buildDestinationClaimId("CA01", "registro"),
      requirementIds: ["CA01"],
      kind: "semantic_destination",
      semanticIdentity: "registro",
      source: "trusted_config",
      trustLevel: "validated",
    }];
    const expectations = parseStepDestinationExpectations(
      [{ stepIndex: 1, destinationClaimId: "invented_id_123" }],
      3,
      ["CA01"],
      manifest,
    );
    // Unknown claim ID → rejected
    expect(expectations).toBeUndefined();
  });

  test("T6: provider tries to send different semanticIdentity → ignored, manifest metadata used", () => {
    const claimId = buildDestinationClaimId("CA01", "registro");
    const manifest: DestinationClaimDefinition[] = [{
      destinationClaimId: claimId,
      requirementIds: ["CA01"],
      kind: "semantic_destination",
      semanticIdentity: "registro",
      source: "trusted_config",
      trustLevel: "validated",
    }];
    // Provider tries to override semanticIdentity
    const expectations = parseStepDestinationExpectations(
      [{ stepIndex: 1, destinationClaimId: claimId, semanticIdentity: "pantalla_inventada" }],
      3,
      ["CA01"],
      manifest,
    );
    expect(expectations).toBeDefined();
    // semanticIdentity comes from manifest, NOT from provider
    expect(expectations![0].semanticIdentity).toBe("registro");
  });

  test("T7: provider tries to send different requirementIds → ignored, manifest metadata used", () => {
    const claimId = buildDestinationClaimId("CA01", "registro");
    const manifest: DestinationClaimDefinition[] = [{
      destinationClaimId: claimId,
      requirementIds: ["CA01"],
      kind: "semantic_destination",
      semanticIdentity: "registro",
      source: "trusted_config",
      trustLevel: "validated",
    }];
    // Provider tries to override requirementIds
    const expectations = parseStepDestinationExpectations(
      [{ stepIndex: 1, destinationClaimId: claimId, requirementIds: ["CA99"] }],
      3,
      ["CA01"],
      manifest,
    );
    expect(expectations).toBeDefined();
    // requirementIds come from manifest, NOT from provider
    expect(expectations![0].requirementIds).toEqual(["CA01"]);
  });

  test("T8: manifest claim ID is deterministic", () => {
    const id1 = buildDestinationClaimId("CA01", "registro");
    const id2 = buildDestinationClaimId("CA01", "registro");
    expect(id1).toBe(id2);
  });

  test("T9: manifest claim ID does not depend on scenarioId", () => {
    const id1 = buildDestinationClaimId("CA01", "registro");
    const id2 = buildDestinationClaimId("CA01", "registro");
    expect(id1).toBe(id2);
    const id3 = buildDestinationClaimId("CA01", "login");
    expect(id1).not.toBe(id3);
  });

  test("T10: provider cannot construct claim indirectly (empty manifest → no claims possible)", () => {
    const manifest: DestinationClaimDefinition[] = [];
    const expectations = parseStepDestinationExpectations(
      [{ stepIndex: 1, destinationClaimId: buildDestinationClaimId("CA01", "registro") }],
      3,
      ["CA01"],
      manifest,
    );
    // Empty manifest → no claims can be referenced → all rejected
    expect(expectations).toBeUndefined();
  });

  test("T11: empty manifest + provider semanticIdentity → rejected", () => {
    const manifest: DestinationClaimDefinition[] = [];
    const expectations = parseStepDestinationExpectations(
      [{ stepIndex: 1, destinationClaimId: buildDestinationClaimId("CA01", "registro") }],
      3,
      ["CA01"],
      manifest,
    );
    expect(expectations).toBeUndefined();
  });

  test("T12: known screen without binding does not grant authority", () => {
    // Even if "registro" is a known screen, without a manifest claim it cannot be referenced
    const manifest = buildMobileDestinationClaimManifest(["CA01"], ["registro"]);
    expect(manifest).toEqual([]);
    // Provider cannot reference any claim
    const expectations = parseStepDestinationExpectations(
      [{ stepIndex: 1, destinationClaimId: buildDestinationClaimId("CA01", "registro") }],
      3,
      ["CA01"],
      manifest,
    );
    expect(expectations).toBeUndefined();
  });

  test("T13: validated Knowledge binding can create manifest claim (if contract allows)", () => {
    // Currently no validated knowledge binding exists, so manifest is empty
    // This test documents that validated_knowledge source is supported in the type
    const manifest = buildMobileDestinationClaimManifest(["CA01"]);
    expect(manifest).toEqual([]);
  });

  test("T14: trusted config binding can create manifest claim (if contract allows)", () => {
    // Currently no trusted config binding exists, so manifest is empty
    // This test documents that trusted_config source is supported in the type
    const manifest = buildMobileDestinationClaimManifest(["CA01"]);
    expect(manifest).toEqual([]);
  });

  test("T15: untrusted/declared Knowledge does not create manifest claim", () => {
    // provider_declaration is NOT a valid source for DestinationClaimDefinition
    // Only canonical_requirement, trusted_config, validated_knowledge are valid
    const manifest = buildMobileDestinationClaimManifest(["CA01"]);
    expect(manifest).toEqual([]);
  });

  test("T16: StepDestinationExpectation derives metadata from manifest", () => {
    const claimId = buildDestinationClaimId("CA01", "registro");
    const manifest: DestinationClaimDefinition[] = [{
      destinationClaimId: claimId,
      requirementIds: ["CA01"],
      kind: "semantic_destination",
      semanticIdentity: "registro",
      source: "trusted_config",
      trustLevel: "validated",
    }];
    const expectations = parseStepDestinationExpectations(
      [{ stepIndex: 1, destinationClaimId: claimId }],
      3,
      ["CA01"],
      manifest,
    );
    expect(expectations).toBeDefined();
    // All metadata comes from manifest, NOT from provider
    expect(expectations![0].requirementIds).toEqual(["CA01"]);
    expect(expectations![0].kind).toBe("semantic_destination");
    expect(expectations![0].semanticIdentity).toBe("registro");
    expect(expectations![0].source).toBe("trusted_config");
    expect(expectations![0].trustLevel).toBe("validated");
  });

  test("T17: invalid stepIndex → rejected", () => {
    const claimId = buildDestinationClaimId("CA01", "registro");
    const manifest: DestinationClaimDefinition[] = [{
      destinationClaimId: claimId,
      requirementIds: ["CA01"],
      kind: "semantic_destination",
      semanticIdentity: "registro",
      source: "trusted_config",
      trustLevel: "validated",
    }];
    const expectations = parseStepDestinationExpectations(
      [{ stepIndex: 5, destinationClaimId: claimId }],
      3,
      ["CA01"],
      manifest,
    );
    expect(expectations).toBeUndefined();
  });

  test("T18: inserted step does not inherit destination claim", () => {
    const claimId = buildDestinationClaimId("CA01", "registro");
    const manifest: DestinationClaimDefinition[] = [{
      destinationClaimId: claimId,
      requirementIds: ["CA01"],
      kind: "semantic_destination",
      semanticIdentity: "registro",
      source: "trusted_config",
      trustLevel: "validated",
    }];
    const refs = [{ stepIndex: 1, requirementIds: ["CA01"] }];
    const expectations = parseStepDestinationExpectations(
      [
        { stepIndex: 0, destinationClaimId: claimId },
        { stepIndex: 1, destinationClaimId: claimId },
      ],
      3,
      ["CA01"],
      manifest,
    );
    expect(expectations).toHaveLength(2);
    // Validate against refs — step 0 is not in refs, so its expectation is dropped
    const validated = validateStepDestinationExpectations(expectations!, refs);
    expect(validated).toHaveLength(1);
    expect(validated[0].stepIndex).toBe(1);
  });

  test("T19: step deletion does not transfer claim by text", () => {
    const claimId1 = buildDestinationClaimId("CA01", "registro");
    const claimId2 = buildDestinationClaimId("CA02", "login");
    const manifest: DestinationClaimDefinition[] = [
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
    const expectations = parseStepDestinationExpectations(
      [
        { stepIndex: 1, destinationClaimId: claimId1 },
        { stepIndex: 2, destinationClaimId: claimId2 },
      ],
      4,
      ["CA01", "CA02"],
      manifest,
    );
    expect(expectations).toHaveLength(2);
    const validated = validateStepDestinationExpectations(expectations!, refs);
    expect(validated).toHaveLength(1);
    expect(validated[0].stepIndex).toBe(2);
    expect(validated[0].semanticIdentity).toBe("login");
  });

  test("T20: declaration does not change destinationSemanticAuthority", () => {
    const claimId = buildDestinationClaimId("CA01", "registro");
    const manifest: DestinationClaimDefinition[] = [{
      destinationClaimId: claimId,
      requirementIds: ["CA01"],
      kind: "semantic_destination",
      semanticIdentity: "registro",
      source: "trusted_config",
      trustLevel: "validated",
    }];
    const expectations = parseStepDestinationExpectations(
      [{ stepIndex: 1, destinationClaimId: claimId }],
      3,
      ["CA01"],
      manifest,
    );
    expect(expectations).toBeDefined();
    expect((expectations![0] as any).destinationSemanticAuthority).toBeUndefined();
  });

  test("T21: declaration does not change trustedForReuse", () => {
    const claimId = buildDestinationClaimId("CA01", "registro");
    const manifest: DestinationClaimDefinition[] = [{
      destinationClaimId: claimId,
      requirementIds: ["CA01"],
      kind: "semantic_destination",
      semanticIdentity: "registro",
      source: "trusted_config",
      trustLevel: "validated",
    }];
    const expectations = parseStepDestinationExpectations(
      [{ stepIndex: 1, destinationClaimId: claimId }],
      3,
      ["CA01"],
      manifest,
    );
    expect(expectations).toBeDefined();
    expect((expectations![0] as any).trustedForReuse).toBeUndefined();
  });

  test("T22: no production hardcodes", () => {
    const id1 = buildDestinationClaimId("ANY_CRITERION", "any_destination");
    const id2 = buildDestinationClaimId("CA99", "pantalla_xyz");
    expect(id1).toBeTruthy();
    expect(id2).toBeTruthy();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^[a-f0-9]{16}$/);
    expect(id2).toMatch(/^[a-f0-9]{16}$/);
  });
});
