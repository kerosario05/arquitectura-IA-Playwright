"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const app_auto_resolver_1 = require("../src/automations/app-auto-resolver");
test_1.test.describe("App Slug Resolution Priority", () => {
    (0, test_1.test)("A. requestAppSlug explicit + inferred default fallback → uses requestAppSlug", () => {
        const result = (0, app_auto_resolver_1.resolveAppForPreview)({
            requestAppSlug: "arquitectura-automatizacion",
            targetAppSlug: undefined,
            targetAppName: undefined,
            testrailSectionName: undefined,
            testrailProjectName: undefined,
            jiraProjectKey: undefined,
        });
        (0, test_1.expect)(result.appSlug).toBe("arquitectura-automatizacion");
        (0, test_1.expect)(result.source).toBe("request");
        (0, test_1.expect)(result.confidence).toBe("high");
    });
    (0, test_1.test)("B. requestTargetAppSlug explicit valid → uses requestTargetAppSlug", () => {
        const result = (0, app_auto_resolver_1.resolveAppForPreview)({
            targetAppSlug: "kiosko",
            targetAppName: "Kiosko App",
            requestAppSlug: "arquitectura-automatizacion",
            testrailSectionName: undefined,
            testrailProjectName: undefined,
            jiraProjectKey: undefined,
        });
        (0, test_1.expect)(result.appSlug).toBe("kiosko");
        (0, test_1.expect)(result.appName).toBe("Kiosko App");
        (0, test_1.expect)(result.source).toBe("explicit");
        (0, test_1.expect)(result.confidence).toBe("high");
    });
    (0, test_1.test)("C. requestTargetAppSlug=undefined + requestAppSlug valid → uses requestAppSlug", () => {
        const result = (0, app_auto_resolver_1.resolveAppForPreview)({
            targetAppSlug: undefined,
            targetAppName: undefined,
            requestAppSlug: "arquitectura-automatizacion",
            testrailSectionName: undefined,
            testrailProjectName: undefined,
            jiraProjectKey: undefined,
        });
        (0, test_1.expect)(result.appSlug).toBe("arquitectura-automatizacion");
        (0, test_1.expect)(result.source).toBe("request");
        (0, test_1.expect)(result.confidence).toBe("high");
    });
    (0, test_1.test)("D. TestRail projectName exists but requestAppSlug also exists → uses requestAppSlug (higher priority)", () => {
        const result = (0, app_auto_resolver_1.resolveAppForPreview)({
            requestAppSlug: "arquitectura-automatizacion",
            targetAppSlug: undefined,
            targetAppName: undefined,
            testrailSectionName: undefined,
            testrailProjectName: "Some TestRail Project",
            jiraProjectKey: undefined,
        });
        (0, test_1.expect)(result.appSlug).toBe("arquitectura-automatizacion");
        (0, test_1.expect)(result.source).toBe("request");
        (0, test_1.expect)(result.confidence).toBe("high");
    });
    (0, test_1.test)("E. TestRail projectName does not establish app identity", () => {
        const result = (0, app_auto_resolver_1.resolveAppForPreview)({
            requestAppSlug: undefined,
            targetAppSlug: undefined,
            targetAppName: undefined,
            testrailSectionName: undefined,
            testrailProjectName: "app-a - Automation",
            jiraProjectKey: undefined,
        });
        (0, test_1.expect)(result.appSlug).toBe("");
        (0, test_1.expect)(result.source).toBe("fallback");
        (0, test_1.expect)(result.confidence).toBe("low");
    });
    (0, test_1.test)("F. No explicit app identity → unresolved", () => {
        const result = (0, app_auto_resolver_1.resolveAppForPreview)({
            requestAppSlug: undefined,
            targetAppSlug: undefined,
            targetAppName: undefined,
            testrailSectionName: undefined,
            testrailProjectName: undefined,
            jiraProjectKey: undefined,
        });
        (0, test_1.expect)(result.appSlug).toBe("");
        (0, test_1.expect)(result.source).toBe("fallback");
        (0, test_1.expect)(result.confidence).toBe("low");
    });
    (0, test_1.test)("Priority order: explicit targetAppSlug > requestAppSlug; metadata is ignored", () => {
        // 1. Explicit targetAppSlug wins over everything
        const withExplicit = (0, app_auto_resolver_1.resolveAppForPreview)({
            targetAppSlug: "explicit-app",
            requestAppSlug: "request-app",
            testrailProjectName: "testrail-project",
            jiraProjectKey: "JIRA",
        });
        (0, test_1.expect)(withExplicit.appSlug).toBe("explicit-app");
        (0, test_1.expect)(withExplicit.source).toBe("explicit");
        // 2. RequestAppSlug wins over TestRail and Jira
        const withRequest = (0, app_auto_resolver_1.resolveAppForPreview)({
            targetAppSlug: undefined,
            requestAppSlug: "request-app",
            testrailProjectName: "testrail-project",
            jiraProjectKey: "JIRA",
        });
        (0, test_1.expect)(withRequest.appSlug).toBe("request-app");
        (0, test_1.expect)(withRequest.source).toBe("request");
        // 3. TestRail metadata cannot establish app identity
        const withTestrailSection = (0, app_auto_resolver_1.resolveAppForPreview)({
            targetAppSlug: undefined,
            requestAppSlug: undefined,
            testrailSectionName: "app-b - Feature X",
            testrailProjectName: "testrail-project",
            jiraProjectKey: "JIRA",
        });
        (0, test_1.expect)(withTestrailSection.appSlug).toBe("");
        (0, test_1.expect)(withTestrailSection.source).toBe("fallback");
        // 4. TestRail project metadata cannot establish app identity
        const withTestrailProject = (0, app_auto_resolver_1.resolveAppForPreview)({
            targetAppSlug: undefined,
            requestAppSlug: undefined,
            testrailSectionName: undefined,
            testrailProjectName: "app-c - Module Y",
            jiraProjectKey: "JIRA",
        });
        (0, test_1.expect)(withTestrailProject.appSlug).toBe("");
        (0, test_1.expect)(withTestrailProject.source).toBe("fallback");
        // 5. Jira metadata cannot establish app identity
        const withJira = (0, app_auto_resolver_1.resolveAppForPreview)({
            targetAppSlug: undefined,
            requestAppSlug: undefined,
            testrailSectionName: undefined,
            testrailProjectName: undefined,
            jiraProjectKey: "JIRA",
        });
        (0, test_1.expect)(withJira.appSlug).toBe("");
        (0, test_1.expect)(withJira.source).toBe("fallback");
    });
    (0, test_1.test)("Normalization: spaces and special chars are normalized to slugs", () => {
        const result = (0, app_auto_resolver_1.resolveAppForPreview)({
            requestAppSlug: "Arquitectura Automatización",
            targetAppSlug: undefined,
            targetAppName: undefined,
            testrailSectionName: undefined,
            testrailProjectName: undefined,
            jiraProjectKey: undefined,
        });
        (0, test_1.expect)(result.appSlug).toBe("arquitectura-automatizacion");
        (0, test_1.expect)(result.source).toBe("request");
    });
    (0, test_1.test)("Empty strings are treated as undefined", () => {
        const result = (0, app_auto_resolver_1.resolveAppForPreview)({
            requestAppSlug: "",
            targetAppSlug: "  ",
            targetAppName: "",
            testrailSectionName: undefined,
            testrailProjectName: undefined,
            jiraProjectKey: "FALLBACK",
        });
        (0, test_1.expect)(result.appSlug).toBe("");
        (0, test_1.expect)(result.source).toBe("fallback");
    });
    (0, test_1.test)("requestAppSlug has higher confidence than jira inference", () => {
        const withRequest = (0, app_auto_resolver_1.resolveAppForPreview)({
            requestAppSlug: "my-app",
        });
        const withJira = (0, app_auto_resolver_1.resolveAppForPreview)({
            jiraProjectKey: "AA",
        });
        (0, test_1.expect)(withRequest.confidence).toBe("high");
        (0, test_1.expect)(withRequest.source).toBe("request");
        (0, test_1.expect)(withJira.confidence).toBe("low");
        (0, test_1.expect)(withJira.source).toBe("fallback");
    });
});
