import type { InputRequirement } from "../db/project-case-input-requirement-service";
import type { FieldCapability } from "./field-capability";

export type RuntimeInputValuePolicy =
  | "scenario_controlled"
  | "safe_synthetic"
  | "dataset_required"
  | "trusted_required"
  | "unresolved";

export type RuntimePolicyRequirement = InputRequirement & {
  fieldCapability?: FieldCapability;
  inputRole?: "scenario" | "supporting";
};

const SAFE_SUPPORTING_KINDS = new Set(["text", "number", "date", "email", "tel"]);

export function resolveRuntimeInputValuePolicy(
  requirement: RuntimePolicyRequirement,
): RuntimeInputValuePolicy {
  if (requirement.sensitive === true || requirement.fieldCapability?.kind === "password") {
    return "trusted_required";
  }
  if (requirement.inputRole === "scenario") return "scenario_controlled";
  if (requirement.inputRole !== "supporting") return "unresolved";

  const capability = requirement.fieldCapability;
  if (!capability) return "unresolved";
  if (SAFE_SUPPORTING_KINDS.has(capability.kind)) return "safe_synthetic";
  if (capability.kind === "select" && (capability.allowedValues?.length ?? 0) > 0) {
    return "safe_synthetic";
  }
  return "unresolved";
}
