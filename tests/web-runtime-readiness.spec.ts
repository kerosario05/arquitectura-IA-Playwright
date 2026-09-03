import { describe, expect, it } from "vitest";
import { applyWebRuntimeReadiness } from "../src/scenarios/scenario-preview.service";
import { buildCanonicalClaims } from "../src/scenarios/scenario-functional-quality";

describe("web runtime readiness", () => {
  it("routes a valid structured scenario without runtime authority", () => {
    const scenario = applyWebRuntimeReadiness({
      semanticValidity: "valid",
      mcpExecutable: true,
      executionReadiness: "standard",
      launchClassification: "standard",
      functionalBranch: { branchId: "branch-a" },
      stepAuthority: [{ authorityValid: true, sourceType: "canonical_requirement" }],
    });
    expect(scenario).toMatchObject({ mcpExecutable: false, executionReadiness: "requires_route_discovery", launchClassification: "adaptive" });
  });

  it("does not route incomplete or runtime-backed scenarios", () => {
    expect((applyWebRuntimeReadiness({ semanticValidity: "incomplete", functionalBranch: { branchId: "branch-a" } }) as any).executionReadiness).toBeUndefined();
    expect((applyWebRuntimeReadiness({ semanticValidity: "valid", functionalBranch: { branchId: "branch-a" }, stepAuthority: [{ authorityValid: true, sourceType: "trusted_route" }] }) as any).executionReadiness).toBeUndefined();
  });

  it("creates independent visibility and semantic destination claims", () => {
    const claims = buildCanonicalClaims([
      { id: "branch-a", requirementId: "branch-a", category: "branch", sourceText: "a", expectedBehavior: "destination", facets: ["activation", "destination"], status: "covered" } as any,
      { id: "visibility-a", requirementId: "visibility-a", category: "visibility", sourceText: "a", expectedBehavior: "visible", facets: ["visibility"], status: "covered" } as any,
      { id: "visibility-b", requirementId: "visibility-b", category: "visibility", sourceText: "b", expectedBehavior: "visible", facets: ["visibility"], status: "covered" } as any,
    ]);
    expect(claims.map((claim) => claim.claimId)).toEqual(expect.arrayContaining([
      "branch-a::activation", "branch-a::destination", "visibility-a::visibility", "visibility-b::visibility",
    ]));
    expect(claims.find((claim) => claim.claimId === "branch-a::destination")?.targetKind).toBe("semantic_destination");
  });
});
