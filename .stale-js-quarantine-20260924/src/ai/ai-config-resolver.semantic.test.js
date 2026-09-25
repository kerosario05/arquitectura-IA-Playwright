"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const ai_config_resolver_1 = require("./ai-config-resolver");
function withEnv(vars, fn) {
    const previous = {};
    for (const [key, value] of Object.entries(vars)) {
        previous[key] = process.env[key];
        if (value === undefined)
            delete process.env[key];
        else
            process.env[key] = value;
    }
    try {
        fn();
    }
    finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined)
                delete process.env[key];
            else
                process.env[key] = value;
        }
    }
}
const baseEnv = {
    AI_ENABLED: "true",
    AI_PROVIDER: "codex_cli",
    AI_MODEL: "gpt-5.4",
    CODEX_CLI_COMMAND: "codex",
};
(0, node_test_1.default)("resolveScenarioSemanticAiConfig", async (t) => {
    await t.test("uses the semantic task model override and purpose", () => {
        withEnv({ ...baseEnv, AI_SCENARIO_SEMANTIC_MODEL: "supported-semantic-model" }, () => {
            const config = (0, ai_config_resolver_1.resolveScenarioSemanticAiConfig)();
            strict_1.default.equal(config.model, "supported-semantic-model");
            strict_1.default.equal(config.purpose, "scenario_data_semantic_enrichment");
        });
    });
    await t.test("lets Codex choose its own model when semantic override is absent", () => {
        withEnv({ ...baseEnv, AI_SCENARIO_SEMANTIC_MODEL: undefined }, () => {
            const config = (0, ai_config_resolver_1.resolveScenarioSemanticAiConfig)();
            strict_1.default.equal(config.model, "");
            strict_1.default.equal(config.purpose, "scenario_data_semantic_enrichment");
        });
    });
    await t.test("preserves the scenario-generation model", () => {
        withEnv({ ...baseEnv, AI_SCENARIO_MODEL: "scenario-model", AI_SCENARIO_SEMANTIC_MODEL: "semantic-model" }, () => {
            strict_1.default.equal((0, ai_config_resolver_1.resolveScenarioAiConfig)().model, "scenario-model");
        });
    });
    await t.test("rejects an unsupported task provider instead of silently substituting a model", () => {
        withEnv({ ...baseEnv, AI_SCENARIO_SEMANTIC_PROVIDER: "unsupported_provider", AI_SCENARIO_SEMANTIC_MODEL: "invalid-model" }, () => {
            strict_1.default.throws(() => (0, ai_config_resolver_1.resolveScenarioSemanticAiConfig)(), (error) => error.code === "ai_provider_unsupported");
        });
    });
    await t.test("uses the canonical semantic model override and purpose", () => {
        withEnv({ ...baseEnv, AI_CANONICAL_SEMANTIC_MODEL: "canonical-model" }, () => {
            const resolved = (0, ai_config_resolver_1.resolveCanonicalSemanticAiConfig)();
            strict_1.default.equal(resolved.model, "canonical-model");
            strict_1.default.equal(resolved.purpose, "canonical_scenario_semantic_normalization");
        });
    });
    await t.test("allows Codex default model for canonical semantic normalization", () => {
        withEnv({ ...baseEnv, AI_MODEL: undefined, AI_CANONICAL_SEMANTIC_MODEL: undefined }, () => {
            strict_1.default.equal((0, ai_config_resolver_1.resolveCanonicalSemanticAiConfig)().model, "");
        });
    });
    await t.test("does not inherit AI_MODEL for canonical semantic Codex", () => {
        withEnv({ ...baseEnv, AI_CANONICAL_SEMANTIC_MODEL: undefined }, () => {
            strict_1.default.equal((0, ai_config_resolver_1.resolveCanonicalSemanticAiConfig)().model, "");
        });
    });
    await t.test("treats codex and codex_cli aliases identically", () => {
        withEnv({ ...baseEnv, AI_PROVIDER: "codex", AI_CANONICAL_SEMANTIC_MODEL: undefined }, () => {
            strict_1.default.equal((0, ai_config_resolver_1.resolveCanonicalSemanticAiConfig)().model, "");
        });
        withEnv({ ...baseEnv, AI_PROVIDER: "codex_cli", AI_CANONICAL_SEMANTIC_MODEL: undefined }, () => {
            strict_1.default.equal((0, ai_config_resolver_1.resolveCanonicalSemanticAiConfig)().model, "");
        });
    });
    await t.test("preserves explicit model validation for non-Codex providers", () => {
        withEnv({ ...baseEnv, AI_PROVIDER: "openai_compatible", AI_MODEL: undefined, AI_CANONICAL_SEMANTIC_MODEL: undefined, AI_BASE_URL: "https://example.test", AI_API_KEY: "fixture" }, () => {
            strict_1.default.throws(() => (0, ai_config_resolver_1.resolveCanonicalSemanticAiConfig)(), (error) => error.code === "ai_provider_config_missing");
        });
    });
    await t.test("preserves global fallback for other purposes", () => {
        withEnv({ ...baseEnv, AI_SCENARIO_MODEL: undefined, AI_SPEC_MODEL: undefined }, () => {
            strict_1.default.equal((0, ai_config_resolver_1.resolveScenarioAiConfig)().model, "gpt-5.4");
            strict_1.default.equal((0, ai_config_resolver_1.resolveAiConfig)("spec_generation").model, "gpt-5.4");
        });
    });
});
