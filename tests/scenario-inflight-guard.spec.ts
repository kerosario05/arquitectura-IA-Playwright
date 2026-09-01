import { test, expect } from "@playwright/test";
import {
  buildScenarioPreviewInFlightKey,
  runScenarioPreviewInFlight,
  getScenarioInFlightCount,
  scenarioInFlightHas,
} from "../src/scenarios/scenario-inflight-guard";

function keyFor(overrides: Parameters<typeof buildScenarioPreviewInFlightKey>[0] = {}) {
  return buildScenarioPreviewInFlightKey({
    appSlug: "test-app",
    projectKey: "TEST",
    sprintId: 1,
    activeSprint: false,
    status: "In Progress",
    selectedIssueKeys: ["TEST-1"],
    ...overrides,
  });
}

test("2 simultaneous equivalent requests → generatorCalls=1, both receive result", async () => {
  let calls = 0;
  const slowGen = async (): Promise<string> => {
    calls++;
    await new Promise((r) => setTimeout(r, 50));
    return "RESULT";
  };

  const key = keyFor();
  const [a, b] = await Promise.all([
    runScenarioPreviewInFlight(key, slowGen),
    runScenarioPreviewInFlight(key, slowGen),
  ]);

  expect(calls).toBe(1);
  expect(a).toBe("RESULT");
  expect(b).toBe("RESULT");
  // Released after completion — no permanent cache
  expect(scenarioInFlightHas(key)).toBe(false);
  expect(getScenarioInFlightCount()).toBe(0);
});

test("requests with different keys → generatorCalls=2", async () => {
  let calls = 0;
  const gen = async (): Promise<string> => {
    calls++;
    return "R";
  };

  const k1 = keyFor({ selectedIssueKeys: ["TEST-1"] });
  const k2 = keyFor({ selectedIssueKeys: ["TEST-2"] });
  expect(k1).not.toBe(k2);

  const [a, b] = await Promise.all([
    runScenarioPreviewInFlight(k1, gen),
    runScenarioPreviewInFlight(k2, gen),
  ]);

  expect(calls).toBe(2);
  expect(a).toBe("R");
  expect(b).toBe("R");
  expect(getScenarioInFlightCount()).toBe(0);
});

test("same issueKey + different huFingerprint (revision) → different keys → generatorCalls=2", async () => {
  let calls = 0;
  const gen = async (): Promise<string> => {
    calls++;
    return "R";
  };

  // Same request params, same issueKey — only huFingerprint differs (simulates
  // a HU modified in Jira between two concurrent requests).
  const k1 = keyFor({
    selectedIssueKeys: ["AA-X"],
    huFingerprint: "rev_aaaa0001",
  });
  const k2 = keyFor({
    selectedIssueKeys: ["AA-X"],
    huFingerprint: "rev_bbbb0002",
  });
  expect(k1).not.toBe(k2);

  const [a, b] = await Promise.all([
    runScenarioPreviewInFlight(k1, gen),
    runScenarioPreviewInFlight(k2, gen),
  ]);

  expect(calls).toBe(2);
  expect(a).toBe("R");
  expect(b).toBe("R");
  expect(getScenarioInFlightCount()).toBe(0);
});

test("same issueKey + same huFingerprint → same key → generatorCalls=1 (joined)", async () => {
  let calls = 0;
  const slowGen = async (): Promise<string> => {
    calls++;
    await new Promise((r) => setTimeout(r, 50));
    return "RESULT";
  };

  const k1 = keyFor({
    selectedIssueKeys: ["AA-X"],
    huFingerprint: "rev_aaaa0001",
  });
  const k2 = keyFor({
    selectedIssueKeys: ["AA-X"],
    huFingerprint: "rev_aaaa0001",
  });
  expect(k1).toBe(k2);

  const [a, b] = await Promise.all([
    runScenarioPreviewInFlight(k1, slowGen),
    runScenarioPreviewInFlight(k2, slowGen),
  ]);

  expect(calls).toBe(1);
  expect(a).toBe("RESULT");
  expect(b).toBe("RESULT");
  expect(scenarioInFlightHas(k1)).toBe(false);
  expect(getScenarioInFlightCount()).toBe(0);
});

test("generation failure releases in-flight; next attempt can run again", async () => {
  let calls = 0;
  const failingGen = async (): Promise<string> => {
    calls++;
    throw new Error("ai_failed");
  };

  const key = keyFor();
  await expect(runScenarioPreviewInFlight(key, failingGen)).rejects.toThrow(
    "ai_failed",
  );

  // Released after failure — no orphan lock
  expect(scenarioInFlightHas(key)).toBe(false);
  expect(getScenarioInFlightCount()).toBe(0);

  // Next attempt can generate again
  let okCalls = 0;
  const okGen = async (): Promise<string> => {
    okCalls++;
    return "OK";
  };
  const result = await runScenarioPreviewInFlight(key, okGen);
  expect(result).toBe("OK");
  expect(okCalls).toBe(1);
});

test("single request passes exactly one guard boundary (started=1, released=1)", async () => {
  const events: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    const msg = args.map(String).join(" ");
    if (msg.includes("[scenario-generation:inflight]")) events.push(msg);
    origLog(...args);
  };

  try {
    const key = keyFor({ huFingerprint: "fp_single" });
    await runScenarioPreviewInFlight(key, async () => "OK");
  } finally {
    console.log = origLog;
  }

  const started = events.filter((e) => e.includes("action=started"));
  const released = events.filter((e) => e.includes("action=released"));
  const joined = events.filter((e) => e.includes("action=joined"));

  expect(started).toHaveLength(1);
  expect(released).toHaveLength(1);
  expect(joined).toHaveLength(0);
});

test("two equivalent concurrent requests → generatorCalls=1, joined=true", async () => {
  const events: string[] = [];
  const origLog = console.log;
  console.log = (...args: unknown[]) => {
    const msg = args.map(String).join(" ");
    if (msg.includes("[scenario-generation:inflight]")) events.push(msg);
    origLog(...args);
  };

  let generatorCalls = 0;
  const slowGen = async (): Promise<string> => {
    generatorCalls++;
    await new Promise((r) => setTimeout(r, 50));
    return "RESULT";
  };

  try {
    const key = keyFor({ huFingerprint: "fp_concurrent" });
    await Promise.all([
      runScenarioPreviewInFlight(key, slowGen),
      runScenarioPreviewInFlight(key, slowGen),
    ]);
  } finally {
    console.log = origLog;
  }

  const started = events.filter((e) => e.includes("action=started"));
  const released = events.filter((e) => e.includes("action=released"));
  const joined = events.filter((e) => e.includes("action=joined"));

  expect(generatorCalls).toBe(1);
  expect(started).toHaveLength(1);
  expect(released).toHaveLength(1);
  expect(joined).toHaveLength(1);
});