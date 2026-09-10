import type { FieldCapability } from "./field-capability";

export type GenerationSemanticType =
  | "money" | "phone" | "email" | "document_identifier" | "job_title"
  | "person_name" | "quantity" | "percentage" | "date" | "datetime"
  | "generic_text" | "unknown";

export type GenerationMode = "synthetic" | "configured_pool" | "configured_dictionary" | "manual";

export type GenerationValueKind = "string" | "number" | "boolean" | "date" | "datetime";
export type GenerationSourceMode = "synthetic" | "configured_values" | "manual";

export type GenerationConstraints = {
  min?: number;
  max?: number;
  step?: number;
  integerOnly?: boolean;
  decimalScale?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};

export type GenerationFormat = {
  mask?: string;
  /** @deprecated Use format.mask. */
  pattern?: string;
  allowedPrefixes?: string[];
  totalLength?: number;
  characterSet?: "digits" | "letters" | "alphanumeric";
};

export type GenerationProfile = {
  valueKind?: GenerationValueKind;
  sourceMode?: GenerationSourceMode;
  valueSetRef?: string;
  constraints?: GenerationConstraints;
  format?: GenerationFormat;
  semanticHint?: string;
  /** @deprecated Use valueKind/sourceMode/valueSetRef/constraints/format. */
  semanticType?: GenerationSemanticType;
  /** @deprecated Use sourceMode. */
  generationMode?: GenerationMode;
  numeric?: {
    integerOnly?: boolean;
    decimalScale?: number;
    min?: number;
    max?: number;
    step?: number;
  };
  phone?: {
    allowedPrefixes?: string[];
    totalDigits?: number;
    maskPattern?: string;
  };
  poolRef?: string;
  dictionaryRef?: string;
};

export function validateGenerationProfile(input: {
  fieldCapability: FieldCapability;
  generationProfile: GenerationProfile;
}): { valid: boolean; reason?: string } {
  const { fieldCapability, generationProfile } = input;
  if (generationProfile.valueKind !== undefined || generationProfile.sourceMode !== undefined) {
    return validateTechnicalProfile(generationProfile);
  }
  const numeric = generationProfile.numeric;
  if (generationProfile.generationMode === "configured_pool" && !generationProfile.poolRef?.trim()) {
    return { valid: false, reason: "pool_reference_required" };
  }
  if (generationProfile.generationMode === "configured_dictionary" && !generationProfile.dictionaryRef?.trim()) {
    return { valid: false, reason: "dictionary_reference_required" };
  }
  if (numeric?.min !== undefined && numeric?.max !== undefined && numeric.min > numeric.max) {
    return { valid: false, reason: "numeric_range_invalid" };
  }
  if (numeric?.decimalScale !== undefined && (!Number.isInteger(numeric.decimalScale) || numeric.decimalScale < 0)) {
    return { valid: false, reason: "decimal_scale_invalid" };
  }
  if (generationProfile.phone?.allowedPrefixes !== undefined && generationProfile.phone.allowedPrefixes.length === 0) {
    return { valid: false, reason: "phone_prefixes_empty" };
  }

  const compatible = (() => {
    switch (generationProfile.semanticType) {
      case "money":
      case "quantity":
      case "percentage":
        return fieldCapability.kind === "number";
      case "phone":
        return fieldCapability.kind === "tel" || fieldCapability.kind === "text";
      case "email":
        return fieldCapability.kind === "email";
      case "document_identifier":
      case "job_title":
      case "person_name":
      case "generic_text":
        return fieldCapability.kind === "text";
      case "date":
        return fieldCapability.kind === "date";
      case "datetime":
        return fieldCapability.kind === "datetime";
      case "unknown":
        return false;
      default:
        return false;
    }
  })();
  return compatible ? { valid: true } : { valid: false, reason: "semantic_type_incompatible" };
}

function validateTechnicalProfile(profile: GenerationProfile): { valid: boolean; reason?: string } {
  if (!profile.valueKind || !profile.sourceMode) return { valid: false, reason: "technical_traits_required" };
  if (profile.sourceMode === "configured_values" && !profile.valueSetRef?.trim()) return { valid: false, reason: "value_set_reference_required" };
  const constraints = profile.constraints;
  if (profile.format?.characterSet !== undefined && !["digits", "letters", "alphanumeric"].includes(profile.format.characterSet)) return { valid: false, reason: "character_set_invalid" };
  if (constraints?.min !== undefined && constraints?.max !== undefined && constraints.min > constraints.max) return { valid: false, reason: "numeric_range_invalid" };
  if (constraints?.step !== undefined && (!Number.isFinite(constraints.step) || constraints.step <= 0)) return { valid: false, reason: "step_invalid" };
  if (constraints?.decimalScale !== undefined && (!Number.isInteger(constraints.decimalScale) || constraints.decimalScale < 0)) return { valid: false, reason: "decimal_scale_invalid" };
  if (constraints?.integerOnly === true && (constraints.decimalScale ?? 0) > 0) return { valid: false, reason: "integer_decimal_incompatible" };
  if (profile.valueKind === "number" && constraints?.minLength !== undefined) return { valid: false, reason: "length_constraints_not_for_number" };
  if (profile.valueKind === "string") {
    if (constraints?.minLength !== undefined && constraints?.maxLength !== undefined && constraints.minLength > constraints.maxLength) return { valid: false, reason: "length_range_invalid" };
    if (profile.format?.totalLength !== undefined && (!Number.isInteger(profile.format.totalLength) || profile.format.totalLength <= 0)) return { valid: false, reason: "total_length_invalid" };
    if (profile.format?.allowedPrefixes !== undefined && (profile.format.allowedPrefixes.length === 0 || profile.format.allowedPrefixes.some((prefix) => !prefix.trim()))) return { valid: false, reason: "prefixes_invalid" };
    if (profile.format?.totalLength !== undefined && profile.format.allowedPrefixes?.some((prefix) => prefix.length >= profile.format!.totalLength!)) return { valid: false, reason: "prefix_too_long" };
  }
  return { valid: true };
}
