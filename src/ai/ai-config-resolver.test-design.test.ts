import assert from "node:assert/strict";
import test from "node:test";
import { resolveAiConfig } from "./ai-config-resolver";

const KEYS = [
  "AI_ENABLED",
  "AI_PROVIDER",
  "AI_MODEL",
  "AI_TIMEOUT_MS",
  "AI_SCENARIO_PROVIDER",
  "AI_SCENARIO_MODEL",
  "AI_SCENARIO_TIMEOUT_MS",
  "AI_TEST_DESIGN_PROVIDER",
  "AI_TEST_DESIGN_MODEL",
  "AI_TEST_DESIGN_TIMEOUT_MS",
  "CLAUDE_CLI_COMMAND",
];

function withEnv(values: Record<string, string>, fn: () => void): void {
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, values);
  try {
    fn();
  } finally {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

test("test_design uses its own provider, model and timeout when set", () => {
  withEnv(
    {
      AI_PROVIDER: "copilot_cli",
      AI_MODEL: "general",
      AI_SCENARIO_PROVIDER: "codex_cli",
      AI_TEST_DESIGN_PROVIDER: "claude_cli",
      AI_TEST_DESIGN_MODEL: "design-model",
      AI_TEST_DESIGN_TIMEOUT_MS: "90000",
    },
    () => {
      const config = resolveAiConfig("test_design");
      assert.equal(config.provider, "claude_cli");
      assert.equal(config.model, "design-model");
      assert.equal(config.timeoutMs, 90000);
      assert.equal(config.purpose, "test_design");
    },
  );
});

test("test_design falls back to the scenario generator settings", () => {
  withEnv(
    { AI_PROVIDER: "copilot_cli", AI_MODEL: "general", AI_SCENARIO_PROVIDER: "claude_cli", AI_SCENARIO_MODEL: "scenario-model", AI_SCENARIO_TIMEOUT_MS: "120000" },
    () => {
      const config = resolveAiConfig("test_design");
      assert.equal(config.provider, "claude_cli");
      assert.equal(config.model, "scenario-model");
      assert.equal(config.timeoutMs, 120000);
    },
  );
});

test("test_design falls back to the global settings last", () => {
  withEnv({ AI_PROVIDER: "claude_cli", AI_MODEL: "general" }, () => {
    const config = resolveAiConfig("test_design");
    assert.equal(config.provider, "claude_cli");
    assert.equal(config.model, "general");
    assert.equal(config.timeoutMs, 240000);
  });
});
