import { test, expect } from "@playwright/test";
import {
  normalizeAppProfile,
  getCurrentAppProfile,
  shouldRunGeneratedSpec,
  buildGeneratedSpecSkipReason
} from "../src/runner/generated-spec-filter";

test("normalizeAppProfile trims and lowercases", () => {
  expect(normalizeAppProfile("  Saucedemo  ")).toBe("saucedemo");
});

test("normalizeAppProfile replaces spaces with underscores", () => {
  expect(normalizeAppProfile("my app")).toBe("my_app");
});

test("normalizeAppProfile replaces special characters with underscores", () => {
  expect(normalizeAppProfile("test-app!@#")).toBe("test_app");
});

test("normalizeAppProfile returns default for empty string", () => {
  expect(normalizeAppProfile("")).toBe("default");
});

test("normalizeAppProfile returns default for undefined", () => {
  expect(normalizeAppProfile(undefined)).toBe("default");
});

test("normalizeAppProfile returns default for whitespace-only", () => {
  expect(normalizeAppProfile("   ")).toBe("default");
});

test("normalizeAppProfile handles already-normalized string", () => {
  expect(normalizeAppProfile("kiosko")).toBe("kiosko");
});

test("getCurrentAppProfile returns default when APP_PROFILE not set", () => {
  delete process.env.APP_PROFILE;
  expect(getCurrentAppProfile()).toBe("default");
});

test("getCurrentAppProfile returns normalized value when APP_PROFILE set", () => {
  process.env.APP_PROFILE = "  Kiosko  ";
  try {
    expect(getCurrentAppProfile()).toBe("kiosko");
  } finally {
    delete process.env.APP_PROFILE;
  }
});

test("shouldRunGeneratedSpec: same profile returns true", () => {
  expect(shouldRunGeneratedSpec({ specProfile: "kiosko", currentProfile: "kiosko" })).toBe(true);
});

test("shouldRunGeneratedSpec: different profile returns false", () => {
  expect(shouldRunGeneratedSpec({ specProfile: "saucedemo", currentProfile: "kiosko" })).toBe(false);
});

test("shouldRunGeneratedSpec: missing spec profile with no current profile returns true (legacy)", () => {
  delete process.env.APP_PROFILE;
  expect(shouldRunGeneratedSpec({})).toBe(true);
});

test("shouldRunGeneratedSpec: missing spec profile with explicit current profile returns false", () => {
  expect(shouldRunGeneratedSpec({ specProfile: undefined, currentProfile: "saucedemo" })).toBe(false);
});

test("shouldRunGeneratedSpec: default spec profile with no current profile returns true", () => {
  delete process.env.APP_PROFILE;
  expect(shouldRunGeneratedSpec({ specProfile: "default" })).toBe(true);
});

test("shouldRunGeneratedSpec: uses env APP_PROFILE when currentProfile not provided", () => {
  process.env.APP_PROFILE = "saucedemo";
  try {
    expect(shouldRunGeneratedSpec({ specProfile: "saucedemo" })).toBe(true);
    expect(shouldRunGeneratedSpec({ specProfile: "kiosko" })).toBe(false);
  } finally {
    delete process.env.APP_PROFILE;
  }
});

test("shouldRunGeneratedSpec: normalization handles case differences", () => {
  expect(shouldRunGeneratedSpec({ specProfile: "Kiosko", currentProfile: "kiosko" })).toBe(true);
  expect(shouldRunGeneratedSpec({ specProfile: "SauceDemo", currentProfile: "saucedemo" })).toBe(true);
});

test("buildGeneratedSpecSkipReason returns undefined when profiles match", () => {
  expect(buildGeneratedSpecSkipReason({ specProfile: "kiosko", currentProfile: "kiosko" })).toBeUndefined();
});

test("buildGeneratedSpecSkipReason returns reason when profiles differ", () => {
  const reason = buildGeneratedSpecSkipReason({ specProfile: "kiosko", currentProfile: "saucedemo" });
  expect(reason).toContain("kiosko");
  expect(reason).toContain("saucedemo");
  expect(reason).toContain("Skipped");
});

test("buildGeneratedSpecSkipReason includes both profiles in message", () => {
  const reason = buildGeneratedSpecSkipReason({ specProfile: "kiosko", currentProfile: "saucedemo" });
  expect(reason).toContain("saucedemo");
  expect(reason).toContain("kiosko");
});
