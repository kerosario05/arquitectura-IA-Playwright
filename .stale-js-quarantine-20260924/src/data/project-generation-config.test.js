"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const project_generation_config_1 = require("./project-generation-config");
const profile = { semanticType: "person_name", generationMode: "synthetic" };
(0, node_test_1.default)("validates project generation configuration and keeps lookups exact", () => {
    const config = {
        version: "1",
        pools: { names: { semanticType: "person_name", values: ["fixture"] } },
        dictionaries: { jobs: { semanticType: "job_title", values: ["fixture"] } },
        phoneProfiles: { mobile: { allowedPrefixes: ["prefix"], totalDigits: 10 } },
        moneyProfiles: { salary: { min: 1, max: 10, step: 1 } },
        namedGenerationProfiles: { name: profile },
    };
    strict_1.default.equal((0, project_generation_config_1.validateProjectGenerationConfig)({}).valid, true);
    strict_1.default.equal((0, project_generation_config_1.validateProjectGenerationConfig)(config).valid, true);
    strict_1.default.deepEqual((0, project_generation_config_1.getGenerationPool)(config, "names"), config.pools?.names);
    strict_1.default.deepEqual((0, project_generation_config_1.getGenerationDictionary)(config, "jobs"), config.dictionaries?.jobs);
    strict_1.default.deepEqual((0, project_generation_config_1.getPhoneProfile)(config, "mobile"), config.phoneProfiles?.mobile);
    strict_1.default.deepEqual((0, project_generation_config_1.getMoneyProfile)(config, "salary"), config.moneyProfiles?.salary);
    strict_1.default.deepEqual((0, project_generation_config_1.getNamedGenerationProfile)(config, "name"), profile);
    strict_1.default.equal((0, project_generation_config_1.getGenerationPool)(config, "missing"), undefined);
    strict_1.default.equal((0, project_generation_config_1.getGenerationPool)(config, "name"), undefined);
});
(0, node_test_1.default)("rejects invalid pools, dictionaries, phones, money and named profiles", () => {
    const invalid = {
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
    const result = (0, project_generation_config_1.validateProjectGenerationConfig)(invalid);
    strict_1.default.equal(result.valid, false);
    strict_1.default.ok(result.errors.some((error) => error.path === "pools.empty.values"));
    strict_1.default.ok(result.errors.some((error) => error.path === "dictionaries.empty.values"));
    strict_1.default.ok(result.errors.some((error) => error.path === "phoneProfiles.bad.allowedPrefixes"));
    strict_1.default.ok(result.errors.some((error) => error.path === "moneyProfiles.badRange.min"));
    strict_1.default.ok(result.errors.some((error) => error.path === "moneyProfiles.badScale.decimalScale"));
    strict_1.default.ok(result.errors.some((error) => error.path === "moneyProfiles.badStep.step"));
    strict_1.default.ok(result.errors.some((error) => error.path === "moneyProfiles.incompatible.decimalScale"));
    strict_1.default.ok(result.errors.some((error) => error.path === "namedGenerationProfiles.bad"));
});
(0, node_test_1.default)("selects deterministically and hides configured values from semantic view", () => {
    const config = {
        version: "2",
        pools: { secret: { semanticType: "generic_text", values: ["POOL_VALUE_HIDDEN", "POOL_VALUE_OTHER"] } },
        dictionaries: { secret: { semanticType: "generic_text", values: ["DICTIONARY_VALUE_HIDDEN"] } },
        phoneProfiles: { phone: { allowedPrefixes: ["p"], totalDigits: 4 } },
        namedGenerationProfiles: { reusable: profile },
    };
    strict_1.default.equal((0, project_generation_config_1.selectSeededValue)([], "seed"), undefined);
    strict_1.default.equal((0, project_generation_config_1.selectSeededValue)(["POOL_VALUE_HIDDEN", "POOL_VALUE_OTHER"], "seed"), (0, project_generation_config_1.selectSeededValue)(["POOL_VALUE_HIDDEN", "POOL_VALUE_OTHER"], "seed"));
    const safe = (0, project_generation_config_1.toSemanticEnrichmentConfig)(config);
    strict_1.default.deepEqual(safe.availablePools, ["secret"]);
    strict_1.default.deepEqual(safe.availableDictionaries, ["secret"]);
    strict_1.default.deepEqual(safe.phoneProfiles, ["phone"]);
    strict_1.default.deepEqual(safe.namedGenerationProfiles, ["reusable"]);
    strict_1.default.equal(JSON.stringify(safe).includes("POOL_VALUE_HIDDEN"), false);
    strict_1.default.equal(JSON.stringify(safe).includes("DICTIONARY_VALUE_HIDDEN"), false);
});
(0, node_test_1.default)("normalizes generic value sets and legacy categories", () => {
    const generic = {
        version: "3",
        valueSets: { set_a: { values: ["VALUE_HIDDEN"], metadata: { valueKind: "string" } } },
        namedProfiles: { reusable: { valueKind: "string", sourceMode: "configured_values", valueSetRef: "set_a" } },
    };
    const safe = (0, project_generation_config_1.toSemanticEnrichmentConfig)(generic);
    strict_1.default.deepEqual(safe.availableValueSetRefs, ["set_a"]);
    strict_1.default.deepEqual(safe.namedProfileRefs, ["reusable"]);
    strict_1.default.equal(JSON.stringify(safe).includes("VALUE_HIDDEN"), false);
    const legacy = (0, project_generation_config_1.normalizeLegacyGenerationConfig)({ version: "legacy", pools: { old: { semanticType: "generic_text", values: ["LEGACY_HIDDEN"] } } });
    strict_1.default.deepEqual(Object.keys(legacy.valueSets ?? {}), ["old"]);
    strict_1.default.equal(legacy.valueSets?.old.values[0], "LEGACY_HIDDEN");
});
