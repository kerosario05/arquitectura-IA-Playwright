"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const node_test_1 = __importDefault(require("node:test"));
const execution_plan_executor_1 = require("../src/runner/execution-plan-executor");
function fakePage(loadingStates) {
    let poll = 0;
    const current = () => loadingStates[Math.min(poll, loadingStates.length - 1)] ?? false;
    return {
        locator: () => ({
            count: async () => current() ? 1 : 0,
            first: () => ({ isVisible: async () => current() }),
        }),
        waitForTimeout: async () => { poll += 1; },
    };
}
(0, node_test_1.default)("loading blocks completion until it disappears", async () => {
    const result = await (0, execution_plan_executor_1.waitForStableInteractiveScreen)(fakePage([true, true, false, false]));
    node_assert_1.strict.equal(result.stable, true);
    node_assert_1.strict.equal(result.signals.includes("spinner"), true);
});
(0, node_test_1.default)("permanent loading returns a diagnostic timeout", async () => {
    const previous = process.env.LOADING_STABILITY_TIMEOUT_MS;
    process.env.LOADING_STABILITY_TIMEOUT_MS = "1";
    try {
        const result = await (0, execution_plan_executor_1.waitForStableInteractiveScreen)(fakePage([true]));
        node_assert_1.strict.equal(result.stable, false);
        node_assert_1.strict.equal(result.reason, "loading_timeout");
    }
    finally {
        if (previous === undefined)
            delete process.env.LOADING_STABILITY_TIMEOUT_MS;
        else
            process.env.LOADING_STABILITY_TIMEOUT_MS = previous;
    }
});
(0, node_test_1.default)("without loading, existing fast stability behavior remains", async () => {
    const result = await (0, execution_plan_executor_1.waitForStableInteractiveScreen)(fakePage([false]));
    node_assert_1.strict.equal(result.stable, true);
    node_assert_1.strict.deepEqual(result.signals, []);
});
(0, node_test_1.default)("pending action transport blocks the next scan until it settles", async () => {
    let pendingPolls = 2;
    const result = await (0, execution_plan_executor_1.waitForStableInteractiveScreen)(fakePage([false]), {
        progressProbe: () => pendingPolls-- > 0,
        waitForPendingTransport: true,
    });
    node_assert_1.strict.equal(result.stable, true);
    node_assert_1.strict.equal(result.signals.includes("network_pending"), true);
});
