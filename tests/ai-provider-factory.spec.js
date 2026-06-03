"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const ai_provider_factory_1 = require("../src/ai/ai-provider-factory");
const ai_provider_types_1 = require("../src/ai/ai-provider.types");
function withEnv(values, fn) {
    const previous = {};
    for (const key of Object.keys(values)) {
        previous[key] = process.env[key];
        if (values[key] === undefined)
            delete process.env[key];
        else
            process.env[key] = values[key];
    }
    try {
        fn();
    }
    finally {
        for (const key of Object.keys(values)) {
            if (previous[key] === undefined)
                delete process.env[key];
            else
                process.env[key] = previous[key];
        }
    }
}
(0, test_1.test)("AI_ENABLED=false no crea provider", () => {
    withEnv({ AI_ENABLED: "false" }, () => {
        (0, test_1.expect)((0, ai_provider_factory_1.readAiProviderConfigFromEnv)()).toBeUndefined();
    });
});
(0, test_1.test)("AI_PROVIDER=disabled retorna undefined", () => {
    withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "disabled"
    }, () => {
        (0, test_1.expect)((0, ai_provider_factory_1.readAiProviderConfigFromEnv)()).toBeUndefined();
    });
});
(0, test_1.test)("openai_compatible crea provider", async () => {
    withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "openai_compatible",
        AI_PROVIDER_NAME: "gemini",
        AI_BASE_URL: "https://example.com/v1",
        AI_API_KEY: "key",
        AI_MODEL: "model"
    }, async () => {
        const provider = await (0, ai_provider_factory_1.createAiProviderFromEnv)();
        (0, test_1.expect)(provider).toBeDefined();
        (0, test_1.expect)(provider.providerType).toBe("openai_compatible");
    });
});
(0, test_1.test)("codex_cli crea provider", async () => {
    withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "codex_cli",
        AI_PROVIDER_NAME: "codex",
        AI_MODEL: "codex",
        CODEX_CLI_COMMAND: "codex"
    }, async () => {
        const provider = await (0, ai_provider_factory_1.createAiProviderFromEnv)();
        (0, test_1.expect)(provider).toBeDefined();
        (0, test_1.expect)(provider.providerType).toBe("codex_cli");
        (0, test_1.expect)(provider.providerName).toBe("codex");
    });
});
(0, test_1.test)("codex_cli sin CODEX_CLI_COMMAND usa fallback", async () => {
    withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "codex_cli",
        AI_PROVIDER_NAME: "codex",
        AI_MODEL: "codex",
        CODEX_CLI_COMMAND: undefined
    }, async () => {
        const provider = await (0, ai_provider_factory_1.createAiProviderFromEnv)();
        (0, test_1.expect)(provider).toBeDefined();
        (0, test_1.expect)(provider.providerType).toBe("codex_cli");
    });
});
(0, test_1.test)("codex_cli parsea CODEX_CLI_EXTRA_ARGS correctamente", () => {
    withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "codex_cli",
        AI_PROVIDER_NAME: "codex",
        AI_MODEL: "codex",
        CODEX_CLI_COMMAND: "codex",
        CODEX_CLI_EXTRA_ARGS: "--skip-git-repo-check --sandbox workspace-write --ask-for-approval never"
    }, () => {
        const config = (0, ai_provider_factory_1.readAiProviderConfigFromEnv)();
        (0, test_1.expect)(config).toBeDefined();
        (0, test_1.expect)(config.extraArgs).toEqual([
            "--skip-git-repo-check",
            "--sandbox",
            "workspace-write",
            "--ask-for-approval",
            "never"
        ]);
    });
});
(0, test_1.test)("codex_cli filtra exec de CODEX_CLI_EXTRA_ARGS", () => {
    withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "codex_cli",
        AI_PROVIDER_NAME: "codex",
        AI_MODEL: "codex",
        CODEX_CLI_COMMAND: "codex",
        CODEX_CLI_EXTRA_ARGS: "exec --skip-git-repo-check"
    }, () => {
        const config = (0, ai_provider_factory_1.readAiProviderConfigFromEnv)();
        (0, test_1.expect)(config).toBeDefined();
        (0, test_1.expect)(config.extraArgs).toEqual(["--skip-git-repo-check"]);
    });
});
(0, test_1.test)("AI_PROVIDER desconocido lanza ai_provider_unsupported", () => {
    withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "unknown_provider"
    }, () => {
        (0, test_1.expect)(() => (0, ai_provider_factory_1.readAiProviderConfigFromEnv)()).toThrowError(ai_provider_types_1.AiProviderError);
        (0, test_1.expect)(() => (0, ai_provider_factory_1.readAiProviderConfigFromEnv)()).toThrow(/Unsupported AI_PROVIDER/i);
    });
});
(0, test_1.test)("missing AI_API_KEY falla claro para openai_compatible", () => {
    withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "openai_compatible",
        AI_BASE_URL: "https://example.com/v1",
        AI_API_KEY: undefined,
        AI_MODEL: "model"
    }, () => {
        (0, test_1.expect)(() => (0, ai_provider_factory_1.readAiProviderConfigFromEnv)()).toThrowError(ai_provider_types_1.AiProviderError);
    });
});
(0, test_1.test)("missing AI_BASE_URL falla claro para openai_compatible", () => {
    withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "openai_compatible",
        AI_BASE_URL: undefined,
        AI_API_KEY: "key",
        AI_MODEL: "model"
    }, () => {
        (0, test_1.expect)(() => (0, ai_provider_factory_1.readAiProviderConfigFromEnv)()).toThrowError(ai_provider_types_1.AiProviderError);
    });
});
(0, test_1.test)("missing AI_MODEL falla claro para openai_compatible", () => {
    withEnv({
        AI_ENABLED: "true",
        AI_PROVIDER: "openai_compatible",
        AI_BASE_URL: "https://example.com/v1",
        AI_API_KEY: "key",
        AI_MODEL: undefined
    }, () => {
        (0, test_1.expect)(() => (0, ai_provider_factory_1.readAiProviderConfigFromEnv)()).toThrowError(ai_provider_types_1.AiProviderError);
    });
});
