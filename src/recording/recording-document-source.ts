import { loadScenarios } from "./recording-store";
import type { RecordedScenario } from "./trace-to-scenario";

export type RecordingEvidenceSource = {
  scenarioId: string;
  title: string;
  steps?: string[];
  documentSteps?: Array<{ text: string; sourceStepIndexes: number[] }>;
  expectedResult?: string;
  preconditions?: string[];
  testData?: Array<{ label: string; value: string }>;
};

export type RecordingEvidenceSelection = {
  appSlug: string;
  recordingId: string;
  scenarioIds: string[];
};

export function buildRecordingDocumentSteps(scenario: RecordedScenario): NonNullable<RecordingEvidenceSource["documentSteps"]> {
  const result: Array<{ text: string; sourceStepIndexes: number[]; valueKey?: string }> = [];
  scenario.testRailSteps.forEach((step, index) => {
    if (step.classification === "TECHNICAL_NOISE" || step.classification === "FOCUS_ONLY" || step.classification === "DYNAMIC_EDITOR_INTERNAL") return;
    const sourceStepIndex = index + 1;
    const field = step.valueKey
      ? scenario.requiredData.find((candidate) => candidate.key === step.valueKey)
      : undefined;
    const isSensitive = Boolean(step.sensitive || field?.sensitive);
    const fieldLabel = field?.label || step.valueKey || "campo indicado";
    // A countdown label can become the inferred field name when a segmented OTP is recorded.
    // In the report, describe the actual segmented action without publishing that UI timer as
    // if it were the name of the input.
    const documentFieldLabel = step.segmentPosition && /reenviar|segundos?|resend|countdown|timer/i.test(fieldLabel)
      ? "código de verificación"
      : fieldLabel;
    const actionText = step.renderedStep?.trim() || step.content;
    const isInput = /^(?:ingresar|seleccionar|fill|select)\b/i.test(actionText);
    const isSelection = /^(?:seleccionar|select)\b/i.test(actionText);
    let text = isInput
      ? `${isSelection ? "Seleccionar" : "Ingresar"} ${isSensitive ? "valor protegido" : (field?.label || "dato de prueba")} en "${documentFieldLabel}"`
      : actionText;
    for (const dataField of scenario.requiredData) {
      const value = scenario.runtimeDataset?.resolvedValues?.[dataField.key];
      const literal = value == null ? "" : String(value);
      if (literal.length < 3) continue;
      text = text.split(literal).join(dataField.sensitive ? "[Protegido]" : dataField.label);
    }

    // A segmented code is one authored action. Keep all source indexes to combine their
    // execution status and attach the final observed screenshot for this action.
    const prior = result.at(-1);
    if (step.segmentPosition && step.valueKey && prior?.valueKey === step.valueKey) {
      prior.sourceStepIndexes.push(sourceStepIndex);
      return;
    }
    result.push({ text, sourceStepIndexes: [sourceStepIndex], valueKey: step.segmentPosition ? step.valueKey : undefined });
  });
  return result.map(({ text, sourceStepIndexes }) => ({ text, sourceStepIndexes }));
}

export function buildRecordingEvidenceSource(scenario: RecordedScenario): RecordingEvidenceSource {
  return {
    scenarioId: scenario.scenarioId,
    title: scenario.title,
    steps: scenario.testRailSteps.map((step) => step.content),
    documentSteps: buildRecordingDocumentSteps(scenario),
    expectedResult: scenario.reviewedExpectedResult?.trim() || scenario.expectedResultCandidate?.trim(),
    preconditions: scenario.preconditions,
    testData: scenario.requiredData.flatMap((field) => {
      const value = scenario.runtimeDataset?.resolvedValues?.[field.key];
      if (value === undefined || value === null || String(value).trim() === "") return [];
      return [{ label: field.label, value: field.sensitive ? "[Protegido]" : String(value) }];
    }),
  };
}

/** Rebuild report sources for recording reruns from their stable recording/scenario lineage. */
export function loadRecordingEvidenceSources(selections: readonly RecordingEvidenceSelection[]): RecordingEvidenceSource[] {
  return selections.flatMap((selection) => {
    if (!selection.appSlug || !selection.recordingId || !Array.isArray(selection.scenarioIds)) return [];
    const selectedIds = new Set(selection.scenarioIds);
    return loadScenarios(selection.appSlug, selection.recordingId)
      .filter((scenario) => selectedIds.has(scenario.scenarioId))
      .map(buildRecordingEvidenceSource);
  });
}
