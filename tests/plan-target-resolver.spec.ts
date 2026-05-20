import { expect, test } from "@playwright/test";
import { resolveLocatorFromPlanTarget } from "../src/runner/plan-target-resolver";

function createMockPage() {
  const calls: string[] = [];
  const locator = { calls };
  const page = {
    getByRole: () => locator,
    getByText: () => locator,
    getByLabel: () => locator,
    getByPlaceholder: () => locator,
    getByTestId: () => locator,
    locator: (value: string) => {
      calls.push(value);
      return locator;
    }
  };
  return { page, calls };
}

test("semantic target throws clear error", () => {
  const { page } = createMockPage();
  expect(() => resolveLocatorFromPlanTarget(page as never, { strategy: "semantic", value: "user field" })).toThrow(
    /semantic target is not executable/
  );
});

test("incomplete testId target throws clear error", () => {
  const { page } = createMockPage();
  expect(() => resolveLocatorFromPlanTarget(page as never, { strategy: "testId" })).toThrow(/Missing value\/name/);
});

test("xpath prefix is added when missing", () => {
  const { page, calls } = createMockPage();
  resolveLocatorFromPlanTarget(page as never, { strategy: "xpath", value: "//button" });
  expect(calls[0]).toBe("xpath=//button");
});

test("existing xpath prefix is preserved", () => {
  const { page, calls } = createMockPage();
  resolveLocatorFromPlanTarget(page as never, { strategy: "xpath", value: "xpath=//button" });
  expect(calls[0]).toBe("xpath=//button");
});
