import type { FieldCapability } from "../testrail/field-capability";
import { generateSemanticSyntheticValue, generateSyntheticValueFromCapability, inferSyntheticSemanticType, type SyntheticValueResult } from "./synthetic-value-resolver";

export type ScenarioSyntheticRequirement = {
  key: string;
  inputRole?: "scenario" | "supporting";
  valuePolicy?: "scenario_controlled" | "safe_synthetic" | "trusted_required" | "unresolved";
  scenarioDataPolicy?: "explicit_value" | "synthetic_allowed" | "trusted_required" | "manual_required" | "unresolved";
  sensitive?: boolean;
  fieldCapability?: FieldCapability;
  label?: string;
  semanticType?: string;
  locale?: string;
  countryCode?: string;
  datasetIdentity?: string;
  relatedValues?: Record<string, string | number | boolean>;
  allowManualSynthetic?: boolean;
};

export function resolveScenarioSyntheticValue(input: {
  requirement: ScenarioSyntheticRequirement;
  seed: string | number;
}): SyntheticValueResult {
  const requirement = input.requirement;
  if (requirement.inputRole !== "scenario") return { status: "unresolved", reason: "input_role_not_scenario" };
  if (requirement.valuePolicy !== "scenario_controlled") return { status: "unresolved", reason: "value_policy_not_scenario_controlled" };
  if (requirement.scenarioDataPolicy !== "synthetic_allowed"
    && !(requirement.scenarioDataPolicy === "manual_required" && requirement.allowManualSynthetic === true)) {
    return { status: "unresolved", reason: "scenario_data_policy_not_allowed" };
  }
  if (requirement.sensitive === true || requirement.fieldCapability?.kind === "password") {
    return { status: "unresolved", reason: "sensitive_requirement" };
  }

  const capability = requirement.fieldCapability;
  if (!capability) return { status: "unresolved", reason: "missing_field_capability" };

  // Prefer the semantic registry for every non-sensitive scenario input. It
  // returns unresolved for genuinely unknown text, allowing the grouped AI
  // fallback to decide without making the generator app-specific.
  const semantic = requirement.semanticType ?? inferSyntheticSemanticType(requirement);
  const semanticResult = generateSemanticSyntheticValue({
    requirement: { ...requirement, semanticType: semantic },
    seed: input.seed,
  });
  if (semanticResult.status === "generated") return semanticResult;

  if (!["email", "tel", "number", "date", "datetime"].includes(capability.kind)) {
    return { status: "unresolved", reason: semanticResult.reason ?? "semantic_type_unknown" };
  }
  return generateSyntheticValueFromCapability({ key: requirement.key, fieldCapability: capability, seed: input.seed });
}
