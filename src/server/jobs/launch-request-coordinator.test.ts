import { describe, expect, it } from "vitest";
import { coordinateLaunchRequest } from "./launch-request-coordinator";

describe("launch request idempotency", () => {
  it("coalesces simultaneous identical launches when older clients omit a key", async () => {
    const body = { appSlug: "profile-a", selectedScenarios: [{ scenarioId: "A-1" }] };
    let calls = 0;
    let finish!: (value: { launchId: string }) => void;
    const execute = () => {
      calls += 1;
      return new Promise<{ launchId: string }>((resolve) => { finish = resolve; });
    };

    const first = coordinateLaunchRequest(body, undefined, execute);
    const duplicate = coordinateLaunchRequest({ selectedScenarios: [{ scenarioId: "A-1" }], appSlug: "profile-a" }, undefined, execute);
    expect(calls).toBe(1);
    finish({ launchId: "launch-1" });
    await expect(first).resolves.toEqual({ result: { launchId: "launch-1" }, replayed: false });
    await expect(duplicate).resolves.toEqual({ result: { launchId: "launch-1" }, replayed: true });
  });

  it("replays a completed launch for the same explicit key", async () => {
    let calls = 0;
    const execute = async () => ({ launchId: `launch-${++calls}` });
    await expect(coordinateLaunchRequest({ selection: [1] }, "launch-action-1", execute))
      .resolves.toEqual({ result: { launchId: "launch-1" }, replayed: false });
    await expect(coordinateLaunchRequest({ selection: [1] }, "launch-action-1", execute))
      .resolves.toEqual({ result: { launchId: "launch-1" }, replayed: true });
    expect(calls).toBe(1);
  });

  it("rejects reuse of a key for a different launch payload", async () => {
    await coordinateLaunchRequest({ selection: [1] }, "launch-action-conflict", async () => "first");
    await expect(coordinateLaunchRequest({ selection: [2] }, "launch-action-conflict", async () => "second"))
      .rejects.toThrow("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_LAUNCH");
  });
});
