import { test, expect } from "@playwright/test";
import { OpenAICompatibleProvider, buildChatCompletionsUrl } from "../src/ai/openai-compatible-provider";
import type { AiProviderConfig } from "../src/ai/ai-provider.types";

const baseConfig: AiProviderConfig = {
  enabled: true,
  provider: "openai_compatible",
  providerName: "gemini",
  baseUrl: "https://example.com/v1/",
  apiKey: "secret",
  model: "gemini-2.5-flash",
  timeoutMs: 30_000,
  requireJson: true,
  requireJsonSchema: true
};

test("construye request correcto", async () => {
  let calledUrl = "";
  let calledBody = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    calledUrl = String(input);
    calledBody = String(init?.body ?? "");
    return new Response(JSON.stringify({ choices: [{ message: { content: "{\"decision\":\"no_safe_action\",\"reason\":\"ok\"}" } }] }), { status: 200 });
  }) as any;

  try {
    const provider = new OpenAICompatibleProvider(baseConfig);
    const result = await provider.completeJson({
      messages: [{ role: "user", content: "hi" }]
    });
    expect(calledUrl).toBe("https://example.com/v1/chat/completions");
    expect(calledBody).toContain("\"model\":\"gemini-2.5-flash\"");
    expect(result.parsedJson?.decision).toBe("no_safe_action");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("respeta timeout", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: any, init?: any) => {
    await new Promise((resolve, reject) => {
      const signal = init?.signal as AbortSignal | undefined;
      const onAbort = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      if (signal?.aborted) onAbort();
      signal?.addEventListener("abort", onAbort);
    });
    return new Response("{}", { status: 200 });
  }) as any;

  try {
    const provider = new OpenAICompatibleProvider({ ...baseConfig, timeoutMs: 10 });
    await expect(provider.completeJson({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/timed out/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parsea JSON válido", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"decision\":\"no_safe_action\",\"reason\":\"ok\"}" } }] }), { status: 200 })) as any;
  try {
    const provider = new OpenAICompatibleProvider(baseConfig);
    const result = await provider.completeJson({ messages: [{ role: "user", content: "hi" }] });
    expect(result.parsedJson?.reason).toBe("ok");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reporta invalid JSON", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 })) as any;
  try {
    const provider = new OpenAICompatibleProvider(baseConfig);
    await expect(provider.completeJson({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/invalid json/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reporta HTTP error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("bad request", { status: 400 })) as any;
  try {
    const provider = new OpenAICompatibleProvider(baseConfig);
    await expect(provider.completeJson({ messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/http error/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normaliza base url con slash", () => {
  expect(buildChatCompletionsUrl("https://x/y/")).toBe("https://x/y/chat/completions");
});
