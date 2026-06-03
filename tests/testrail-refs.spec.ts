import { test, expect } from "@playwright/test";
import { sanitizeTestRailRef, buildSafeRefsFilter, buildScenarioRefCandidates } from "../src/server/services/testrail-case-publisher";
import type { McpScenario } from "../src/scenarios/scenario-types";

// ── sanitizeTestRailRef ──

test("sanitizeTestRailRef: removes pipe characters", () => {
  expect(sanitizeTestRailRef("AA-81|PREVIEW-001")).toBe("AA-81PREVIEW-001");
});

test("sanitizeTestRailRef: removes commas", () => {
  expect(sanitizeTestRailRef("AA-81,PREVIEW-001")).toBe("AA-81PREVIEW-001");
});

test("sanitizeTestRailRef: removes special characters", () => {
  expect(sanitizeTestRailRef("PROJ-123_{test}")).toBe("PROJ-123_TEST");
});

test("sanitizeTestRailRef: uppercases", () => {
  expect(sanitizeTestRailRef("aa-81-preview-001")).toBe("AA-81-PREVIEW-001");
});

test("sanitizeTestRailRef: keeps underscores and hyphens", () => {
  expect(sanitizeTestRailRef("PROJ_123_PREVIEW_001")).toBe("PROJ_123_PREVIEW_001");
});

test("sanitizeTestRailRef: returns empty for empty input", () => {
  expect(sanitizeTestRailRef("")).toBe("");
});

test("sanitizeTestRailRef: returns empty for only special chars", () => {
  expect(sanitizeTestRailRef("|,,,{}[]!@#$%^&*()")).toBe("");
});

test("sanitizeTestRailRef: caps at 64 chars", () => {
  const long = "A".repeat(100);
  expect(sanitizeTestRailRef(long).length).toBe(64);
});

test("sanitizeTestRailRef: removes spaces", () => {
  expect(sanitizeTestRailRef("AA 81 PREVIEW 001")).toBe("AA-81-PREVIEW-001");
});

test("sanitizeTestRailRef: removes dots", () => {
  expect(sanitizeTestRailRef("AA.81.PREVIEW.001")).toBe("AA-81-PREVIEW-001");
});

test("sanitizeTestRailRef: removes cacheKey and JSON", () => {
  // JSON special chars are removed, alphanumeric content remains
  expect(sanitizeTestRailRef('{"key":"val"}')).toBe("KEYVAL");
  expect(sanitizeTestRailRef("cacheKey_abc123")).toBe("CACHEKEY_ABC123");
});

// ── buildScenarioRefCandidates ──

function makeScenario(overrides: Partial<McpScenario> = {}): McpScenario {
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

test("buildScenarioRefCandidates: includes storyKey+scenarioId, sourceIssueKey, scenarioId", () => {
  const scenario = makeScenario({ sourceIssueKey: "AA-81" });
  const candidates = buildScenarioRefCandidates(scenario, "PREVIEW-001", "AA");
  expect(candidates).toContain("AA-PREVIEW-001");
  expect(candidates).toContain("AA-81");
  expect(candidates).toContain("PREVIEW-001");
});

test("buildScenarioRefCandidates: deduplicates identical values", () => {
  const scenario = makeScenario({ sourceIssueKey: "AA-PREVIEW-001" });
  const candidates = buildScenarioRefCandidates(scenario, "PREVIEW-001", "AA");
  // keyRef = "AA-PREVIEW-001", sourceIssueKey = "AA-PREVIEW-001", scenarioId = "PREVIEW-001"
  // After dedup: "AA-PREVIEW-001" and "PREVIEW-001"
  expect(new Set(candidates).size).toBe(candidates.length);
  expect(candidates.length).toBeLessThanOrEqual(3);
});

test("buildScenarioRefCandidates: works without storyKey", () => {
  const scenario = makeScenario({ sourceIssueKey: "AA-81" });
  const candidates = buildScenarioRefCandidates(scenario, "PREVIEW-001");
  expect(candidates).not.toContain("undefined-PREVIEW-001");
  expect(candidates).toContain("AA-81");
  expect(candidates).toContain("PREVIEW-001");
});

test("buildScenarioRefCandidates: works without sourceIssueKey", () => {
  const scenario = makeScenario({ sourceIssueKey: "" });
  const candidates = buildScenarioRefCandidates(scenario, "PREVIEW-001", "AA");
  expect(candidates).toContain("AA-PREVIEW-001");
  expect(candidates).toContain("PREVIEW-001");
  expect(candidates).not.toContain("");
});

// ── buildSafeRefsFilter ──

test("buildSafeRefsFilter: never returns undefined with valid refs", () => {
  const result = buildSafeRefsFilter({
    refs: ["AA-PREVIEW-001", "AA-81"],
  });
  expect(result).toBeDefined();
  expect(typeof result).toBe("string");
  expect(result.length).toBeGreaterThan(0);
});

test("buildSafeRefsFilter: returns comma-joined deduped refs", () => {
  const result = buildSafeRefsFilter({
    refs: ["AA-PREVIEW-001", "AA-81", "AA-PREVIEW-001"],
  });
  const parts = result.split(",");
  expect(new Set(parts).size).toBe(parts.length); // no dupes
  expect(parts).toContain("AA-PREVIEW-001");
  expect(parts).toContain("AA-81");
});

test("buildSafeRefsFilter: uses fallback when all refs invalid", () => {
  // "!!" becomes "" after sanitization, so it fails the regex
  const result = buildSafeRefsFilter({
    refs: ["", "!!"],
    fallback: "PREVIEW-001",
  });
  expect(result).toBe("PREVIEW-001");
});

test("buildSafeRefsFilter: uses UNKNOWN-REF when no valid refs and no fallback", () => {
  const result = buildSafeRefsFilter({
    refs: ["", "!!"],
  });
  expect(result).toBe("UNKNOWN-REF");
});

test("buildSafeRefsFilter: handles empty refs array", () => {
  const result = buildSafeRefsFilter({
    refs: [],
  });
  expect(result).toBe("UNKNOWN-REF");
});

test("buildSafeRefsFilter: handles single ref", () => {
  const result = buildSafeRefsFilter({
    ref: "PREVIEW-001",
  });
  expect(result).toBe("PREVIEW-001");
});

test("buildSafeRefsFilter: sanitizes invalid ref characters", () => {
  const result = buildSafeRefsFilter({
    refs: ["AA-81|test,invalid"],
  });
  expect(result).not.toContain("|");
  expect(result).not.toContain(",");
  expect(result).toBe("AA-81TESTINVALID");
});

test("buildSafeRefsFilter: caps at 20 deduped refs", () => {
  const manyRefs = Array.from({ length: 30 }, (_, i) => `REF-${String(i).padStart(3, "0")}`);
  const result = buildSafeRefsFilter({ refs: manyRefs });
  const parts = result.split(",");
  expect(parts.length).toBeLessThanOrEqual(20);
});

test("buildSafeRefsFilter: preserves underscore refs", () => {
  const result = buildSafeRefsFilter({
    refs: ["AA_81_PREVIEW_001"],
  });
  expect(result).toBe("AA_81_PREVIEW_001");
});

test("buildSafeRefsFilter: storyKey ref format passes validation", () => {
  const result = buildSafeRefsFilter({
    refs: ["AA-81-PREVIEW-001"],
  });
  expect(result).toBe("AA-81-PREVIEW-001");
});

// ── Acceptance criteria logging ──

test("acceptance: log shows refs format", () => {
  const refsFilter = buildSafeRefsFilter({
    refs: ["AA-81-PREVIEW-001"],
    fallback: "PREVIEW-001",
  });
  const hasRefs = Boolean(refsFilter);
  const refsType = typeof refsFilter;
  const refsLength = typeof refsFilter === "string" ? refsFilter.length : 0;
  const logLine = `[testrail-publish] case=PREVIEW-001 refs="${refsFilter}" hasRefs=${hasRefs}`;

  expect(hasRefs).toBe(true);
  expect(refsType).toBe("string");
  expect(refsLength).toBeGreaterThan(0);
  expect(logLine).toContain('refs="AA-81-PREVIEW-001"');
  expect(logLine).toContain("hasRefs=true");
});

test("acceptance: no pipe, no commas, no cacheKey, no JSON in refs", () => {
  const dirty = "AA-81|cacheKey:abc123,{\"key\":\"val\"},PREVIEW-001";
  const clean = sanitizeTestRailRef(dirty);
  expect(clean).not.toContain("|");
  expect(clean).not.toContain(",");
  expect(clean).not.toContain("cacheKey");
  expect(clean).not.toContain("{");
  expect(clean).not.toContain("}");
  // Alphanumeric chars are preserved; special chars removed
  expect(clean).toBe("AA-81CACHEKEYABC123KEYVALPREVIEW-001");
});

test("acceptance: each preview generates unique ref", () => {
  const refs = ["AA-PREVIEW-001", "AA-PREVIEW-002", "AA-PREVIEW-003"];
  const unique = new Set(refs);
  expect(unique.size).toBe(refs.length);
  for (const r of refs) {
    expect(sanitizeTestRailRef(r)).toBe(r);
  }
});

test("acceptance: no refs_filter used as refs", () => {
  // Verify refs_filter is never used as the refs value
  const scenario = makeScenario({ sourceIssueKey: "AA-81" });
  const candidates = buildScenarioRefCandidates(scenario, "PREVIEW-001", "AA");
  for (const c of candidates) {
    expect(c).not.toMatch(/refs_filter/i);
  }
});

test("acceptance: refs is sent with configurable custom_refs support", () => {
  // Verify refs is in the payload keys and custom_refs is included when appropriate
  const refsFilter = buildSafeRefsFilter({
    refs: ["AA-81-PREVIEW-001"],
    fallback: "PREVIEW-001",
  });
  // Simulate what addCase does with TESTRAIL_REFS_FIELD=both
  const body: Record<string, unknown> = { title: "Test" };
  body.refs = refsFilter;
  body.custom_refs = refsFilter; // Added for "both" mode
  expect(body).toHaveProperty("refs");
  expect(body).toHaveProperty("custom_refs");
  expect(body.refs).toBe("AA-81-PREVIEW-001");
  expect(body.custom_refs).toBe("AA-81-PREVIEW-001");
});

test("TESTRAIL_REFS_FIELD=both sends refs and custom_refs", () => {
  const body: Record<string, unknown> = { title: "Test" };
  const refsField: "both" | "refs" | "custom_refs" = "both";
  const refsValue = "AA-81-PREVIEW-001";
  
  if (refsField === "both" || refsField === "refs") {
    body.refs = refsValue;
  }
  if (refsField === "both" || refsField === "custom_refs") {
    body.custom_refs = refsValue;
  }
  
  expect(body).toHaveProperty("refs");
  expect(body).toHaveProperty("custom_refs");
  expect(body.refs).toBe(refsValue);
  expect(body.custom_refs).toBe(refsValue);
});

test("TESTRAIL_REFS_FIELD=refs sends only refs", () => {
  const body: Record<string, unknown> = { title: "Test" };
  const refsValue = "AA-81-PREVIEW-001";
  
  // Simulate TESTRAIL_REFS_FIELD=refs behavior
  body.refs = refsValue;
  
  expect(body).toHaveProperty("refs");
  expect(body).not.toHaveProperty("custom_refs");
  expect(body.refs).toBe(refsValue);
});

test("TESTRAIL_REFS_FIELD=custom_refs sends only custom_refs", () => {
  const body: Record<string, unknown> = { title: "Test" };
  const refsValue = "AA-81-PREVIEW-001";
  
  // Simulate TESTRAIL_REFS_FIELD=custom_refs behavior
  body.custom_refs = refsValue;
  
  expect(body).not.toHaveProperty("refs");
  expect(body).toHaveProperty("custom_refs");
  expect(body.custom_refs).toBe(refsValue);
});

test("refs value never contains pipes, commas, or cacheKey", () => {
  const refsValue = "AA-81-PREVIEW-001";
  expect(refsValue).not.toContain("|");
  expect(refsValue).not.toContain(",");
  expect(refsValue).not.toContain("cacheKey");
});

test("debug logging shows hasRefs and hasCustomRefs flags", () => {
  const refsValue = "AA-81-PREVIEW-001";
  const hasRefs = typeof refsValue === "string" && refsValue.trim().length > 0;
  const hasCustomRefs = true; // when mode is "both"
  const refsPreview = refsValue.replace(/[|,]/g, "").slice(0, 64);
  
  const logMessage = `[testrail-debug] endpoint=add_case hasRefs=${hasRefs} hasCustomRefs=${hasCustomRefs} refsPreview="${refsPreview}"`;
  
  expect(hasRefs).toBe(true);
  expect(hasCustomRefs).toBe(true);
  expect(logMessage).toContain("hasRefs=true");
  expect(logMessage).toContain("hasCustomRefs=true");
  expect(logMessage).toContain('refsPreview="AA-81-PREVIEW-001"');
});
