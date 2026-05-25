import { test, expect } from "@playwright/test";
import { runAiRepairOrchestrator } from "../src/ai/repair/ai-repair-orchestrator";

function withEnv(values: Record<string, string | undefined>, fn: () => Promise<void> | void): Promise<void> | void {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  const restore = () => {
    for (const key of Object.keys(values)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
  const result = fn();
  if (result && typeof (result as Promise<void>).then === "function") {
    return (result as Promise<void>).finally(restore);
  }
  restore();
}

const input = {
  appSlug: "app",
  failure: "target_not_found",
  currentStep: "click",
  currentUrl: "https://x",
  candidates: [{ candidateId: "c1", visible: true, clickable: true, enabled: true, sensitive: false }]
};

test("provider disabled", async () => {
  await withEnv({ AI_REPAIR_ENABLED: "false" }, async () => {
    const r = await runAiRepairOrchestrator(input);
    expect(r.status).toBe("provider_disabled");
  });
});

test("provider error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("network down"); }) as any;
  await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "key",
    AI_MODEL: "model"
  }, async () => {
    const r = await runAiRepairOrchestrator(input);
    expect(r.status).toBe("provider_error");
  });
  globalThis.fetch = originalFetch;
});

test("invalid response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"decision\":\"repaired_plan\",\"reason\":\"x\"}" } }] }), { status: 200 })) as any;
  await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "key",
    AI_MODEL: "model"
  }, async () => {
    const r = await runAiRepairOrchestrator(input);
    expect(r.status).toBe("invalid_response");
  });
  globalThis.fetch = originalFetch;
});

test("no_safe_action válido", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"decision\":\"no_safe_action\",\"reason\":\"x\"}" } }] }), { status: 200 })) as any;
  await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "key",
    AI_MODEL: "model"
  }, async () => {
    const r = await runAiRepairOrchestrator(input);
    expect(r.status).toBe("no_safe_action");
  });
  globalThis.fetch = originalFetch;
});

test("repaired_plan válido", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"decision\":\"repaired_plan\",\"reason\":\"x\",\"candidateId\":\"c1\"}" } }] }), { status: 200 })) as any;
  await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "key",
    AI_MODEL: "model"
  }, async () => {
    const r = await runAiRepairOrchestrator(input);
    expect(r.status).toBe("repaired_plan");
  });
  globalThis.fetch = originalFetch;
});

test("repaired_plan bloqueado por candidate inválido", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: "{\"decision\":\"repaired_plan\",\"reason\":\"x\",\"candidateId\":\"missing\"}" } }] }), { status: 200 })) as any;
  await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "key",
    AI_MODEL: "model"
  }, async () => {
    const r = await runAiRepairOrchestrator(input);
    expect(r.status).toBe("invalid_response");
  });
  globalThis.fetch = originalFetch;
});
