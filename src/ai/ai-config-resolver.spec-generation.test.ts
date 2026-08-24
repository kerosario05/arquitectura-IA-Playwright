import assert from "node:assert";
import test from "node:test";
import { resolveSpecGenerationAiConfig } from "./ai-config-resolver";

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("resolveSpecGenerationAiConfig", async (t) => {
  await t.test("uses AI_SPEC_* with priority over AI_PROVIDER/AI_MODEL", () => {
    withEnv({
      AI_ENABLED: "true",
      AI_PROVIDER: "openai_compatible",
      AI_MODEL: "gpt-fallback",
      AI_BASE_URL: "https://example.test",
      AI_API_KEY: "x",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "claude-opus-4.5",
      AI_SPEC_TIMEOUT_MS: "360000",
      AI_SPEC_MAX_ATTEMPTS: "1",
      COPILOT_CLI_COMMAND: "copilot"
    }, () => {
      const cfg = resolveSpecGenerationAiConfig();
      assert.strictEqual(cfg.provider, "copilot_cli");
      assert.strictEqual(cfg.model, "claude-opus-4.5");
      assert.strictEqual(cfg.timeoutMs, 360000);
      assert.strictEqual(cfg.maxAttempts, 1);
    });
  });

  await t.test("falls back to AI_PROVIDER/AI_MODEL when AI_SPEC_* are missing", () => {
    withEnv({
      AI_ENABLED: "true",
      AI_PROVIDER: "copilot_cli",
      AI_MODEL: "claude-sonnet-4.6",
      AI_SPEC_PROVIDER: undefined,
      AI_SPEC_MODEL: undefined,
      COPILOT_CLI_COMMAND: "copilot"
    }, () => {
      const cfg = resolveSpecGenerationAiConfig();
      assert.strictEqual(cfg.provider, "copilot_cli");
      assert.strictEqual(cfg.model, "claude-sonnet-4.6");
    });
  });

  await t.test("uses AI_SPEC_REQUIRE_JSON and AI_SPEC_REQUIRE_JSON_SCHEMA", () => {
    withEnv({
      AI_ENABLED: "true",
      AI_PROVIDER: "copilot_cli",
      AI_MODEL: "model-a",
      AI_SPEC_PROVIDER: "copilot_cli",
      AI_SPEC_MODEL: "model-b",
      AI_REQUIRE_JSON: "false",
      AI_REQUIRE_JSON_SCHEMA: "false",
      AI_SPEC_REQUIRE_JSON: "true",
      AI_SPEC_REQUIRE_JSON_SCHEMA: "true",
      COPILOT_CLI_COMMAND: "copilot"
    }, () => {
      const cfg = resolveSpecGenerationAiConfig();
      assert.strictEqual(cfg.requireJson, true);
      assert.strictEqual(cfg.requireJsonSchema, true);
    });
  });
});
