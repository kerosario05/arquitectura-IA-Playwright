import * as path from "node:path";
import type { AddressInfo } from "node:net";
import express from "express";
import { expect, test } from "@playwright/test";
import { AiProviderError, type AiCompletionRequest, type AiCompletionResponse, type AiProvider } from "../src/ai/ai-provider.types";
import { refreshStatus as refreshAppiumStatus, __resetAppiumServerStateForTesting, __resetHttpStatusCheckerForTesting, __setHttpStatusCheckerForTesting } from "../src/mobile/appium-server-manager";
import { resolveAndroidSdk } from "../src/mobile/android-sdk";
import { __resetAdbRunnerForTesting, __resetEmulatorStateForTesting, __setAdbRunnerForTesting, startEmulator, stopEmulator } from "../src/mobile/emulator-manager";
import { generateMobileScenarios } from "../src/scenarios/mobile-scenario-generator";
import { jobStore } from "../src/server/jobs/job-store";
import { startMobileTestRunJob } from "../src/server/jobs/mobile-test-runner";
import {
  __awaitMobileScenarioGenerationForTesting,
  __resetMobileScenarioGenerationStateForTesting,
  __setMobileScenarioGenerationRunnerForTesting,
} from "../src/server/jobs/mobile-scenario-generation-manager";
import { mobileRouter } from "../src/server/routes/mobile";
import type { JiraIssueSource } from "../src/scenarios/scenario-types";
import type { RequiredJiraRuntimeConfig } from "../src/types/jira.types";

function createExistsSync(paths: string[]): (targetPath: string) => boolean {
  const normalized = new Set(paths.map((p) => path.resolve(p).toLowerCase()));
  return (targetPath: string) => normalized.has(path.resolve(targetPath).toLowerCase());
}

const jiraConfig: RequiredJiraRuntimeConfig = {
  baseUrl: "https://jira.example.local",
  email: "qa@example.local",
  apiToken: "token",
  acceptanceCriteriaField: "customfield_12345",
};

const issueAA88: JiraIssueSource = {
  key: "AA-88",
  summary: "Flujo móvil",
  description: "Descripción",
  acceptanceCriteria: "Criterios",
  labels: [],
  components: [],
  status: "To Do",
  issueType: "Story",
};

test.describe("mobile android sdk resolver", () => {
  test("resolves explicit SDK path when binaries exist", () => {
    const sdkHome = "C:\\Android\\Sdk";
    const existsSync = createExistsSync([
      sdkHome,
      path.join(sdkHome, "platform-tools", "adb.exe"),
      path.join(sdkHome, "emulator", "emulator.exe"),
    ]);
    const resolved = resolveAndroidSdk({
      env: { ANDROID_HOME: sdkHome },
      existsSync,
      platform: "win32",
    });
    expect(resolved.sdkHome).toBe(path.resolve(sdkHome));
    expect(resolved.adbPath).toContain("adb.exe");
    expect(resolved.emulatorPath).toContain("emulator.exe");
  });

  test("rejects unexpanded env literals and falls back to LOCALAPPDATA SDK", () => {
    const localAppData = "C:\\Users\\someone\\AppData\\Local";
    const fallbackSdk = path.join(localAppData, "Android", "Sdk");
    const existsSync = createExistsSync([
      fallbackSdk,
      path.join(fallbackSdk, "platform-tools", "adb.exe"),
      path.join(fallbackSdk, "emulator", "emulator.exe"),
    ]);
    const resolved = resolveAndroidSdk({
      env: {
        ANDROID_HOME: "$env:LOCALAPPDATA\\Android\\Sdk",
        LOCALAPPDATA: localAppData,
      },
      existsSync,
      platform: "win32",
    });
    expect(resolved.sdkHome).toBe(path.resolve(fallbackSdk));
  });

  test("fails with actionable error when adb is missing", () => {
    const sdkHome = "C:\\Android\\Sdk";
    const existsSync = createExistsSync([
      sdkHome,
      path.join(sdkHome, "emulator", "emulator.exe"),
    ]);
    expect(() =>
      resolveAndroidSdk({
        env: { ANDROID_HOME: sdkHome },
        existsSync,
        platform: "win32",
      })
    ).toThrow(/adb binary is missing/i);
  });
});

test.describe("mobile appium status refresh", () => {
  test.beforeEach(() => {
    __resetAppiumServerStateForTesting();
    __resetHttpStatusCheckerForTesting();
  });

  test.afterEach(() => {
    __resetAppiumServerStateForTesting();
    __resetHttpStatusCheckerForTesting();
  });

  test("marks external server as ready when /status responds ok", async () => {
    __setHttpStatusCheckerForTesting(async () => ({ ok: true, status: 200 }));
    const status = await refreshAppiumStatus(4723);
    expect(status.status).toBe("ready");
    expect(status.ready).toBe(true);
    expect(status.external).toBe(true);
    expect(status.running).toBe(true);
    expect(status.port).toBe(4723);
  });

  test("returns to stopped when previously external server is no longer reachable", async () => {
    __setHttpStatusCheckerForTesting(async () => ({ ok: true, status: 200 }));
    await refreshAppiumStatus(4723);

    __setHttpStatusCheckerForTesting(async () => ({ ok: false, status: 0 }));
    const status = await refreshAppiumStatus(4723);
    expect(status.status).toBe("stopped");
    expect(status.ready).toBe(false);
    expect(status.running).toBe(false);
    expect(status.external).toBe(false);
  });
});

test.describe("mobile scenario generation diagnostics", () => {
  async function runWithProvider(
    completeJson: (request: AiCompletionRequest) => Promise<AiCompletionResponse>
  ) {
    const provider: AiProvider = {
      providerType: "fake",
      providerName: "fake",
      model: "fake-model",
      completeJson,
    };
    return generateMobileScenarios(
      jiraConfig,
      "AA",
      10,
      undefined,
      50,
      undefined,
      {
        loadIssues: async () => [issueAA88],
        createProvider: async () => provider,
        logger: { log: () => undefined, error: () => undefined },
      }
    );
  }

  test("uses scenario_generation purpose and keeps valid scenarios", async () => {
    let capturedPurpose: string | undefined;
    const result = await runWithProvider(async (request) => {
      capturedPurpose = request.purpose;
      return {
        rawText: JSON.stringify({
          scenarios: [
            {
              sourceIssueKey: "AA-88",
              title: "Escenario válido",
              steps: [
                { action: "launchApp", description: "Abrir app" },
                { action: "click", description: "Tap botón", target: { strategy: "accessibilityId", value: "btnIngresar" } },
              ],
              expectedResult: "Pantalla abierta",
              preconditions: ["Usuario registrado"],
            },
          ],
        }),
        parsedJson: {
          scenarios: [
            {
              sourceIssueKey: "AA-88",
              title: "Escenario válido",
              steps: [
                { action: "launchApp", description: "Abrir app" },
                { action: "click", description: "Tap botón", target: { strategy: "accessibilityId", value: "btnIngresar" } },
              ],
              expectedResult: "Pantalla abierta",
              preconditions: ["Usuario registrado"],
            },
          ],
        },
        model: "fake-model",
        providerName: "fake",
        durationMs: 10,
        diagnostics: { exitCode: 0 },
      };
    });
    expect(capturedPurpose).toBe("scenario_generation");
    expect(result.scenarios).toHaveLength(1);
    expect(result.rejected).toHaveLength(0);
    expect(result.diagnosticsByIssue["AA-88"]?.finalScenarioCount).toBe(1);
  });

  test("classifies contract mismatch when provider payload shape is invalid", async () => {
    const result = await runWithProvider(async () => ({
      rawText: "{\"unexpected\":true}",
      parsedJson: { unexpected: true },
      model: "fake-model",
      providerName: "fake",
      durationMs: 8,
      diagnostics: { exitCode: 0 },
    }));
    expect(result.scenarios).toHaveLength(0);
    expect(result.rejected).toEqual([{ sourceIssueKey: "AA-88", reason: "ai_contract_mismatch" }]);
    expect(result.diagnosticsByIssue["AA-88"]?.contractValid).toBe(false);
    expect(result.diagnosticsByIssue["AA-88"]?.classifiedReason).toBe("ai_contract_mismatch");
  });

  test("classifies dropped scenarios when all fail normalization", async () => {
    const result = await runWithProvider(async () => ({
      rawText: JSON.stringify({
        scenarios: [
          {
            sourceIssueKey: "AA-88",
            title: "Escenario inválido",
            steps: [{ action: "click", description: "Falta target" }],
          },
        ],
      }),
      parsedJson: {
        scenarios: [
          {
            sourceIssueKey: "AA-88",
            title: "Escenario inválido",
            steps: [{ action: "click", description: "Falta target" }],
          },
        ],
      },
      model: "fake-model",
      providerName: "fake",
      durationMs: 7,
      diagnostics: { exitCode: 0 },
    }));
    expect(result.scenarios).toHaveLength(0);
    expect(result.rejected).toEqual([{ sourceIssueKey: "AA-88", reason: "all_scenarios_dropped" }]);
    expect(result.diagnosticsByIssue["AA-88"]?.normalizationDroppedCount).toBe(1);
    expect(result.diagnosticsByIssue["AA-88"]?.dropReasons).toContain("missing_step_target");
  });

  test("maps provider invalid JSON failure with diagnostics", async () => {
    const result = await runWithProvider(async () => {
      throw new AiProviderError("ai_provider_invalid_json", "invalid json", {
        exitCode: 21,
        stdout: "oops",
      });
    });
    expect(result.scenarios).toHaveLength(0);
    expect(result.rejected).toEqual([{ sourceIssueKey: "AA-88", reason: "ai_invalid_json" }]);
    expect(result.diagnosticsByIssue["AA-88"]?.providerExitCode).toBe(21);
    expect(result.diagnosticsByIssue["AA-88"]?.rawOutputLength).toBe(4);
  });

  test("filters mobile generation by selectedIssueKeys", async () => {
    let providerCalls = 0;
    const provider: AiProvider = {
      providerType: "fake",
      providerName: "fake",
      model: "fake-model",
      completeJson: async () => {
        providerCalls++;
        return {
          rawText: JSON.stringify({
            scenarios: [
              {
                sourceIssueKey: "AA-88",
                title: "Escenario",
                steps: [{ action: "launchApp", description: "Abrir app" }],
                expectedResult: "OK",
              },
            ],
          }),
          parsedJson: {
            scenarios: [
              {
                sourceIssueKey: "AA-88",
                title: "Escenario",
                steps: [{ action: "launchApp", description: "Abrir app" }],
                expectedResult: "OK",
              },
            ],
          },
          model: "fake-model",
          providerName: "fake",
          durationMs: 5,
          diagnostics: { exitCode: 0 },
        };
      },
    };
    const result = await generateMobileScenarios(
      jiraConfig,
      "AA",
      10,
      undefined,
      50,
      undefined,
      {
        loadIssues: async () => [
          issueAA88,
          { ...issueAA88, key: "AA-99", summary: "Otra HU" },
        ],
        createProvider: async () => provider,
        logger: { log: () => undefined, error: () => undefined },
        selectedIssueKeys: ["AA-88"],
      }
    );
    expect(providerCalls).toBe(1);
    expect(result.issuesFound).toBe(1);
    expect(result.scenarios[0]?.sourceIssueKey).toBe("AA-88");
  });
});

test.describe("mobile test runner preflight", () => {
  test("fails early with actionable error when apkPath does not exist", async () => {
    const job = jobStore.create("mobile-test-run", {
      avdName: "test-avd",
      apkPath: "C:\\path\\that\\does-not-exist.apk",
      steps: [{ action: "launchApp", description: "Abrir app" }],
    });
    await startMobileTestRunJob(job.id);
    const updated = jobStore.get(job.id);
    expect(updated).toBeDefined();
    expect(updated?.status).toBe("failed");
    expect(updated?.errorMessage).toContain("APK file not found at path");
  });
});

test.describe("mobile router status endpoints", () => {
  test.beforeEach(() => {
    __resetAppiumServerStateForTesting();
    __resetHttpStatusCheckerForTesting();
    __resetAdbRunnerForTesting();
    __resetEmulatorStateForTesting();
  });

  test.afterEach(() => {
    __resetAppiumServerStateForTesting();
    __resetHttpStatusCheckerForTesting();
    __resetAdbRunnerForTesting();
    __resetEmulatorStateForTesting();
  });

  test("appium/status responds with refreshed status contract", async () => {
    __setHttpStatusCheckerForTesting(async () => ({ ok: true, status: 200 }));
    const app = express();
    app.use(express.json());
    app.use("/api/mobile", mobileRouter);
    const server = await new Promise<import("node:http").Server>((resolve, reject) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
      s.once("error", reject);
    });
    const address = server.address() as AddressInfo | null;
    expect(address).not.toBeNull();
    const port = address?.port;
    expect(typeof port).toBe("number");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/mobile/appium/status`);
      const payload = await response.json() as { ok: boolean; status?: string; ready?: boolean };
      expect(response.status).toBe(200);
      expect(payload.ok).toBe(true);
      expect(payload.status).toBe("ready");
      expect(payload.ready).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("emulator/start is idempotent when an emulator is already running", async () => {
    __setAdbRunnerForTesting(async (args) => {
      if (args[0] === "devices") {
        return {
          exitCode: 0,
          stdout: "List of devices attached\r\nemulator-5554\tdevice\r\n",
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    await startEmulator("Pixel_7_Pro", { headless: true });

    const app = express();
    app.use(express.json());
    app.use("/api/mobile", mobileRouter);
    const server = await new Promise<import("node:http").Server>((resolve, reject) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
      s.once("error", reject);
    });
    const address = server.address() as AddressInfo | null;
    expect(address).not.toBeNull();
    const port = address?.port;
    expect(typeof port).toBe("number");
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/mobile/emulator/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ avdName: "Pixel_7_Pro", headless: true }),
      });
      const payload = await response.json() as { ok: boolean; reused?: boolean; message?: string };
      expect(response.status).toBe(202);
      expect(payload.ok).toBe(true);
      expect(payload.reused).toBe(true);
      expect(payload.message).toContain("reusing existing instance");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test("stopEmulator preserves reused external emulator by default", async () => {
    const adbCalls: string[][] = [];
    __setAdbRunnerForTesting(async (args) => {
      adbCalls.push(args);
      if (args[0] === "devices") {
        return {
          exitCode: 0,
          stdout: "List of devices attached\r\nemulator-5554\tdevice\r\n",
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    await startEmulator("Pixel_7_Pro", { headless: true });
    const logs: string[] = [];
    await stopEmulator((line) => logs.push(line));

    expect(adbCalls.some((args) => args.includes("emu") && args.includes("kill"))).toBe(false);
    expect(logs.some((line) => line.includes("emulatorCleanup action=preserve reason=reused_external_emulator"))).toBe(true);
  });

  test("stopEmulator still preserves external emulator even with explicit caller metadata", async () => {
    const adbCalls: string[][] = [];
    __setAdbRunnerForTesting(async (args) => {
      adbCalls.push(args);
      if (args[0] === "devices") {
        return {
          exitCode: 0,
          stdout: "List of devices attached\r\nemulator-5554\tdevice\r\n",
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    });
    await startEmulator("Pixel_7_Pro", { headless: true });
    const logs: string[] = [];
    await stopEmulator((line) => logs.push(line), {
      caller: "unit-test",
      runId: "run-stop-1",
    });
    expect(adbCalls.some((args) => args.includes("emu") && args.includes("kill"))).toBe(false);
    expect(logs.some((line) => line.includes("emulatorCleanup action=preserve reason=reused_external_emulator"))).toBe(true);
  });
});

test.describe("mobile async scenario generation endpoints", () => {
  test.afterEach(() => {
    __setMobileScenarioGenerationRunnerForTesting(null);
    __resetMobileScenarioGenerationStateForTesting();
  });

  test("reuses same generation job for concurrent equivalent requests", async () => {
    let release: (() => void) | null = null;
    __setMobileScenarioGenerationRunnerForTesting(async (_input, handlers) => {
      handlers.onIssuesResolved(["AA-94", "AA-93"]);
      handlers.onIssueStart({ issueKey: "AA-94", index: 0, total: 2, startedAt: new Date().toISOString() });
      await new Promise<void>((resolve) => { release = resolve; });
      handlers.onIssueCompleted({
        issueKey: "AA-94",
        index: 0,
        total: 2,
        status: "completed",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 5,
        scenarios: [{ scenarioId: "MOBILE-AA-94-001", sourceIssueKey: "AA-94", title: "S1", steps: [], expectedResult: "OK", preconditions: [], requiredData: [] }],
        rejected: [],
        diagnostics: {
          providerExitCode: 0,
          rawOutputLength: 12,
          parsed: true,
          contractValid: true,
          rawScenarioCount: 1,
          rawRejectedCount: 0,
          normalizationDroppedCount: 0,
          dropReasons: [],
          finalScenarioCount: 1,
          finalRejectedCount: 0,
          classifiedReason: undefined,
        },
      });
      handlers.onIssueStart({ issueKey: "AA-93", index: 1, total: 2, startedAt: new Date().toISOString() });
      handlers.onIssueCompleted({
        issueKey: "AA-93",
        index: 1,
        total: 2,
        status: "completed",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 5,
        scenarios: [{ scenarioId: "MOBILE-AA-93-001", sourceIssueKey: "AA-93", title: "S2", steps: [], expectedResult: "OK", preconditions: [], requiredData: [] }],
        rejected: [],
        diagnostics: {
          providerExitCode: 0,
          rawOutputLength: 12,
          parsed: true,
          contractValid: true,
          rawScenarioCount: 1,
          rawRejectedCount: 0,
          normalizationDroppedCount: 0,
          dropReasons: [],
          finalScenarioCount: 1,
          finalRejectedCount: 0,
          classifiedReason: undefined,
        },
      });
      return {
        scenarios: [
          { scenarioId: "MOBILE-AA-94-001", sourceIssueKey: "AA-94", title: "S1", steps: [], expectedResult: "OK", preconditions: [], requiredData: [] },
          { scenarioId: "MOBILE-AA-93-001", sourceIssueKey: "AA-93", title: "S2", steps: [], expectedResult: "OK", preconditions: [], requiredData: [] },
        ],
        rejected: [],
        issuesFound: 2,
        diagnosticsByIssue: {
          "AA-94": {
            providerExitCode: 0,
            rawOutputLength: 12,
            parsed: true,
            contractValid: true,
            rawScenarioCount: 1,
            rawRejectedCount: 0,
            normalizationDroppedCount: 0,
            dropReasons: [],
            finalScenarioCount: 1,
            finalRejectedCount: 0,
            classifiedReason: undefined,
          },
          "AA-93": {
            providerExitCode: 0,
            rawOutputLength: 12,
            parsed: true,
            contractValid: true,
            rawScenarioCount: 1,
            rawRejectedCount: 0,
            normalizationDroppedCount: 0,
            dropReasons: [],
            finalScenarioCount: 1,
            finalRejectedCount: 0,
            classifiedReason: undefined,
          },
        },
      };
    });

    const app = express();
    app.use(express.json());
    app.use("/api/mobile", mobileRouter);
    const server = await new Promise<import("node:http").Server>((resolve, reject) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
      s.once("error", reject);
    });
    const address = server.address() as AddressInfo | null;
    const port = address?.port;
    try {
      const payload = {
        projectKey: "AA",
        sprintId: 10,
        appSlug: "app-conversacional-bsc",
        selectedIssueKeys: ["AA-93", "AA-94"],
      };
      const firstRes = await fetch(`http://127.0.0.1:${port}/api/mobile/scenarios/generation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const secondRes = await fetch(`http://127.0.0.1:${port}/api/mobile/scenarios/generation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const firstBody = await firstRes.json() as { generationJobId: string; reused: boolean };
      const secondBody = await secondRes.json() as { generationJobId: string; reused: boolean };
      expect(firstRes.status).toBe(202);
      expect(secondRes.status).toBe(202);
      expect(firstBody.generationJobId).toBe(secondBody.generationJobId);
      expect(firstBody.reused).toBe(false);
      expect(secondBody.reused).toBe(true);

      const runningRes = await fetch(`http://127.0.0.1:${port}/api/mobile/scenarios/generation/${firstBody.generationJobId}`);
      const runningBody = await runningRes.json() as { status: string; issueProgress: Array<{ issueKey: string; status: string }> };
      expect(runningRes.status).toBe(200);
      expect(runningBody.status === "running" || runningBody.status === "pending").toBeTruthy();
      expect(Array.isArray(runningBody.issueProgress)).toBeTruthy();

      release?.();
      await __awaitMobileScenarioGenerationForTesting(firstBody.generationJobId);
      const doneRes = await fetch(`http://127.0.0.1:${port}/api/mobile/scenarios/generation/${firstBody.generationJobId}`);
      const doneBody = await doneRes.json() as { status: string; result?: { scenarios?: Array<{ sourceIssueKey: string }> } };
      expect(doneRes.status).toBe(200);
      expect(doneBody.status).toBe("completed");
      expect(doneBody.result?.scenarios?.length).toBe(2);
      expect((doneBody as any).testRunId).toBeUndefined();
      expect((doneBody as any).publishedCases).toBeUndefined();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
