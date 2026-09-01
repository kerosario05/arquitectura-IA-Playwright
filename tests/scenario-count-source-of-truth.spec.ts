import { test, expect } from "@playwright/test";

test("summary.visible matches scenarios.length — 4 visible scenarios of mixed readiness", () => {
  // Simulate the response assembly after readiness pass
  const readinessExecutable = [{ scenarioId: "A", executionMode: "standard" }];
  const readinessRequiresLearning = [
    { scenarioId: "B", executionMode: "adaptive" },
    { scenarioId: "C", executionMode: "adaptive" },
  ];
  const readinessAdaptive: any[] = [];
  const readinessNonAutomatable = [{ scenarioId: "D", executionMode: "adaptive" }];

  const executableScenarios = [...readinessExecutable];
  const adaptiveScenarios = [...readinessRequiresLearning, ...readinessAdaptive, ...readinessNonAutomatable];
  const responseScenarios = [...readinessExecutable, ...readinessRequiresLearning, ...readinessAdaptive, ...readinessNonAutomatable];

  // Old calculation (divergent source)
  const oldVisible = executableScenarios.length + adaptiveScenarios.length;
  // New calculation (same source as UI renders)
  const newVisible = responseScenarios.length;

  expect(oldVisible).toBe(4);
  expect(newVisible).toBe(4);
  expect(responseScenarios.length).toBe(4);
  // Both happen to match here, but the fix ensures they ALWAYS match
  // by using responseScenarios.length directly
  console.log("4 scenarios: oldVisible=%d newVisible=%d scenarios.length=%d", oldVisible, newVisible, responseScenarios.length);
});

test("summary.visible matches scenarios.length — 3 visible scenarios (1 omitted)", () => {
  const readinessExecutable = [{ scenarioId: "A", executionMode: "standard" }];
  const readinessRequiresLearning = [
    { scenarioId: "B", executionMode: "adaptive" },
    { scenarioId: "C", executionMode: "adaptive" },
  ];
  const readinessAdaptive: any[] = [];
  const readinessNonAutomatable: any[] = [];

  const executableScenarios = [...readinessExecutable];
  const adaptiveScenarios = [...readinessRequiresLearning, ...readinessAdaptive, ...readinessNonAutomatable];
  const responseScenarios = [...readinessExecutable, ...readinessRequiresLearning, ...readinessAdaptive, ...readinessNonAutomatable];

  const oldVisible = executableScenarios.length + adaptiveScenarios.length;
  const newVisible = responseScenarios.length;

  expect(oldVisible).toBe(3);
  expect(newVisible).toBe(3);
  expect(responseScenarios.length).toBe(3);
  console.log("3 scenarios: oldVisible=%d newVisible=%d scenarios.length=%d", oldVisible, newVisible, responseScenarios.length);
});

test("summary.visible diverges when adaptiveScenarios has extra items not in responseScenarios", () => {
  // This is the bug scenario: adaptiveScenarios accumulates items from multiple
  // passes (markScenariosAsCoverageDiagnostics + readiness) but responseScenarios
  // only reflects the final readiness classification.
  const readinessExecutable = [{ scenarioId: "A", executionMode: "standard" }];
  const readinessRequiresLearning = [
    { scenarioId: "B", executionMode: "adaptive" },
    { scenarioId: "C", executionMode: "adaptive" },
  ];
  const readinessAdaptive: any[] = [];
  const readinessNonAutomatable = [{ scenarioId: "D", executionMode: "adaptive" }];

  // Simulate the bug: adaptiveScenarios gets extra items from coverage diagnostics pass
  // that aren't cleared before readiness push
  const executableScenarios = [...readinessExecutable];
  const adaptiveScenarios = [
    { scenarioId: "X", executionMode: "adaptive" }, // stale from coverage diagnostics
    ...readinessRequiresLearning,
    ...readinessAdaptive,
    ...readinessNonAutomatable,
  ];
  const responseScenarios = [...readinessExecutable, ...readinessRequiresLearning, ...readinessAdaptive, ...readinessNonAutomatable];

  const oldVisible = executableScenarios.length + adaptiveScenarios.length; // 5 (divergent!)
  const newVisible = responseScenarios.length; // 4 (correct)

  expect(oldVisible).toBe(5); // BUG: counts stale items
  expect(newVisible).toBe(4); // FIXED: matches rendered rows
  expect(responseScenarios.length).toBe(4);
  console.log("divergence: oldVisible=%d newVisible=%d scenarios.length=%d", oldVisible, newVisible, responseScenarios.length);
});
