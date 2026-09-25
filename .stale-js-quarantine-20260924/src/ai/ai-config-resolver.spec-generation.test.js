"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const node_test_1 = __importDefault(require("node:test"));
const ai_config_resolver_1 = require("./ai-config-resolver");
function withEnv(vars, fn) {
    const previous = {};
    for (const [key, value] of Object.entries(vars)) {
        previous[key] = process.env[key];
        if (value === undefined) {
            delete process.env[key];
        }
        else {
            process.env[key] = value;
        }
    }
    try {
        fn();
    }
    finally {
        for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) {
                delete process.env[key];
            }
            else {
                process.env[key] = value;
            }
        }
    }
}
(0, node_test_1.default)("resolveSpecGenerationAiConfig", async (t) => {
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
            const cfg = (0, ai_config_resolver_1.resolveSpecGenerationAiConfig)();
            node_assert_1.default.strictEqual(cfg.provider, "copilot_cli");
            node_assert_1.default.strictEqual(cfg.model, "claude-opus-4.5");
            node_assert_1.default.strictEqual(cfg.timeoutMs, 360000);
            node_assert_1.default.strictEqual(cfg.maxAttempts, 1);
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
            const cfg = (0, ai_config_resolver_1.resolveSpecGenerationAiConfig)();
            node_assert_1.default.strictEqual(cfg.provider, "copilot_cli");
            node_assert_1.default.strictEqual(cfg.model, "claude-sonnet-4.6");
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
            const cfg = (0, ai_config_resolver_1.resolveSpecGenerationAiConfig)();
            node_assert_1.default.strictEqual(cfg.requireJson, true);
            node_assert_1.default.strictEqual(cfg.requireJsonSchema, true);
        });
    });
    await t.test("resolves the spec-only Codex reasoning effort", () => {
        withEnv({
            AI_ENABLED: "true",
            AI_SPEC_PROVIDER: "codex_cli",
            AI_SPEC_MODEL: "gpt-5.6-luna",
            AI_SPEC_REASONING_EFFORT: "medium",
            AI_SPEC_TIMEOUT_MS: "360000",
            CODEX_CLI_COMMAND: "codex"
        }, () => {
            const cfg = (0, ai_config_resolver_1.resolveSpecGenerationAiConfig)();
            node_assert_1.default.strictEqual(cfg.reasoningEffort, "medium");
            node_assert_1.default.strictEqual(cfg.timeoutMs, 360000);
        });
    });
    await t.test("accepts low effort and preserves the default when absent", () => {
        withEnv({ AI_ENABLED: "true", AI_SPEC_PROVIDER: "codex_cli", AI_SPEC_MODEL: "model-a", AI_SPEC_REASONING_EFFORT: "low" }, () => {
            node_assert_1.default.strictEqual((0, ai_config_resolver_1.resolveSpecGenerationAiConfig)().reasoningEffort, "low");
        });
        withEnv({ AI_ENABLED: "true", AI_SPEC_PROVIDER: "codex_cli", AI_SPEC_MODEL: "model-a", AI_SPEC_REASONING_EFFORT: undefined }, () => {
            node_assert_1.default.strictEqual((0, ai_config_resolver_1.resolveSpecGenerationAiConfig)().reasoningEffort, undefined);
        });
    });
    await t.test("rejects an unsupported effort without silently changing it", () => {
        withEnv({ AI_ENABLED: "true", AI_SPEC_PROVIDER: "codex_cli", AI_SPEC_MODEL: "model-a", AI_SPEC_REASONING_EFFORT: "turbo" }, () => {
            node_assert_1.default.throws(() => (0, ai_config_resolver_1.resolveSpecGenerationAiConfig)(), { code: "ai_provider_config_missing" });
        });
    });
});
