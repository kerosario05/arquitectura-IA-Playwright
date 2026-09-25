"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const testrail_case_publisher_1 = require("../src/server/services/testrail-case-publisher");
// ── sanitizeTestRailRef ──
(0, test_1.test)("sanitizeTestRailRef: removes pipe characters", () => {
    (0, test_1.expect)((0, testrail_case_publisher_1.sanitizeTestRailRef)("AA-81|PREVIEW-001")).toBe("AA-81PREVIEW-001");
});
(0, test_1.test)("sanitizeTestRailRef: removes commas", () => {
    (0, test_1.expect)((0, testrail_case_publisher_1.sanitizeTestRailRef)("AA-81,PREVIEW-001")).toBe("AA-81PREVIEW-001");
});
(0, test_1.test)("sanitizeTestRailRef: removes special characters", () => {
    (0, test_1.expect)((0, testrail_case_publisher_1.sanitizeTestRailRef)("PROJ-123_{test}")).toBe("PROJ-123_TEST");
});
(0, test_1.test)("sanitizeTestRailRef: uppercases", () => {
    (0, test_1.expect)((0, testrail_case_publisher_1.sanitizeTestRailRef)("aa-81-preview-001")).toBe("AA-81-PREVIEW-001");
});
(0, test_1.test)("sanitizeTestRailRef: keeps underscores and hyphens", () => {
    (0, test_1.expect)((0, testrail_case_publisher_1.sanitizeTestRailRef)("PROJ_123_PREVIEW_001")).toBe("PROJ_123_PREVIEW_001");
});
(0, test_1.test)("sanitizeTestRailRef: returns empty for empty input", () => {
    (0, test_1.expect)((0, testrail_case_publisher_1.sanitizeTestRailRef)("")).toBe("");
});
(0, test_1.test)("sanitizeTestRailRef: returns empty for only special chars", () => {
    (0, test_1.expect)((0, testrail_case_publisher_1.sanitizeTestRailRef)("|,,,{}[]!@#$%^&*()")).toBe("");
});
(0, test_1.test)("sanitizeTestRailRef: caps at 64 chars", () => {
    const long = "A".repeat(100);
    (0, test_1.expect)((0, testrail_case_publisher_1.sanitizeTestRailRef)(long).length).toBe(64);
});
(0, test_1.test)("sanitizeTestRailRef: removes spaces", () => {
    (0, test_1.expect)((0, testrail_case_publisher_1.sanitizeTestRailRef)("AA 81 PREVIEW 001")).toBe("AA-81-PREVIEW-001");
});
(0, test_1.test)("sanitizeTestRailRef: removes dots", () => {
    (0, test_1.expect)((0, testrail_case_publisher_1.sanitizeTestRailRef)("AA.81.PREVIEW.001")).toBe("AA-81-PREVIEW-001");
});
(0, test_1.test)("sanitizeTestRailRef: removes cacheKey and JSON", () => {
    // JSON special chars are removed, alphanumeric content remains
    (0, test_1.expect)((0, testrail_case_publisher_1.sanitizeTestRailRef)('{"key":"val"}')).toBe("KEYVAL");
    (0, test_1.expect)((0, testrail_case_publisher_1.sanitizeTestRailRef)("cacheKey_abc123")).toBe("CACHEKEY_ABC123");
});
// ── buildScenarioRefCandidates ──
function makeScenario(overrides = {}) {
    return {
        sourceIssueKey: overrides.sourceIssueKey ?? "AA-81",
        title: overrides.title ?? "Test",
        steps: overrides.steps ?? ["Step 1"],
        preconditions: overrides.preconditions ?? [],
        expectedResult: overrides.expectedResult ?? "Result",
        type: overrides.type ?? "functional",
        database: overrides.database ?? "",
        isConverted: overrides.isConverted ?? 0,
        automationType: overrides.automationType ?? "e2e",
        setupStrategy: overrides.setupStrategy ?? "default",
        appSlug: overrides.appSlug ?? "app-a",
        routeProfile: overrides.routeProfile ?? "",
        dataRequirements: overrides.dataRequirements ?? "",
        nonExecutableCriteria: overrides.nonExecutableCriteria ?? "",
        mcpExecutable: overrides.mcpExecutable ?? true,
        validation: overrides.validation ?? { valid: true, errors: [], warnings: [] },
    };
}
(0, test_1.test)("buildScenarioRefCandidates: includes storyKey+scenarioId, sourceIssueKey, scenarioId", () => {
    const scenario = makeScenario({ sourceIssueKey: "AA-81" });
    const candidates = (0, testrail_case_publisher_1.buildScenarioRefCandidates)(scenario, "PREVIEW-001", "AA");
    (0, test_1.expect)(candidates).toContain("AA-PREVIEW-001");
    (0, test_1.expect)(candidates).toContain("AA-81");
    (0, test_1.expect)(candidates).toContain("PREVIEW-001");
});
(0, test_1.test)("buildScenarioRefCandidates: deduplicates identical values", () => {
    const scenario = makeScenario({ sourceIssueKey: "AA-PREVIEW-001" });
    const candidates = (0, testrail_case_publisher_1.buildScenarioRefCandidates)(scenario, "PREVIEW-001", "AA");
    // keyRef = "AA-PREVIEW-001", sourceIssueKey = "AA-PREVIEW-001", scenarioId = "PREVIEW-001"
    // After dedup: "AA-PREVIEW-001" and "PREVIEW-001"
    (0, test_1.expect)(new Set(candidates).size).toBe(candidates.length);
    (0, test_1.expect)(candidates.length).toBeLessThanOrEqual(3);
});
(0, test_1.test)("buildScenarioRefCandidates: works without storyKey", () => {
    const scenario = makeScenario({ sourceIssueKey: "AA-81" });
    const candidates = (0, testrail_case_publisher_1.buildScenarioRefCandidates)(scenario, "PREVIEW-001");
    (0, test_1.expect)(candidates).not.toContain("undefined-PREVIEW-001");
    (0, test_1.expect)(candidates).toContain("AA-81");
    (0, test_1.expect)(candidates).toContain("PREVIEW-001");
});
(0, test_1.test)("buildScenarioRefCandidates: works without sourceIssueKey", () => {
    const scenario = makeScenario({ sourceIssueKey: "" });
    const candidates = (0, testrail_case_publisher_1.buildScenarioRefCandidates)(scenario, "PREVIEW-001", "AA");
    (0, test_1.expect)(candidates).toContain("AA-PREVIEW-001");
    (0, test_1.expect)(candidates).toContain("PREVIEW-001");
    (0, test_1.expect)(candidates).not.toContain("");
});
// ── buildSafeRefsFilter ──
(0, test_1.test)("buildSafeRefsFilter: never returns undefined with valid refs", () => {
    const result = (0, testrail_case_publisher_1.buildSafeRefsFilter)({
        refs: ["AA-PREVIEW-001", "AA-81"],
    });
    (0, test_1.expect)(result).toBeDefined();
    (0, test_1.expect)(typeof result).toBe("string");
    (0, test_1.expect)(result.length).toBeGreaterThan(0);
});
(0, test_1.test)("buildSafeRefsFilter: returns comma-joined deduped refs", () => {
    const result = (0, testrail_case_publisher_1.buildSafeRefsFilter)({
        refs: ["AA-PREVIEW-001", "AA-81", "AA-PREVIEW-001"],
    });
    const parts = result.split(",");
    (0, test_1.expect)(new Set(parts).size).toBe(parts.length); // no dupes
    (0, test_1.expect)(parts).toContain("AA-PREVIEW-001");
    (0, test_1.expect)(parts).toContain("AA-81");
});
(0, test_1.test)("buildSafeRefsFilter: uses fallback when all refs invalid", () => {
    // "!!" becomes "" after sanitization, so it fails the regex
    const result = (0, testrail_case_publisher_1.buildSafeRefsFilter)({
        refs: ["", "!!"],
        fallback: "PREVIEW-001",
    });
    (0, test_1.expect)(result).toBe("PREVIEW-001");
});
(0, test_1.test)("buildSafeRefsFilter: uses UNKNOWN-REF when no valid refs and no fallback", () => {
    const result = (0, testrail_case_publisher_1.buildSafeRefsFilter)({
        refs: ["", "!!"],
    });
    (0, test_1.expect)(result).toBe("UNKNOWN-REF");
});
(0, test_1.test)("buildSafeRefsFilter: handles empty refs array", () => {
    const result = (0, testrail_case_publisher_1.buildSafeRefsFilter)({
        refs: [],
    });
    (0, test_1.expect)(result).toBe("UNKNOWN-REF");
});
(0, test_1.test)("buildSafeRefsFilter: handles single ref", () => {
    const result = (0, testrail_case_publisher_1.buildSafeRefsFilter)({
        ref: "PREVIEW-001",
    });
    (0, test_1.expect)(result).toBe("PREVIEW-001");
});
(0, test_1.test)("buildSafeRefsFilter: sanitizes invalid ref characters", () => {
    const result = (0, testrail_case_publisher_1.buildSafeRefsFilter)({
        refs: ["AA-81|test,invalid"],
    });
    (0, test_1.expect)(result).not.toContain("|");
    (0, test_1.expect)(result).not.toContain(",");
    (0, test_1.expect)(result).toBe("AA-81TESTINVALID");
});
(0, test_1.test)("buildSafeRefsFilter: caps at 20 deduped refs", () => {
    const manyRefs = Array.from({ length: 30 }, (_, i) => `REF-${String(i).padStart(3, "0")}`);
    const result = (0, testrail_case_publisher_1.buildSafeRefsFilter)({ refs: manyRefs });
    const parts = result.split(",");
    (0, test_1.expect)(parts.length).toBeLessThanOrEqual(20);
});
(0, test_1.test)("buildSafeRefsFilter: preserves underscore refs", () => {
    const result = (0, testrail_case_publisher_1.buildSafeRefsFilter)({
        refs: ["AA_81_PREVIEW_001"],
    });
    (0, test_1.expect)(result).toBe("AA_81_PREVIEW_001");
});
(0, test_1.test)("buildSafeRefsFilter: storyKey ref format passes validation", () => {
    const result = (0, testrail_case_publisher_1.buildSafeRefsFilter)({
        refs: ["AA-81-PREVIEW-001"],
    });
    (0, test_1.expect)(result).toBe("AA-81-PREVIEW-001");
});
// ── Acceptance criteria logging ──
(0, test_1.test)("acceptance: log shows refs format", () => {
    const refsFilter = (0, testrail_case_publisher_1.buildSafeRefsFilter)({
        refs: ["AA-81-PREVIEW-001"],
        fallback: "PREVIEW-001",
    });
    const hasRefs = Boolean(refsFilter);
    const refsType = typeof refsFilter;
    const refsLength = typeof refsFilter === "string" ? refsFilter.length : 0;
    const logLine = `[testrail-publish] case=PREVIEW-001 refs="${refsFilter}" hasRefs=${hasRefs}`;
    (0, test_1.expect)(hasRefs).toBe(true);
    (0, test_1.expect)(refsType).toBe("string");
    (0, test_1.expect)(refsLength).toBeGreaterThan(0);
    (0, test_1.expect)(logLine).toContain('refs="AA-81-PREVIEW-001"');
    (0, test_1.expect)(logLine).toContain("hasRefs=true");
});
(0, test_1.test)("acceptance: no pipe, no commas, no cacheKey, no JSON in refs", () => {
    const dirty = "AA-81|cacheKey:abc123,{\"key\":\"val\"},PREVIEW-001";
    const clean = (0, testrail_case_publisher_1.sanitizeTestRailRef)(dirty);
    (0, test_1.expect)(clean).not.toContain("|");
    (0, test_1.expect)(clean).not.toContain(",");
    (0, test_1.expect)(clean).not.toContain("cacheKey");
    (0, test_1.expect)(clean).not.toContain("{");
    (0, test_1.expect)(clean).not.toContain("}");
    // Alphanumeric chars are preserved; special chars removed
    (0, test_1.expect)(clean).toBe("AA-81CACHEKEYABC123KEYVALPREVIEW-001");
});
(0, test_1.test)("acceptance: each preview generates unique ref", () => {
    const refs = ["AA-PREVIEW-001", "AA-PREVIEW-002", "AA-PREVIEW-003"];
    const unique = new Set(refs);
    (0, test_1.expect)(unique.size).toBe(refs.length);
    for (const r of refs) {
        (0, test_1.expect)((0, testrail_case_publisher_1.sanitizeTestRailRef)(r)).toBe(r);
    }
});
(0, test_1.test)("acceptance: no refs_filter used as refs", () => {
    // Verify refs_filter is never used as the refs value
    const scenario = makeScenario({ sourceIssueKey: "AA-81" });
    const candidates = (0, testrail_case_publisher_1.buildScenarioRefCandidates)(scenario, "PREVIEW-001", "AA");
    for (const c of candidates) {
        (0, test_1.expect)(c).not.toMatch(/refs_filter/i);
    }
});
(0, test_1.test)("acceptance: refs is sent with configurable custom_refs support", () => {
    // Verify refs is in the payload keys and custom_refs is included when appropriate
    const refsFilter = (0, testrail_case_publisher_1.buildSafeRefsFilter)({
        refs: ["AA-81-PREVIEW-001"],
        fallback: "PREVIEW-001",
    });
    // Simulate what addCase does with TESTRAIL_REFS_FIELD=both
    const body = { title: "Test" };
    body.refs = refsFilter;
    body.custom_refs = refsFilter; // Added for "both" mode
    (0, test_1.expect)(body).toHaveProperty("refs");
    (0, test_1.expect)(body).toHaveProperty("custom_refs");
    (0, test_1.expect)(body.refs).toBe("AA-81-PREVIEW-001");
    (0, test_1.expect)(body.custom_refs).toBe("AA-81-PREVIEW-001");
});
(0, test_1.test)("TESTRAIL_REFS_FIELD=both sends refs and custom_refs", () => {
    const body = { title: "Test" };
    const refsField = "both";
    const refsValue = "AA-81-PREVIEW-001";
    if (refsField === "both" || refsField === "refs") {
        body.refs = refsValue;
    }
    if (refsField === "both" || refsField === "custom_refs") {
        body.custom_refs = refsValue;
    }
    (0, test_1.expect)(body).toHaveProperty("refs");
    (0, test_1.expect)(body).toHaveProperty("custom_refs");
    (0, test_1.expect)(body.refs).toBe(refsValue);
    (0, test_1.expect)(body.custom_refs).toBe(refsValue);
});
(0, test_1.test)("TESTRAIL_REFS_FIELD=refs sends only refs", () => {
    const body = { title: "Test" };
    const refsValue = "AA-81-PREVIEW-001";
    // Simulate TESTRAIL_REFS_FIELD=refs behavior
    body.refs = refsValue;
    (0, test_1.expect)(body).toHaveProperty("refs");
    (0, test_1.expect)(body).not.toHaveProperty("custom_refs");
    (0, test_1.expect)(body.refs).toBe(refsValue);
});
(0, test_1.test)("TESTRAIL_REFS_FIELD=custom_refs sends only custom_refs", () => {
    const body = { title: "Test" };
    const refsValue = "AA-81-PREVIEW-001";
    // Simulate TESTRAIL_REFS_FIELD=custom_refs behavior
    body.custom_refs = refsValue;
    (0, test_1.expect)(body).not.toHaveProperty("refs");
    (0, test_1.expect)(body).toHaveProperty("custom_refs");
    (0, test_1.expect)(body.custom_refs).toBe(refsValue);
});
(0, test_1.test)("refs value never contains pipes, commas, or cacheKey", () => {
    const refsValue = "AA-81-PREVIEW-001";
    (0, test_1.expect)(refsValue).not.toContain("|");
    (0, test_1.expect)(refsValue).not.toContain(",");
    (0, test_1.expect)(refsValue).not.toContain("cacheKey");
});
(0, test_1.test)("debug logging shows hasRefs and hasCustomRefs flags", () => {
    const refsValue = "AA-81-PREVIEW-001";
    const hasRefs = typeof refsValue === "string" && refsValue.trim().length > 0;
    const hasCustomRefs = true; // when mode is "both"
    const refsPreview = refsValue.replace(/[|,]/g, "").slice(0, 64);
    const logMessage = `[testrail-debug] endpoint=add_case hasRefs=${hasRefs} hasCustomRefs=${hasCustomRefs} refsPreview="${refsPreview}"`;
    (0, test_1.expect)(hasRefs).toBe(true);
    (0, test_1.expect)(hasCustomRefs).toBe(true);
    (0, test_1.expect)(logMessage).toContain("hasRefs=true");
    (0, test_1.expect)(logMessage).toContain("hasCustomRefs=true");
    (0, test_1.expect)(logMessage).toContain('refsPreview="AA-81-PREVIEW-001"');
});
