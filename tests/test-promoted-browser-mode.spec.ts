import { test, expect } from "@playwright/test";
import {
  applyPromotedBrowserMode,
  resolvePromotedBrowserMode,
} from "../src/cli/test-promoted-browser-mode";

test("browser mode: explicit --headed has top priority", () => {
  const resolved = resolvePromotedBrowserMode({
    headedFlag: true,
    headlessFlag: true,
    automationHeadless: "true",
    automationSource: "qa_lab_automatic",
  });
  expect(resolved).toEqual({
    mode: "headed",
    source: "explicit_cli_flag",
  });
});

test("browser mode: explicit --headless is honored", () => {
  const resolved = resolvePromotedBrowserMode({
    headedFlag: false,
    headlessFlag: true,
    automationHeadless: undefined,
    automationSource: undefined,
  });
  expect(resolved).toEqual({
    mode: "headless",
    source: "explicit_cli_flag",
  });
});

test("browser mode: automatic QA Lab run resolves to headless", () => {
  const resolved = resolvePromotedBrowserMode({
    headedFlag: false,
    headlessFlag: false,
    automationHeadless: "true",
    automationSource: "qa_lab_automatic",
  });
  expect(resolved).toEqual({
    mode: "headless",
    source: "qa_lab_automatic",
  });
});

test("browser mode: no explicit flag keeps config mode", () => {
  const resolved = resolvePromotedBrowserMode({
    headedFlag: false,
    headlessFlag: false,
    automationHeadless: "false",
    automationSource: undefined,
  });
  expect(resolved).toEqual({
    mode: "config",
    source: "default_config",
  });
});

test("apply mode: headless forces HEADLESS=true and removes PWDEBUG", () => {
  const applied = applyPromotedBrowserMode({
    playwrightArgs: ["automations/apps", "--workers=1"],
    baseEnv: {
      HEADLESS: "false",
      PWDEBUG: "1",
    } as NodeJS.ProcessEnv,
    browserMode: {
      mode: "headless",
      source: "qa_lab_automatic",
    },
  });
  expect(applied.playwrightArgs).toEqual(["automations/apps", "--workers=1"]);
  expect(applied.playwrightEnv.HEADLESS).toBe("true");
  expect(applied.playwrightEnv.PWDEBUG).toBeUndefined();
});

test("apply mode: headed appends --headed and sets HEADLESS=false", () => {
  const applied = applyPromotedBrowserMode({
    playwrightArgs: ["automations/apps", "--workers=1"],
    baseEnv: {
      HEADLESS: "true",
    } as NodeJS.ProcessEnv,
    browserMode: {
      mode: "headed",
      source: "explicit_cli_flag",
    },
  });
  expect(applied.playwrightArgs).toEqual(["automations/apps", "--workers=1", "--headed"]);
  expect(applied.playwrightEnv.HEADLESS).toBe("false");
});
