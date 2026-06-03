"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const repair_context_pack_1 = require("../src/ai/repair/repair-context-pack");
(0, test_1.test)("excluye secretos", () => {
    const pack = (0, repair_context_pack_1.buildRepairContextPack)({
        appSlug: "app",
        failure: "target_not_found password token",
        currentStep: "step",
        currentUrl: "https://x",
        candidates: [{ candidateId: "c1", visible: true, text: "api-key here" }],
        maxChars: 5000
    });
    (0, test_1.expect)(JSON.stringify(pack)).not.toContain("password");
    (0, test_1.expect)(JSON.stringify(pack)).not.toContain("token");
});
(0, test_1.test)("respeta max chars", () => {
    const pack = (0, repair_context_pack_1.buildRepairContextPack)({
        appSlug: "app",
        failure: "target_not_found",
        currentStep: "step",
        currentUrl: "https://x",
        candidates: Array.from({ length: 200 }, (_, i) => ({ candidateId: `c${i}`, visible: true, text: "x".repeat(200) })),
        runtimeEvidenceTrace: { huge: "y".repeat(10000) },
        maxChars: 1000
    });
    (0, test_1.expect)(JSON.stringify(pack).length).toBeLessThanOrEqual(5000);
});
(0, test_1.test)("incluye failure/currentStep/candidates/constraints", () => {
    const pack = (0, repair_context_pack_1.buildRepairContextPack)({
        appSlug: "app",
        failure: "target_not_found",
        currentStep: "click x",
        currentUrl: "https://x",
        candidates: [{ candidateId: "c1", visible: true }],
        constraints: ["must_return_existing_candidate_id"],
        maxChars: 5000
    });
    (0, test_1.expect)(pack.failure).toContain("target_not_found");
    (0, test_1.expect)(pack.currentStep).toContain("click x");
    (0, test_1.expect)(pack.candidates[0].candidateId).toBe("c1");
    (0, test_1.expect)(pack.constraints?.[0]).toContain("must_return_existing_candidate_id");
});
(0, test_1.test)("no incluye repo/logs grandes", () => {
    const pack = (0, repair_context_pack_1.buildRepairContextPack)({
        appSlug: "app",
        failure: "x",
        currentStep: "y",
        currentUrl: "https://x",
        candidates: [{ candidateId: "c1", visible: true }],
        runtimeEvidenceTrace: { logs: "z".repeat(100000) },
        maxChars: 800
    });
    (0, test_1.expect)(JSON.stringify(pack).length).toBeLessThan(10000);
});
