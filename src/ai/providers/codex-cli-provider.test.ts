import assert from "node:assert";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import test from "node:test";
import { CodexCliProvider, __setRunCodexCliForTesting } from "./codex-cli-provider";
import { runCodexCli } from "../../agent/codex-cli-runner";
import type { AiCompletionRequest } from "../ai-provider.types";
import type { CodexCliRunnerInput, CodexCliRunnerResult } from "../../types/codex-auto-repair.types";

function buildScenarioRequest(): AiCompletionRequest {
  return {
    purpose: "scenario_generation",
    requireJson: true,
    messages: [
      { role: "system", content: "Generate scenarios." },
      { role: "user", content: "Return a JSON object with scenarios." },
    ],
  };
}

function buildSpecGenerationRequest(): AiCompletionRequest {
  return {
    purpose: "spec_generation",
    requireJson: true,
    messages: [
      { role: "system", content: "Generate Playwright spec." },
      { role: "user", content: "Return a JSON object with specContent and coverage." },
    ],
  };
}

function buildProvider(): CodexCliProvider {
  return new CodexCliProvider({
    providerName: "codex-test",
    model: "mock-model",
    timeoutMs: 5000,
    command: "codex",
    extraArgs: [],
  });
}

async function writeScenarioFile(cwd: string): Promise<void> {
  const outputPath = path.join(cwd, "scenario-generation-result.json");
  await fs.writeFile(outputPath, JSON.stringify({ scenarios: [] }), "utf-8");
}

async function writeSpecGenerationFile(cwd: string): Promise<void> {
  const outputPath = path.join(cwd, "spec-generation-result.json");
  await fs.writeFile(outputPath, JSON.stringify({
    specContent: "import { test } from '@playwright/test';\ntest('x', async () => {});",
    coveredStepIndexes: [1],
    coveredAssertions: [],
    usedPageObjects: [],
    declaredIdentifiers: [],
    unresolvedRequirements: [],
    warnings: []
  }), "utf-8");
}

function baseRunnerResult(): CodexCliRunnerResult {
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    durationMs: 1500,
  };
}

test("CodexCliProvider usage bridge", async (t) => {
  await t.test("passes taskType=generation when purpose is scenario_generation", async () => {
    const provider = buildProvider();
    let receivedInput: CodexCliRunnerInput | undefined;

    __setRunCodexCliForTesting(async (input) => {
      receivedInput = input;
      await writeScenarioFile(input.cwd);
      return {
        ...baseRunnerResult(),
        usage: {
          timestamp: "2026-01-01T00:00:00.000Z",
          provider: "codex_cli",
          model: "mock-model",
          taskType: "generation",
          inputTokens: 100,
          cachedInputTokens: 60,
          cacheWriteInputTokens: 0,
          nonCachedInputTokens: 40,
          outputTokens: 20,
          reasoningOutputTokens: 5,
          totalPhysicalTokens: 120,
          durationMs: 1500,
          exitCode: 0,
          success: true,
        },
      };
    });

    try {
      await provider.completeJson(buildScenarioRequest());
      assert.strictEqual(receivedInput?.taskType, "generation");
    } finally {
      __setRunCodexCliForTesting(runCodexCli);
    }
  });

  await t.test("passes taskType=generation when purpose is spec_generation", async () => {
    const provider = buildProvider();
    let receivedInput: CodexCliRunnerInput | undefined;

    __setRunCodexCliForTesting(async (input) => {
      receivedInput = input;
      await writeSpecGenerationFile(input.cwd);
      return {
        ...baseRunnerResult(),
      };
    });

    try {
      await provider.completeJson(buildSpecGenerationRequest());
      assert.strictEqual(receivedInput?.taskType, "generation");
    } finally {
      __setRunCodexCliForTesting(runCodexCli);
    }
  });

  await t.test("propagates full usage metrics without recomputing totals", async () => {
    const provider = buildProvider();

    __setRunCodexCliForTesting(async (input) => {
      await writeScenarioFile(input.cwd);
      return {
        ...baseRunnerResult(),
        usage: {
          timestamp: "2026-01-01T00:00:00.000Z",
          provider: "codex_cli",
          model: "mock-model",
          taskType: "generation",
          inputTokens: 100,
          cachedInputTokens: 60,
          cacheWriteInputTokens: 0,
          nonCachedInputTokens: 40,
          outputTokens: 20,
          reasoningOutputTokens: 5,
          totalPhysicalTokens: 120,
          durationMs: 1500,
          exitCode: 0,
          success: true,
        },
      };
    });

    try {
      const response = await provider.completeJson(buildScenarioRequest());
      assert.strictEqual(response.usage?.inputTokens, 100);
      assert.strictEqual(response.usage?.cachedInputTokens, 60);
      assert.strictEqual(response.usage?.cacheWriteInputTokens, 0);
      assert.strictEqual(response.usage?.nonCachedInputTokens, 40);
      assert.strictEqual(response.usage?.outputTokens, 20);
      assert.strictEqual(response.usage?.reasoningOutputTokens, 5);
      assert.strictEqual(response.usage?.totalPhysicalTokens, 120);
      assert.strictEqual(response.usage?.durationMs, 1500);
      assert.strictEqual(response.usage?.success, true);
    } finally {
      __setRunCodexCliForTesting(runCodexCli);
    }
  });

  await t.test("keeps partial usage fields without inventing values", async () => {
    const provider = buildProvider();

    __setRunCodexCliForTesting(async (input) => {
      await writeScenarioFile(input.cwd);
      return {
        ...baseRunnerResult(),
        usage: {
          inputTokens: 100,
          outputTokens: 20,
        } as any,
      };
    });

    try {
      const response = await provider.completeJson(buildScenarioRequest());
      assert.strictEqual(response.usage?.inputTokens, 100);
      assert.strictEqual(response.usage?.outputTokens, 20);
      assert.strictEqual(response.usage?.cachedInputTokens, undefined);
      assert.strictEqual(response.usage?.nonCachedInputTokens, undefined);
      assert.strictEqual(response.usage?.totalPhysicalTokens, undefined);
      assert.strictEqual(Number.isNaN(response.usage?.cachedInputTokens), false);
    } finally {
      __setRunCodexCliForTesting(runCodexCli);
    }
  });

  await t.test("preserves usage on non-zero exit when JSON is valid", async () => {
    const provider = buildProvider();

    __setRunCodexCliForTesting(async (input) => {
      await writeScenarioFile(input.cwd);
      return {
        ...baseRunnerResult(),
        exitCode: 17,
        stderr: "simulated warning",
        usage: {
          inputTokens: 100,
          outputTokens: 20,
          totalPhysicalTokens: 120,
          success: false,
        } as any,
      };
    });

    try {
      const response = await provider.completeJson(buildScenarioRequest());
      assert.strictEqual(response.diagnostics?.warning, "ai_provider_exited_non_zero_but_output_valid");
      assert.strictEqual(response.diagnostics?.exitCode, 17);
      assert.strictEqual(response.usage?.inputTokens, 100);
      assert.strictEqual(response.usage?.outputTokens, 20);
      assert.strictEqual(response.usage?.totalPhysicalTokens, 120);
      assert.strictEqual(response.usage?.success, false);
    } finally {
      __setRunCodexCliForTesting(runCodexCli);
    }
  });
});

const VALID_SPEC_OUTPUT = {
  specContent: "import { test } from '@playwright/test';\ntest('y', async () => {});",
  coveredStepIndexes: [1],
  coveredAssertions: [],
  usedPageObjects: [],
  declaredIdentifiers: [],
  unresolvedRequirements: [],
  warnings: [],
};

async function captureConsoleLogs(fn: () => Promise<void>): Promise<string[]> {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return logs;
}

test("C7 spec generation resolves structured output from result file with result_file log", async () => {
  const provider = buildProvider();
  let runCount = 0;

  __setRunCodexCliForTesting(async (input) => {
    runCount += 1;
    await writeSpecGenerationFile(input.cwd);
    return baseRunnerResult();
  });

  try {
    const logs = await captureConsoleLogs(async () => {
      const response = await provider.completeJson(buildSpecGenerationRequest());
      assert.strictEqual(typeof response.parsedJson?.specContent, "string");
      assert.ok(String(response.parsedJson?.specContent).includes("test('x'"));
    });
    assert.strictEqual(runCount, 1);
    assert.ok(logs.some((line) => line.includes("[codex-output] source=result_file schemaValid=true")));
  } finally {
    __setRunCodexCliForTesting(runCodexCli);
  }
});

test("C8 recovers valid JSON from stdout when result file is missing, without an extra AI invocation", async () => {
  const provider = buildProvider();
  let runCount = 0;

  __setRunCodexCliForTesting(async () => {
    runCount += 1;
    return { ...baseRunnerResult(), stdout: JSON.stringify(VALID_SPEC_OUTPUT) };
  });

  try {
    const logs = await captureConsoleLogs(async () => {
      const response = await provider.completeJson(buildSpecGenerationRequest());
      assert.strictEqual(response.parsedJson?.specContent, VALID_SPEC_OUTPUT.specContent);
      assert.strictEqual(response.diagnostics, undefined);
    });
    assert.strictEqual(runCount, 1);
    assert.ok(logs.some((line) => line.includes("[codex-output] source=stdout schemaValid=true")));
    assert.ok(logs.some((line) => line.includes("[codex-output] recovered=true extraAiInvocation=false")));
  } finally {
    __setRunCodexCliForTesting(runCodexCli);
  }
});

test("C9 fails with ai_provider_output_missing when neither file nor parseable stdout exists", async () => {
  const provider = buildProvider();

  __setRunCodexCliForTesting(async () => ({
    ...baseRunnerResult(),
    stdout: "Wrote [spec-generation-result.json](some-path) but I did not include JSON.",
  }));

  try {
    await assert.rejects(provider.completeJson(buildSpecGenerationRequest()), (err: any) => {
      assert.strictEqual(err.code, "ai_provider_output_missing");
      return true;
    });
  } finally {
    __setRunCodexCliForTesting(runCodexCli);
  }
});

test("C10 fails closed with ai_provider_invalid_json when output JSON has an invalid spec shape", async () => {
  const provider = buildProvider();

  __setRunCodexCliForTesting(async (input) => {
    await fs.writeFile(path.join(input.cwd, "spec-generation-result.json"), JSON.stringify({ greeting: "hello" }), "utf-8");
    return baseRunnerResult();
  });

  try {
    await assert.rejects(provider.completeJson(buildSpecGenerationRequest()), (err: any) => {
      assert.strictEqual(err.code, "ai_provider_invalid_json");
      return true;
    });
  } finally {
    __setRunCodexCliForTesting(runCodexCli);
  }
});

test("C11 stdout recovery performs exactly one provider invocation (aiAttempts stays one)", async () => {
  const provider = buildProvider();
  let runCount = 0;

  __setRunCodexCliForTesting(async () => {
    runCount += 1;
    return { ...baseRunnerResult(), stdout: JSON.stringify({ ...VALID_SPEC_OUTPUT, specContent: `call${runCount}` }) };
  });

  try {
    const response = await provider.completeJson(buildSpecGenerationRequest());
    assert.strictEqual(runCount, 1);
    assert.strictEqual(response.parsedJson?.specContent, "call1");
  } finally {
    __setRunCodexCliForTesting(runCodexCli);
  }
});

test("C12 stdout recovery is transport-level and does not consume the repair budget", async () => {
  const provider = buildProvider();

  __setRunCodexCliForTesting(async () => ({
    ...baseRunnerResult(),
    stdout: JSON.stringify(VALID_SPEC_OUTPUT),
  }));

  try {
    const logs = await captureConsoleLogs(async () => {
      const response = await provider.completeJson(buildSpecGenerationRequest());
      // Clean success: no warning, no non-zero exit, no repair-flavored diagnostics.
      assert.strictEqual(response.diagnostics, undefined);
      assert.strictEqual(response.usage?.exitCode, undefined);
    });
    assert.ok(logs.some((line) => line.includes("recovered=true extraAiInvocation=false")));
    assert.ok(!logs.some((line) => line.includes("repair")));
  } finally {
    __setRunCodexCliForTesting(runCodexCli);
  }
});
