import assert from "node:assert/strict";
import test from "node:test";
import {
  getGenerationDictionary,
  getGenerationPool,
  getMoneyProfile,
  getNamedGenerationProfile,
  getPhoneProfile,
  normalizeLegacyGenerationConfig,
  selectSeededValue,
  toSemanticEnrichmentConfig,
  validateProjectGenerationConfig,
  type ProjectGenerationConfig,
} from "./project-generation-config";

const profile = { semanticType: "person_name" as const, generationMode: "synthetic" as const };

test("validates project generation configuration and keeps lookups exact", () => {
  const config: ProjectGenerationConfig = {
    version: "1",
    pools: { names: { semanticType: "person_name", values: ["fixture"] } },
    dictionaries: { jobs: { semanticType: "job_title", values: ["fixture"] } },
    phoneProfiles: { mobile: { allowedPrefixes: ["prefix"], totalDigits: 10 } },
    moneyProfiles: { salary: { min: 1, max: 10, step: 1 } },
    namedGenerationProfiles: { name: profile },
  };
  assert.equal(validateProjectGenerationConfig({}).valid, true);
  assert.equal(validateProjectGenerationConfig(config).valid, true);
  assert.deepEqual(getGenerationPool(config, "names"), config.pools?.names);
  assert.deepEqual(getGenerationDictionary(config, "jobs"), config.dictionaries?.jobs);
  assert.deepEqual(getPhoneProfile(config, "mobile"), config.phoneProfiles?.mobile);
  assert.deepEqual(getMoneyProfile(config, "salary"), config.moneyProfiles?.salary);
  assert.deepEqual(getNamedGenerationProfile(config, "name"), profile);
  assert.equal(getGenerationPool(config, "missing"), undefined);
  assert.equal(getGenerationPool(config, "name"), undefined);
});

test("rejects invalid pools, dictionaries, phones, money and named profiles", () => {
  const invalid: ProjectGenerationConfig = {
    version: "1",
    pools: { empty: { semanticType: "generic_text", values: [] } },
    dictionaries: { empty: { semanticType: "generic_text", values: [] } },
    phoneProfiles: { bad: { allowedPrefixes: [], totalDigits: 2 } },
    moneyProfiles: {
      badRange: { min: 2, max: 1 },
      badScale: { decimalScale: -1 },
      badStep: { step: 0 },
      incompatible: { integerOnly: true, decimalScale: 2 },
    },
    namedGenerationProfiles: {
      bad: { semanticType: "document_identifier", generationMode: "configured_pool" },
    },
  };
  const result = validateProjectGenerationConfig(invalid);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.path === "pools.empty.values"));
  assert.ok(result.errors.some((error) => error.path === "dictionaries.empty.values"));
  assert.ok(result.errors.some((error) => error.path === "phoneProfiles.bad.allowedPrefixes"));
  assert.ok(result.errors.some((error) => error.path === "moneyProfiles.badRange.min"));
  assert.ok(result.errors.some((error) => error.path === "moneyProfiles.badScale.decimalScale"));
  assert.ok(result.errors.some((error) => error.path === "moneyProfiles.badStep.step"));
  assert.ok(result.errors.some((error) => error.path === "moneyProfiles.incompatible.decimalScale"));
  assert.ok(result.errors.some((error) => error.path === "namedGenerationProfiles.bad"));
});

test("selects deterministically and hides configured values from semantic view", () => {
  const config: ProjectGenerationConfig = {
    version: "2",
    pools: { secret: { semanticType: "generic_text", values: ["POOL_VALUE_HIDDEN", "POOL_VALUE_OTHER"] } },
    dictionaries: { secret: { semanticType: "generic_text", values: ["DICTIONARY_VALUE_HIDDEN"] } },
    phoneProfiles: { phone: { allowedPrefixes: ["p"], totalDigits: 4 } },
    namedGenerationProfiles: { reusable: profile },
  };
  assert.equal(selectSeededValue([], "seed"), undefined);
  assert.equal(selectSeededValue(["POOL_VALUE_HIDDEN", "POOL_VALUE_OTHER"], "seed"), selectSeededValue(["POOL_VALUE_HIDDEN", "POOL_VALUE_OTHER"], "seed"));
  const safe = toSemanticEnrichmentConfig(config);
  assert.deepEqual(safe.availablePools, ["secret"]);
  assert.deepEqual(safe.availableDictionaries, ["secret"]);
  assert.deepEqual(safe.phoneProfiles, ["phone"]);
  assert.deepEqual(safe.namedGenerationProfiles, ["reusable"]);
  assert.equal(JSON.stringify(safe).includes("POOL_VALUE_HIDDEN"), false);
  assert.equal(JSON.stringify(safe).includes("DICTIONARY_VALUE_HIDDEN"), false);
});

test("normalizes generic value sets and legacy categories", () => {
  const generic = {
    version: "3",
    valueSets: { set_a: { values: ["VALUE_HIDDEN"], metadata: { valueKind: "string" } } },
    namedProfiles: { reusable: { valueKind: "string", sourceMode: "configured_values", valueSetRef: "set_a" } },
  };
  const safe = toSemanticEnrichmentConfig(generic as never);
  assert.deepEqual(safe.availableValueSetRefs, ["set_a"]);
  assert.deepEqual(safe.namedProfileRefs, ["reusable"]);
  assert.equal(JSON.stringify(safe).includes("VALUE_HIDDEN"), false);
  const legacy = normalizeLegacyGenerationConfig({ version: "legacy", pools: { old: { semanticType: "generic_text", values: ["LEGACY_HIDDEN"] } } } as never);
  assert.deepEqual(Object.keys(legacy.valueSets ?? {}), ["old"]);
  assert.equal(legacy.valueSets?.old.values[0], "LEGACY_HIDDEN");
});
