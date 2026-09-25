import type { McpScenario } from "../scenarios/scenario-types";
import type { RecordedScenario } from "./trace-to-scenario";
import type { RecordingDataPolicy } from "./session-trace.types";

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
  // FIRST_LEAK fix: `recordingDataPolicy` used to gate whether a sensitive step's REAL recorded
  // value (`renderedStep`/`exampleValue`) reached TestRail via `includeQaCredentialsInTestRail`
  // -- but `normalizeRecordingDataPolicy` already hardcodes that flag to `true` unconditionally
  // ("Recording policy is an invariant"), so every recording was publishing real secrets to
  // TestRail regardless of what was configured. TestRail is never a secret store: a sensitive
  // step/field's REAL value must never reach it, independent of any policy. The parameter stays
  // (kept for signature compatibility with existing callers) but no longer governs that
  // decision -- `persistQaCredentials`/`includeQaCredentialsInTestRail` remain meaningful only
  // for the EXECUTION channel (the runtime dataset a live fill actually reads), never for this
  // PRESENTATION/artifact channel.
  _recordingDataPolicy?: RecordingDataPolicy,
): McpScenario {
  const lastExpected = scenario.testRailSteps[scenario.testRailSteps.length - 1]?.expected?.trim();
  const humanPreconditions = scenario.preconditions
    .filter((entry) => !/automationScenarioId|scenarioId\s*[:=]|setup\s+com[úu]n\s*:/i.test(entry))
    .map((entry) => entry.trim())
    .filter(Boolean);
  return {
    sourceIssueKey: `REC-${recordingId.slice(0, 8).toUpperCase()}`,
    // The recording's own canonical scenario identity (e.g. "REC-D8DBD8F9-01") — distinct from
    // sourceIssueKey above (the recording-level grouping ref shared by every scenario in it).
    // Without this, the TestRail publisher (buildSafeTestRailRefs) had no scenario-specific
    // identity to build an authoritative ref from, and fell back to combining sourceIssueKey
    // with its own internal, ephemeral virtual mapping id (e.g. "L-d8dbd8f9-001") instead —
    // producing a ref that could not be matched exactly on a later execution. See
    // testrail-case-publisher.ts's buildSafeTestRailRefs.
    scenarioId: scenario.scenarioId,
    title: scenario.title,
    steps: scenario.testRailSteps.map((step) => {
      // A sensitive step ALWAYS publishes its generic, safe template -- never `renderedStep`
      // (the concrete, human-friendly wording meant for QA's own live review of what was
      // recorded, never artifact/publication authority) -- regardless of any configured policy.
      // TestRail is never a secret store.
      const humanStep = step.sensitive ? step.stepTemplate ?? step.content : step.renderedStep ?? step.content;
      return step.expected ? `${humanStep}\nEsperado: ${step.expected}` : humanStep;
    },
    ),
    preconditions: humanPreconditions,
    expectedResult: lastExpected || "Resultado esperado por confirmar",
    type: "Functional",
    database: "QA",
    isConverted: 0,
    automationType: "recorded_session",
    setupStrategy: "recorded_walkthrough",
    appSlug,
    routeProfile: "",
    // A sensitive field's real recorded value never joins this string either, regardless of
    // policy -- only the key itself, exactly like every non-sensitive field already was.
    dataRequirements: scenario.requiredData.map((field) => field.key).join(", "),
    nonExecutableCriteria: scenario.readiness && !scenario.readiness.executionReadiness
      ? scenario.readiness.missingInputs.map((input) => input.valueKey).join(", ")
      : "",
    // A derived scenario may run exploratorily once its data and technical contract are ready.
    // Oracle readiness is deliberately not part of the MCP execution gate.
    mcpExecutable: scenario.mutationDiagnostics?.rejectionReason !== "MUTATION_NO_EFFECT"
      && (scenario.provenance !== "derived"
        || (scenario.mutation !== undefined && scenario.readiness?.executionReadiness === true)),
  };
}
