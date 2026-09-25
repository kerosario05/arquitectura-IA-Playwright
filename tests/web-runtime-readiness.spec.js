"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const scenario_preview_service_1 = require("../src/scenarios/scenario-preview.service");
const scenario_functional_quality_1 = require("../src/scenarios/scenario-functional-quality");
(0, vitest_1.describe)("web runtime readiness", () => {
    (0, vitest_1.it)("routes a valid structured scenario without runtime authority", () => {
        const scenario = (0, scenario_preview_service_1.applyWebRuntimeReadiness)({
            semanticValidity: "valid",
            mcpExecutable: true,
            executionReadiness: "standard",
            launchClassification: "standard",
            functionalBranch: { branchId: "branch-a" },
            stepAuthority: [{ authorityValid: true, sourceType: "canonical_requirement" }],
        });
        (0, vitest_1.expect)(scenario).toMatchObject({ mcpExecutable: false, executionReadiness: "requires_route_discovery", launchClassification: "adaptive" });
    });
    (0, vitest_1.it)("does not route incomplete or runtime-backed scenarios", () => {
        (0, vitest_1.expect)((0, scenario_preview_service_1.applyWebRuntimeReadiness)({ semanticValidity: "incomplete", functionalBranch: { branchId: "branch-a" } }).executionReadiness).toBeUndefined();
        (0, vitest_1.expect)((0, scenario_preview_service_1.applyWebRuntimeReadiness)({ semanticValidity: "valid", functionalBranch: { branchId: "branch-a" }, stepAuthority: [{ authorityValid: true, sourceType: "trusted_route" }] }).executionReadiness).toBeUndefined();
    });
    (0, vitest_1.it)("creates independent visibility and semantic destination claims", () => {
        const claims = (0, scenario_functional_quality_1.buildCanonicalClaims)([
            { id: "branch-a", requirementId: "branch-a", category: "branch", sourceText: "a", expectedBehavior: "destination", facets: ["activation", "destination"], status: "covered" },
            { id: "visibility-a", requirementId: "visibility-a", category: "visibility", sourceText: "a", expectedBehavior: "visible", facets: ["visibility"], status: "covered" },
            { id: "visibility-b", requirementId: "visibility-b", category: "visibility", sourceText: "b", expectedBehavior: "visible", facets: ["visibility"], status: "covered" },
        ]);
        (0, vitest_1.expect)(claims.map((claim) => claim.claimId)).toEqual(vitest_1.expect.arrayContaining([
            "branch-a::activation", "branch-a::destination", "visibility-a::visibility", "visibility-b::visibility",
        ]));
        (0, vitest_1.expect)(claims.find((claim) => claim.claimId === "branch-a::destination")?.targetKind).toBe("semantic_destination");
    });
});
