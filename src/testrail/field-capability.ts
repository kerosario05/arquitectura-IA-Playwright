import type { InputRequirement } from "../db/project-case-input-requirement-service";

export type FieldCapabilityKind =
  | "text"
  | "password"
  | "number"
  | "email"
  | "tel"
  | "date"
  | "datetime"
  | "select"
  | "checkbox"
  | "radio"
  | "file"
  | "unknown";

export type FieldCapability = {
  kind: FieldCapabilityKind;
  allowedValues?: string[];
  optionSource?: "contract" | "runtime_observed" | "unknown";
  constraints?: {
    min?: number;
    max?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    format?: string;
  };
};

const KNOWN_KINDS = new Set<FieldCapabilityKind>([
  "text", "password", "number", "email", "tel", "date", "datetime",
  "select", "checkbox", "radio", "file",
]);

export function resolveFieldCapability(requirement: InputRequirement): FieldCapability {
  const normalizedType = requirement.controlType?.trim().toLowerCase();
  const kind: FieldCapabilityKind = normalizedType
    ? (/^(?:secret|password|credential)$/i.test(normalizedType)
      ? "password"
      : KNOWN_KINDS.has(normalizedType as FieldCapabilityKind) ? normalizedType as FieldCapabilityKind : "unknown")
    : (requirement.sensitive === true ? "password" : "text");

  if (kind !== "select") return { kind };

  const allowedValues = Array.isArray(requirement.allowedValues)
    ? requirement.allowedValues.map((value) => String(value))
    : [];
  return {
    kind,
    allowedValues,
    optionSource: allowedValues.length > 0 ? "contract" : "unknown",
  };
}
