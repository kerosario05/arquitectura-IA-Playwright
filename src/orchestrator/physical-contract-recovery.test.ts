import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runOneIteration } from "./orchestrator-runner";
import { initState } from "./state-machine";
import type { TaskContract } from "./types";

test("physical preflight restores missing steps and runtime URL from the exact recording artifact", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-physical-contract-recovery-"));
  const recordingId = "recording-123";
  const recordingDir = path.join(root, "automations", "apps", "roke", "recordings", recordingId);
  fs.mkdirSync(recordingDir, { recursive: true });
  fs.writeFileSync(path.join(recordingDir, "scenarios.json"), JSON.stringify([{ webSteps: [
    { action: "navigate", value: "https://example.test/" },
    { action: "click", target: { value: "button|Products" } },
  ] }]));

  const task: TaskContract = {
    taskId: "physical-contract-recovery-test",
    objective: "Verify a recording with a fresh physical run",
    successCriteria: ["fresh=true", "freshRunId is real", "stepsExpected=2", "stepsExecuted=2"],
    physicalValidationRequired: true,
    currentFrontier: "Recording physical contract",
    physicalGreens: [],
    allowedStopReasons: ["SUCCESS", "HUMAN_GATE", "EXTERNAL_BLOCKER"],
    qaLabBaseUrl: "http://localhost:3001",
    qaLabReference: { kind: "recording", id: recordingId, projectSlug: "roke" },
  };

  let physicalCalls = 0;
  let physicalPrompt = "";
  const events: Array<{ type: string; metadata?: Record<string, unknown> }> = [];
  try {
    const result = await runOneIteration(root, initState(task), {
      dryRun: false,
      useCodexOrchestratorAgent: false,
      onEvent: (event) => events.push(event),
      actorInvokerOverrides: {
        qaLabRuntime: async () => undefined,
        codexPhysical: async (_repoRoot, prompt) => {
          physicalCalls++;
          physicalPrompt = prompt;
          return {
            exitCode: 0,
            stdout: "FRESH RUN\njobId=fresh-fixture\nstepsExpected=2\nstepsExecuted=1\nfunctionalExecution=false\ncausalOutcomeObserved=false\nFIRST LOSS\nfile=recorder boundary\ncondition=first click absent\nreason=fixture evidence only",
            stderr: "", timedOut: false, spawnedCommand: "mock",
          };
        },
      },
    });

    assert.equal(physicalCalls, 1);
    assert.match(physicalPrompt, /Runtime URL: https:\/\/example\.test\//);
    assert.match(physicalPrompt, /Pasos físicos en orden exacto/);
    assert.ok(events.some((event) => event.type === "PREFLIGHT_RECOVERED"));
    const physicalPreflight = events.find((event) => event.type === "PHYSICAL_CONTRACT_PREFLIGHT");
    assert.equal(physicalPreflight?.metadata?.stepsExpected, 2);
    assert.equal(physicalPreflight?.metadata?.hasRuntimeUrl, true);
    assert.equal(result.task.projectSlug, "roke");
    assert.equal(result.task.steps?.length, 2);
    assert.equal(result.task.runtimeUrl, "https://example.test/");
    assert.equal(result.iterations.at(-1)?.codexPhysicalResult?.freshRunId, "fresh-fixture");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("physical preflight remains incomplete when the exact recording artifact has no usable actions", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-physical-contract-missing-"));
  const task: TaskContract = {
    taskId: "physical-contract-missing-test",
    objective: "Verify a recording with a fresh physical run",
    successCriteria: ["fresh=true", "freshRunId is real", "stepsExpected=1", "stepsExecuted=1"],
    physicalValidationRequired: true,
    currentFrontier: "Recording physical contract",
    physicalGreens: [],
    allowedStopReasons: ["SUCCESS", "HUMAN_GATE", "EXTERNAL_BLOCKER"],
    qaLabBaseUrl: "http://localhost:3001",
    qaLabReference: { kind: "recording", id: "missing-recording", projectSlug: "roke" },
  };
  let physicalCalls = 0;
  try {
    const result = await runOneIteration(root, initState(task), {
      dryRun: false,
      useCodexOrchestratorAgent: false,
      actorInvokerOverrides: { codexPhysical: async () => { physicalCalls++; throw new Error("must not invoke with an incomplete contract"); } },
    });
    assert.equal(physicalCalls, 0);
    assert.equal(result.status, "EXTERNAL_BLOCKER");
    assert.match(result.iterations.at(-1)?.decision.stopReasonDetail ?? "", /contract is incomplete/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
