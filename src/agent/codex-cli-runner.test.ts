import assert from "node:assert";
import { EventEmitter } from "node:events";
import path from "node:path";
import os from "node:os";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn as nodeSpawn } from "node:child_process";
import { __setSpawnForTesting, runCodexCli } from "./codex-cli-runner";

const tests: Array<{ label: string; fn: () => Promise<void> | void }> = [];

function test(label: string, fn: () => Promise<void> | void): void { tests.push({ label, fn }); }

function describe(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

class FakeChildProcess extends EventEmitter {
  public readonly stdout = new EventEmitter();
  public readonly stderr = new EventEmitter();

  kill(_signal?: NodeJS.Signals): boolean {
    this.emit("close", null, "SIGTERM");
    return true;
  }
}

type SpawnPlan = {
  stdoutLines: string[];
  stderrLines?: string[];
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
};

function installSpawnPlan(plan: SpawnPlan): void {
  __setSpawnForTesting((() => {
    const child = new FakeChildProcess() as any;
    setTimeout(() => {
      for (const line of plan.stdoutLines) {
        child.stdout.emit("data", `${line}\n`);
      }
      for (const line of plan.stderrLines ?? []) {
        child.stderr.emit("data", `${line}\n`);
      }
      child.emit("close", plan.exitCode ?? 0, plan.signal ?? null);
    }, 0);
    return child;
  }) as typeof nodeSpawn);
}

async function withTempCwd(fn: (dir: string) => Promise<void>): Promise<void> {
  const originalCwd = process.cwd();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "codex-cli-runner-test-"));
  process.chdir(tempDir);
  try {
    await fn(tempDir);
  } finally {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
  }
}

function readLastJsonlLine(content: string): Record<string, unknown> {
  const lines = content.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  assert.ok(lines.length > 0, "metrics file should contain at least one line");
  return JSON.parse(lines[lines.length - 1]) as Record<string, unknown>;
}

describe("runCodexCli usage instrumentation", () => {
  test("parses turn.completed usage, keeps last agent_message, and persists JSONL", async () => {
    await withTempCwd(async (cwd) => {
      installSpawnPlan({
        stdoutLines: [
          JSON.stringify({ type: "item.completed", item: { type: "agent_message", content: [{ type: "output_text", text: "first draft" }] } }),
          JSON.stringify({ type: "item.completed", item: { type: "agent_message", content: [{ type: "output_text", text: "final answer" }] } }),
          JSON.stringify({
            type: "turn.completed",
            model: "gpt-5.4",
            usage: {
              inputTokens: 120,
              cachedInputTokens: 20,
              cacheWriteInputTokens: 7,
              outputTokens: 40,
              reasoningOutputTokens: 9
            }
          })
        ]
      });

      const result = await runCodexCli({
        command: "codex",
        extraArgs: ["--model", "gpt-5.4"],
        prompt: "safe prompt",
        cwd,
        timeoutMs: 5000,
        taskType: "generation"
      });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.stdout, "final answer");
      assert.ok(result.usage, "usage should be present when turn.completed is emitted");
      assert.strictEqual(result.usage?.inputTokens, 120);
      assert.strictEqual(result.usage?.cachedInputTokens, 20);
      assert.strictEqual(result.usage?.cacheWriteInputTokens, 7);
      assert.strictEqual(result.usage?.nonCachedInputTokens, 100);
      assert.strictEqual(result.usage?.outputTokens, 40);
      assert.strictEqual(result.usage?.reasoningOutputTokens, 9);
      assert.strictEqual(result.usage?.totalPhysicalTokens, 160, "reasoningOutputTokens must not be re-added");

      const metricsPath = path.join(cwd, ".artifacts", "metrics", "codex-usage.jsonl");
      const metricsContent = await readFile(metricsPath, "utf-8");
      const record = readLastJsonlLine(metricsContent);
      assert.strictEqual(record.provider, "codex_cli");
      assert.strictEqual(record.model, "gpt-5.4");
      assert.strictEqual(record.taskType, "generation");
      assert.strictEqual(record.nonCachedInputTokens, 100);
      assert.strictEqual(record.totalPhysicalTokens, 160);
      assert.strictEqual(record.success, true);
    });
  });

  test("missing usage does not break response and keeps compatibility", async () => {
    await withTempCwd(async (cwd) => {
      installSpawnPlan({
        stdoutLines: [
          JSON.stringify({ type: "item.completed", item: { type: "agent_message", content: [{ text: "{\"ok\":true}" }] } })
        ]
      });

      const result = await runCodexCli({
        command: "codex",
        extraArgs: [],
        prompt: "prompt",
        cwd,
        timeoutMs: 5000
      });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.stdout, "{\"ok\":true}");
      assert.strictEqual(result.usage, undefined, "usage should remain optional when unavailable");

      const metricsPath = path.join(cwd, ".artifacts", "metrics", "codex-usage.jsonl");
      const metricsContent = await readFile(metricsPath, "utf-8");
      const record = readLastJsonlLine(metricsContent);
      assert.strictEqual(record.taskType, "unknown");
      assert.strictEqual(record.inputTokens, 0);
      assert.strictEqual(record.outputTokens, 0);
      assert.strictEqual(record.success, true);
    });
  });

  test("invalid JSONL line is tolerated without leaking prompt content", async () => {
    await withTempCwd(async (cwd) => {
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => {
        logs.push(args.map(arg => String(arg)).join(" "));
      };

      try {
        installSpawnPlan({
          stdoutLines: [
            "NOT_JSON_LINE",
            JSON.stringify({ type: "item.completed", item: { type: "agent_message", content: [{ text: "safe result" }] } })
          ]
        });

        const result = await runCodexCli({
          command: "codex",
          extraArgs: ["--model", "gpt-5.3-codex"],
          prompt: "very-secret-prompt-123",
          cwd,
          timeoutMs: 5000,
          taskType: "repair"
        });

        assert.strictEqual(result.exitCode, 0);
        assert.strictEqual(result.stdout, "safe result");
        assert.ok(!logs.join("\n").includes("very-secret-prompt-123"), "logs must not contain prompt content");
      } finally {
        console.log = originalLog;
      }
    });
  });
});

void (async () => {
  try {
    for (const t of tests) {
      try {
        await t.fn();
        console.log(`  PASS  ${t.label}`);
      } catch (err) {
        console.error(`  FAIL  ${t.label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      }
    }
  } finally {
    __setSpawnForTesting(nodeSpawn);
  }
})();
