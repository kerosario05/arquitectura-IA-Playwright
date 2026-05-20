import { expect, test } from "@playwright/test";
import { validateObjectRegistry } from "../src/registry/object-registry-validator";
import type { ObjectRegistry } from "../src/types/object-registry.types";

function createBaseRegistry(): ObjectRegistry {
  return {
    version: "1.0",
    appName: "generic",
    objects: []
  };
}

test("valid empty registry", () => {
  const result = validateObjectRegistry(createBaseRegistry());
  expect(result.valid).toBe(true);
});

test("valid role object", () => {
  const registry = createBaseRegistry();
  registry.objects.push({
    key: "loginButton",
    name: "Login Button",
    type: "button",
    locator: { strategy: "role", role: "button", name: "Login" }
  });
  const result = validateObjectRegistry(registry);
  expect(result.valid).toBe(true);
});

test("duplicated key returns error", () => {
  const registry = createBaseRegistry();
  registry.objects.push(
    { key: "x", name: "X", type: "button", locator: { strategy: "testId", value: "x" } },
    { key: "x", name: "X2", type: "button", locator: { strategy: "testId", value: "x2" } }
  );
  const result = validateObjectRegistry(registry);
  expect(result.valid).toBe(false);
});

test("css locator generates warning", () => {
  const registry = createBaseRegistry();
  registry.objects.push({ key: "x", name: "X", type: "input", locator: { strategy: "css", value: "#x" } });
  const result = validateObjectRegistry(registry);
  expect(result.issues.some((issue) => issue.level === "warning" && issue.code === "LOCATOR_LOW_RESILIENCE")).toBe(true);
});

test("xpath locator generates warning", () => {
  const registry = createBaseRegistry();
  registry.objects.push({ key: "x", name: "X", type: "input", locator: { strategy: "xpath", value: "//input" } });
  const result = validateObjectRegistry(registry);
  expect(result.issues.some((issue) => issue.level === "warning" && issue.code === "LOCATOR_LOW_RESILIENCE")).toBe(true);
});

test("role without role or name returns error", () => {
  const registry = createBaseRegistry();
  registry.objects.push({ key: "x", name: "X", type: "button", locator: { strategy: "role" } });
  const result = validateObjectRegistry(registry);
  expect(result.valid).toBe(false);
});

test("duplicate aliases generate warning", () => {
  const registry = createBaseRegistry();
  registry.objects.push({
    key: "x",
    name: "X",
    type: "button",
    locator: { strategy: "testId", value: "x" },
    aliases: ["Ingresar", "ingresar"]
  });
  const result = validateObjectRegistry(registry);
  expect(result.issues.some((issue) => issue.level === "warning" && issue.code === "ALIASES_DUPLICATED")).toBe(true);
});
