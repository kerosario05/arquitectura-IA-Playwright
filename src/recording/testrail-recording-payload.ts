import type { AddCaseInput } from "../types/testrail.types";
import { serializeTestRailSteps } from "../testrail/testrail-step-serializer";

export type TestRailRecordingPayloadDiagnostic = {
  payloadKeys: string[];
  customFieldKeys: string[];
  fieldShapes: Record<string, string>;
  stepsFieldName: "custom_steps_separated" | "custom_steps" | "none";
  stepsFieldType: string;
  stepsCount: number;
  serializedPayloadBytes: number;
};

function shape(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array[${value.length}]`;
  if (typeof value === "object") return "object";
  return typeof value;
}

function containsUndefined(value: unknown): boolean {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(containsUndefined);
  if (value && typeof value === "object") return Object.values(value).some(containsUndefined);
  return false;
}

export function validateTestRailRecordingPayload(payload: Record<string, unknown>): string[] {
  const errors: string[] = [];
  if (typeof payload.title !== "string" || payload.title.trim().length === 0) errors.push("title must be a non-empty string");
  if (containsUndefined(payload)) errors.push("payload contains undefined");
  for (const [key, value] of Object.entries(payload)) {
    if (value === null) errors.push(`${key} must not be null`);
  }
  const separated = payload.custom_steps_separated;
  if (separated !== undefined) {
    if (!Array.isArray(separated)) errors.push("custom_steps_separated must be an array");
    else for (const [index, step] of separated.entries()) {
      if (!step || typeof step !== "object" || Array.isArray(step)) errors.push(`custom_steps_separated[${index}] must be an object`);
      else {
        const candidate = step as Record<string, unknown>;
        if (typeof candidate.content !== "string" || candidate.content.trim().length === 0) errors.push(`custom_steps_separated[${index}].content must be a string`);
        if (typeof candidate.expected !== "string") errors.push(`custom_steps_separated[${index}].expected must be a string`);
      }
    }
  }
  if (payload.custom_steps !== undefined && typeof payload.custom_steps !== "string") errors.push("custom_steps must be a string");
  // Some TestRail templates expose both fields and require the legacy text field even when
  // the separated representation is also accepted. The shared client may therefore send both;
  // their individual shapes are validated above rather than rejected as Recording-specific.
  return errors;
}

export function describeTestRailRecordingPayload(payload: Record<string, unknown>): TestRailRecordingPayloadDiagnostic {
  const separated = payload.custom_steps_separated;
  const text = payload.custom_steps;
  const fields = Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, shape(value)]));
  return {
    payloadKeys: Object.keys(payload),
    customFieldKeys: Object.keys(payload).filter((key) => key.startsWith("custom_")),
    fieldShapes: fields,
    stepsFieldName: Array.isArray(separated) ? "custom_steps_separated" : typeof text === "string" ? "custom_steps" : "none",
    stepsFieldType: Array.isArray(separated) ? "array<object{content:string,expected:string}>" : typeof text,
    stepsCount: Array.isArray(separated) ? separated.length : typeof text === "string" ? text.split("\n").filter(Boolean).length : 0,
    serializedPayloadBytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
  };
}

export function validateTestRailRecordingInput(input: AddCaseInput): string[] {
  if (input.stepsSeparated === undefined) return validateTestRailRecordingPayload({ title: input.title });
  const payload = {
    title: input.title,
    custom_steps: serializeTestRailSteps(input.stepsSeparated),
    custom_steps_separated: input.stepsSeparated.map((step) => ({ content: step.content, expected: step.expected ?? "" })),
  };
  return validateTestRailRecordingPayload(payload);
}
