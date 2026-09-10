import { validateGenerationProfile, type GenerationFormat, type GenerationProfile } from "../testrail/generation-profile";

export type GenerationPool = {
  semanticType?: string;
  values: string[];
  selectionStrategy?: "seeded";
};

export type GenerationDictionary = GenerationPool;

export type PhoneProfile = {
  allowedPrefixes: string[];
  totalDigits: number;
  maskPattern?: string;
};

export type MoneyProfile = {
  integerOnly?: boolean;
  decimalScale?: number;
  min?: number;
  max?: number;
  step?: number;
};

export type ProjectGenerationConfig = {
  version: string;
  locale?: string;
  countryCode?: string;
  valueSets?: Record<string, ValueSet>;
  namedProfiles?: Record<string, GenerationProfile>;
  pools?: Record<string, GenerationPool>;
  dictionaries?: Record<string, GenerationDictionary>;
  phoneProfiles?: Record<string, PhoneProfile>;
  moneyProfiles?: Record<string, MoneyProfile>;
  namedGenerationProfiles?: Record<string, GenerationProfile>;
};

export type ValueSet = {
  values: string[];
  selectionStrategy?: "seeded";
  metadata?: { valueKind?: string; format?: GenerationFormat };
};

export type ProjectGenerationConfigError = {
  path: string;
  code: string;
  message: string;
};

export type ProjectGenerationConfigValidation = {
  valid: boolean;
  errors: ProjectGenerationConfigError[];
};

export type SemanticEnrichmentProjectConfig = {
  locale?: string;
  countryCode?: string;
  availableValueSetRefs?: string[];
  namedProfileRefs?: string[];
  availablePools?: string[];
  availableDictionaries?: string[];
  phoneProfiles?: string[];
  namedGenerationProfiles?: string[];
  namedGenerationProfilesVersion?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function addError(errors: ProjectGenerationConfigError[], path: string, code: string, message: string): void {
  errors.push({ path, code, message });
}

function validateEntries(
  section: unknown,
  path: string,
  errors: ProjectGenerationConfigError[],
  validateEntry: (entry: Record<string, unknown>, entryPath: string) => void,
): void {
  if (section === undefined) return;
  if (!isRecord(section)) {
    addError(errors, path, "object_required", "Configuration section must be an object");
    return;
  }
  for (const [ref, value] of Object.entries(section)) {
    const entryPath = `${path}.${ref}`;
    if (!ref.trim()) addError(errors, entryPath, "reference_empty", "Reference must not be empty");
    if (!isRecord(value)) {
      addError(errors, entryPath, "object_required", "Configuration entry must be an object");
      continue;
    }
    validateEntry(value, entryPath);
  }
}

function validateValueCollection(entry: Record<string, unknown>, path: string, errors: ProjectGenerationConfigError[]): void {
  if (typeof entry.semanticType !== "string" || !entry.semanticType.trim()) {
    addError(errors, `${path}.semanticType`, "semantic_type_required", "semanticType must be a non-empty string");
  }
  if (!Array.isArray(entry.values) || entry.values.length === 0 || entry.values.some((value) => typeof value !== "string" || !value.trim())) {
    addError(errors, `${path}.values`, "values_non_empty", "values must contain non-empty strings");
  }
  if (entry.selectionStrategy !== undefined && entry.selectionStrategy !== "seeded") {
    addError(errors, `${path}.selectionStrategy`, "selection_strategy_invalid", "Only seeded selection is supported");
  }
}

function validatePhone(entry: Record<string, unknown>, path: string, errors: ProjectGenerationConfigError[]): void {
  const prefixes = entry.allowedPrefixes;
  if (!Array.isArray(prefixes) || prefixes.length === 0 || prefixes.some((prefix) => typeof prefix !== "string" || !prefix.trim())) {
    addError(errors, `${path}.allowedPrefixes`, "prefixes_non_empty", "allowedPrefixes must contain non-empty strings");
  }
  if (typeof entry.totalDigits !== "number" || !Number.isInteger(entry.totalDigits) || entry.totalDigits <= 0) {
    addError(errors, `${path}.totalDigits`, "total_digits_invalid", "totalDigits must be a positive integer");
  } else if (Array.isArray(prefixes)) {
    prefixes.forEach((prefix, index) => {
      if (typeof prefix === "string" && prefix.length >= entry.totalDigits as number) {
        addError(errors, `${path}.allowedPrefixes.${index}`, "prefix_too_long", "totalDigits must exceed prefix length");
      }
    });
  }
  if (entry.maskPattern !== undefined && typeof entry.maskPattern !== "string") {
    addError(errors, `${path}.maskPattern`, "mask_pattern_invalid", "maskPattern must be a string");
  }
}

function validateMoney(entry: Record<string, unknown>, path: string, errors: ProjectGenerationConfigError[]): void {
  for (const key of ["decimalScale", "min", "max", "step"]) {
    if (entry[key] !== undefined && (typeof entry[key] !== "number" || !Number.isFinite(entry[key]))) {
      addError(errors, `${path}.${key}`, "number_invalid", `${key} must be a finite number`);
    }
  }
  if (typeof entry.min === "number" && typeof entry.max === "number" && entry.min > entry.max) {
    addError(errors, `${path}.min`, "range_invalid", "min must be less than or equal to max");
  }
  if (typeof entry.decimalScale === "number" && (!Number.isInteger(entry.decimalScale) || entry.decimalScale < 0)) {
    addError(errors, `${path}.decimalScale`, "decimal_scale_invalid", "decimalScale must be a non-negative integer");
  }
  if (typeof entry.step === "number" && entry.step <= 0) {
    addError(errors, `${path}.step`, "step_invalid", "step must be greater than zero");
  }
  if (entry.integerOnly === true && typeof entry.decimalScale === "number" && entry.decimalScale > 0) {
    addError(errors, `${path}.decimalScale`, "integer_decimal_incompatible", "integerOnly cannot use a positive decimalScale");
  }
}

function profileCapability(profile: GenerationProfile): { kind: "number" | "tel" | "email" | "date" | "text" } {
  if (profile.valueKind === "number") return { kind: "number" };
  if (profile.valueKind === "date") return { kind: "date" };
  if (profile.valueKind === "datetime") return { kind: "datetime" } as never;
  if (["money", "quantity", "percentage"].includes(profile.semanticType)) return { kind: "number" };
  if (profile.semanticType === "phone") return { kind: "tel" };
  if (profile.semanticType === "email") return { kind: "email" };
  if (profile.semanticType === "date") return { kind: "date" };
  return { kind: "text" };
}

export function validateProjectGenerationConfig(config: unknown): ProjectGenerationConfigValidation {
  const errors: ProjectGenerationConfigError[] = [];
  if (!isRecord(config)) return { valid: false, errors: [{ path: "config", code: "object_required", message: "Configuration must be an object" }] };
  if (config.version !== undefined && (typeof config.version !== "string" || !config.version.trim())) {
    addError(errors, "version", "version_invalid", "version must be a non-empty string");
  }
  if (config.locale !== undefined && (typeof config.locale !== "string" || !config.locale.trim())) addError(errors, "locale", "locale_invalid", "locale must be a non-empty string");
  if (config.countryCode !== undefined && (typeof config.countryCode !== "string" || !config.countryCode.trim())) addError(errors, "countryCode", "country_code_invalid", "countryCode must be a non-empty string");
  validateEntries(config.valueSets, "valueSets", errors, (entry, path) => {
    if (!Array.isArray(entry.values) || entry.values.length === 0 || entry.values.some((value) => typeof value !== "string" || !value.trim())) {
      addError(errors, `${path}.values`, "values_non_empty", "values must contain non-empty strings");
    }
    if (entry.selectionStrategy !== undefined && entry.selectionStrategy !== "seeded") addError(errors, `${path}.selectionStrategy`, "selection_strategy_invalid", "Only seeded selection is supported");
  });
  validateEntries(config.namedProfiles, "namedProfiles", errors, (entry, path) => {
    const profile = entry as GenerationProfile;
    const result = validateGenerationProfile({ fieldCapability: profileCapability(profile), generationProfile: profile });
    if (!result.valid) addError(errors, path, "generation_profile_invalid", result.reason ?? "Generation profile is invalid");
    if (profile.sourceMode === "configured_values" && !config.valueSets?.[profile.valueSetRef ?? ""]) {
      addError(errors, `${path}.valueSetRef`, "value_set_reference_not_configured", "valueSetRef must exist in valueSets");
    }
  });
  validateEntries(config.pools, "pools", errors, (entry, path) => validateValueCollection(entry, path, errors));
  validateEntries(config.dictionaries, "dictionaries", errors, (entry, path) => validateValueCollection(entry, path, errors));
  validateEntries(config.phoneProfiles, "phoneProfiles", errors, (entry, path) => validatePhone(entry, path, errors));
  validateEntries(config.moneyProfiles, "moneyProfiles", errors, (entry, path) => validateMoney(entry, path, errors));
  validateEntries(config.namedGenerationProfiles, "namedGenerationProfiles", errors, (entry, path) => {
    const result = validateGenerationProfile({ fieldCapability: profileCapability(entry as GenerationProfile), generationProfile: entry as GenerationProfile });
    if (!result.valid) addError(errors, path, "generation_profile_invalid", result.reason ?? "Generation profile is invalid");
  });
  return { valid: errors.length === 0, errors };
}

export function getGenerationPool(config: ProjectGenerationConfig, ref: string): GenerationPool | undefined { return config.pools?.[ref]; }
export function getGenerationDictionary(config: ProjectGenerationConfig, ref: string): GenerationDictionary | undefined { return config.dictionaries?.[ref]; }
export function getPhoneProfile(config: ProjectGenerationConfig, ref: string): PhoneProfile | undefined { return config.phoneProfiles?.[ref]; }
export function getMoneyProfile(config: ProjectGenerationConfig, ref: string): MoneyProfile | undefined { return config.moneyProfiles?.[ref]; }
export function getNamedGenerationProfile(config: ProjectGenerationConfig, ref: string): GenerationProfile | undefined { return config.namedGenerationProfiles?.[ref]; }

export function selectSeededValue(values: string[], seed: string | number): string | undefined {
  if (values.length === 0) return undefined;
  let hash = 2166136261;
  for (const character of String(seed)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return values[(hash >>> 0) % values.length];
}

export function normalizeLegacyGenerationConfig(config: ProjectGenerationConfig): ProjectGenerationConfig {
  const valueSets = { ...(config.valueSets ?? {}) };
  const pools = Object.fromEntries(Object.entries(config.pools ?? {}).map(([ref, pool]) => [ref, { ...pool, semanticType: pool.semanticType ?? "generic_text" }]));
  const dictionaries = Object.fromEntries(Object.entries(config.dictionaries ?? {}).map(([ref, dictionary]) => [ref, { ...dictionary, semanticType: dictionary.semanticType ?? "generic_text" }]));
  for (const [ref, pool] of Object.entries(pools)) valueSets[ref] ??= { values: pool.values, selectionStrategy: pool.selectionStrategy, metadata: { valueKind: "string" } };
  for (const [ref, dictionary] of Object.entries(dictionaries)) valueSets[ref] ??= { values: dictionary.values, selectionStrategy: dictionary.selectionStrategy, metadata: { valueKind: "string" } };
  const sourceProfiles = config.namedProfiles ?? config.namedGenerationProfiles ?? {};
  const namedProfiles = Object.fromEntries(Object.entries(sourceProfiles).map(([ref, profile]) => [ref, normalizeLegacyGenerationProfile(profile)]));
  return { ...config, pools, dictionaries, valueSets, namedProfiles };
}

function normalizeLegacyGenerationProfile(profile: GenerationProfile): GenerationProfile {
  if (profile.valueKind || profile.sourceMode) return profile;
  const valueKind: GenerationProfile["valueKind"] = profile.semanticType === "money" || profile.semanticType === "quantity" || profile.semanticType === "percentage" ? "number"
    : profile.semanticType === "phone" ? "string"
      : profile.semanticType === "date" ? "date"
        : profile.semanticType === "datetime" ? "datetime"
          : "string";
  const sourceMode: GenerationProfile["sourceMode"] = profile.generationMode === "configured_pool" || profile.generationMode === "configured_dictionary" ? "configured_values" : profile.generationMode === "manual" ? "manual" : "synthetic";
  return {
    valueKind,
    sourceMode,
    valueSetRef: profile.poolRef ?? profile.dictionaryRef,
    constraints: profile.numeric ? { ...profile.numeric } : profile.format?.pattern ? { pattern: profile.format.pattern } : undefined,
    format: profile.phone ? { allowedPrefixes: profile.phone.allowedPrefixes, totalLength: profile.phone.totalDigits, mask: profile.phone.maskPattern } : profile.format ? { mask: profile.format.mask } : undefined,
    semanticHint: profile.semanticType,
  };
}

export function toCanonicalProjectGenerationConfig(config: ProjectGenerationConfig): ProjectGenerationConfig {
  const normalized = normalizeLegacyGenerationConfig(config);
  return {
    version: normalized.version,
    ...(normalized.locale ? { locale: normalized.locale } : {}),
    ...(normalized.countryCode ? { countryCode: normalized.countryCode } : {}),
    valueSets: normalized.valueSets,
    namedProfiles: normalized.namedProfiles,
  };
}

export function toSemanticEnrichmentConfig(config: ProjectGenerationConfig): SemanticEnrichmentProjectConfig {
  const normalized = normalizeLegacyGenerationConfig(config);
  return {
    ...(normalized.locale ? { locale: normalized.locale } : {}),
    ...(normalized.countryCode ? { countryCode: normalized.countryCode } : {}),
    availableValueSetRefs: Object.keys(normalized.valueSets ?? {}),
    namedProfileRefs: Object.keys(normalized.namedProfiles ?? {}),
    availablePools: Object.keys(normalized.pools ?? {}),
    availableDictionaries: Object.keys(normalized.dictionaries ?? {}),
    phoneProfiles: Object.keys(normalized.phoneProfiles ?? {}),
    namedGenerationProfiles: Object.keys(normalized.namedGenerationProfiles ?? {}),
    namedGenerationProfilesVersion: normalized.version,
  };
}
