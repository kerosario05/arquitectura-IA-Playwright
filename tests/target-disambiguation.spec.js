"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const target_resolver_1 = require("../src/discovery/target-resolver");
const base = {
    visible: true,
    enabled: true,
    clickable: true,
    technicalIdentity: "role:button|Guardar",
    surfaceIdentity: "form:employee",
};
test_1.test.describe("structured target disambiguation", () => {
    (0, test_1.test)("rejects same text when candidates belong to different surfaces", () => {
        const result = (0, target_resolver_1.disambiguateStructuredTargetCandidates)([
            { id: "main", ...base, surfaceIdentity: "form:employee" },
            { id: "dialog", ...base, surfaceIdentity: "dialog:confirmation" },
        ], { technicalIdentity: base.technicalIdentity, surfaceIdentity: "form:employee" });
        (0, test_1.expect)(result.status).toBe("resolved");
        (0, test_1.expect)(result.candidate?.id).toBe("main");
    });
    (0, test_1.test)("ignores hidden and disabled candidates", () => {
        const result = (0, target_resolver_1.disambiguateStructuredTargetCandidates)([
            { id: "hidden", ...base, visible: false },
            { id: "disabled", ...base, enabled: false },
            { id: "visible", ...base },
        ], { technicalIdentity: base.technicalIdentity, surfaceIdentity: base.surfaceIdentity });
        (0, test_1.expect)(result.status).toBe("resolved");
        (0, test_1.expect)(result.candidate?.id).toBe("visible");
    });
    (0, test_1.test)("does not choose between equivalent visible candidates", () => {
        const result = (0, target_resolver_1.disambiguateStructuredTargetCandidates)([
            { id: "one", ...base },
            { id: "two", ...base },
        ], { technicalIdentity: base.technicalIdentity, surfaceIdentity: base.surfaceIdentity });
        (0, test_1.expect)(result.status).toBe("ambiguous");
        (0, test_1.expect)(result.candidates.map((candidate) => candidate.id)).toEqual(["one", "two"]);
    });
    (0, test_1.test)("returns not_found when the recorded target is not on the current surface", () => {
        const result = (0, target_resolver_1.disambiguateStructuredTargetCandidates)([
            { id: "other-surface", ...base, surfaceIdentity: "route:other" },
        ], { technicalIdentity: base.technicalIdentity, surfaceIdentity: base.surfaceIdentity });
        (0, test_1.expect)(result.status).toBe("not_found");
    });
    (0, test_1.test)("resolves an exact recorded technical identity after rediscovery", () => {
        const result = (0, target_resolver_1.disambiguateStructuredTargetCandidates)([
            { id: "rediscovered", ...base, technicalIdentity: "role:button|Guardar" },
        ], { technicalIdentity: "role:button|Guardar", surfaceIdentity: "form:employee" });
        (0, test_1.expect)(result.status).toBe("resolved");
        (0, test_1.expect)(result.candidate?.id).toBe("rediscovered");
    });
});
