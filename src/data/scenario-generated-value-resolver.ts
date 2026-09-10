import type { GenerationProfile } from "../testrail/generation-profile";
import { validateGenerationProfile } from "../testrail/generation-profile";
import type { ProjectGenerationConfig } from "./project-generation-config";
import { getGenerationPool, selectSeededValue, normalizeLegacyGenerationConfig } from "./project-generation-config";
import { generateSyntheticValueFromCapability } from "./synthetic-value-resolver";

export type ScenarioGeneratedValueResult = {
  status: "resolved" | "unresolved" | "blocked";
  value?: string | number | boolean;
  source?: "synthetic" | "configured_values";
  reason?: string;
};

type Requirement = {
  key: string;
  inputRole?: "scenario" | "supporting";
  valuePolicy?: string;
  scenarioDataPolicy?: string;
  sensitive?: boolean;
  inputIntent?: { mode?: string };
  fieldCapability?: { kind: string; allowedValues?: string[] };
};

function hash(seed: string | number, key: string): number {
  let result = 2166136261;
  for (const character of `${String(seed)}|${key}`) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  return result >>> 0;
}

function blocked(requirement: Requirement): boolean {
  return requirement.inputRole !== "scenario"
    || requirement.valuePolicy !== "scenario_controlled"
    || requirement.sensitive === true
    || requirement.fieldCapability?.kind === "password"
    || requirement.scenarioDataPolicy === "trusted_required"
    || (requirement.inputIntent !== undefined && requirement.inputIntent.mode !== "set_value");
}

function resolveNumber(profile: GenerationProfile, seed: number): ScenarioGeneratedValueResult {
  const constraints = profile.constraints ?? {};
  const min = constraints.min ?? 0;
  const max = constraints.max ?? (min + 999);
  const scale = constraints.decimalScale ?? (constraints.integerOnly ? 0 : 2);
  const step = constraints.step ?? (constraints.integerOnly ? 1 : 10 ** -scale);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max || step <= 0) return { status: "unresolved", reason: "invalid_number_constraints" };
  const count = Math.floor((max - min) / step);
  const value = min + Math.min(seed % (count + 1), count) * step;
  const rounded = Number(value.toFixed(scale));
  return { status: "resolved", value: constraints.integerOnly ? Math.trunc(rounded) : rounded, source: "synthetic" };
}

function resolveString(profile: GenerationProfile, seed: number): ScenarioGeneratedValueResult {
  const constraints = profile.constraints ?? {};
  if (constraints.pattern !== undefined) return { status: "unresolved", reason: "pattern_not_safely_satisfied" };
  const format = profile.format ?? {};
  const totalLength = format.totalLength;
  const minLength = constraints.minLength ?? (totalLength ?? 8);
  const maxLength = constraints.maxLength ?? (totalLength ?? Math.max(minLength, 24));
  if (minLength < 0 || maxLength < minLength || (totalLength !== undefined && totalLength < 1)) return { status: "unresolved", reason: "invalid_string_constraints" };
  const length = totalLength ?? minLength + (seed % (maxLength - minLength + 1));
  const prefix = format.allowedPrefixes?.length ? format.allowedPrefixes[seed % format.allowedPrefixes.length] : "";
  if (prefix.length >= length) return { status: "unresolved", reason: "prefix_too_long" };
  const alphabet = format.characterSet === "digits"
    ? "0123456789"
    : format.characterSet === "letters"
      ? "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
      : "abcdefghijklmnopqrstuvwxyz0123456789";
  let value = prefix;
  for (let index = value.length; index < length; index += 1) value += alphabet[(seed + index * 31) % alphabet.length];
  if (format.mask !== undefined) {
    let cursor = 0;
    value = format.mask.split("").map((character) => {
      if (character === "#" || character === "A" || character === "*") return value[cursor++] ?? "";
      return character;
    }).join("");
  }
  return { status: "resolved", value, source: "synthetic" };
}

export function resolveScenarioGeneratedValue(input: {
  requirement: Requirement;
  generationProfile: GenerationProfile;
  projectGenerationConfig: ProjectGenerationConfig;
  seed: string | number;
}): ScenarioGeneratedValueResult {
  const { requirement, generationProfile: profile } = input;
  if (blocked(requirement)) return { status: "blocked", reason: "generation_not_authorized" };
  if (requirement.scenarioDataPolicy !== "configured_value_allowed" && requirement.scenarioDataPolicy !== "synthetic_allowed") return { status: "blocked", reason: "scenario_data_policy_not_allowed" };
  if (!validateGenerationProfile({ fieldCapability: requirement.fieldCapability as never, generationProfile: profile }).valid) return { status: "unresolved", reason: "generation_profile_invalid" };
  const config = normalizeLegacyGenerationConfig(input.projectGenerationConfig);
  const seed = hash(input.seed, requirement.key);
  if (profile.sourceMode === "manual") return { status: "blocked", reason: "manual_generation" };
  if (profile.sourceMode === "configured_values") {
    if (requirement.scenarioDataPolicy !== "configured_value_allowed") return { status: "blocked", reason: "configured_values_not_authorized" };
    const set = config.valueSets?.[profile.valueSetRef ?? ""] ?? getGenerationPool(config, profile.valueSetRef ?? "");
    const value = set?.values ? selectSeededValue(set.values, seed) : undefined;
    return value === undefined ? { status: "unresolved", reason: "value_set_not_found_or_empty" } : { status: "resolved", value, source: "configured_values" };
  }
  if (profile.valueKind === "number") return resolveNumber(profile, seed);
  if (profile.valueKind === "string") {
    if (requirement.fieldCapability?.kind === "email") {
      return { status: "resolved", value: `synthetic${seed.toString(36)}@example.test`, source: "synthetic" };
    }
    return resolveString(profile, seed);
  }
  const capabilityKind = profile.valueKind === "date" || profile.valueKind === "datetime" ? profile.valueKind : requirement.fieldCapability?.kind;
  if (capabilityKind === "date" || capabilityKind === "datetime") {
    const result = generateSyntheticValueFromCapability({ key: requirement.key, fieldCapability: { kind: capabilityKind } as never, seed });
    return result.status === "generated" ? { status: "resolved", value: result.value, source: "synthetic" } : { status: "unresolved", reason: result.reason };
  }
  if (profile.valueKind === "boolean") return { status: "resolved", value: seed % 2 === 0, source: "synthetic" };
  return { status: "unresolved", reason: "value_kind_not_supported" };
}
