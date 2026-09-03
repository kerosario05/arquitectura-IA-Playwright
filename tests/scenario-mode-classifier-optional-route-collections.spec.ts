import { test, expect } from "@playwright/test";
import { classifyScenarioMode } from "../src/scenarios/scenario-mode-classifier";

test("classifies a route profile with navigation data and missing optional collections", () => {
  const routeProfile = {
    routes: [{ from: "entry", intermediates: ["section"] }],
    intermediates: { entry: ["section"] },
  };

  expect(() => classifyScenarioMode("Validar que se muestre el listado", routeProfile as any)).not.toThrow();
  expect(classifyScenarioMode("Validar que se muestre el listado", routeProfile as any)).toMatchObject({
    mode: "listing_validation",
    missingSteps: ["entry", "list_target"],
  });
});
