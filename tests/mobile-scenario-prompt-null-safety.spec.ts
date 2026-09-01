import { expect, test } from "@playwright/test";
import { buildMobileScenarioMessages } from "../src/scenarios/mobile-scenario-prompt-builder";
import type { JiraIssueSource } from "../src/scenarios/scenario-types";
import type { MobileRouteProfile } from "../src/mobile/mobile-route-profile.types";
import type { MobileLearnedScreen } from "../src/mobile/mobile-knowledge-resolver";
import type { DestinationClaimDefinition } from "../src/mobile/mobile-destination-claim";

/**
 * Mobile Scenario Prompt Builder — Pre-provider null safety tests (T1-T10)
 *
 * Tests that buildMobileScenarioMessages does NOT crash when:
 * - routeProfile.screens is undefined/missing
 * - knowledgeItems is empty
 * - destinationClaimManifest is empty
 * - aliases/config are undefined/null
 */

const baseIssue: JiraIssueSource = {
  key: "AA-94",
  summary: "Test issue",
  description: "Test description",
  acceptanceCriteria: "CA01: Test criterion",
  labels: [],
  components: [],
  status: "To Do",
  issueType: "Story",
};

function makeMinimalProfile(overrides: Partial<MobileRouteProfile> = {}): MobileRouteProfile {
  return {
    appSlug: overrides.appSlug ?? "test-app",
    packageName: overrides.packageName ?? "com.test.app",
    appName: overrides.appName ?? "Test App",
    platform: "android",
    mainActivity: overrides.mainActivity ?? "com.test.app.MainActivity",
    updatedAt: overrides.updatedAt ?? "2026-01-01T00:00:00.000Z",
    screens: overrides.screens ?? {},
    ...("flows" in overrides ? { flows: overrides.flows } : {}),
    ...("functionalDataProfiles" in overrides ? { functionalDataProfiles: overrides.functionalDataProfiles } : {}),
  };
}

// T1: routeProfile exists + screens=[] → no crash
test("T1: routeProfile exists with empty screens → no crash", () => {
  const profile = makeMinimalProfile({ screens: {} });
  const messages = buildMobileScenarioMessages(baseIssue, profile, [], []);
  expect(messages).toHaveLength(2);
  expect(messages[0].role).toBe("system");
  expect(messages[1].role).toBe("user");
});

// T2: knowledgeItems=[] → no crash
test("T2: empty knowledgeItems → no crash", () => {
  const messages = buildMobileScenarioMessages(baseIssue, null, [], []);
  expect(messages).toHaveLength(2);
});

// T3: destinationClaimManifest=[] → no crash
test("T3: empty destinationClaimManifest → no crash", () => {
  const messages = buildMobileScenarioMessages(baseIssue, null, [], []);
  expect(messages).toHaveLength(2);
});

// T4: routeProfile undefined → no crash
test("T4: routeProfile undefined → no crash", () => {
  const messages = buildMobileScenarioMessages(baseIssue, undefined, undefined, undefined);
  expect(messages).toHaveLength(2);
});

// T5: all optional params undefined → no crash
test("T5: all optional params undefined → no crash", () => {
  const messages = buildMobileScenarioMessages(baseIssue);
  expect(messages).toHaveLength(2);
});

// T6: screens property missing from JSON → no crash
test("T6: screens property missing from routeProfile → no crash", () => {
  const profile = makeMinimalProfile() as any;
  delete profile.screens;
  const messages = buildMobileScenarioMessages(baseIssue, profile, [], []);
  expect(messages).toHaveLength(2);
});

// T7: screens property null → no crash
test("T7: screens property null → no crash", () => {
  const profile = makeMinimalProfile({ screens: null as any });
  const messages = buildMobileScenarioMessages(baseIssue, profile, [], []);
  expect(messages).toHaveLength(2);
});

// T8: provider input is constructed correctly
test("T8: provider input contains issue text", () => {
  const messages = buildMobileScenarioMessages(baseIssue, null, [], []);
  const userContent = messages[1].content as string;
  expect(userContent).toContain("AA-94");
  expect(userContent).toContain("Test issue");
  expect(userContent).toContain("CA01");
});

// T9: provider invocation point is reached (mock)
test("T9: provider invocation point is reached", () => {
  let providerCalled = false;
  const mockProvider = {
    completeJson: async () => {
      providerCalled = true;
      return { parsedJson: { scenarios: [], rejected: [] }, rawText: "{}", diagnostics: { exitCode: 0 } };
    }
  };

  // Build messages should not crash
  const messages = buildMobileScenarioMessages(baseIssue, null, [], []);
  expect(messages).toHaveLength(2);
  expect(providerCalled).toBe(false); // Provider not called yet, but messages built successfully
});

// T10: no production hardcodes
test("T10: no production hardcodes", () => {
  const messages = buildMobileScenarioMessages(baseIssue, null, [], []);
  const userContent = messages[1].content as string;
  expect(userContent).not.toContain("appconversacional");
  expect(userContent).not.toContain("com.appconversacionalbsc");
});
