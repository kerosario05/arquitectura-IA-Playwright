import { test, expect } from "@playwright/test";
import { resolveScenarioRoute } from "../src/scenarios/scenario-route-resolver";
import { buildExecutableSteps } from "../src/scenarios/route-backed-scenario-builder";

test("resolves detail navigation without optional visibleControls", () => {
  const routeProfile = {
    routes: [{ from: "entry", intermediates: ["section"] }],
    intermediates: { entry: ["section"] },
  };
  const issue = {
    key: "TEST-1",
    summary: "Detail navigation",
    description: "Validar la información detallada disponible.",
    acceptanceCriteria: "Validar que se muestre la información del producto.",
    labels: [],
    components: [],
    status: "Open",
    issueType: "Story",
  };

  const resolution = resolveScenarioRoute(issue, routeProfile as any, "app");
  expect(resolution.scenarioMode).toBe("detail_navigation");
  expect(() => buildExecutableSteps("detail_navigation", routeProfile as any, issue.description, ["section"])).not.toThrow();
});
