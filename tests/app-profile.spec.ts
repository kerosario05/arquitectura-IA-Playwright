import { test, expect } from "@playwright/test";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { normalizeAppSlug, resolveAppProfile, ensureAppStructure, resolveProjectNameFromTestRail, logAppProfile, validateAuthFlowDependencies, savePromotedAppConfig, loadPromotedAppConfigSync } from "../src/automations/app-profile";
import type { AppProfile } from "../src/automations/app-profile";
import { loadPageObjectRegistry } from "../src/automations/page-object-registry";

// normalizeAppSlug tests
test.describe("normalizeAppSlug", () => {
  test('"Kiosko" -> "kiosko"', () => {
    expect(normalizeAppSlug("Kiosko")).toBe("kiosko");
  });

  test('"Fenix" -> "fenix"', () => {
    expect(normalizeAppSlug("Fenix")).toBe("fenix");
  });

  test('"Banca Móvil" -> "banca-movil"', () => {
    expect(normalizeAppSlug("Banca Móvil")).toBe("banca-movil");
  });

  test('"App / Canales Digitales" -> "app-canales-digitales"', () => {
    expect(normalizeAppSlug("App / Canales Digitales")).toBe("app-canales-digitales");
  });

  test('"  Mi App!!  " -> "mi-app"', () => {
    expect(normalizeAppSlug("  Mi App!!  ")).toBe("mi-app");
  });

  test('"../evil" blocks path traversal', () => {
    const result = normalizeAppSlug("../evil");
    expect(result).not.toContain("..");
    expect(result).not.toContain("/");
    expect(result).not.toContain("\\");
    expect(result).toBe("evil");
  });

  test('"" -> "default"', () => {
    expect(normalizeAppSlug("")).toBe("default");
  });

  test('undefined -> "default"', () => {
    expect(normalizeAppSlug(undefined)).toBe("default");
  });

  test('"   " -> "default"', () => {
    expect(normalizeAppSlug("   ")).toBe("default");
  });

  test('"default" stays "default"', () => {
    expect(normalizeAppSlug("default")).toBe("default");
  });

  test('"My_App" -> "my-app"', () => {
    expect(normalizeAppSlug("My_App")).toBe("my-app");
  });

  test('"App--Name" -> "app-name"', () => {
    expect(normalizeAppSlug("App--Name")).toBe("app-name");
  });

  test('"-leading-trailing-" -> "leading-trailing"', () => {
    expect(normalizeAppSlug("-leading-trailing-")).toBe("leading-trailing");
  });

  test('"../../etc/passwd" blocks path traversal', () => {
    const result = normalizeAppSlug("../../etc/passwd");
    expect(result).not.toContain("..");
    expect(result).not.toContain("/");
    expect(result).toBe("etc-passwd");
  });

  test('"..\\..\\windows\\system32" blocks path traversal', () => {
    const result = normalizeAppSlug("..\\..\\windows\\system32");
    expect(result).not.toContain("..");
    expect(result).not.toContain("\\");
  });
});

// resolveAppProfile priority tests
test.describe("resolveAppProfile priority", () => {
  test("CLI --app wins over APP_SLUG", async () => {
    const result = await resolveAppProfile({
      cliAppSlug: "kiosko",
      envAppSlug: "fenix"
    });
    expect(result.profile.appSlug).toBe("kiosko");
    expect(result.profile.source).toBe("cli");
  });

  test("APP_SLUG wins over TestRail project", async () => {
    const result = await resolveAppProfile({
      envAppSlug: "fenix",
      testRailProjectId: "123",
      testRailBaseUrl: "https://testrail.example.com",
      testRailEmail: "test@example.com",
      testRailApiKey: "fake-key"
    });
    expect(result.profile.appSlug).toBe("fenix");
    expect(result.profile.source).toBe("env");
  });

  test("TestRail project wins over default", async () => {
    const result = await resolveAppProfile({
      testRailProjectId: "123",
      testRailBaseUrl: "https://testrail.example.com",
      testRailEmail: "test@example.com",
      testRailApiKey: "fake-key"
    });
    // TestRail will fail to connect, so it falls back to default
    expect(result.profile.source).toBe("default");
    expect(result.profile.appSlug).toBe("default");
  });

  test("default when nothing specified", async () => {
    const result = await resolveAppProfile({});
    expect(result.profile.appSlug).toBe("default");
    expect(result.profile.source).toBe("default");
  });

  test("default when TestRail fails", async () => {
    const result = await resolveAppProfile({
      testRailProjectId: "999999",
      testRailBaseUrl: "https://invalid.example.com",
      testRailEmail: "test@example.com",
      testRailApiKey: "invalid-key"
    });
    expect(result.profile.appSlug).toBe("default");
    expect(result.profile.source).toBe("default");
  });

  test("baseDir is correct for custom appSlug", async () => {
    const result = await resolveAppProfile({ cliAppSlug: "my-app" });
    expect(result.baseDir).toBe(path.join("automations", "apps", "my-app"));
  });

  test("baseDir is correct for default", async () => {
    const result = await resolveAppProfile({});
    expect(result.baseDir).toBe(path.join("automations", "apps", "default"));
  });
});

// ensureAppStructure tests
test.describe("ensureAppStructure", () => {
  const testDir = path.join(".tmp-test-app-structure", "test-app");

  test.afterEach(async () => {
    await fsp.rm(path.dirname(testDir), { recursive: true, force: true });
  });

  test("creates structure if not exists", async () => {
    const created = await ensureAppStructure(testDir);
    expect(created.sort()).toContain("cases");
    expect(created.sort()).toContain("flows");
    expect(created.sort()).toContain("lib");
    expect(created.sort()).toContain("pages");

    for (const subdir of ["pages", "flows", "cases", "lib"]) {
      const stat = await fsp.stat(path.join(testDir, subdir));
      expect(stat.isDirectory()).toBe(true);
    }
  });

  test("reuses structure if already exists", async () => {
    await ensureAppStructure(testDir);
    const created = await ensureAppStructure(testDir);
    expect(created).toEqual([]);
  });

  test("creates only missing subdirectories", async () => {
    await ensureAppStructure(testDir);
    await fsp.rm(path.join(testDir, "lib"), { recursive: true });
    const created = await ensureAppStructure(testDir);
    expect(created).toEqual(["lib"]);
  });

  test("does not delete existing files", async () => {
    await ensureAppStructure(testDir);
    const existingFile = path.join(testDir, "pages", "existing.page.ts");
    await fsp.writeFile(existingFile, "// existing", "utf-8");

    await ensureAppStructure(testDir);

    const content = await fsp.readFile(existingFile, "utf-8");
    expect(content).toBe("// existing");
  });

  test("registers framework page objects through the shared registry helpers", async () => {
    const registryRoot = path.join("registry-test-app-structure", "automations", "apps", "test-app");
    try {
      await ensureAppStructure(registryRoot);
      const registry = await loadPageObjectRegistry({ appSlug: "test-app" } as any, path.join("registry-test-app-structure"));
      expect(registry.pageObjects.some((po) => po.className === "ProductListPage")).toBe(true);
      expect(registry.pageObjects.some((po) => po.className === "OperationsMenuPage")).toBe(true);
    } finally {
      await fsp.rm(path.join("registry-test-app-structure"), { recursive: true, force: true });
    }
  });
});

// Isolation tests
test.describe("app isolation", () => {
  test("kiosko does not write to default", async () => {
    const kioskoResult = await resolveAppProfile({ cliAppSlug: "kiosko" });
    const defaultResult = await resolveAppProfile({});

    expect(kioskoResult.baseDir).not.toBe(defaultResult.baseDir);
    expect(kioskoResult.baseDir).toContain("kiosko");
    expect(defaultResult.baseDir).toContain("default");
  });

  test("app-a does not modify app-b", async () => {
    const appAResult = await resolveAppProfile({ cliAppSlug: "app-a" });
    const appBResult = await resolveAppProfile({ cliAppSlug: "app-b" });

    expect(appAResult.baseDir).not.toBe(appBResult.baseDir);
    expect(appAResult.baseDir).toContain("app-a");
    expect(appBResult.baseDir).toContain("app-b");
  });

  test("fenix does not import from kiosko", async () => {
    const fenixResult = await resolveAppProfile({ cliAppSlug: "fenix" });
    const kioskoResult = await resolveAppProfile({ cliAppSlug: "kiosko" });

    expect(fenixResult.baseDir).not.toContain("kiosko");
    expect(kioskoResult.baseDir).not.toContain("fenix");
  });
});

// logAppProfile tests
test.describe("logAppProfile", () => {
  test("logs CLI source correctly", () => {
    const profile: AppProfile = {
      appSlug: "kiosko",
      source: "cli",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z"
    };
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(msg);
    logAppProfile(profile, "automations/apps/kiosko", ["pages", "flows"]);
    console.log = origLog;

    expect(lines.some(l => l.includes("appSlug=kiosko"))).toBe(true);
    expect(lines.some(l => l.includes("source=cli"))).toBe(true);
    expect(lines.some(l => l.includes("baseDir=automations/apps/kiosko"))).toBe(true);
  });

  test("logs env source correctly", () => {
    const profile: AppProfile = {
      appSlug: "fenix",
      source: "env",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z"
    };
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(msg);
    logAppProfile(profile, "automations/apps/fenix");
    console.log = origLog;

    expect(lines.some(l => l.includes("appSlug=fenix"))).toBe(true);
    expect(lines.some(l => l.includes("source=env"))).toBe(true);
  });

  test("logs default source correctly", () => {
    const profile: AppProfile = {
      appSlug: "default",
      source: "default",
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z"
    };
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(msg);
    logAppProfile(profile, "automations/apps/default");
    console.log = origLog;

    expect(lines.some(l => l.includes("appSlug=default"))).toBe(true);
    expect(lines.some(l => l.includes("source=default"))).toBe(true);
  });
});

// AuthFlow dependency bundle tests
test.describe("AuthFlow dependency bundle", () => {
  const testDir = path.join(".tmp-test-app-structure", "authflow-test-app");

  test.afterEach(async () => {
    await fsp.rm(path.dirname(testDir), { recursive: true, force: true });
  });

  test("ensureAppStructure copies AuthFlow dependency files from default app", async () => {
    const created = await ensureAppStructure(testDir);

    expect(created.some(f => f.startsWith("flows/"))).toBe(true);
    expect(created.some(f => f.startsWith("pages/"))).toBe(true);
    expect(created.some(f => f.startsWith("components/"))).toBe(true);

    expect(fs.existsSync(path.join(testDir, "flows", "auth.flow.ts"))).toBe(true);
    expect(fs.existsSync(path.join(testDir, "flows", "auth.flow.js"))).toBe(true);
    expect(fs.existsSync(path.join(testDir, "flows", "auth.flow.helpers.ts"))).toBe(true);
    expect(fs.existsSync(path.join(testDir, "pages", "identification.page.ts"))).toBe(true);
    expect(fs.existsSync(path.join(testDir, "pages", "phoneconfirmation.page.ts"))).toBe(true);
    expect(fs.existsSync(path.join(testDir, "pages", "operationsmenu.page.ts"))).toBe(true);
    expect(fs.existsSync(path.join(testDir, "components", "otp.component.ts"))).toBe(true);
    expect(fs.existsSync(path.join(testDir, "components", "virtual-keyboard.component.ts"))).toBe(true);
  });

  test("ensureAppStructure creates components directory", async () => {
    await ensureAppStructure(testDir);
    const stat = await fsp.stat(path.join(testDir, "components"));
    expect(stat.isDirectory()).toBe(true);
  });

  test("ensureAppStructure does not overwrite existing app-specific files", async () => {
    await ensureAppStructure(testDir);

    const customPage = path.join(testDir, "pages", "custom.page.ts");
    await fsp.writeFile(customPage, "// custom page", "utf-8");

    const created = await ensureAppStructure(testDir);
    expect(created).toEqual([]);

    const content = await fsp.readFile(customPage, "utf-8");
    expect(content).toBe("// custom page");
  });

  test("validateAuthFlowDependencies returns valid when all files exist", () => {
    const result = validateAuthFlowDependencies(path.resolve("automations/apps/default"));
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  test("validateAuthFlowDependencies returns missing files when they don't exist", async () => {
    await fsp.mkdir(path.join(testDir, "flows"), { recursive: true });
    await fsp.mkdir(path.join(testDir, "pages"), { recursive: true });
    await fsp.mkdir(path.join(testDir, "components"), { recursive: true });

    const result = validateAuthFlowDependencies(testDir);
    expect(result.valid).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
    expect(result.missing.some(f => f.includes("auth.flow"))).toBe(true);
  });
});

test.describe("promoted app config IO", () => {
  const outputRoot = path.join("registry-test-app-config");

  test.afterEach(async () => {
    await fsp.rm(outputRoot, { recursive: true, force: true });
  });

  test("savePromotedAppConfig writes atomically and loadPromotedAppConfigSync reads it back", async () => {
    await savePromotedAppConfig({
      appProfile: {
        appSlug: "io-app",
        source: "default",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      baseUrl: "https://example.test",
      loginMode: "no_login",
      testData: {},
      testDataAliases: {},
      testDataRefs: {},
      missingInputBehavior: "fail",
      updatedAt: new Date().toISOString()
    }, outputRoot);

    const loaded = loadPromotedAppConfigSync({
      appSlug: "io-app",
      configPath: path.join(outputRoot, "automations", "apps", "io-app", "app.config.json")
    });

    expect(loaded?.baseUrl).toBe("https://example.test");
    expect(loaded?.appProfile.appSlug).toBe("io-app");
  });
});
