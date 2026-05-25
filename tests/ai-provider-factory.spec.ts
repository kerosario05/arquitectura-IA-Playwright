import { test, expect } from "@playwright/test";
import { createAiProviderFromEnv } from "../src/ai/ai-provider-factory";
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
    expect(createAiProviderFromEnv()).toBeUndefined();
  });
});

test("openai_compatible crea provider", () => {
  withEnv({
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "key",
    AI_MODEL: "model"
  }, () => {
    const provider = createAiProviderFromEnv();
    expect(provider).toBeDefined();
    expect(provider!.providerType).toBe("openai_compatible");
  });
});

test("missing AI_API_KEY falla claro", () => {
  withEnv({
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: undefined,
    AI_MODEL: "model"
  }, () => {
    expect(() => createAiProviderFromEnv()).toThrowError(AiProviderError);
  });
});

test("missing AI_BASE_URL falla claro", () => {
  withEnv({
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_BASE_URL: undefined,
    AI_API_KEY: "key",
    AI_MODEL: "model"
  }, () => {
    expect(() => createAiProviderFromEnv()).toThrowError(AiProviderError);
  });
});

test("missing AI_MODEL falla claro", () => {
  withEnv({
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "key",
    AI_MODEL: undefined
  }, () => {
    expect(() => createAiProviderFromEnv()).toThrowError(AiProviderError);
  });
});
