import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import type { ClaudeResult, CodexPhysicalResult, OrchestratorIterationRecord } from "./types";
import { qaLabRuntimeActionForEvidence } from "./orchestrator-runner";
import { waitForRuntimeTarget } from "./qa-lab-runtime";

test("QA Lab runtime is restarted before physical validation after a Claude source change", () => {
  const evidence = { actor: "CLAUDE", result: { sourceChanged: true } } as ClaudeResult;
  assert.equal(qaLabRuntimeActionForEvidence(evidence), "restart");
});

test("QA Lab runtime is only ensured when Claude made no source change", () => {
  const evidence = { actor: "CLAUDE", result: { sourceChanged: false } } as ClaudeResult;
  assert.equal(qaLabRuntimeActionForEvidence(evidence), "ensure");
});

test("physical evidence never authorizes a QA Lab source restart", () => {
  const evidence = { actor: "CODEX_PHYSICAL", sourceChanged: false } as CodexPhysicalResult;
  assert.equal(qaLabRuntimeActionForEvidence(evidence), "ensure");
});

test("a later test-only Claude pass does not hide an earlier source change before the next physical replay", () => {
  const iterations = [
    { claudeResult: { result: { sourceChanged: true } } },
    { claudeResult: { result: { sourceChanged: false } } },
  ] as OrchestratorIterationRecord[];
  const evidence = { actor: "CLAUDE", result: { sourceChanged: false } } as ClaudeResult;
  assert.equal(qaLabRuntimeActionForEvidence(evidence, iterations), "restart");
});

test("a physical replay clears the pending restart required by prior source edits", () => {
  const iterations = [
    { claudeResult: { result: { sourceChanged: true } } },
    { codexPhysicalResult: { actor: "CODEX_PHYSICAL" } },
    { claudeResult: { result: { sourceChanged: false } } },
  ] as OrchestratorIterationRecord[];
  const evidence = { actor: "CLAUDE", result: { sourceChanged: false } } as ClaudeResult;
  assert.equal(qaLabRuntimeActionForEvidence(evidence, iterations), "ensure");
});

test("missing evidence prepares QA Lab without treating historical artifacts as a fix", () => {
  assert.equal(qaLabRuntimeActionForEvidence(undefined), "ensure");
});

test("unavailable runtime target enters dependency wait and resumes only when the target responds", async () => {
  const statuses = [0, 503, 200];
  const delays: number[] = [];
  const waiting: string[] = [];
  const ready: number[] = [];
  await waitForRuntimeTarget("https://example.test/", {
    probe: async () => {
      const status = statuses.shift();
      if (status === undefined) return 200;
      if (status === 0) throw new Error("connection closed");
      return status;
    },
    pause: async (milliseconds) => { delays.push(milliseconds); },
    onWaiting: (_attempt, reason) => waiting.push(reason),
    onReady: (attempts) => ready.push(attempts),
  });
  assert.deepEqual(delays, [1_000, 2_000]);
  assert.deepEqual(waiting, ["connection closed"]);
  assert.deepEqual(ready, [2]);
});

test("runtime target wait rejects non-HTTP URL configuration", async () => {
  await assert.rejects(waitForRuntimeTarget("file:///tmp/target", { probe: async () => 200 }));
});

test("runtime reachability probe accepts a live HTTP endpoint", async () => {
  const server = createServer((_request, response) => { response.writeHead(200); response.end(); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind a TCP port.");
  try {
    await waitForRuntimeTarget(`http://127.0.0.1:${address.port}/`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
