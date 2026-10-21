import fs from "node:fs/promises";
import path from "node:path";
import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { EvidenceScenarioRecord, EvidenceStepRecord } from "../evidence/evidence-types";
import { buildEvidencePaths } from "../evidence/evidence-paths";
import { failedJiraSpecStep, type JiraReuseEvidenceContext } from "./jira-reuse-evidence";

export default class JiraReuseEvidenceReporter implements Reporter {
  private context?: JiraReuseEvidenceContext;
  private pending: Promise<void>[] = [];

  onBegin() {
    const raw = process.env.JIRA_REUSE_EVIDENCE_CONTEXT;
    if (raw) this.context = JSON.parse(raw) as JiraReuseEvidenceContext;
    if (this.context) console.log("[evidence] initialized mode=jira_promoted_reuse");
  }

  onTestEnd(test: TestCase, result: TestResult) {
    // Playwright does not await onTestEnd. onEnd is the awaited lifecycle hook.
    this.pending.push(this.saveTestEvidence(test, result));
  }

  async onEnd() {
    await Promise.all(this.pending);
  }

  private async saveTestEvidence(test: TestCase, result: TestResult) {
    const context = this.context;
    if (!context || path.resolve(test.location.file) !== path.resolve(context.specPath)) return;
    const paths = buildEvidencePaths({ ...context, scenarioId: `C${context.caseId}`, scenarioTitle: test.title });
    const specSource = await fs.readFile(context.specPath, "utf8");
    const plan = JSON.parse(await fs.readFile(path.join(path.dirname(context.specPath), "plan.json"), "utf8")) as ExecutionPlan;
    const passed = result.status === "passed";
    const failedStep = failedJiraSpecStep(specSource, context.specPath, result.errors.map(error => error.stack ?? ""));
    const timestamp = new Date().toISOString();
    await fs.mkdir(paths.screenshotsDir, { recursive: true });
    const finalIndex = plan.steps.filter(step => !step.optional).at(-1)?.index;

    const stepScreenshots = new Map<number, string>();
    const stepMetadata = new Map<number, {
      timestamp?: string;
      screenIdentity?: { id: string; title: string };
    }>();
    for (const attachment of result.attachments) {
      const imageMatch = attachment.name.match(/^jira-step-(\d{3})$/);
      if (imageMatch && attachment.contentType === "image/png" && (attachment.path || attachment.body)) {
        const stepIndex = Number(imageMatch[1]);
        const stepPath = path.resolve(paths.screenshotsDir,
          passed && stepIndex === finalIndex ? "final.png" : `step-${imageMatch[1]}.png`);
        if (attachment.path) await fs.copyFile(attachment.path, stepPath);
        else await fs.writeFile(stepPath, attachment.body!);
        stepScreenshots.set(stepIndex, stepPath);
        continue;
      }
      const metadataMatch = attachment.name.match(/^jira-step-(\d{3})-meta$/);
      if (!metadataMatch || attachment.contentType !== "application/json" || (!attachment.path && !attachment.body)) continue;
      try {
        const body = attachment.path
          ? await fs.readFile(attachment.path, "utf8")
          : attachment.body!.toString("utf8");
        const metadata = JSON.parse(body) as {
          timestamp?: string;
          screenIdentity?: { id?: string; title?: string };
        };
        const screenIdentity = typeof metadata.screenIdentity?.id === "string"
          && typeof metadata.screenIdentity.title === "string"
          ? { id: metadata.screenIdentity.id, title: metadata.screenIdentity.title }
          : undefined;
        stepMetadata.set(Number(metadataMatch[1]), {
          ...(typeof metadata.timestamp === "string" ? { timestamp: metadata.timestamp } : {}),
          ...(screenIdentity ? { screenIdentity } : {}),
        });
      } catch {
        // Ignore a malformed optional step attachment; functional test status remains authoritative.
      }
    }

    // The configured `screenshot: on` attachment is the final page capture. Step captures
    // have explicit names and must never be mistaken for the final checkpoint.
    // Only the last required step's capture counts as final; never relabel an older step capture.
    let screenshotPath: string | undefined = passed && finalIndex !== undefined
      ? stepScreenshots.get(finalIndex)
      : undefined;
    if (!screenshotPath) {
      const screenshot = [...result.attachments].reverse().find(attachment =>
        !attachment.name.startsWith("jira-step-")
        && attachment.contentType === "image/png"
        && (attachment.path || attachment.body));
      if (screenshot) {
        screenshotPath = path.resolve(paths.screenshotsDir, "final.png");
        if (screenshot.path) await fs.copyFile(screenshot.path, screenshotPath);
        else await fs.writeFile(screenshotPath, screenshot.body!);
      }
    }

    if (!passed && failedStep !== undefined) {
      console.log(`[promoted-step] stepIndex=${failedStep} phase=failed`);
    }
    let activeScreen: { id: string; title: string } | undefined;
    const steps = plan.steps.map(step => {
      const metadata = stepMetadata.get(step.index);
      if (metadata?.screenIdentity) activeScreen = metadata.screenIdentity;
      const stepScreenshotPath = stepScreenshots.get(step.index)
        ?? (screenshotPath && step.index === (passed ? finalIndex : failedStep) ? screenshotPath : undefined);
      const status: EvidenceStepRecord["status"] = passed || (failedStep !== undefined && step.index < failedStep) ? "passed"
        : step.index === failedStep ? "failed" : "skipped";
      return {
        index: step.index, stepIndex: step.index, stepText: step.description ?? step.action,
        status,
        timestamp: metadata?.timestamp ?? timestamp,
        ...(activeScreen ? { screenId: activeScreen.id, screenTitle: activeScreen.title } : {}),
        ...(step.index === failedStep ? { errorMessage: "JIRA_REUSED_SPEC_FAILED" } : {}),
        ...(stepScreenshotPath ? { screenshotPath: stepScreenshotPath } : {}),
      };
    });
    const record: EvidenceScenarioRecord = {
      scenarioId: `C${context.caseId}`, scenarioTitle: test.title,
      requirement: plan.scenario.externalId?.split(":")[0] ?? "",
      analyst: "QA Lab", date: timestamp, status: passed ? "Exitoso" : "Fallido",
      captureStatus: screenshotPath ? "success" : "failed", functionalStatus: passed ? "passed" : "failed",
      evidenceKind: "jira_semantic", appSlug: context.appSlug, sectionSlug: context.sectionSlug, sectionName: context.sectionName,
      steps,
      finalScreenEvidence: { captured: Boolean(screenshotPath), path: screenshotPath ?? null, capturedAt: timestamp },
    };
    await fs.writeFile(paths.evidenceJsonPath, JSON.stringify(record, null, 2));
    console.log(`[evidence] scenario saved caseId=${context.caseId} captureStatus=${record.captureStatus}`);
  }
}
