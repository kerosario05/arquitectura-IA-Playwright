import { test, expect } from "@playwright/test";
import { createAiProviderFromEnv, readAiProviderConfigFromEnv } from "../src/ai/ai-provider-factory";
import { AiProviderError } from "../src/ai/ai-provider.types";

function withEnv(values: Record<string, string | undefined>, fn: () => void): void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(values)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test("AI_ENABLED=false no crea provider", () => {
  withEnv({ AI_ENABLED: "false" }, () => {
    expect(readAiProviderConfigFromEnv()).toBeUndefined();
  });
});

test("AI_PROVIDER=disabled retorna undefined", () => {
  withEnv({
    AI_ENABLED: "true",
    AI_PROVIDER: "disabled"
  }, () => {
    expect(readAiProviderConfigFromEnv()).toBeUndefined();
  });
});

test("openai_compatible crea provider", async () => {
  withEnv({
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "key",
    AI_MODEL: "model"
  }, async () => {
    const provider = await createAiProviderFromEnv();
    expect(provider).toBeDefined();
    expect(provider!.providerType).toBe("openai_compatible");
  });
});

test("codex_cli crea provider", async () => {
  withEnv({
    AI_ENABLED: "true",
    AI_PROVIDER: "codex_cli",
    AI_PROVIDER_NAME: "codex",
    AI_MODEL: "codex",
    CODEX_CLI_COMMAND: "codex"
  }, async () => {
    const provider = await createAiProviderFromEnv();
    expect(provider).toBeDefined();
    expect(provider!.providerType).toBe("codex_cli");
    expect(provider!.providerName).toBe("codex");
  });
});

test("codex_cli sin CODEX_CLI_COMMAND usa fallback", async () => {
  withEnv({
    AI_ENABLED: "true",
    AI_PROVIDER: "codex_cli",
    AI_PROVIDER_NAME: "codex",
    AI_MODEL: "codex",
    CODEX_CLI_COMMAND: undefined
  }, async () => {
    const provider = await createAiProviderFromEnv();
    expect(provider).toBeDefined();
    expect(provider!.providerType).toBe("codex_cli");
  });
});

test("codex_cli parsea CODEX_CLI_EXTRA_ARGS correctamente", () => {
  withEnv({
    AI_ENABLED: "true",
    AI_PROVIDER: "codex_cli",
    AI_PROVIDER_NAME: "codex",
    AI_MODEL: "codex",
    CODEX_CLI_COMMAND: "codex",
    CODEX_CLI_EXTRA_ARGS: "--skip-git-repo-check --sandbox workspace-write --ask-for-approval never"
  }, () => {
    const config = readAiProviderConfigFromEnv();
    expect(config).toBeDefined();
    expect(config!.extraArgs).toEqual([
      "--skip-git-repo-check",
      "--sandbox",
      "workspace-write",
      "--ask-for-approval",
      "never"
    ]);
  });
});

test("codex_cli filtra exec de CODEX_CLI_EXTRA_ARGS", () => {
  withEnv({
    AI_ENABLED: "true",
    AI_PROVIDER: "codex_cli",
    AI_PROVIDER_NAME: "codex",
    AI_MODEL: "codex",
    CODEX_CLI_COMMAND: "codex",
    CODEX_CLI_EXTRA_ARGS: "exec --skip-git-repo-check"
  }, () => {
    const config = readAiProviderConfigFromEnv();
    expect(config).toBeDefined();
    expect(config!.extraArgs).toEqual(["--skip-git-repo-check"]);
  });
});

test("AI_PROVIDER desconocido lanza ai_provider_unsupported", () => {
  withEnv({
    AI_ENABLED: "true",
    AI_PROVIDER: "unknown_provider"
  }, () => {
    expect(() => readAiProviderConfigFromEnv()).toThrowError(AiProviderError);
    expect(() => readAiProviderConfigFromEnv()).toThrow(/Unsupported AI_PROVIDER/i);
  });
});

test("missing AI_API_KEY falla claro para openai_compatible", () => {
  withEnv({
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: undefined,
    AI_MODEL: "model"
  }, () => {
    expect(() => readAiProviderConfigFromEnv()).toThrowError(AiProviderError);
  });
});

test("missing AI_BASE_URL falla claro para openai_compatible", () => {
  withEnv({
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_BASE_URL: undefined,
    AI_API_KEY: "key",
    AI_MODEL: "model"
  }, () => {
    expect(() => readAiProviderConfigFromEnv()).toThrowError(AiProviderError);
  });
});

test("missing AI_MODEL falla claro para openai_compatible", () => {
  withEnv({
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "key",
    AI_MODEL: undefined
  }, () => {
    expect(() => readAiProviderConfigFromEnv()).toThrowError(AiProviderError);
  });
});
