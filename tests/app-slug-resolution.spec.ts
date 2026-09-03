import { test, expect } from "@playwright/test";
import { resolveAppForPreview } from "../src/automations/app-auto-resolver";

test.describe("App Slug Resolution Priority", () => {

  test("A. requestAppSlug explicit + inferred default fallback → uses requestAppSlug", () => {
    const result = resolveAppForPreview({
      requestAppSlug: "arquitectura-automatizacion",
      targetAppSlug: undefined,
      targetAppName: undefined,
      testrailSectionName: undefined,
      testrailProjectName: undefined,
      jiraProjectKey: undefined,
    });

    expect(result.appSlug).toBe("arquitectura-automatizacion");
    expect(result.source).toBe("request");
    expect(result.confidence).toBe("high");
  });

  test("B. requestTargetAppSlug explicit valid → uses requestTargetAppSlug", () => {
    const result = resolveAppForPreview({
      targetAppSlug: "kiosko",
      targetAppName: "Kiosko App",
      requestAppSlug: "arquitectura-automatizacion",
      testrailSectionName: undefined,
      testrailProjectName: undefined,
      jiraProjectKey: undefined,
    });

    expect(result.appSlug).toBe("kiosko");
    expect(result.appName).toBe("Kiosko App");
    expect(result.source).toBe("explicit");
    expect(result.confidence).toBe("high");
  });

  test("C. requestTargetAppSlug=undefined + requestAppSlug valid → uses requestAppSlug", () => {
    const result = resolveAppForPreview({
      targetAppSlug: undefined,
      targetAppName: undefined,
      requestAppSlug: "arquitectura-automatizacion",
      testrailSectionName: undefined,
      testrailProjectName: undefined,
      jiraProjectKey: undefined,
    });

    expect(result.appSlug).toBe("arquitectura-automatizacion");
    expect(result.source).toBe("request");
    expect(result.confidence).toBe("high");
  });

  test("D. TestRail projectName exists but requestAppSlug also exists → uses requestAppSlug (higher priority)", () => {
    const result = resolveAppForPreview({
      requestAppSlug: "arquitectura-automatizacion",
      targetAppSlug: undefined,
      targetAppName: undefined,
      testrailSectionName: undefined,
      testrailProjectName: "Some TestRail Project",
      jiraProjectKey: undefined,
    });

    expect(result.appSlug).toBe("arquitectura-automatizacion");
    expect(result.source).toBe("request");
    expect(result.confidence).toBe("high");
  });

  test("E. TestRail projectName does not establish app identity", () => {
    const result = resolveAppForPreview({
      requestAppSlug: undefined,
      targetAppSlug: undefined,
      targetAppName: undefined,
      testrailSectionName: undefined,
      testrailProjectName: "app-a - Automation",
      jiraProjectKey: undefined,
    });

    expect(result.appSlug).toBe("");
    expect(result.source).toBe("fallback");
    expect(result.confidence).toBe("low");
  });

  test("F. No explicit app identity → unresolved", () => {
    const result = resolveAppForPreview({
      requestAppSlug: undefined,
      targetAppSlug: undefined,
      targetAppName: undefined,
      testrailSectionName: undefined,
      testrailProjectName: undefined,
      jiraProjectKey: undefined,
    });

    expect(result.appSlug).toBe("");
    expect(result.source).toBe("fallback");
    expect(result.confidence).toBe("low");
  });

  test("Priority order: explicit targetAppSlug > requestAppSlug; metadata is ignored", () => {
    // 1. Explicit targetAppSlug wins over everything
    const withExplicit = resolveAppForPreview({
      targetAppSlug: "explicit-app",
      requestAppSlug: "request-app",
      testrailProjectName: "testrail-project",
      jiraProjectKey: "JIRA",
    });
    expect(withExplicit.appSlug).toBe("explicit-app");
    expect(withExplicit.source).toBe("explicit");

    // 2. RequestAppSlug wins over TestRail and Jira
    const withRequest = resolveAppForPreview({
      targetAppSlug: undefined,
      requestAppSlug: "request-app",
      testrailProjectName: "testrail-project",
      jiraProjectKey: "JIRA",
    });
    expect(withRequest.appSlug).toBe("request-app");
    expect(withRequest.source).toBe("request");

    // 3. TestRail metadata cannot establish app identity
    const withTestrailSection = resolveAppForPreview({
      targetAppSlug: undefined,
      requestAppSlug: undefined,
      testrailSectionName: "app-b - Feature X",
      testrailProjectName: "testrail-project",
      jiraProjectKey: "JIRA",
    });
    expect(withTestrailSection.appSlug).toBe("");
    expect(withTestrailSection.source).toBe("fallback");

    // 4. TestRail project metadata cannot establish app identity
    const withTestrailProject = resolveAppForPreview({
      targetAppSlug: undefined,
      requestAppSlug: undefined,
      testrailSectionName: undefined,
      testrailProjectName: "app-c - Module Y",
      jiraProjectKey: "JIRA",
    });
    expect(withTestrailProject.appSlug).toBe("");
    expect(withTestrailProject.source).toBe("fallback");

    // 5. Jira metadata cannot establish app identity
    const withJira = resolveAppForPreview({
      targetAppSlug: undefined,
      requestAppSlug: undefined,
      testrailSectionName: undefined,
      testrailProjectName: undefined,
      jiraProjectKey: "JIRA",
    });
    expect(withJira.appSlug).toBe("");
    expect(withJira.source).toBe("fallback");
  });

  test("Normalization: spaces and special chars are normalized to slugs", () => {
    const result = resolveAppForPreview({
      requestAppSlug: "Arquitectura Automatización",
      targetAppSlug: undefined,
      targetAppName: undefined,
      testrailSectionName: undefined,
      testrailProjectName: undefined,
      jiraProjectKey: undefined,
    });

    expect(result.appSlug).toBe("arquitectura-automatizacion");
    expect(result.source).toBe("request");
  });

  test("Empty strings are treated as undefined", () => {
    const result = resolveAppForPreview({
      requestAppSlug: "",
      targetAppSlug: "  ",
      targetAppName: "",
      testrailSectionName: undefined,
      testrailProjectName: undefined,
      jiraProjectKey: "FALLBACK",
    });

    expect(result.appSlug).toBe("");
    expect(result.source).toBe("fallback");
  });

  test("requestAppSlug has higher confidence than jira inference", () => {
    const withRequest = resolveAppForPreview({
      requestAppSlug: "my-app",
    });

    const withJira = resolveAppForPreview({
      jiraProjectKey: "AA",
    });

    expect(withRequest.confidence).toBe("high");
    expect(withRequest.source).toBe("request");

    expect(withJira.confidence).toBe("low");
    expect(withJira.source).toBe("fallback");
  });
});
