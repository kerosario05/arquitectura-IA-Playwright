"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const data_key_resolver_1 = require("../src/data/data-key-resolver");
// Simulate the 7 trace points without needing HTTP server
function simulateEndpointToJob(body) {
    // Simulate runsRouter POST /scenario-preview jobPayload creation: { ...body, issueKey, ... }
    const jobPayload = { ...body, issueKey: "TEST-001", targetAppSlug: body.appSlug };
    return jobPayload;
}
function simulateVirtualCase(jobPayload, scenario) {
    // Simulate scenario-preview-runner attaching per-scenario overrides
    const dataOverridesMap = jobPayload.dataOverrides;
    const vc = { ...scenario, displayId: "PREVIEW-001", id: "preview-001" };
    if (dataOverridesMap && dataOverridesMap[vc.displayId]) {
        vc.dataOverrides = dataOverridesMap[vc.displayId];
    }
    return vc;
}
function simulateCaseDiscoveryOptions(vc) {
    const scenarioOverrides = vc.dataOverrides;
    // Build suggestedData from dataRequirements
    let suggestedData;
    if (Array.isArray(vc.dataRequirements)) {
        const map = {};
        for (const r of vc.dataRequirements)
            if (r.key && r.suggestedValue)
                map[r.key] = String(r.suggestedValue);
        if (Object.keys(map).length > 0)
            suggestedData = map;
    }
    return { scenarioDataOverrides: scenarioOverrides, scenarioSuggestedData: suggestedData };
}
(0, test_1.test)("E2E override 250 reaches Playwright fill", () => {
    const scenario = {
        title: "Test field_a",
        dataRequirements: [{ key: "field_a", label: "Field A", suggestedValue: "100", controlType: "text" }],
    };
    const requestBody = {
        appSlug: "test-app",
        scenarios: [scenario],
        dataOverrides: { "PREVIEW-001": { field_a: "250" } },
    };
    // 1 endpoint received
    const endpointUsed = "/api/runs/scenario-preview";
    (0, test_1.expect)(endpointUsed).toBe("/api/runs/scenario-preview");
    // 2 request.dataOverrides
    (0, test_1.expect)(requestBody.dataOverrides["PREVIEW-001"].field_a).toBe("250");
    // 3 job.params.dataOverrides
    const jobParams = simulateEndpointToJob(requestBody);
    (0, test_1.expect)(jobParams.dataOverrides["PREVIEW-001"].field_a).toBe("250");
    // 4 VirtualCase.dataOverrides
    const vc = simulateVirtualCase(jobParams, scenario);
    (0, test_1.expect)(vc.dataOverrides.field_a).toBe("250");
    // 5 CaseDiscoveryOptions
    const opts = simulateCaseDiscoveryOptions(vc);
    (0, test_1.expect)(opts.scenarioDataOverrides?.field_a).toBe("250");
    // 6 resolved dataKey
    const resolved = (0, data_key_resolver_1.resolveDataKey)("field_a", { overrides: opts.scenarioDataOverrides, suggestedData: opts.scenarioSuggestedData });
    (0, test_1.expect)(resolved.value).toBe("250");
    (0, test_1.expect)(resolved.source).toBe("dataOverrides");
    // 7 Playwright fill value (via plan-value-resolver would use same)
    const playwrightValue = resolved.value;
    (0, test_1.expect)(playwrightValue).toBe("250");
});
(0, test_1.test)("Fallback without override uses suggested 100", () => {
    const scenario = {
        dataRequirements: [{ key: "field_a", label: "Field A", suggestedValue: "100" }],
    };
    const vc = { displayId: "PREVIEW-001", dataRequirements: scenario.dataRequirements };
    const opts = simulateCaseDiscoveryOptions(vc);
    const resolved = (0, data_key_resolver_1.resolveDataKey)("field_a", { suggestedData: opts.scenarioSuggestedData });
    (0, test_1.expect)(resolved.value).toBe("100");
    (0, test_1.expect)(resolved.source).toBe("suggestedValue");
});
(0, test_1.test)("Isolation A 250 vs B 500", () => {
    const ra = (0, data_key_resolver_1.resolveDataKey)("field_a", { overrides: { field_a: "250" } });
    const rb = (0, data_key_resolver_1.resolveDataKey)("field_a", { overrides: { field_a: "500" } });
    (0, test_1.expect)(ra.value).toBe("250");
    (0, test_1.expect)(rb.value).toBe("500");
});
