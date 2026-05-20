import path from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { config, requireTestRailConfig } from "../config/env";
import { TestRailClient } from "../clients/testrail.client";
import { normalizeTestRailCases } from "../testrail/testrail-normalizer";
import { generateRuleBasedExecutionPlan, normalizeExecutionPlan } from "../plans";
import { enrichExecutionPlanWithSnapshot } from "../plans/plan-enricher";
import { buildDataContext } from "../data/data-context";
import { executeExecutionPlan, writePlanExecutionResults } from "../runner";
import { reportToTestRail } from "../testrail/testrail-reporter";
import { promoteExecutionPlan } from "../automations/promote-plan";
import { findAndCloneReusablePlan } from "../automations/automation-reuse";
import { buildAgentHandoffRequest, writeAgentHandoffPackage, runCodexAutoRepair, validateAgentHandoffResponse } from "../agent";
import { analyzeSnapshotGaps, formatGapDiagnosis } from "../agent/snapshot-gap-detector";
import { runPostExecutionReporting } from "../reporting/post-execution-reporting";
import { buildPlanRepairGoal } from "./plan-repair-goal";
import type { CaseStartWorkflowInput, CaseStartWorkflowResult, PromotionResult, HandoffResult, AutoRepairResult, ReuseResult } from "../types/case-start.types";
import type { TestScenario } from "../types/testrail.types";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { PlansExecutionSummary, PlanExecutionResult } from "../types/plan-execution.types";
import type { PageSnapshot } from "../types/page-snapshot.types";
import type { AgentHandoffResponse } from "../types/agent-handoff.types";

function buildArtifactsDir(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return path.resolve(`.artifacts/cases/${stamp}`);
}

async function loadSnapshotIfExists(): Promise<PageSnapshot | undefined> {
  const explorerDir = path.resolve(".artifacts/explorer");
  try {
    const { readdir, readFile } = await import("node:fs/promises");
    const files = await readdir(explorerDir);
    const snapshotFile = files.find((f) => f.startsWith("snapshot-") && f.endsWith(".json"));
    if (!snapshotFile) {
      return undefined;
    }
    const content = await readFile(path.join(explorerDir, snapshotFile), "utf-8");
    return JSON.parse(content) as PageSnapshot;
  } catch {
    return undefined;
  }
}

export async function startCaseAutomationWorkflow(
  input: CaseStartWorkflowInput
): Promise<CaseStartWorkflowResult> {
  const startedAt = new Date().toISOString();
  const artifactsDir = buildArtifactsDir();
  await mkdir(artifactsDir, { recursive: true });

  const browser = await chromium.launch({ headless: !input.headed });
  const page = await browser.newPage();

  try {
    const testRailRuntimeConfig = requireTestRailConfig(config);
    const client = new TestRailClient(testRailRuntimeConfig);

    const rawCase = await client.getCase(input.caseId);
    const scenarios = normalizeTestRailCases([rawCase]);

    if (scenarios.length === 0) {
      throw new Error(`No scenario could be generated for case ${input.caseId}.`);
    }

    const scenario = scenarios[0];

    let reuse: ReuseResult | undefined;
    let reusedPlan: ExecutionPlan | undefined;

    if (input.reuseExisting !== false) {
      console.log("[cases:start] Searching for reusable automation...");
      const reuseResult = await findAndCloneReusablePlan(
        input.caseId,
        scenario.title,
        undefined
      );

      if (reuseResult) {
        console.log(`[cases:start] Reusable automation found: ${reuseResult.match.entry.id}`);
        console.log(`[cases:start] Reusing automation from case C${reuseResult.match.entry.caseId} for case C${input.caseId}`);
        reusedPlan = reuseResult.plan;
        reuse = {
          found: true,
          sourceAutomationId: reuseResult.match.entry.id,
          sourceCaseId: reuseResult.match.entry.caseId,
          matchType: reuseResult.match.matchType,
          confidence: reuseResult.match.confidence
        };
      } else {
        console.log("[cases:start] Reuse skipped: no matching automation found.");
        reuse = { found: false, skippedReason: "no_match" };
      }
    } else {
      reuse = { found: false, skippedReason: "disabled" };
    }

    const plan = reusedPlan ?? normalizeExecutionPlan(
      generateRuleBasedExecutionPlan(scenario, { includeLogin: true })
    );

    const planPath = path.join(artifactsDir, `plan-${input.caseId}.json`);
    await writeFile(planPath, JSON.stringify(plan, null, 2), "utf-8");

    const dataContext = buildDataContext(config);
    const snapshot = await loadSnapshotIfExists();

    let enrichedPlan: ExecutionPlan = plan;
    if (snapshot && !reusedPlan) {
      const enrichment = enrichExecutionPlanWithSnapshot({
        plan,
        snapshot,
        dataContext,
        aliases: config.app.testDataAliases,
        missingInputBehavior: config.app.missingInputBehavior
      });
      enrichedPlan = enrichment.plan;
    }

    console.log(reusedPlan ? "[cases:start] Executing reused plan..." : "[cases:start] Executing plan...");

    const executionResult = await executeExecutionPlan({
      page,
      plan: enrichedPlan,
      dataContext,
      evidenceDir: path.join(artifactsDir, "evidence"),
      continueOnFailure: input.continueOnFailure,
      appBaseUrl: config.app.baseUrl
    });

    const planResult: PlanExecutionResult = {
      scenario: enrichedPlan.scenario,
      status: executionResult.status,
      startedAt: executionResult.startedAt,
      finishedAt: executionResult.finishedAt,
      durationMs: executionResult.durationMs,
      evidenceDir: executionResult.evidenceDir,
      steps: executionResult.steps
    };

    const summary: PlansExecutionSummary = {
      generatedAt: new Date().toISOString(),
      total: 1,
      passed: executionResult.status === "passed" ? 1 : 0,
      failed: executionResult.status === "failed" ? 1 : 0,
      partial: executionResult.status === "partial" ? 1 : 0,
      skipped: executionResult.status === "skipped" ? 1 : 0,
      results: [planResult]
    };

    const resultPath = path.join(artifactsDir, `results-${input.caseId}.json`);
    await writePlanExecutionResults(summary, resultPath);

    let testRailRunId: number | undefined;
    let testRailRunUrl: string | undefined;

    if (input.reportToTestRail !== false) {
      const projectId = input.projectId;
      const suiteId = input.suiteId ?? config.integrations.testRail?.suiteId;
      const runName = `Automation Run C${input.caseId} ${new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-")}`;

      const reportOutput = await reportToTestRail(client, {
        resultsSummary: summary,
        projectId,
        suiteId,
        runName,
        dryRun: input.dryRun ?? false
      });

      testRailRunId = reportOutput.runId;
      testRailRunUrl = reportOutput.runUrl;
    }

    let promotion: PromotionResult | undefined;
    let handoff: HandoffResult | undefined;
    let autoRepair: AutoRepairResult | undefined;

    const isPlanValidated = enrichedPlan.status === "validated";
    const executionPassed = executionResult.status === "passed";

    let finalPlan: ExecutionPlan = enrichedPlan;
    let finalScenario: TestScenario = scenario;
    let finalSummary: PlansExecutionSummary = summary;
    let finalResultPath = resultPath;
    let finalExecutionPassed = executionPassed;
    let finalIsPlanValidated = isPlanValidated;

    if (input.autoHandoff && !isPlanValidated && !reusedPlan) {
      const gapAnalysis = analyzeSnapshotGaps(enrichedPlan, snapshot);
      const noPlaywright = true;

      if (gapAnalysis.hasGaps) {
        const diagnosis = formatGapDiagnosis(gapAnalysis, noPlaywright);
        console.log(`[cases:start] Snapshot gap detected for case C${input.caseId}:`);
        console.log(diagnosis);

        if (input.dryRun) {
          handoff = { created: false, dryRun: true, reason: "dry_run" };
          if (input.autoRepair) {
            autoRepair = { attempted: false, success: false, dryRun: true, error: "Dry-run mode: would detect snapshot gaps." };
          }
        } else {
          handoff = {
            created: false,
            handoffDir: path.join(artifactsDir, `handoff-C${input.caseId}`),
            dryRun: false,
            reason: "plan_needs_discovery"
          };
          autoRepair = {
            attempted: false,
            success: false,
            dryRun: false,
            error: `The requested flow requires browser discovery because target elements are not present in the captured snapshot. Missing: ${gapAnalysis.allMissingTargets.join(", ")}`
          };
        }
      } else if (input.dryRun) {
        handoff = { created: false, dryRun: true, reason: "dry_run" };
        if (input.autoRepair) {
          autoRepair = { attempted: false, success: false, dryRun: true };
        }
      } else {
        const handoffDir = path.join(artifactsDir, `handoff-C${input.caseId}`);
        const goal = buildPlanRepairGoal({
          caseId: input.caseId,
          scenarioTitle: enrichedPlan.scenario.title,
          pendingSteps: enrichedPlan.steps.filter((s) => s.action === "noop")
        });

        const request = buildAgentHandoffRequest({
          kind: "plan_repair",
          goal,
          scenario,
          currentPlan: enrichedPlan,
          snapshot,
          dataContext
        });

        const handoffResult = await writeAgentHandoffPackage({ request, outputDir: handoffDir });

        handoff = {
          created: true,
          handoffDir,
          requestPath: handoffResult.requestPath,
          instructionsPath: handoffResult.instructionsPath,
          schemaPath: handoffResult.schemaPath,
          responsePath: handoffResult.responsePath,
          dryRun: false,
          reason: "plan_needs_repair"
        };

        if (input.autoRepair && handoff.created) {
          const codexCommand = config.integrations.codex?.command ?? "codex";
          const codexExtraArgsRaw = config.integrations.codex?.extraArgs ?? "--skip-git-repo-check --sandbox workspace-write";
          const codexExtraArgs = codexExtraArgsRaw.split(/\s+/).filter(Boolean);
          const timeoutMs = config.integrations.codex?.autoRepairTimeoutMs ?? 900000;
          const promptMode = config.integrations.codex?.autoRepairPromptMode ?? "compact";

          const repairResult = await runCodexAutoRepair({
            handoffDir,
            requestPath: handoffResult.requestPath,
            instructionsPath: handoffResult.instructionsPath,
            responsePath: handoffResult.responsePath,
            schemaPath: handoffResult.schemaPath,
            projectRoot: process.cwd(),
            timeoutMs,
            codexCommand,
            codexExtraArgs,
            promptMode
          });

          if (repairResult.success) {
            autoRepair = { attempted: true, success: true, dryRun: false, responsePath: repairResult.responsePath };

            try {
              const responseContent = await readFile(repairResult.responsePath, "utf-8");
              const response = JSON.parse(responseContent) as AgentHandoffResponse;

              const availableKeys = request.dataContextSummary?.availableKeys?.map((k) => (typeof k === "string" ? k : k.key)) ?? [];
              const validation = validateAgentHandoffResponse(response, {
                availableDataKeys: availableKeys
              });

              if (validation.valid && response.plans.length > 0) {
                finalPlan = response.plans[0];
                finalIsPlanValidated = finalPlan.status === "validated";

                if (finalIsPlanValidated) {
                  const repairExecutionResult = await executeExecutionPlan({
                    page,
                    plan: finalPlan,
                    dataContext,
                    evidenceDir: path.join(artifactsDir, "evidence-repaired"),
                    continueOnFailure: input.continueOnFailure,
                    appBaseUrl: config.app.baseUrl
                  });

                  const repairedPlanResult: PlanExecutionResult = {
                    scenario: finalPlan.scenario,
                    status: repairExecutionResult.status,
                    startedAt: repairExecutionResult.startedAt,
                    finishedAt: repairExecutionResult.finishedAt,
                    durationMs: repairExecutionResult.durationMs,
                    evidenceDir: repairExecutionResult.evidenceDir,
                    steps: repairExecutionResult.steps
                  };

                  finalSummary = {
                    generatedAt: new Date().toISOString(),
                    total: 1,
                    passed: repairExecutionResult.status === "passed" ? 1 : 0,
                    failed: repairExecutionResult.status === "failed" ? 1 : 0,
                    partial: repairExecutionResult.status === "partial" ? 1 : 0,
                    skipped: repairExecutionResult.status === "skipped" ? 1 : 0,
                    results: [repairedPlanResult]
                  };

                  finalResultPath = path.join(artifactsDir, `results-${input.caseId}-repaired.json`);
                  await writePlanExecutionResults(finalSummary, finalResultPath);
                  finalExecutionPassed = repairExecutionResult.status === "passed";

                  if (input.reportToTestRail !== false) {
                    const projectId = input.projectId;
                    const suiteId = input.suiteId ?? config.integrations.testRail?.suiteId;
                    const runName = `Automation Run C${input.caseId} (repaired) ${new Date().toISOString().slice(0, 19).replace(/[:.]/g, "-")}`;

                    const reportOutput = await reportToTestRail(client, {
                      resultsSummary: finalSummary,
                      projectId,
                      suiteId,
                      runName,
                      dryRun: input.dryRun ?? false
                    });

                    testRailRunId = reportOutput.runId;
                    testRailRunUrl = reportOutput.runUrl;
                  }
                }
              } else {
                autoRepair = {
                  attempted: true,
                  success: false,
                  dryRun: false,
                  error: `Agent response validation failed: ${validation.issues.filter((i) => i.level === "error").map((i) => i.message).join("; ")}`
                };
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              autoRepair = { attempted: true, success: false, dryRun: false, error: message };
            }
          } else {
            autoRepair = {
              attempted: true,
              success: false,
              dryRun: false,
              error: repairResult.error,
              timedOut: repairResult.timedOut
            };
          }
        }
      }
    }

    let postReportingTestRailRunId: number | undefined;
    let postReportingJiraAttached = false;

    if (input.reportToTestRail !== false && finalExecutionPassed && finalIsPlanValidated && !input.dryRun) {
      const sectionId = config.integrations.testRail?.sectionId
        ? Number(config.integrations.testRail.sectionId)
        : undefined;
      const projectId = config.integrations.testRail?.projectId
        ? Number(config.integrations.testRail.projectId)
        : undefined;
      const suiteId = config.integrations.testRail?.suiteId
        ? Number(config.integrations.testRail.suiteId)
        : undefined;

      if (sectionId && projectId) {
        const evidenceDocPath = path.join(artifactsDir, `evidence-C${input.caseId}.docx`);
        const reportingResult = await runPostExecutionReporting({
          page,
          caseId: input.caseId,
          projectId,
          suiteId,
          sectionId,
          jiraIssueKey: config.integrations.jira?.projectKey
            ? `${config.integrations.jira.projectKey}-${input.caseId}`
            : "AA-79",
          runName: `Regresion Kiosko Automatizada - C${input.caseId}`,
          evidenceDocPath,
          escenarios: finalSummary.results
        });
        postReportingTestRailRunId = reportingResult.testRailRunId;
        postReportingJiraAttached = reportingResult.jiraAttached;
      }
    }

    const shouldPromote = input.autoPromote && finalExecutionPassed && finalIsPlanValidated;

    if (shouldPromote) {
      if (input.dryRun) {
        promotion = { promoted: false, dryRun: true, reason: "dry_run" };
      } else {
        const entry = await promoteExecutionPlan({
          plan: finalPlan,
          sourcePlanPath: planPath,
          lastExecutionResultPath: finalResultPath,
          source: reusedPlan ? "manual" : "rule_based",
          overwrite: true
        });
        promotion = {
          promoted: true,
          automationId: entry.id,
          planPath: entry.planPath,
          specPath: entry.specPath,
          dryRun: false
        };
      }
    } else if (input.autoPromote && !finalExecutionPassed) {
      promotion = { promoted: false, dryRun: false, reason: "execution_failed" };
    } else if (input.autoPromote && !finalIsPlanValidated) {
      promotion = { promoted: false, dryRun: false, reason: "plan_not_validated" };
    }

    const workflowStatus = finalIsPlanValidated && finalExecutionPassed
      ? "success"
      : (handoff?.reason === "plan_needs_discovery")
        ? "needs_discovery"
        : (!finalIsPlanValidated && input.autoHandoff)
          ? "needs_agent"
          : "failed";

    return {
      caseId: input.caseId,
      status: workflowStatus,
      planPath,
      executionResultPath: finalResultPath,
      testRailRunId: postReportingTestRailRunId ?? testRailRunId,
      testRailRunUrl,
      startedAt,
      completedAt: new Date().toISOString(),
      promotion,
      handoff,
      autoRepair,
      reuse,
      postReporting: input.reportToTestRail !== false && finalExecutionPassed && finalIsPlanValidated
        ? { testRailRunId: postReportingTestRailRunId, jiraAttached: postReportingJiraAttached }
        : undefined
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      caseId: input.caseId,
      status: "failed",
      error: message,
      startedAt,
      completedAt: new Date().toISOString()
    };
  } finally {
    await browser.close();
  }
}
