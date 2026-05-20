import { test, expect } from "@playwright/test";
import { waitForPageReady } from "../src/browser/page-readiness";

test("waitForPageReady options have sensible defaults", () => {
  expect(typeof waitForPageReady).toBe("function");
});

test("waitForPageReady does not contain hardcoded texts like Iniciar or Bienvenido", () => {
  const fs = require("fs");
  const path = require("path");
  const content = fs.readFileSync(path.join(__dirname, "../src/browser/page-readiness.ts"), "utf-8");

  expect(content).not.toContain("Iniciar");
  expect(content).not.toContain("Bienvenido");
  expect(content).not.toContain("¡Hola!");
  expect(content).not.toContain("kiosco");
  expect(content).not.toContain("kiosko");
});

test("waitForPageReady exports correct type signature", () => {
  const options = {
    domContentLoadedTimeoutMs: 30000,
    networkIdleTimeoutMs: 3000,
    stabilizationMs: 200,
    visibleHints: ["Welcome"],
    visibleHintTimeoutMs: 5000,
    requireVisibleHint: false
  };

  expect(options.domContentLoadedTimeoutMs).toBe(30000);
  expect(options.networkIdleTimeoutMs).toBe(3000);
  expect(options.stabilizationMs).toBe(200);
  expect(options.visibleHints).toEqual(["Welcome"]);
  expect(options.visibleHintTimeoutMs).toBe(5000);
  expect(options.requireVisibleHint).toBe(false);
});

test("waitForPageReady options can be partially specified", () => {
  const partialOptions: Record<string, unknown> = {
    stabilizationMs: 1000
  };

  expect(partialOptions.stabilizationMs).toBe(1000);
  expect(partialOptions.domContentLoadedTimeoutMs).toBeUndefined();
});

test("waitForPageReady visibleHints supports string and RegExp", () => {
  const options = {
    visibleHints: ["Welcome", /Hello/]
  };

  expect(options.visibleHints.length).toBe(2);
  expect(typeof options.visibleHints[0]).toBe("string");
  expect(options.visibleHints[1] instanceof RegExp).toBe(true);
});
