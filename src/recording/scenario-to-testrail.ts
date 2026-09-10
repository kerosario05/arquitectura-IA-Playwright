import type { McpScenario } from "../scenarios/scenario-types";
import type { RecordedScenario } from "./trace-to-scenario";

/**
 * Adapts a recorded scenario to what the shared TestRail publisher expects.
 *
 * Recordings publish through the same path as generated scenarios rather than calling
 * `add_case` themselves. A bare call sends only what it is handed, and a TestRail instance
 * can require fields on every case — `custom_expected` and `custom_case_oracle` in ours —
 * that only the shared publisher knows how to fill. This is the whole cost of that reuse: one
 * translation between two internal shapes.
 *
 * The publisher's step type is a plain string, while a recorded step carries its own expected
 * result. Folding the expectation into the step text is what keeps it: TestRail renders each
 * entry as `1. <content>` in the plain-text steps field, so the pair reads exactly as it did
 * before. `expectedResult` feeds `custom_expected` — the last step's expectation is the
 * outcome the whole case asserts.
 */
export function toPublishableScenario(
  scenario: RecordedScenario,
  appSlug: string,
  recordingId: string,
): McpScenario {
  const lastExpected = scenario.testRailSteps[scenario.testRailSteps.length - 1]?.expected?.trim();
  return {
    sourceIssueKey: `REC-${recordingId.slice(0, 8).toUpperCase()}`,
    title: scenario.title,
    steps: scenario.testRailSteps.map((step) =>
      step.expected ? `${step.content}\nEsperado: ${step.expected}` : step.content,
    ),
    preconditions: scenario.preconditions,
    expectedResult: lastExpected || "",
    type: "Functional",
    database: "QA",
    isConverted: 0,
    automationType: "recorded_session",
    setupStrategy: "recorded_walkthrough",
    appSlug,
    routeProfile: "",
    dataRequirements: "",
    nonExecutableCriteria: "",
    // A derived scenario is a proposal the recording never walked, so it is not executable.
    mcpExecutable: scenario.provenance !== "derived",
  };
}
