import assert from "node:assert";
import test from "node:test";
import { runAiRepairOrchestrator, type AiRepairOrchestratorInput } from "./ai-repair-orchestrator";
import { createRepairAiProvider, createAiProviderFromConfig } from "../ai-provider-factory";
import { resolveRepairAiConfig } from "../ai-config-resolver";
import { CopilotCliProvider } from "../providers/copilot-cli-provider";
import { AiProviderError, type AiProvider, type AiCompletionRequest, type AiCompletionResponse } from "../ai-provider.types";

// ---------------------------------------------------------------------------
// Minimal fake provider factory
// ---------------------------------------------------------------------------

function fakeRepairDecision(decision: "repaired_plan" | "no_safe_action" | "needs_more_context" = "no_safe_action"): Record<string, unknown> {
  return {
    decision,
    reason: "test reason",
    repairType: "target_resolution",
    candidateId: decision === "repaired_plan" ? "cand-001" : undefined,
    confidence: 0.9
  };
}

function buildFakeProvider(
  options: {
    providerName?: string;
    model?: string;
    response?: Record<string, unknown>;
    throwError?: Error;
  } = {}
): AiProvider {
  const { providerName = "fake-provider", model = "fake-model", response, throwError } = options;
  return {
    providerType: "fake" as any,
    providerName,
    model,
    completeJson: async (req: AiCompletionRequest): Promise<AiCompletionResponse> => {
      if (throwError) throw throwError;
      return {
        rawText: JSON.stringify(response ?? fakeRepairDecision()),
        parsedJson: response ?? fakeRepairDecision(),
        model,
        providerName,
        durationMs: 10,
        usage: { totalPhysicalTokens: 50, durationMs: 10, success: true }
      };
    }
  };
}

function buildBaseInput(overrides: Partial<AiRepairOrchestratorInput> = {}): AiRepairOrchestratorInput {
  return {
    appSlug: "test-app",
    failure: "target_not_found",
    currentStep: "click",
    currentUrl: "https://example.com",
    candidates: [
      {
        candidateId: "cand-001",
        role: "button",
        text: "Submit",
        visible: true,
        enabled: true,
        clickable: true,
        sensitive: false
      }
    ],
    ...overrides
  };
}

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const original: Record<string, string | undefined> = {};
  for (const [key, val] of Object.entries(vars)) {
    original[key] = process.env[key];
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
  return fn().finally(() => {
    for (const [key, val] of Object.entries(original)) {
      if (val === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = val;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("AI-REPAIR orchestrator", async (t) => {

  // 1. AI_REPAIR_PROVIDER=copilot_cli resolves to CopilotCliProvider
  await t.test("AI_REPAIR_PROVIDER=copilot_cli constructs CopilotCliProvider", async () => {
    await withEnv({
      AI_ENABLED: "true",
      AI_REPAIR_PROVIDER: "copilot_cli",
      AI_REPAIR_MODEL: "claude-opus-4.5",
      AI_PROVIDER: undefined,
      AI_MODEL: undefined,
      COPILOT_CLI_COMMAND: "copilot"
    }, async () => {
      const config = resolveRepairAiConfig();
      assert.strictEqual(config.provider, "copilot_cli");
      assert.strictEqual(config.model, "claude-opus-4.5");
      const provider = await createAiProviderFromConfig(config);
      assert.ok(provider instanceof CopilotCliProvider, "should be CopilotCliProvider instance");
    });
  });

  // 2. AI_REPAIR_MODEL reaches the effective provider
  await t.test("AI_REPAIR_MODEL=claude-opus-4.5 reaches effective provider config", async () => {
    await withEnv({
      AI_ENABLED: "true",
      AI_REPAIR_PROVIDER: "copilot_cli",
      AI_REPAIR_MODEL: "claude-opus-4.5",
      AI_MODEL: "wrong-model",
      COPILOT_CLI_COMMAND: "copilot"
    }, async () => {
      const config = resolveRepairAiConfig();
      assert.strictEqual(config.model, "claude-opus-4.5", "repair model must take priority over AI_MODEL");
    });
  });

  // 3. AI_REPAIR_* takes priority over AI_PROVIDER / AI_MODEL
  await t.test("AI_REPAIR_* has priority over general AI_PROVIDER and AI_MODEL", async () => {
    await withEnv({
      AI_ENABLED: "true",
      AI_PROVIDER: "openai_compatible",
      AI_MODEL: "gpt-4",
      AI_REPAIR_PROVIDER: "copilot_cli",
      AI_REPAIR_MODEL: "claude-opus-4.5",
      COPILOT_CLI_COMMAND: "copilot"
    }, async () => {
      const config = resolveRepairAiConfig();
      assert.strictEqual(config.provider, "copilot_cli");
      assert.strictEqual(config.model, "claude-opus-4.5");
    });
  });

  // 4. Fallback to general vars when AI_REPAIR_* are absent
  await t.test("falls back to AI_PROVIDER / AI_MODEL when AI_REPAIR_* are absent", async () => {
    await withEnv({
      AI_ENABLED: "true",
      AI_PROVIDER: "copilot_cli",
      AI_MODEL: "claude-opus-4.5",
      AI_REPAIR_PROVIDER: undefined,
      AI_REPAIR_MODEL: undefined,
      COPILOT_CLI_COMMAND: "copilot"
    }, async () => {
      const config = resolveRepairAiConfig();
      assert.strictEqual(config.provider, "copilot_cli");
      assert.strictEqual(config.model, "claude-opus-4.5");
    });
  });

  // 5. Provider creation error returns provider_error (not thrown)
  await t.test("provider creation error returns provider_error status without throwing", async () => {
    await withEnv({
      AI_REPAIR_ENABLED: "true",
      AI_ENABLED: "true",
      AI_REPAIR_PROVIDER: "unsupported_provider_xyz",
      AI_REPAIR_MODEL: "some-model",
      AI_PROVIDER: undefined,
      AI_MODEL: undefined
    }, async () => {
      // Must not throw — orchestrator should catch it
      let result: Awaited<ReturnType<typeof runAiRepairOrchestrator>>;
      try {
        result = await runAiRepairOrchestrator(buildBaseInput());
      } catch (err) {
        assert.fail(`orchestrator must not throw; got: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      assert.strictEqual(result.status, "provider_error");
      assert.ok(typeof result.diagnostics.code === "string", "should include error code");
      assert.ok(typeof result.diagnostics.message === "string", "should include error message");
      assert.strictEqual(result.diagnostics.invocationsConsumed, 0, "no invocations consumed before provider is created");
    });
  });

  // 6. input.provider injection still works (for tests)
  await t.test("input.provider injection bypasses env resolution", async () => {
    await withEnv({
      AI_REPAIR_ENABLED: "true",
      AI_ENABLED: "true",
      AI_REPAIR_PROVIDER: undefined,
      AI_REPAIR_MODEL: undefined,
      AI_PROVIDER: undefined,
      AI_MODEL: undefined
    }, async () => {
      const injectedProvider = buildFakeProvider({
        providerName: "injected-provider",
        model: "injected-model",
        response: fakeRepairDecision("no_safe_action")
      });
      const result = await runAiRepairOrchestrator(buildBaseInput({ provider: injectedProvider }));
      // Should succeed (not provider_error) using injected provider
      assert.ok(
        result.status === "no_safe_action" || result.status === "repaired_plan" || result.status === "needs_more_context",
        `expected a decision-based status, got: ${result.status}`
      );
    });
  });

  // 7. Log shows effective provider and model (via diagnostics)
  await t.test("diagnostics include effective provider name", async () => {
    await withEnv({
      AI_REPAIR_ENABLED: "true"
    }, async () => {
      const injectedProvider = buildFakeProvider({
        providerName: "copilot_cli",
        model: "claude-opus-4.5",
        response: fakeRepairDecision("no_safe_action")
      });
      const result = await runAiRepairOrchestrator(buildBaseInput({ provider: injectedProvider }));
      // status must be a decision status
      assert.ok(result.status !== "provider_error", `unexpected provider_error: ${JSON.stringify(result.diagnostics)}`);
      // provider name should appear in diagnostics
      assert.strictEqual(result.diagnostics.provider, "copilot_cli");
    });
  });

  // 8. Pre-invocation failure (provider creation error) reports zero invocations consumed
  await t.test("pre-invocation provider_error has invocationsConsumed=0", async () => {
    await withEnv({
      AI_REPAIR_ENABLED: "true",
      AI_ENABLED: "true",
      AI_REPAIR_PROVIDER: "openai_compatible",
      AI_REPAIR_MODEL: "gpt-4",
      AI_BASE_URL: undefined,
      AI_API_KEY: undefined,
      AI_PROVIDER: undefined,
      AI_MODEL: undefined
    }, async () => {
      const result = await runAiRepairOrchestrator(buildBaseInput());
      assert.strictEqual(result.status, "provider_error");
      assert.strictEqual(result.diagnostics.invocationsConsumed, 0, "no tokens consumed before provider created");
    });
  });

  // 9. Deterministic route repair is separate (orchestrator status distinguishes AI vs deterministic)
  await t.test("orchestrator disabled (AI_REPAIR_ENABLED=false) returns provider_disabled, not a repair decision", async () => {
    await withEnv({ AI_REPAIR_ENABLED: "false" }, async () => {
      const result = await runAiRepairOrchestrator(buildBaseInput());
      assert.strictEqual(result.status, "provider_disabled");
      // This confirms deterministic route repairs don't flow through AI orchestrator
    });
  });

  // Additional: provider throws AiProviderError during completion → invocationsConsumed=1 (invocation was started)
  await t.test("AiProviderError during completion includes invocationsConsumed=1", async () => {
    await withEnv({ AI_REPAIR_ENABLED: "true" }, async () => {
      const throwingProvider = buildFakeProvider({
        throwError: new AiProviderError("ai_provider_timeout", "timed out after 60000ms")
      });
      const result = await runAiRepairOrchestrator(buildBaseInput({ provider: throwingProvider }));
      assert.strictEqual(result.status, "provider_error");
      assert.strictEqual(result.diagnostics.invocationsConsumed, 1, "invocation was started before it failed");
    });
  });

});
