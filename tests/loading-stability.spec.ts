import { strict as assert } from "node:assert";
import test from "node:test";
import { waitForStableInteractiveScreen } from "../src/runner/execution-plan-executor";

function fakePage(loadingStates: boolean[]): any {
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

test("loading blocks completion until it disappears", async () => {
  const result = await waitForStableInteractiveScreen(fakePage([true, true, false, false]));
  assert.equal(result.stable, true);
  assert.equal(result.signals.includes("spinner"), true);
});

test("permanent loading returns a diagnostic timeout", async () => {
  const previous = process.env.LOADING_STABILITY_TIMEOUT_MS;
  process.env.LOADING_STABILITY_TIMEOUT_MS = "1";
  try {
    const result = await waitForStableInteractiveScreen(fakePage([true]));
    assert.equal(result.stable, false);
    assert.equal(result.reason, "loading_timeout");
  } finally {
    if (previous === undefined) delete process.env.LOADING_STABILITY_TIMEOUT_MS;
    else process.env.LOADING_STABILITY_TIMEOUT_MS = previous;
  }
});

test("without loading, existing fast stability behavior remains", async () => {
  const result = await waitForStableInteractiveScreen(fakePage([false]));
  assert.equal(result.stable, true);
  assert.deepEqual(result.signals, []);
});

test("pending action transport blocks the next scan until it settles", async () => {
  let pendingPolls = 2;
  const result = await waitForStableInteractiveScreen(fakePage([false]), {
    progressProbe: () => pendingPolls-- > 0,
    waitForPendingTransport: true,
  });
  assert.equal(result.stable, true);
  assert.equal(result.signals.includes("network_pending"), true);
});
