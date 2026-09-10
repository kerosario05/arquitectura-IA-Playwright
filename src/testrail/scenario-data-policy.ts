import type { InputIntent } from "../types/execution-plan.types";
import type { InputRequirement } from "../db/project-case-input-requirement-service";
import type { FieldCapability } from "./field-capability";

export type ScenarioDataPolicy =
  | "explicit_value"
  | "synthetic_allowed"
  | "configured_value_allowed"
  | "trusted_required"
  | "manual_required"
  | "unresolved";

export type ScenarioDataPolicyRequirement = InputRequirement & {
  fieldCapability?: FieldCapability;
  inputRole?: "scenario" | "supporting";
  inputIntent?: InputIntent;
  explicitValue?: unknown;
  semanticType?: string;
  generationConstraints?: Record<string, unknown>;
  source?: "contract" | "runtime_inferred";
};

function hasValidConstraints(capability: FieldCapability): boolean {
  const constraints = capability.constraints;
  if (!constraints) return true;
  if (constraints.min !== undefined && constraints.max !== undefined && constraints.min > constraints.max) return false;
  if (constraints.minLength !== undefined && constraints.maxLength !== undefined && constraints.minLength > constraints.maxLength) return false;
  return true;
}

export function resolveScenarioDataPolicy(
  requirement: ScenarioDataPolicyRequirement,
): ScenarioDataPolicy {
  const capability = requirement.fieldCapability;
  if (requirement.sensitive === true || capability?.kind === "password") return "trusted_required";

  const intent = requirement.inputIntent;
  if (intent && intent.mode !== "set_value") return "explicit_value";
  if (intent?.mode === "set_value" && requirement.explicitValue !== undefined) return "explicit_value";
  if (requirement.inputRole !== "scenario") return "unresolved";
  if (!capability || !hasValidConstraints(capability)) return "unresolved";

  if (["email", "tel", "number", "date", "datetime"].includes(capability.kind)) {
    return "synthetic_allowed";
  }
  if (["text", "select", "radio", "file"].includes(capability.kind)) return "manual_required";
  return "unresolved";
}
