import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { resolveWebBaseUrl } from "../src/cli/discovery-preview";

const TEST_APP_SLUG = "project-a-test-isolation";
const TEST_APP_DIR = path.join(process.cwd(), "automations", "apps", TEST_APP_SLUG);
const TEST_CONFIG_PATH = path.join(TEST_APP_DIR, "app.config.json");

function ensureTestApp(baseUrl: string) {
  fs.mkdirSync(TEST_APP_DIR, { recursive: true });
  const cfg = {
    name: "Project A Test",
    baseUrl,
    loginMode: "no_login",
    testData: {},
    testDataAliases: {},
    missingInputBehavior: "auto_generate",
  };
  fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");
}

function cleanupTestApp() {
  try { fs.rmSync(TEST_APP_DIR, { recursive: true, force: true }); } catch {}
}

test.describe("web:base-url isolation", () => {
  test.afterEach(() => cleanupTestApp());

  test("proyecto genérico A: effective=project-a.example, nunca default.example", () => {
    const projectBaseUrl = "https://project-a.example/";
    // Env/default would be https://default.example/ but must not be used
    ensureTestApp(projectBaseUrl);

    // Ensure env default is different (simulate global env = default.example)
    // resolveWebBaseUrl must return project config, not env
    const result = resolveWebBaseUrl(TEST_APP_SLUG);

    expect(result.appSlug).toBe(TEST_APP_SLUG);
    expect(result.source).toBe("app_config");
    expect(result.configured).toBe(projectBaseUrl);
    expect(result.effective).toBe(projectBaseUrl);
    expect(result.fallbackUsed).toBe(false);
    expect(result.effective).not.toBe("https://default.example/");
    expect(result.effective).not.toContain("default.example");
  });

  test("FAIL CLOSED: appSlug con config sin baseUrl debe fallar, no fallback silencioso", () => {
    // Create config without baseUrl (empty)
    fs.mkdirSync(TEST_APP_DIR, { recursive: true });
    const cfg: any = {
      name: "Project A Missing",
      loginMode: "no_login",
      // baseUrl missing
    };
    fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf-8");

    expect(() => resolveWebBaseUrl(TEST_APP_SLUG)).toThrow(/FAIL CLOSED|missing baseUrl/);
  });

  test("FAIL CLOSED: appSlug inexistente debe fallar, no usar default", () => {
    const missingSlug = "nonexistent-project-xyz-12345";
    // Ensure no dir exists
    const missingDir = path.join(process.cwd(), "automations", "apps", missingSlug);
    try { fs.rmSync(missingDir, { recursive: true, force: true }); } catch {}
    expect(() => resolveWebBaseUrl(missingSlug)).toThrow(/FAIL CLOSED|missing baseUrl/);
  });
});
