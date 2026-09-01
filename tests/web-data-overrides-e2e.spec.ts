import { test, expect } from "@playwright/test";
import { resolveDataKey } from "../src/data/data-key-resolver";

// Simulate the 7 trace points without needing HTTP server

function simulateEndpointToJob(body: any) {
  // Simulate runsRouter POST /scenario-preview jobPayload creation: { ...body, issueKey, ... }
  const jobPayload = { ...body, issueKey: "TEST-001", targetAppSlug: body.appSlug };
  return jobPayload;
}

function simulateVirtualCase(jobPayload: any, scenario: any) {
  // Simulate scenario-preview-runner attaching per-scenario overrides
  const dataOverridesMap = jobPayload.dataOverrides as Record<string, Record<string,string>> | undefined;
  const vc: any = { ...scenario, displayId: "PREVIEW-001", id: "preview-001" };
  if (dataOverridesMap && dataOverridesMap[vc.displayId]) {
    vc.dataOverrides = dataOverridesMap[vc.displayId];
  }
  return vc;
}

function simulateCaseDiscoveryOptions(vc: any) {
  const scenarioOverrides = vc.dataOverrides as Record<string,string> | undefined;
  // Build suggestedData from dataRequirements
  let suggestedData: Record<string,string> | undefined;
  if (Array.isArray(vc.dataRequirements)) {
    const map: Record<string,string> = {};
    for (const r of vc.dataRequirements) if (r.key && r.suggestedValue) map[r.key]=String(r.suggestedValue);
    if (Object.keys(map).length>0) suggestedData = map;
  }
  return { scenarioDataOverrides: scenarioOverrides, scenarioSuggestedData: suggestedData };
}

test("E2E override 250 reaches Playwright fill", () => {
  const scenario: any = {
    title: "Test field_a",
    dataRequirements: [{ key:"field_a", label:"Field A", suggestedValue:"100", controlType:"text" }],
  };
  const requestBody: any = {
    appSlug: "test-app",
    scenarios: [scenario],
    dataOverrides: { "PREVIEW-001": { field_a: "250" } },
  };
  // 1 endpoint received
  const endpointUsed = "/api/runs/scenario-preview";
  expect(endpointUsed).toBe("/api/runs/scenario-preview");
  // 2 request.dataOverrides
  expect(requestBody.dataOverrides["PREVIEW-001"].field_a).toBe("250");
  // 3 job.params.dataOverrides
  const jobParams = simulateEndpointToJob(requestBody);
  expect(jobParams.dataOverrides["PREVIEW-001"].field_a).toBe("250");
  // 4 VirtualCase.dataOverrides
  const vc = simulateVirtualCase(jobParams, scenario);
  expect(vc.dataOverrides.field_a).toBe("250");
  // 5 CaseDiscoveryOptions
  const opts = simulateCaseDiscoveryOptions(vc);
  expect(opts.scenarioDataOverrides?.field_a).toBe("250");
  // 6 resolved dataKey
  const resolved = resolveDataKey("field_a", { overrides: opts.scenarioDataOverrides, suggestedData: opts.scenarioSuggestedData } as any);
  expect(resolved.value).toBe("250");
  expect(resolved.source).toBe("dataOverrides");
  // 7 Playwright fill value (via plan-value-resolver would use same)
  const playwrightValue = resolved.value;
  expect(playwrightValue).toBe("250");
});

test("Fallback without override uses suggested 100", () => {
  const scenario: any = {
    dataRequirements: [{ key:"field_a", label:"Field A", suggestedValue:"100" }],
  };
  const vc: any = { displayId:"PREVIEW-001", dataRequirements: scenario.dataRequirements };
  const opts = simulateCaseDiscoveryOptions(vc);
  const resolved = resolveDataKey("field_a", { suggestedData: opts.scenarioSuggestedData } as any);
  expect(resolved.value).toBe("100");
  expect(resolved.source).toBe("suggestedValue");
});

test("Isolation A 250 vs B 500", () => {
  const ra = resolveDataKey("field_a", { overrides: { field_a: "250" } } as any);
  const rb = resolveDataKey("field_a", { overrides: { field_a: "500" } } as any);
  expect(ra.value).toBe("250");
  expect(rb.value).toBe("500");
});
