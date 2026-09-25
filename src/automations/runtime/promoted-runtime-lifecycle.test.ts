import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PromotedSpecRuntime } from "./promoted-spec-runtime";

/**
 * Job da808bb9-5856-4432-bde3-f4bb3e8525c6 physically proved that attempt 2's candidate
 * completed every business step AND the final oracle successfully (evidence.json status
 * "Exitoso"), yet Playwright still reported "Test timeout of 30000ms exceeded" — with no
 * telemetry at all covering what happened between the last business step and the test
 * function's return. finishEvidence() is the one place in PromotedSpecRuntime every generated
 * candidate's `finally` block always calls, right after every required step/oracle has already
 * settled and right before the candidate's test() body returns — so it is the only
 * always-instrumentable boundary for that gap without changing the AI-generated candidate
 * contract itself. These tests prove the four [promoted-runtime-lifecycle] phases fire, in
 * order, on both the success and the evidence-disabled path.
 */

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const original: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(vars)) {
    original[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return fn().finally(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function createMockPage() {
  return {
    on: () => undefined,
    url: () => "https://example.test/",
    isClosed: () => false,
    waitForLoadState: async () => undefined,
    evaluate: async () => true,
    screenshot: async () => undefined,
  };
}

function captureConsoleLog(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  return { lines, restore: () => { console.log = original; } };
}

test("finishEvidence emits the four lifecycle phases in order when evidence recording is enabled", async () => {
  const evidenceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "promoted-lifecycle-enabled-"));
  try {
    await withEnv(
      {
        EVIDENCE_ENABLED: "true",
        EVIDENCE_DOCX_ENABLED: "false",
        EVIDENCE_PER_SCENARIO_DOCX: "false",
        EVIDENCE_OUTPUT_DIR: evidenceRoot,
        APP_SLUG: "app-test",
        SECTION_SLUG: "lifecycle-section",
        SCENARIO_ID: "LIFECYCLE-ENABLED",
        SCENARIO_TITLE: "Lifecycle probe",
      },
      async () => {
        const runtime = new PromotedSpecRuntime(createMockPage() as any, { captureDiagnostics: false });
        const capture = captureConsoleLog();
        try {
          await runtime.finishEvidence();
        } finally {
          capture.restore();
        }
        const lifecycleLines = capture.lines.filter((line) => line.startsWith("[promoted-runtime-lifecycle]"));
        const phases = lifecycleLines.map((line) => line.match(/phase=(\S+)/)?.[1]);
        assert.deepEqual(phases, ["test_business_complete", "finish_evidence_start", "finish_evidence_complete", "test_body_return"]);
      },
    );
  } finally {
    await fs.rm(evidenceRoot, { recursive: true, force: true });
  }
});

test("finishEvidence still emits test_business_complete and test_body_return when evidence is disabled (no finish_evidence_start/complete in between)", async () => {
  await withEnv({ EVIDENCE_ENABLED: "false" }, async () => {
    const runtime = new PromotedSpecRuntime(createMockPage() as any, { captureDiagnostics: false });
    const capture = captureConsoleLog();
    try {
      await runtime.finishEvidence();
    } finally {
      capture.restore();
    }
    const lifecycleLines = capture.lines.filter((line) => line.startsWith("[promoted-runtime-lifecycle]"));
    const phases = lifecycleLines.map((line) => line.match(/phase=(\S+)/)?.[1]);
    assert.deepEqual(phases, ["test_business_complete", "test_body_return"]);
  });
});
