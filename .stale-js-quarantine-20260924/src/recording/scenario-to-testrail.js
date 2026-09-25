"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toPublishableScenario = toPublishableScenario;
const semantic_recording_1 = require("./semantic-recording");
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
function toPublishableScenario(scenario, appSlug, recordingId, recordingDataPolicy) {
    const effectivePolicy = (0, semantic_recording_1.normalizeRecordingDataPolicy)(recordingDataPolicy);
    const lastExpected = scenario.testRailSteps[scenario.testRailSteps.length - 1]?.expected?.trim();
    const humanPreconditions = scenario.preconditions
        .filter((entry) => !/automationScenarioId|scenarioId\s*[:=]|setup\s+com[úu]n\s*:/i.test(entry))
        .map((entry) => entry.trim())
        .filter(Boolean);
    return {
        sourceIssueKey: `REC-${recordingId.slice(0, 8).toUpperCase()}`,
        title: scenario.title,
        steps: scenario.testRailSteps.map((step) => {
            const canIncludeSensitiveValue = effectivePolicy.includeQaCredentialsInTestRail;
            const humanStep = step.sensitive && !canIncludeSensitiveValue
                ? step.stepTemplate ?? step.content
                : step.renderedStep ?? step.content;
            return step.expected ? `${humanStep}\nEsperado: ${step.expected}` : humanStep;
        }),
        preconditions: humanPreconditions,
        expectedResult: lastExpected || "Resultado esperado por confirmar",
        type: "Functional",
        database: "QA",
        isConverted: 0,
        automationType: "recorded_session",
        setupStrategy: "recorded_walkthrough",
        appSlug,
        routeProfile: "",
        dataRequirements: scenario.requiredData
            .map((field) => {
            const includeValue = effectivePolicy.includeQaCredentialsInTestRail
                && field.sensitive
                && field.exampleValue;
            return includeValue ? `${field.key}=${field.exampleValue}` : field.key;
        })
            .join(", "),
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
