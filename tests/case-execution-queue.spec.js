"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const case_execution_queue_1 = require("../src/runner/case-execution-queue");
function makeSilentLogger() {
    const logs = [];
    return {
        logs,
        logger: { log: (msg) => logs.push(msg) }
    };
}
(0, test_1.test)("executes items in order with concurrency=1", async () => {
    const executionOrder = [];
    const result = await (0, case_execution_queue_1.runCaseExecutionQueue)([1, 2, 3, 4, 5], async (item) => {
        executionOrder.push(item);
        return item * 10;
    }, { concurrency: 1 });
    (0, test_1.expect)(executionOrder).toEqual([1, 2, 3, 4, 5]);
    (0, test_1.expect)(result.items.map((r) => r.value)).toEqual([10, 20, 30, 40, 50]);
    (0, test_1.expect)(result.total).toBe(5);
    (0, test_1.expect)(result.passed).toBe(5);
    (0, test_1.expect)(result.failed).toBe(0);
    (0, test_1.expect)(result.skipped).toBe(0);
});
(0, test_1.test)("does not start second item until first finishes with concurrency=1", async () => {
    const timestamps = [];
    await (0, case_execution_queue_1.runCaseExecutionQueue)([1, 2, 3], async (item, _ctx) => {
        const start = Date.now();
        await new Promise((r) => setTimeout(r, 50));
        const end = Date.now();
        timestamps.push({ item, start, end });
        return item;
    }, { concurrency: 1 });
    (0, test_1.expect)(timestamps).toHaveLength(3);
    for (let i = 1; i < timestamps.length; i++) {
        (0, test_1.expect)(timestamps[i].start).toBeGreaterThanOrEqual(timestamps[i - 1].end - 5);
    }
});
(0, test_1.test)("preserves results in input order", async () => {
    const result = await (0, case_execution_queue_1.runCaseExecutionQueue)(["a", "b", "c"], async (item) => `result-${item}`, { concurrency: 1 });
    (0, test_1.expect)(result.items[0].value).toBe("result-a");
    (0, test_1.expect)(result.items[1].value).toBe("result-b");
    (0, test_1.expect)(result.items[2].value).toBe("result-c");
});
(0, test_1.test)("captures error and continues when stopOnFailure=false", async () => {
    const result = await (0, case_execution_queue_1.runCaseExecutionQueue)([1, 2, 3, 4], async (item) => {
        if (item === 2)
            throw new Error("fail-on-2");
        return item;
    }, { concurrency: 1, stopOnFailure: false });
    (0, test_1.expect)(result.items).toHaveLength(4);
    (0, test_1.expect)(result.items[0].value).toBe(1);
    (0, test_1.expect)(result.items[1].error).toBeDefined();
    (0, test_1.expect)(result.items[1].error?.message).toBe("fail-on-2");
    (0, test_1.expect)(result.items[2].value).toBe(3);
    (0, test_1.expect)(result.items[3].value).toBe(4);
    (0, test_1.expect)(result.passed).toBe(3);
    (0, test_1.expect)(result.failed).toBe(1);
});
(0, test_1.test)("stops queue when stopOnFailure=true", async () => {
    const executed = [];
    const result = await (0, case_execution_queue_1.runCaseExecutionQueue)([1, 2, 3, 4], async (item) => {
        executed.push(item);
        if (item === 2)
            throw new Error("fail-on-2");
        return item;
    }, { concurrency: 1, stopOnFailure: true });
    (0, test_1.expect)(executed).toEqual([1, 2]);
    (0, test_1.expect)(result.items).toHaveLength(4);
    (0, test_1.expect)(result.items[0].value).toBe(1);
    (0, test_1.expect)(result.items[1].error).toBeDefined();
    (0, test_1.expect)(result.items[2].value).toBeUndefined();
    (0, test_1.expect)(result.items[2].error).toBeUndefined();
    (0, test_1.expect)(result.items[3].value).toBeUndefined();
    (0, test_1.expect)(result.items[3].error).toBeUndefined();
    (0, test_1.expect)(result.passed).toBe(1);
    (0, test_1.expect)(result.failed).toBe(1);
    (0, test_1.expect)(result.skipped).toBe(2);
});
(0, test_1.test)("supports concurrency=2 when explicitly configured", async () => {
    const concurrentCount = { count: 0, max: 0 };
    await (0, case_execution_queue_1.runCaseExecutionQueue)([1, 2, 3, 4, 5, 6], async (item) => {
        concurrentCount.count += 1;
        concurrentCount.max = Math.max(concurrentCount.max, concurrentCount.count);
        await new Promise((r) => setTimeout(r, 30));
        concurrentCount.count -= 1;
        return item;
    }, { concurrency: 2 });
    (0, test_1.expect)(concurrentCount.max).toBeGreaterThanOrEqual(2);
    (0, test_1.expect)(concurrentCount.max).toBeLessThanOrEqual(2);
});
(0, test_1.test)("logs include start/end/progress", async () => {
    const { logs, logger } = makeSilentLogger();
    await (0, case_execution_queue_1.runCaseExecutionQueue)([1, 2], async (item) => item, { concurrency: 1, label: "test-queue" }, logger);
    (0, test_1.expect)(logs.some((l) => l.includes("Starting queue: test-queue"))).toBe(true);
    (0, test_1.expect)(logs.some((l) => l.includes("Starting case 1/2"))).toBe(true);
    (0, test_1.expect)(logs.some((l) => l.includes("Finished case 1/2"))).toBe(true);
    (0, test_1.expect)(logs.some((l) => l.includes("Starting case 2/2"))).toBe(true);
    (0, test_1.expect)(logs.some((l) => l.includes("Finished case 2/2"))).toBe(true);
    (0, test_1.expect)(logs.some((l) => l.includes("Queue completed"))).toBe(true);
});
(0, test_1.test)("logs failure and continuation when stopOnFailure=false", async () => {
    const { logs, logger } = makeSilentLogger();
    await (0, case_execution_queue_1.runCaseExecutionQueue)([1, 2, 3], async (item) => {
        if (item === 2)
            throw new Error("boom");
        return item;
    }, { concurrency: 1, stopOnFailure: false }, logger);
    (0, test_1.expect)(logs.some((l) => l.includes("Case failed"))).toBe(true);
    (0, test_1.expect)(logs.some((l) => l.includes("Continuing because stopOnFailure=false"))).toBe(true);
});
(0, test_1.test)("logs stopping when stopOnFailure=true", async () => {
    const { logs, logger } = makeSilentLogger();
    await (0, case_execution_queue_1.runCaseExecutionQueue)([1, 2, 3], async (item) => {
        if (item === 2)
            throw new Error("boom");
        return item;
    }, { concurrency: 1, stopOnFailure: true }, logger);
    (0, test_1.expect)(logs.some((l) => l.includes("Stopping queue because stopOnFailure=true"))).toBe(true);
});
(0, test_1.test)("returns summary with total/passed/failed", async () => {
    const result = await (0, case_execution_queue_1.runCaseExecutionQueue)([1, 2, 3, 4, 5], async (item) => {
        if (item === 3)
            throw new Error("fail");
        return item;
    }, { concurrency: 1, stopOnFailure: false });
    (0, test_1.expect)(result.total).toBe(5);
    (0, test_1.expect)(result.passed).toBe(4);
    (0, test_1.expect)(result.failed).toBe(1);
    (0, test_1.expect)(result.totalDurationMs).toBeGreaterThanOrEqual(0);
});
(0, test_1.test)("handles empty items array", async () => {
    const result = await (0, case_execution_queue_1.runCaseExecutionQueue)([], async () => "x", { concurrency: 1 });
    (0, test_1.expect)(result.items).toHaveLength(0);
    (0, test_1.expect)(result.total).toBe(0);
    (0, test_1.expect)(result.passed).toBe(0);
    (0, test_1.expect)(result.failed).toBe(0);
    (0, test_1.expect)(result.skipped).toBe(0);
});
(0, test_1.test)("default concurrency is 1 when not specified", async () => {
    const executionOrder = [];
    await (0, case_execution_queue_1.runCaseExecutionQueue)([1, 2, 3], async (item) => {
        executionOrder.push(item);
        return item;
    });
    (0, test_1.expect)(executionOrder).toEqual([1, 2, 3]);
});
(0, test_1.test)("provides correct context to worker", async () => {
    const contexts = [];
    await (0, case_execution_queue_1.runCaseExecutionQueue)(["a", "b", "c"], async (_item, ctx) => {
        contexts.push(ctx);
        return _item;
    }, { concurrency: 1, label: "my-label" });
    (0, test_1.expect)(contexts).toHaveLength(3);
    (0, test_1.expect)(contexts[0].index).toBe(0);
    (0, test_1.expect)(contexts[1].index).toBe(1);
    (0, test_1.expect)(contexts[2].index).toBe(2);
    (0, test_1.expect)(contexts.every((c) => c.total === 3)).toBe(true);
    (0, test_1.expect)(contexts.every((c) => c.label === "my-label")).toBe(true);
});
(0, test_1.test)("durationMs is recorded per item", async () => {
    const result = await (0, case_execution_queue_1.runCaseExecutionQueue)([1, 2], async (item) => {
        await new Promise((r) => setTimeout(r, 50));
        return item;
    }, { concurrency: 1 });
    (0, test_1.expect)(result.items[0].durationMs).toBeGreaterThanOrEqual(40);
    (0, test_1.expect)(result.items[1].durationMs).toBeGreaterThanOrEqual(40);
});
(0, test_1.test)("error durationMs is recorded", async () => {
    const result = await (0, case_execution_queue_1.runCaseExecutionQueue)([1, 2], async (item) => {
        if (item === 2) {
            await new Promise((r) => setTimeout(r, 30));
            throw new Error("fail");
        }
        return item;
    }, { concurrency: 1, stopOnFailure: false });
    (0, test_1.expect)(result.items[1].durationMs).toBeGreaterThanOrEqual(20);
});
