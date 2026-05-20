import { expect, test } from "@playwright/test";
import { getActionCapability, listSupportedActions } from "../src/registry/action-registry";

test("lists supported actions", () => {
  const actions = listSupportedActions();
  expect(actions).toEqual(
    expect.arrayContaining(["navigate", "login", "click", "fill", "select", "assertText", "assertUrl", "noop"])
  );
});

test("fill requires target and value", () => {
  const fill = getActionCapability("fill");
  expect(fill).toBeDefined();
  expect(fill?.requiresTarget).toBe(true);
  expect(fill?.requiresValue).toBe(true);
  expect(fill?.allowsValueKey).toBe(true);
});

test("assertText requires expected", () => {
  const capability = getActionCapability("assertText");
  expect(capability?.requiresExpected).toBe(true);
});

test("noop does not require target", () => {
  const capability = getActionCapability("noop");
  expect(capability?.requiresTarget).toBe(false);
});

test("getActionCapability returns existing action", () => {
  const capability = getActionCapability("navigate");
  expect(capability?.action).toBe("navigate");
});
