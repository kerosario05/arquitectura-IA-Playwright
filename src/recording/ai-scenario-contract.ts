/**
 * The only contract accepted from the recording scenario suggester.
 *
 * This is deliberately separate from the executable RecordedScenario type: the model may
 * propose cases, but it must never silently become the source of recorded locators or turn an
 * unwalked proposal into an observed case.
 */

export const RECORDING_AI_SCENARIO_SCHEMA_NAME = "recording-ai-scenario-response" as const;

export const RECORDING_AI_SCENARIO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scenarios", "rejected"],
  properties: {
    scenarios: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "type",
          "rationale",
          "preconditions",
          "sharedSetupRef",
          "goalRelated",
          "scenarioSpecificSteps",
          "steps",
          "expectedResultCandidate",
          "oracleAuthority",
          "hypothesis",
          "needsReview",
          "sourceEvidenceRefs",
          "confidence",
        ],
        properties: {
          title: { type: "string", minLength: 1 },
          type: { type: "string", enum: ["DERIVED_ALTERNATIVE", "DERIVED_VALIDATION", "AI_PROPOSED"] },
          rationale: { type: "string" },
          preconditions: { type: "array", items: { type: "string" } },
          sharedSetupRef: { type: "string", minLength: 1 },
          goalRelated: { type: "boolean" },
          scenarioSpecificSteps: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["content", "expected"],
              properties: { content: { type: "string" }, expected: { type: "string" } },
            },
          },
          steps: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["content", "expected"],
              properties: { content: { type: "string" }, expected: { type: "string" } },
            },
          },
          expectedResultCandidate: { type: "string" },
          oracleAuthority: { type: "string", enum: ["OBSERVED", "DECLARED", "CONSTRAINT_BACKED", "TESTRAIL_AUTHORITY", "AI_HYPOTHESIS", "MISSING"] },
          hypothesis: { type: "boolean" },
          needsReview: { type: "boolean" },
          sourceEvidenceRefs: { type: "array", items: { type: "string" } },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    rejected: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["reason"],
        properties: {
          reason: { type: "string", minLength: 1 },
          sourceEvidenceRefs: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

export type RecordingAiScenarioType = "DERIVED_ALTERNATIVE" | "DERIVED_VALIDATION" | "AI_PROPOSED";

export type RecordingAiScenarioStep = { content: string; expected: string };
export type RecordingAiOracleAuthority = "OBSERVED" | "DECLARED" | "CONSTRAINT_BACKED" | "TESTRAIL_AUTHORITY" | "AI_HYPOTHESIS" | "MISSING";

export type RecordingAiScenarioProposal = {
  title: string;
  type: RecordingAiScenarioType;
  rationale: string;
  preconditions: string[];
  sharedSetupRef: string;
  goalRelated: boolean;
  scenarioSpecificSteps: RecordingAiScenarioStep[];
  steps: RecordingAiScenarioStep[];
  expectedResultCandidate: string;
  oracleAuthority: RecordingAiOracleAuthority;
  hypothesis: boolean;
  needsReview: boolean;
  sourceEvidenceRefs: string[];
  confidence: number;
};

export type RecordingAiScenarioRejected = {
  reason: string;
  sourceEvidenceRefs?: string[];
};

export type RecordingAiScenarioResponse = {
  scenarios: RecordingAiScenarioProposal[];
  rejected: RecordingAiScenarioRejected[];
};

export type ContractValidation = {
  valid: boolean;
  reason?: string;
  detectedKeys: string[];
  value?: RecordingAiScenarioResponse;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isProposal(value: unknown): value is RecordingAiScenarioProposal {
  if (!isRecord(value)) return false;
  if (typeof value.title !== "string" || !value.title.trim()) return false;
  if (!(["DERIVED_ALTERNATIVE", "DERIVED_VALIDATION", "AI_PROPOSED"] as string[]).includes(String(value.type))) return false;
  if (typeof value.rationale !== "string" || !stringArray(value.preconditions)) return false;
  if (typeof value.sharedSetupRef !== "string" || !value.sharedSetupRef.trim() || typeof value.goalRelated !== "boolean") return false;
  if (!Array.isArray(value.scenarioSpecificSteps) || !value.scenarioSpecificSteps.every((step) => isRecord(step) && typeof step.content === "string" && typeof step.expected === "string")) return false;
  if (!Array.isArray(value.steps) || !value.steps.every((step) => isRecord(step) && typeof step.content === "string" && typeof step.expected === "string")) return false;
  if (typeof value.expectedResultCandidate !== "string" || !stringArray(value.sourceEvidenceRefs)) return false;
  if (!( ["OBSERVED", "DECLARED", "CONSTRAINT_BACKED", "TESTRAIL_AUTHORITY", "AI_HYPOTHESIS", "MISSING"] as string[]).includes(String(value.oracleAuthority))) return false;
  if (typeof value.hypothesis !== "boolean" || typeof value.needsReview !== "boolean") return false;
  return typeof value.confidence === "number" && Number.isFinite(value.confidence) && value.confidence >= 0 && value.confidence <= 1;
}

export function validateRecordingAiScenarioResponse(raw: unknown): ContractValidation {
  const detectedKeys = isRecord(raw) ? Object.keys(raw) : [];
  if (!isRecord(raw)) return { valid: false, reason: "top-level response must be an object", detectedKeys };
  if (Object.keys(raw).some((key) => key !== "scenarios" && key !== "rejected")) {
    return { valid: false, reason: "top-level response contains unknown keys", detectedKeys };
  }
  if (!Array.isArray(raw.scenarios) || !raw.scenarios.every(isProposal)) {
    return { valid: false, reason: "scenarios must be an array of canonical proposals", detectedKeys };
  }
  if (!Array.isArray(raw.rejected) || !raw.rejected.every((item) => isRecord(item) && typeof item.reason === "string" && item.reason.trim().length > 0 && (item.sourceEvidenceRefs === undefined || stringArray(item.sourceEvidenceRefs)))) {
    return { valid: false, reason: "rejected must be an array of {reason, sourceEvidenceRefs?}", detectedKeys };
  }
  return { valid: true, detectedKeys, value: raw as RecordingAiScenarioResponse };
}

export function recordingAiSchemaInstruction(): string {
  return JSON.stringify(RECORDING_AI_SCENARIO_SCHEMA, null, 2);
}
