import { test, expect } from "@playwright/test";
import { runCaseExecutionQueue } from "../src/runner/case-execution-queue";
import type { QueueItemContext, CaseExecutionQueueOptions, QueueLogger } from "../src/runner/case-execution-queue";

function makeSilentLogger(): { logs: string[]; logger: QueueLogger } {
  const logs: string[] = [];
  return {
    logs,
    logger: { log: (msg: string) => logs.push(msg) }
  };
}

test("executes items in order with concurrency=1", async () => {
  const executionOrder: number[] = [];
  const result = await runCaseExecutionQueue(
    [1, 2, 3, 4, 5],
    async (item) => {
      executionOrder.push(item);
      return item * 10;
    },
    { concurrency: 1 }
  );

  expect(executionOrder).toEqual([1, 2, 3, 4, 5]);
  expect(result.items.map((r) => r.value)).toEqual([10, 20, 30, 40, 50]);
  expect(result.total).toBe(5);
  expect(result.passed).toBe(5);
  expect(result.failed).toBe(0);
  expect(result.skipped).toBe(0);
});

test("does not start second item until first finishes with concurrency=1", async () => {
  const timestamps: { item: number; start: number; end: number }[] = [];

  await runCaseExecutionQueue(
    [1, 2, 3],
    async (item, _ctx) => {
      const start = Date.now();
      await new Promise((r) => setTimeout(r, 50));
      const end = Date.now();
      timestamps.push({ item, start, end });
      return item;
    },
    { concurrency: 1 }
  );

  expect(timestamps).toHaveLength(3);

  for (let i = 1; i < timestamps.length; i++) {
    expect(timestamps[i].start).toBeGreaterThanOrEqual(timestamps[i - 1].end - 5);
  }
});

test("preserves results in input order", async () => {
  const result = await runCaseExecutionQueue(
    ["a", "b", "c"],
    async (item) => `result-${item}`,
    { concurrency: 1 }
  );

  expect(result.items[0].value).toBe("result-a");
  expect(result.items[1].value).toBe("result-b");
  expect(result.items[2].value).toBe("result-c");
});

test("captures error and continues when stopOnFailure=false", async () => {
  const result = await runCaseExecutionQueue(
    [1, 2, 3, 4],
    async (item) => {
      if (item === 2) throw new Error("fail-on-2");
      return item;
    },
    { concurrency: 1, stopOnFailure: false }
  );

  expect(result.items).toHaveLength(4);
  expect(result.items[0].value).toBe(1);
  expect(result.items[1].error).toBeDefined();
  expect(result.items[1].error?.message).toBe("fail-on-2");
  expect(result.items[2].value).toBe(3);
  expect(result.items[3].value).toBe(4);
  expect(result.passed).toBe(3);
  expect(result.failed).toBe(1);
});

test("stops queue when stopOnFailure=true", async () => {
  const executed: number[] = [];

  const result = await runCaseExecutionQueue(
    [1, 2, 3, 4],
    async (item) => {
      executed.push(item);
      if (item === 2) throw new Error("fail-on-2");
      return item;
    },
    { concurrency: 1, stopOnFailure: true }
  );

  expect(executed).toEqual([1, 2]);
  expect(result.items).toHaveLength(4);
  expect(result.items[0].value).toBe(1);
  expect(result.items[1].error).toBeDefined();
  expect(result.items[2].value).toBeUndefined();
  expect(result.items[2].error).toBeUndefined();
  expect(result.items[3].value).toBeUndefined();
  expect(result.items[3].error).toBeUndefined();
  expect(result.passed).toBe(1);
  expect(result.failed).toBe(1);
  expect(result.skipped).toBe(2);
});

test("supports concurrency=2 when explicitly configured", async () => {
  const concurrentCount: { count: number; max: number } = { count: 0, max: 0 };

  await runCaseExecutionQueue(
    [1, 2, 3, 4, 5, 6],
    async (item) => {
      concurrentCount.count += 1;
      concurrentCount.max = Math.max(concurrentCount.max, concurrentCount.count);
      await new Promise((r) => setTimeout(r, 30));
      concurrentCount.count -= 1;
      return item;
    },
    { concurrency: 2 }
  );

  expect(concurrentCount.max).toBeGreaterThanOrEqual(2);
  expect(concurrentCount.max).toBeLessThanOrEqual(2);
});

test("logs include start/end/progress", async () => {
  const { logs, logger } = makeSilentLogger();

  await runCaseExecutionQueue(
    [1, 2],
    async (item) => item,
    { concurrency: 1, label: "test-queue" },
    logger
  );

  expect(logs.some((l) => l.includes("Starting queue: test-queue"))).toBe(true);
  expect(logs.some((l) => l.includes("Starting case 1/2"))).toBe(true);
  expect(logs.some((l) => l.includes("Finished case 1/2"))).toBe(true);
  expect(logs.some((l) => l.includes("Starting case 2/2"))).toBe(true);
  expect(logs.some((l) => l.includes("Finished case 2/2"))).toBe(true);
  expect(logs.some((l) => l.includes("Queue completed"))).toBe(true);
});

test("logs failure and continuation when stopOnFailure=false", async () => {
  const { logs, logger } = makeSilentLogger();

  await runCaseExecutionQueue(
    [1, 2, 3],
    async (item) => {
      if (item === 2) throw new Error("boom");
      return item;
    },
    { concurrency: 1, stopOnFailure: false },
    logger
  );

  expect(logs.some((l) => l.includes("Case failed"))).toBe(true);
  expect(logs.some((l) => l.includes("Continuing because stopOnFailure=false"))).toBe(true);
});

test("logs stopping when stopOnFailure=true", async () => {
  const { logs, logger } = makeSilentLogger();

  await runCaseExecutionQueue(
    [1, 2, 3],
    async (item) => {
      if (item === 2) throw new Error("boom");
      return item;
    },
    { concurrency: 1, stopOnFailure: true },
    logger
  );

  expect(logs.some((l) => l.includes("Stopping queue because stopOnFailure=true"))).toBe(true);
});

test("returns summary with total/passed/failed", async () => {
  const result = await runCaseExecutionQueue(
    [1, 2, 3, 4, 5],
    async (item) => {
      if (item === 3) throw new Error("fail");
      return item;
    },
    { concurrency: 1, stopOnFailure: false }
  );

  expect(result.total).toBe(5);
  expect(result.passed).toBe(4);
  expect(result.failed).toBe(1);
  expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
});

test("handles empty items array", async () => {
  const result = await runCaseExecutionQueue(
    [],
    async () => "x",
    { concurrency: 1 }
  );

  expect(result.items).toHaveLength(0);
  expect(result.total).toBe(0);
  expect(result.passed).toBe(0);
  expect(result.failed).toBe(0);
  expect(result.skipped).toBe(0);
});

test("default concurrency is 1 when not specified", async () => {
  const executionOrder: number[] = [];

  await runCaseExecutionQueue(
    [1, 2, 3],
    async (item) => {
      executionOrder.push(item);
      return item;
    }
  );

  expect(executionOrder).toEqual([1, 2, 3]);
});

test("provides correct context to worker", async () => {
  const contexts: QueueItemContext[] = [];

  await runCaseExecutionQueue(
    ["a", "b", "c"],
    async (_item, ctx) => {
      contexts.push(ctx);
      return _item;
    },
    { concurrency: 1, label: "my-label" }
  );

  expect(contexts).toHaveLength(3);
  expect(contexts[0].index).toBe(0);
  expect(contexts[1].index).toBe(1);
  expect(contexts[2].index).toBe(2);
  expect(contexts.every((c) => c.total === 3)).toBe(true);
  expect(contexts.every((c) => c.label === "my-label")).toBe(true);
});

test("durationMs is recorded per item", async () => {
  const result = await runCaseExecutionQueue(
    [1, 2],
    async (item) => {
      await new Promise((r) => setTimeout(r, 50));
      return item;
    },
    { concurrency: 1 }
  );

  expect(result.items[0].durationMs).toBeGreaterThanOrEqual(40);
  expect(result.items[1].durationMs).toBeGreaterThanOrEqual(40);
});

test("error durationMs is recorded", async () => {
  const result = await runCaseExecutionQueue(
    [1, 2],
    async (item) => {
      if (item === 2) {
        await new Promise((r) => setTimeout(r, 30));
        throw new Error("fail");
      }
      return item;
    },
    { concurrency: 1, stopOnFailure: false }
  );

  expect(result.items[1].durationMs).toBeGreaterThanOrEqual(20);
});
