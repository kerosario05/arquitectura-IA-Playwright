import path from "node:path";
import { chromium, firefox, webkit, type Browser } from "@playwright/test";
import { config } from "../../config/env";
import { buildDataContext } from "../../data/data-context";
import { executeExecutionPlan } from "../../runner/execution-plan-executor";
import { promoteExecutionPlan } from "../../automations/promote-plan";
import { toExecutionPlan } from "../../recording/scenario-to-plan";
import type { RecordedScenario } from "../../recording/trace-to-scenario";
import { jobStore } from "./job-store";

/**
 * Replays a recorded web walkthrough and turns the ones that pass into specs.
 *
 * The mobile side of the panel hands its scenarios to the emulator chain; the web side had
 * nowhere to go, because a recorded web scenario is not a mobile one — its steps live in
 * `webSteps`, in the shape of an execution plan. This is the bridge: plan, run, promote.
 *
 * It deliberately does NOT run the project's login strategy first. The walkthrough is
 * replayed exactly as it was captured, login included if the person logged in — anything
 * else would execute steps the recording never saw and call the result a replay.
 *
 * Promotion happens only after a successful run, which is the framework's own contract: a
 * plan earns its spec by running, never by being written.
 */

export type WebRecordingScenarioResult = {
  scenarioId: string;
  title: string;
  status: "passed" | "failed" | "partial" | "skipped";
  failedStep?: { index: number; description?: string; error?: string };
  evidenceDir?: string;
  specPath?: string;
  promotionError?: string;
};

export type StartWebRecordingExecutionParams = {
  appSlug: string;
  recordingId: string;
  scenarios: RecordedScenario[];
  baseUrl?: string;
  /** Values the reviewer typed in the panel, per scenario and step index. */
  dataOverrides?: Record<string, Record<number, string>>;
};

/** Turns the panel's per-step overrides into the key/value shape the data context speaks. */
function overridesForScenario(
  scenario: RecordedScenario,
  overrides: Record<number, string> | undefined,
): Record<string, string> {
  if (!overrides) return {};
  const byStep = new Map(scenario.requiredData.map((field) => [field.stepIndex, field.key]));
  const resolved: Record<string, string> = {};
  for (const [stepIndex, value] of Object.entries(overrides)) {
    const key = byStep.get(Number(stepIndex));
    if (key && value.trim()) resolved[key] = value;
  }
  return resolved;
}

/**
 * Scenarios worth replaying.
 *
 * A derived scenario — the control nobody pressed, the gate nobody forced — carries steps but
 * describes a state the recording never reached, and its expected result is still a proposal.
 * Running it would assert something nobody established.
 */
function replayable(scenarios: readonly RecordedScenario[]): RecordedScenario[] {
  return scenarios.filter((s) => s.webSteps.length > 0 && s.provenance !== "derived");
}

export function startWebRecordingExecution(params: StartWebRecordingExecutionParams): { jobId: string } {
  const job = jobStore.create("web-recording-execution", {
    recordingId: params.recordingId,
    appSlug: params.appSlug,
    scenarioCount: params.scenarios.length,
  });
  const log = (line: string) => jobStore.appendLog(job.id, line);

  void runExecution(job.id, params, log).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    log(`[recording:web] la ejecución falló: ${message}`);
    jobStore.update(job.id, {
      status: "failed",
      errorMessage: message,
      completedAt: new Date().toISOString(),
    });
  });

  return { jobId: job.id };
}

async function runExecution(
  jobId: string,
  params: StartWebRecordingExecutionParams,
  log: (line: string) => void,
): Promise<void> {
  jobStore.update(jobId, { status: "running", startedAt: new Date().toISOString() });

  const scenarios = replayable(params.scenarios);
  const skipped = params.scenarios.length - scenarios.length;
  if (skipped > 0) {
    log(`[recording:web] ${skipped} escenario(s) omitidos: derivados, la grabación no los recorrió`);
  }
  if (scenarios.length === 0) {
    jobStore.update(jobId, {
      status: "done",
      completedAt: new Date().toISOString(),
      summary: { totalStories: 0, synced: 0, passed: 0, failed: 0, recordingResults: [] },
    });
    log("[recording:web] no hay escenarios reproducibles en esta grabación");
    return;
  }

  const engine = { chromium, firefox, webkit }[config.execution.browser];
  const browser: Browser = await engine.launch({ headless: config.execution.headless });
  log(
    `[recording:web] navegador ${config.execution.browser} ${config.execution.headless ? "oculto" : "visible"}; ${scenarios.length} escenario(s)`,
  );

  const results: WebRecordingScenarioResult[] = [];

  /**
   * Publishes progress after every scenario.
   *
   * The live-execution screen reads these counters straight off the job, so writing the
   * summary only at the end would leave the bar at zero for the whole replay — which is
   * exactly the stretch of time a person is watching it.
   */
  const publishProgress = (currentTitle?: string) => {
    const passedSoFar = results.filter((r) => r.status === "passed").length;
    jobStore.update(jobId, {
      currentCase: currentTitle,
      currentCaseTitle: currentTitle,
      summary: {
        totalStories: scenarios.length,
        scenarioCount: scenarios.length,
        synced: results.length,
        completed: results.length,
        passed: passedSoFar,
        failed: results.length - passedSoFar,
        skipped,
        progressPercent: Math.round((results.length / scenarios.length) * 100),
      },
    });
  };

  publishProgress(scenarios[0]?.title);

  try {
    for (const scenario of scenarios) {
      // A fresh context per scenario: each case has to stand on its own, and a session left
      // open by the previous one would make a case pass for the wrong reason.
      const context = await browser.newContext();
      const page = await context.newPage();
      page.setDefaultTimeout(config.execution.defaultTimeoutMs);

      const evidenceDir = path.resolve(
        ".artifacts",
        "executions",
        `recording-${params.recordingId}`,
        scenario.scenarioId,
      );

      try {
        const { plan, suggestedData } = toExecutionPlan(scenario, { baseUrl: params.baseUrl });
        const dataContext = buildDataContext(config, {
          dataOverrides: overridesForScenario(scenario, params.dataOverrides?.[scenario.scenarioId]),
          suggestedData,
        });

        log(`[recording:web] ejecutando "${scenario.title}" (${plan.steps.length} pasos)`);
        const execution = await executeExecutionPlan({
          page,
          plan,
          dataContext,
          evidenceDir,
          appBaseUrl: params.baseUrl ?? config.app.baseUrl,
          onStepFinished: (step) => {
            const description = plan.steps.find((s) => s.index === step.index)?.description ?? step.action;
            log(
              `[recording:web]   paso ${step.index}/${plan.steps.length} ${step.status}: ${description}` +
                (step.error ? ` — ${step.error.split("\n")[0].slice(0, 160)}` : ""),
            );
          },
        });

        const failing = execution.steps.find((step) => step.status === "failed");
        const result: WebRecordingScenarioResult = {
          scenarioId: scenario.scenarioId,
          title: scenario.title,
          status: execution.status,
          evidenceDir,
          failedStep: failing
            ? {
                index: failing.index,
                description: plan.steps.find((s) => s.index === failing.index)?.description,
                error: failing.error,
              }
            : undefined,
        };

        if (execution.status === "passed") {
          try {
            const promoted = await promoteExecutionPlan({
              plan: { ...plan, status: "validated" },
              source: "manual",
              overwrite: true,
            });
            result.specPath = promoted.specPath;
            log(`[recording:web] "${scenario.title}" pasó → ${promoted.specPath}`);
          } catch (err) {
            result.promotionError = err instanceof Error ? err.message : String(err);
            log(`[recording:web] "${scenario.title}" pasó pero no se pudo promover: ${result.promotionError}`);
          }
        } else {
          log(
            `[recording:web] "${scenario.title}" ${execution.status}` +
              (failing ? ` en el paso ${failing.index + 1}: ${failing.error ?? "sin detalle"}` : ""),
          );
        }

        results.push(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({
          scenarioId: scenario.scenarioId,
          title: scenario.title,
          status: "failed",
          evidenceDir,
          failedStep: { index: 0, error: message },
        });
        log(`[recording:web] "${scenario.title}" no se pudo ejecutar: ${message}`);
      } finally {
        await context.close().catch(() => undefined);
        const next = scenarios[scenarios.indexOf(scenario) + 1];
        publishProgress(next?.title);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.length - passed;
  jobStore.update(jobId, {
    status: "done",
    completedAt: new Date().toISOString(),
    summary: {
      totalStories: results.length,
      synced: results.length,
      passed,
      failed,
      skipped,
      scenarioCount: params.scenarios.length,
      recordingResults: results,
    },
  });
  log(`[recording:web] terminado: ${passed} pasaron, ${failed} fallaron, ${skipped} omitidos`);
}
