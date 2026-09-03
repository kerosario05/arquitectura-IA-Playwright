import { test, expect } from "@playwright/test";
import { isConfiguredRouteProfileUsable } from "../src/scenarios/scenario-preview.service";

test.describe("configured routeProfile acceptance", () => {
  test("accepts navigation structure without entry or aliases", () => {
    const routeProfile = {
      routes: [{ from: "entry", intermediates: ["section"] }],
      intermediates: { entry: ["section"] },
    };

    expect(isConfiguredRouteProfileUsable(routeProfile)).toBe(true);
  });

  test("rejects an empty routeProfile", () => {
    expect(isConfiguredRouteProfileUsable({})).toBe(false);
    expect(isConfiguredRouteProfileUsable(null)).toBe(false);
  });
});
