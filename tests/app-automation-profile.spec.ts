import { test, expect } from "@playwright/test";
import {
  normalizeAppSlug,
  deriveAppProfile,
  buildAppAutomationPaths,
  serializeRuntimeConfigForPromotion,
  redactPromotedAppConfigForLogs
} from "../src/automations/app-profile";
import type { FullConfig } from "../src/types/env.types";

function makeConfig(overrides?: Partial<FullConfig["app"]>): FullConfig {
  return {
    app: {
      name: "Generic Banking App",
      appProfile: "profile-a",
      baseUrl: "https://app-a.example.test",
      loginMode: "password",
      username: "demo-user",
      password: "demo-pass",
      extraLoginFields: { tenant: "main", secretCode: "1234" },
      testData: { account: "001" },
      testDataAliases: { account: ["acc"] },
      missingInputBehavior: "fail",
      ...overrides
    },
    execution: {
      browser: "chromium",
      headless: true,
      evidenceDir: ".artifacts/evidence",
      defaultTimeoutMs: 30000
    },
    integrations: {}
  };
}

test("normalizeAppSlug cleans accents, spaces and symbols", () => {
  expect(normalizeAppSlug("  Módulo Pagos / QA  ")).toBe("modulo-pagos-qa");
});

test("deriveAppProfile uses APP_PROFILE when present", () => {
  const profile = deriveAppProfile({
    appProfile: "Custom Profile",
    appName: "Ignored Name",
    baseUrl: "https://example.test"
  });
  expect(profile.appSlug).toBe("custom-profile");
});

test("deriveAppProfile derives from baseUrl when APP_PROFILE is missing", () => {
  const profile = deriveAppProfile({
    appProfile: "",
    appName: "",
    baseUrl: "https://portal.internal.example.test"
  });
  expect(profile.appSlug).toBe("example");
});

test("buildAppAutomationPaths creates per-app directories", () => {
  const profile = deriveAppProfile({ appProfile: "qa-web", baseUrl: "https://example.test" });
  const paths = buildAppAutomationPaths(profile, "auto-1");
  expect(paths.appDir.replace(/\\/g, "/")).toContain("automations/apps/qa-web");
  expect(paths.casesDir).toContain("cases");
  expect(paths.caseDir).toContain("auto-1");
  expect(paths.caseConfigPath).toContain("case.json");
  expect(paths.configPath).toContain("app.config.json");
  expect(paths.planPath).toContain("plan.json");
  expect(paths.specPath).toContain("spec.ts");
  expect(paths.runsDir).toContain("runs");
  expect(paths.evidenceDir).toContain("evidence");
});

test("serializeRuntimeConfigForPromotion persists runnable config and refs", () => {
  const promoted = serializeRuntimeConfigForPromotion(makeConfig());
  expect(promoted.baseUrl).toBe("https://app-a.example.test");
  expect(promoted.loginMode).toBe("password");
  expect(promoted.testData.account).toBe("001");
  expect(promoted.usernameRef).toBe("APP_USERNAME");
  expect(promoted.passwordRef).toBe("APP_PASSWORD");
});

test("redactPromotedAppConfigForLogs does not expose password", () => {
  const promoted = serializeRuntimeConfigForPromotion(makeConfig());
  const redacted = redactPromotedAppConfigForLogs(promoted);
  expect(JSON.stringify(redacted)).not.toContain("demo-pass");
});
