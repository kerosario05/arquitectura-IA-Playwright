import assert from "node:assert/strict";
import test from "node:test";
import { resolveAiConfig, resolveCanonicalSemanticAiConfig, resolveScenarioAiConfig, resolveScenarioSemanticAiConfig } from "./ai-config-resolver";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { fn(); } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const baseEnv = {
  AI_ENABLED: "true",
  AI_PROVIDER: "codex_cli",
  AI_MODEL: "gpt-5.4",
  CODEX_CLI_COMMAND: "codex",
};

test("resolveScenarioSemanticAiConfig", async (t) => {
  await t.test("uses the semantic task model override and purpose", () => {
    withEnv({ ...baseEnv, AI_SCENARIO_SEMANTIC_MODEL: "supported-semantic-model" }, () => {
      const config = resolveScenarioSemanticAiConfig();
      assert.equal(config.model, "supported-semantic-model");
      assert.equal(config.purpose, "scenario_data_semantic_enrichment");
    });
  });

  await t.test("lets Codex choose its own model when semantic override is absent", () => {
    withEnv({ ...baseEnv, AI_SCENARIO_SEMANTIC_MODEL: undefined }, () => {
      const config = resolveScenarioSemanticAiConfig();
      assert.equal(config.model, "");
      assert.equal(config.purpose, "scenario_data_semantic_enrichment");
    });
  });

  await t.test("preserves the scenario-generation model", () => {
    withEnv({ ...baseEnv, AI_SCENARIO_MODEL: "scenario-model", AI_SCENARIO_SEMANTIC_MODEL: "semantic-model" }, () => {
      assert.equal(resolveScenarioAiConfig().model, "scenario-model");
    });
  });

  await t.test("rejects an unsupported task provider instead of silently substituting a model", () => {
    withEnv({ ...baseEnv, AI_SCENARIO_SEMANTIC_PROVIDER: "unsupported_provider", AI_SCENARIO_SEMANTIC_MODEL: "invalid-model" }, () => {
      assert.throws(() => resolveScenarioSemanticAiConfig(), (error: any) => error.code === "ai_provider_unsupported");
    });
  });

  await t.test("uses the canonical semantic model override and purpose", () => {
    withEnv({ ...baseEnv, AI_CANONICAL_SEMANTIC_MODEL: "canonical-model" }, () => {
      const resolved = resolveCanonicalSemanticAiConfig();
      assert.equal(resolved.model, "canonical-model");
      assert.equal(resolved.purpose, "canonical_scenario_semantic_normalization");
    });
  });

  await t.test("allows Codex default model for canonical semantic normalization", () => {
    withEnv({ ...baseEnv, AI_MODEL: undefined, AI_CANONICAL_SEMANTIC_MODEL: undefined }, () => {
      assert.equal(resolveCanonicalSemanticAiConfig().model, "");
    });
  });

  await t.test("does not inherit AI_MODEL for canonical semantic Codex", () => {
    withEnv({ ...baseEnv, AI_CANONICAL_SEMANTIC_MODEL: undefined }, () => {
      assert.equal(resolveCanonicalSemanticAiConfig().model, "");
    });
  });

  await t.test("treats codex and codex_cli aliases identically", () => {
    withEnv({ ...baseEnv, AI_PROVIDER: "codex", AI_CANONICAL_SEMANTIC_MODEL: undefined }, () => {
      assert.equal(resolveCanonicalSemanticAiConfig().model, "");
    });
    withEnv({ ...baseEnv, AI_PROVIDER: "codex_cli", AI_CANONICAL_SEMANTIC_MODEL: undefined }, () => {
      assert.equal(resolveCanonicalSemanticAiConfig().model, "");
    });
  });

  await t.test("preserves explicit model validation for non-Codex providers", () => {
    withEnv({ ...baseEnv, AI_PROVIDER: "openai_compatible", AI_MODEL: undefined, AI_CANONICAL_SEMANTIC_MODEL: undefined, AI_BASE_URL: "https://example.test", AI_API_KEY: "fixture" }, () => {
      assert.throws(() => resolveCanonicalSemanticAiConfig(), (error: any) => error.code === "ai_provider_config_missing");
    });
  });

  await t.test("preserves global fallback for other purposes", () => {
    withEnv({ ...baseEnv, AI_SCENARIO_MODEL: undefined, AI_SPEC_MODEL: undefined }, () => {
      assert.equal(resolveScenarioAiConfig().model, "gpt-5.4");
      assert.equal(resolveAiConfig("spec_generation").model, "gpt-5.4");
    });
  });
});
