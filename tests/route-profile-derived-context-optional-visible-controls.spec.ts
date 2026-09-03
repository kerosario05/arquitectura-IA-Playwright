import { test, expect } from "@playwright/test";
import { buildDerivedExecutionContext } from "../src/scenarios/route-profile-derived-context";

test("derives route context when visibleControls is absent or not an array", () => {
  const baseProfile = {
    routes: [{ from: "entry", intermediates: ["section"] }],
    intermediates: { entry: ["section"] },
  };

  expect(() => buildDerivedExecutionContext("app", baseProfile as any, new Map(), [])).not.toThrow();
  expect(() => buildDerivedExecutionContext("app", { ...baseProfile, visibleControls: {} } as any, new Map(), [])).not.toThrow();
});
