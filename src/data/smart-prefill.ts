import { generateSemanticSyntheticValue, inferSyntheticSemanticType, type SemanticSyntheticRequirement } from "./synthetic-value-resolver";
import type { FieldCapability } from "../testrail/field-capability";

export type SmartPrefillSource =
  | "user_entered" | "selection_runtime" | "confirmed_replay" | "qa_dataset"
  | "project_config" | "configured_values" | "deterministic_synthetic" | "ai_synthetic" | "missing";

export type SmartPrefillRequirement = {
  key: string;
  label?: string;
  canonicalLabel?: string;
  semanticLabel?: string;
  targetLabel?: string;
  semanticType?: string;
  sensitive?: boolean;
  required?: boolean;
  fieldCapability?: FieldCapability;
  datasetIdentity?: string;
  inputUsage?: string[];
  inputRole?: "scenario" | "supporting";
  valuePolicy?: string;
  scenarioDataPolicy?: string;
};

export type SmartPrefillValue = {
  value: string | number | boolean;
  source: Exclude<SmartPrefillSource, "missing" | "deterministic_synthetic" | "ai_synthetic">;
  verified: boolean;
};

export type SmartPrefillField = {
  key: string;
  displayLabel: string;
  labelSource: "declared" | "canonical" | "semantic" | "target" | "humanized" | "ai";
  semanticType: string;
  value?: string | number | boolean;
  source: SmartPrefillSource;
  generated: boolean;
  verified: boolean;
  sensitive: boolean;
  editable: true;
  confidence?: number;
  datasetIdentity?: string;
};

export type SmartPrefillAiField = {
  key: string;
  semanticType: string;
  displayLabel: string;
  generatedValue: string | number | boolean;
  confidence: number;
};

export type SmartPrefillAiInputField = {
  key: string;
  humanLabel: string;
  semanticType: string;
  type: string;
  semanticHints: string[];
};

export type SmartPrefillResult = {
  fields: SmartPrefillField[];
  aiCalls: number;
  sensitiveKeysSentToAi: string[];
};

export type SmartPrefillDeterministicResult = {
  value?: string | number | boolean;
  source?: "project_config" | "configured_values" | "deterministic_synthetic";
  blocked?: boolean;
};

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function humanizeKey(key: string): string {
  return (key.split(".").at(-1) ?? key)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

export function resolveDisplayLabel(requirement: SmartPrefillRequirement): { label: string; source: SmartPrefillField["labelSource"] } {
  const candidates: Array<[string | undefined, SmartPrefillField["labelSource"]]> = [
    [requirement.label, "declared"],
    [requirement.canonicalLabel, "canonical"],
    [requirement.semanticLabel, "semantic"],
    [requirement.targetLabel, "target"],
  ];
  const found = candidates.find(([label]) => typeof label === "string" && label.trim());
  return found ? { label: found[0]!.trim(), source: found[1] } : { label: humanizeKey(requirement.key), source: "humanized" };
}

function isSecret(requirement: SmartPrefillRequirement): boolean {
  const key = normalizeKey(requirement.key);
  return requirement.sensitive === true || requirement.fieldCapability?.kind === "password"
    || /(^|[._-])(password|pass|token|otp|secret|pin)([._-]|$)/.test(key);
}

function asKnownValue(value: unknown): string | number | boolean | undefined {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : undefined;
}

function lookup(values: Record<string, SmartPrefillValue | string | number | boolean> | undefined, key: string, fallbackSource: SmartPrefillValue["source"]): SmartPrefillValue | undefined {
  if (!values) return undefined;
  const target = normalizeKey(key);
  const entry = Object.entries(values).find(([candidate]) => normalizeKey(candidate) === target)?.[1];
  const value = typeof entry === "object" && entry !== null && "value" in entry ? asKnownValue(entry.value) : asKnownValue(entry);
  if (value === undefined || (typeof value === "string" && !value.trim())) return undefined;
  if (typeof entry === "object" && entry !== null && "value" in entry) {
    const source = entry.source;
    if (["user_entered", "selection_runtime", "confirmed_replay", "qa_dataset", "project_config"].includes(source)) {
      return { value, source: source as SmartPrefillValue["source"], verified: entry.verified === true };
    }
  }
  return { value, source: fallbackSource, verified: false };
}

function groupIdentity(requirement: SmartPrefillRequirement): string {
  if (requirement.datasetIdentity?.trim()) return requirement.datasetIdentity.trim();
  const segments = requirement.key.split(".");
  const scope = segments.find((segment) => /(?:[_-]\d+|\[\d+\])$/.test(segment));
  return scope ?? "general";
}

function semanticInput(requirement: SmartPrefillRequirement, label: string, locale?: string): SemanticSyntheticRequirement {
  return {
    key: requirement.key,
    label,
    semanticType: requirement.semanticType,
    sensitive: requirement.sensitive,
    fieldCapability: requirement.fieldCapability,
    datasetIdentity: groupIdentity(requirement),
    locale,
  };
}

function buildField(requirement: SmartPrefillRequirement, value?: SmartPrefillValue, overrides: Partial<SmartPrefillField> = {}): SmartPrefillField {
  const label = resolveDisplayLabel(requirement);
  const semanticType = requirement.semanticType ?? inferSyntheticSemanticType({ key: requirement.key, label: label.label, fieldCapability: requirement.fieldCapability });
  return {
    key: requirement.key,
    displayLabel: label.label,
    labelSource: label.source,
    semanticType,
    ...(value ? { value: value.value } : {}),
    source: value?.source ?? "missing",
    generated: false,
    verified: value?.verified === true,
    sensitive: isSecret(requirement),
    editable: true,
    datasetIdentity: groupIdentity(requirement),
    ...overrides,
  };
}

export function validateSmartPrefillAiResponse(value: unknown, allowedKeys: ReadonlySet<string>): { valid: true; fields: SmartPrefillAiField[] } | { valid: false; reason: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { valid: false, reason: "object_required" };
  const root = value as Record<string, unknown>;
  if (!Array.isArray(root.fields) || Object.keys(root).some((key) => key !== "fields")) return { valid: false, reason: "strict_root_schema" };
  const fields: SmartPrefillAiField[] = [];
  for (const item of root.fields) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { valid: false, reason: "field_object_required" };
    const field = item as Record<string, unknown>;
    const expected = ["key", "semanticType", "displayLabel", "generatedValue", "confidence"];
    if (Object.keys(field).some((key) => !expected.includes(key)) || expected.some((key) => !(key in field))) return { valid: false, reason: "strict_field_schema" };
    if (typeof field.key !== "string" || !allowedKeys.has(normalizeKey(field.key))) return { valid: false, reason: "unknown_or_mutated_key" };
    if (typeof field.semanticType !== "string" || typeof field.displayLabel !== "string") return { valid: false, reason: "field_metadata_invalid" };
    if (asKnownValue(field.generatedValue) === undefined || typeof field.confidence !== "number" || field.confidence < 0 || field.confidence > 1) return { valid: false, reason: "field_value_invalid" };
    fields.push({ key: field.key, semanticType: field.semanticType, displayLabel: field.displayLabel, generatedValue: field.generatedValue as string | number | boolean, confidence: field.confidence });
  }
  return { valid: true, fields };
}

export async function resolveSmartPrefill(input: {
  requirements: SmartPrefillRequirement[];
  currentUserValues?: Record<string, SmartPrefillValue | string | number | boolean>;
  selectionRuntimeValues?: Record<string, SmartPrefillValue | string | number | boolean>;
  confirmedReplayValues?: Record<string, SmartPrefillValue | string | number | boolean>;
  qaDatasetValues?: Record<string, SmartPrefillValue | string | number | boolean>;
  projectConfigValues?: Record<string, SmartPrefillValue | string | number | boolean>;
  seed: string | number;
  aiFallback?: (input: { datasetIdentity: string; locale?: string; fields: SmartPrefillAiInputField[] }) => Promise<unknown>;
  deterministicResolver?: (input: {
    requirement: SmartPrefillRequirement;
    displayLabel: string;
    datasetIdentity: string;
    relatedValues: Record<string, string | number | boolean>;
  }) => SmartPrefillDeterministicResult | undefined | Promise<SmartPrefillDeterministicResult | undefined>;
  locale?: string;
}): Promise<SmartPrefillResult> {
  const result: SmartPrefillField[] = [];
  const generatedByDataset = new Map<string, Record<string, string | number | boolean>>();
  const unresolvedByGroup = new Map<string, SmartPrefillRequirement[]>();
  const sourceMaps = [input.currentUserValues, input.selectionRuntimeValues, input.confirmedReplayValues, input.qaDatasetValues, input.projectConfigValues];
  for (const requirement of input.requirements) {
    const secret = isSecret(requirement);
    let known: SmartPrefillValue | undefined;
    for (const [index, sourceMap] of sourceMaps.entries()) {
      if (secret && index === 2) continue; // confirmed replay never carries secrets
      const fallbackSource: SmartPrefillValue["source"] = ["user_entered", "selection_runtime", "confirmed_replay", "qa_dataset", "project_config"][index] as SmartPrefillValue["source"];
      known = lookup(sourceMap, requirement.key, fallbackSource);
      if (known) break;
    }
    if (known) {
      result.push(buildField(requirement, known));
      continue;
    }
    if (secret) {
      result.push(buildField(requirement));
      continue;
    }
    if (requirement.inputRole === "supporting") {
      result.push(buildField(requirement));
      continue;
    }
    const label = resolveDisplayLabel(requirement).label;
    const dataset = groupIdentity(requirement);
    const relatedValues = generatedByDataset.get(dataset) ?? {};
    const customDeterministic = input.deterministicResolver
      ? await input.deterministicResolver({ requirement, displayLabel: label, datasetIdentity: dataset, relatedValues })
      : undefined;
    const deterministic = customDeterministic === undefined
      ? generateSemanticSyntheticValue({ requirement: { ...semanticInput(requirement, label, input.locale), relatedValues }, seed: input.seed })
      : undefined;
    const deterministicValue = customDeterministic?.value ?? deterministic?.value;
    const deterministicSource = customDeterministic?.source ?? "deterministic_synthetic";
    if (customDeterministic?.blocked) {
      result.push(buildField(requirement));
      continue;
    }
    if (deterministicValue !== undefined) {
      result.push(buildField(requirement, undefined, { value: deterministicValue, source: deterministicSource, generated: true, verified: false }));
      const datasetValues = generatedByDataset.get(dataset) ?? {};
      datasetValues[requirement.key] = deterministicValue;
      generatedByDataset.set(dataset, datasetValues);
      continue;
    }
    const group = groupIdentity(requirement);
    unresolvedByGroup.set(group, [...(unresolvedByGroup.get(group) ?? []), requirement]);
  }

  let aiCalls = 0;
  const sensitiveKeysSentToAi: string[] = [];
  for (const [datasetIdentity, requirements] of unresolvedByGroup) {
    if (!input.aiFallback) {
      result.push(...requirements.map((requirement) => buildField(requirement)));
      continue;
    }
    aiCalls += 1;
    const allowedKeys = new Set(requirements.map((requirement) => normalizeKey(requirement.key)));
    const response = await input.aiFallback({
      datasetIdentity,
      locale: input.locale,
      fields: requirements.map((requirement) => {
        const label = resolveDisplayLabel(requirement).label;
        return { key: requirement.key, humanLabel: label, semanticType: requirement.semanticType ?? inferSyntheticSemanticType({ key: requirement.key, label, fieldCapability: requirement.fieldCapability }), type: requirement.fieldCapability?.kind ?? "unknown", semanticHints: [label, requirement.key] };
      }),
    });
    const validated = validateSmartPrefillAiResponse(response, allowedKeys);
    if (!validated.valid) {
      result.push(...requirements.map((requirement) => buildField(requirement)));
      continue;
    }
    const returned = new Map(validated.fields.map((field) => [normalizeKey(field.key), field]));
    for (const requirement of requirements) {
      const field = returned.get(normalizeKey(requirement.key));
      if (!field) { result.push(buildField(requirement)); continue; }
      result.push(buildField(requirement, undefined, { displayLabel: field.displayLabel, labelSource: "ai", semanticType: field.semanticType, value: field.generatedValue, source: "ai_synthetic", generated: true, verified: false, confidence: field.confidence }));
    }
  }
  return { fields: result, aiCalls, sensitiveKeysSentToAi };
}
