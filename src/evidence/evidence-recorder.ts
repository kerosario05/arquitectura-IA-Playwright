import * as fs from "node:fs";
import * as path from "node:path";
import type { Page } from "@playwright/test";
import { loadEvidenceConfig, type EvidenceConfig, type EvidenceScenarioContext, type EvidenceStepRecord, type EvidenceScenarioRecord, type DetailEvidenceMetadata, type InitialScreenEvidence, deriveScenarioStatus } from "./evidence-types";
import { buildEvidencePaths, buildScreenshotFilename } from "./evidence-paths";
import { generateEvidenceDocx } from "./evidence-docx-generator";

export class EvidenceRecorder {
  private config: EvidenceConfig;
  private context: EvidenceScenarioContext;
  private steps: EvidenceStepRecord[] = [];
  private paths: ReturnType<typeof buildEvidencePaths>;
  private started = false;
  private finished = false;
  private detailEvidence?: DetailEvidenceMetadata;
  private finalProductClickStepIndex?: number;
  private detailOpened?: boolean;
  private evidenceKind?: string;
  private isDetailEvidence?: boolean;
  private lastActionTarget?: string;
  private initialScreenEvidence?: InitialScreenEvidence;

  constructor(context: EvidenceScenarioContext, config?: Partial<EvidenceConfig>) {
    this.config = { ...loadEvidenceConfig(), ...config };
    this.context = context;
    this.paths = buildEvidencePaths(context);
  }

  get enabled(): boolean {
    return this.config.enabled;
  }

  async start(): Promise<void> {
    if (!this.config.enabled) return;
    if (this.started) return;
    this.started = true;

    // Ensure directories exist
    await fs.promises.mkdir(this.paths.scenarioDir, { recursive: true });
    await fs.promises.mkdir(this.paths.screenshotsDir, { recursive: true });
    await fs.promises.mkdir(this.paths.snapshotsDir, { recursive: true });

    const runIdLog = this.context.runId ? ` runId=${this.context.runId}` : "";
    console.log(`[evidence:scenario] started scenarioId=${this.context.scenarioId}${runIdLog} dir=${this.paths.scenarioDir}`);
  }

  async captureInitialScreen(page: Page, executionSource: "full_discovery" | "promoted_reuse", timeoutMs = 10000): Promise<boolean> {
    if (this.initialScreenEvidence) return this.initialScreenEvidence.status === "ready";
    await this.start();
    const capturedAt = new Date().toISOString();
    let ready = false;
    let reason: string | undefined;
    try {
      if (page.isClosed()) throw new Error("initial_load_failure");
      await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const usable = await page.evaluate(() => document.readyState !== "loading" && Boolean(document.body) && document.body.childNodes.length > 0).catch(() => false);
        if (usable) { ready = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!ready) reason = "initial_readiness_timeout";
    } catch (error) {
      reason = error instanceof Error && error.message.includes("timeout") ? "initial_readiness_timeout" : "navigation_failed";
    }

    let screenshotPath: string | null = null;
    try {
      const filename = ready ? "initial-screen.png" : "initial-load-failure.png";
      screenshotPath = path.join(this.paths.screenshotsDir, filename);
      await page.screenshot({ path: screenshotPath, fullPage: this.config.fullPage });
    } catch {
      screenshotPath = null;
    }
    this.initialScreenEvidence = {
      status: ready ? "ready" : "load_failed",
      captured: Boolean(screenshotPath),
      path: screenshotPath,
      capturedAt,
      ...(ready ? {} : { reason }),
    };
    console.log(`[evidence:initial] scenarioId=${this.context.scenarioId} executionSource=${executionSource} status=${this.initialScreenEvidence.status} captured=${this.initialScreenEvidence.captured} beforeStepIndex=1 reason=${ready ? "none" : reason}`);
    if (!ready) console.log(`[initial-readiness] scenarioId=${this.context.scenarioId} executionSource=${executionSource} ready=false reason=${reason} stepsStarted=false`);
    return ready;
  }

  async captureStep(
    page: Page,
    stepIndex: number,
    stepText: string,
    options?: {
      target?: string;
      status?: "passed" | "failed" | "skipped";
      errorMessage?: string;
      sourceStepIndex?: number;
    },
  ): Promise<EvidenceStepRecord> {
    const record: EvidenceStepRecord = {
      index: stepIndex,
      stepIndex: options?.sourceStepIndex,
      stepText,
      target: options?.target,
      status: options?.status ?? "passed",
      timestamp: new Date().toISOString(),
      errorMessage: options?.errorMessage,
    };

    if (!this.config.enabled) {
      this.steps.push(record);
      return record;
    }

    // Ensure started
    if (!this.started) await this.start();

    // Take screenshot
    try {
      const filename = buildScreenshotFilename(stepIndex, stepText);
      const screenshotPath = path.join(this.paths.screenshotsDir, filename);
      await page.screenshot({ path: screenshotPath, fullPage: this.config.fullPage });
      record.screenshotPath = screenshotPath;

      // Log screenshot capture with size
      const stats = await fs.promises.stat(screenshotPath);
      console.log(`[evidence:scenario] screenshot captured scenarioId=${this.context.scenarioId} step=${stepIndex} path=${screenshotPath} size=${stats.size}`);
    } catch (err: any) {
      const msg = `Screenshot failed for step ${stepIndex}: ${err.message}`;
      if (this.config.failOnError) {
        throw new Error(msg);
      }
      console.log(`[evidence:scenario] ${msg}`);
    }

    this.steps.push(record);
    return record;
  }

  /**
   * Add a step record without capturing a screenshot.
   * Useful for populating steps from discovery result at finalization time.
   */
  addStepRecord(
    stepIndex: number,
    stepText: string,
    options?: {
      target?: string;
      status?: "passed" | "failed" | "skipped";
      errorMessage?: string;
      screenshotPath?: string;
      snapshotPath?: string;
      sourceStepIndex?: number;
    },
  ): void {
    // Validate screenshotPath - must be image file or undefined
    if (options?.screenshotPath) {
      const ext = path.extname(options.screenshotPath).toLowerCase();
      if (ext !== ".png" && ext !== ".jpg" && ext !== ".jpeg") {
        console.log(`[evidence:scenario] rejected invalid screenshotPath=${options.screenshotPath} (must be .png/.jpg/.jpeg)`);
        // Move to snapshotPath if it's .json
        if (ext === ".json") {
          options.snapshotPath = options.screenshotPath;
          options.screenshotPath = undefined;
        } else {
          options.screenshotPath = undefined;
        }
      }
    }

    const record: EvidenceStepRecord = {
      index: stepIndex,
      stepIndex: options?.sourceStepIndex,
      stepText,
      target: options?.target,
      status: options?.status ?? "passed",
      timestamp: new Date().toISOString(),
      errorMessage: options?.errorMessage,
      screenshotPath: options?.screenshotPath,
      snapshotPath: options?.snapshotPath,
    };
    this.steps.push(record);
  }

  /**
   * Get current step count (useful for checking if steps were populated).
   */
  get stepCount(): number {
    return this.steps.length;
  }

  get hasInitialScreenEvidence(): boolean {
    return Boolean(this.initialScreenEvidence);
  }

  /**
   * Capture detail screenshot after final product click.
   * This screenshot validates that the detail screen loaded correctly.
   */
  async captureDetailScreenshot(
    page: Page,
    target: string,
    stepIndex: number,
    options?: {
      validateSelector?: string;
      validateText?: string;
      detailHeading?: boolean;
      detailSections?: boolean;
      actionButtons?: boolean;
      oracleReason?: string;
    }
  ): Promise<{ captured: boolean; screenshotPath?: string; reason: string }> {
    if (!this.config.enabled) {
      console.log(`[detail-screenshot] skipped (evidence disabled) target="${target}"`);
      return { captured: false, reason: "evidence_disabled" };
    }

    if (!this.started) await this.start();

    console.log(`[detail-screenshot] required=true target="${target}" step=${stepIndex}`);

    try {
      // Wait for detail screen to stabilize
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
      await page.waitForTimeout(500); // Brief stabilization

      // Validate that detail screen is visible
      if (options?.validateSelector) {
        try {
          await page.waitForSelector(options.validateSelector, { timeout: 3000, state: "visible" });
          console.log(`[detail-screenshot] validation selector found="${options.validateSelector}"`);
        } catch {
          console.log(`[detail-screenshot] validation selector not found="${options.validateSelector}"`);
        }
      }

      if (options?.validateText) {
        const textVisible = await page.locator(`text=${options.validateText}`).first().isVisible({ timeout: 3000 }).catch(() => false);
        if (textVisible) {
          console.log(`[detail-screenshot] validation text found="${options.validateText}"`);
        } else {
          console.log(`[detail-screenshot] validation text not found="${options.validateText}"`);
        }
      }

      // Capture screenshot
      const filename = buildScreenshotFilename(stepIndex, `detail_loaded_${target}`);
      const screenshotPath = path.join(this.paths.screenshotsDir, filename);
      await page.screenshot({ path: screenshotPath, fullPage: this.config.fullPage });

      const stats = await fs.promises.stat(screenshotPath);
      console.log(`[detail-screenshot] captured=true target="${target}" step=${stepIndex} path=${screenshotPath} size=${stats.size}`);

      // Store detail evidence metadata with oracle signals
      this.detailEvidence = {
        required: true,
        captured: true,
        target,
        capturedAfterStep: stepIndex,
        screenshotPath,
        reason: options?.oracleReason ?? "detail_loaded",
        detailOpened: true,  // If we reached here, detail opened
        detailHeading: options?.detailHeading,
        detailSections: options?.detailSections,
        actionButtons: options?.actionButtons,
        oracleReason: options?.oracleReason ?? "detail_loaded"
      };

      return { captured: true, screenshotPath, reason: options?.oracleReason ?? "detail_loaded" };
    } catch (err: any) {
      const msg = `Failed to capture detail screenshot: ${err.message}`;
      console.log(`[detail-screenshot] captured=false target="${target}" reason="${err.message}"`);

      // Store failed attempt
      this.detailEvidence = {
        required: true,
        captured: false,
        target,
        capturedAfterStep: stepIndex,
        reason: err.message,
        detailOpened: false
      };

      if (this.config.failOnError) {
        throw new Error(msg);
      }
      return { captured: false, reason: err.message };
    }
  }

  /**
   * Mark that detail screenshot is required but not yet captured.
   * Called when a detail scenario is detected.
   */
  markDetailScreenshotRequired(target: string): void {
    const required = this.isDetailEvidence !== false;
    console.log(`[detail-screenshot] required=${required} target="${target}" evidenceKind=${this.evidenceKind ?? "unknown"} isDetail=${this.isDetailEvidence}`);
    this.detailEvidence = {
      required,
      captured: false,
      target,
      reason: required ? "not_captured_yet" : "not_detail_evidence_classification"
    };
  }

  /** Set evidence classification from the executor's classifyEvidenceKind result. */
  setEvidenceClassification(kind: string, isDetail: boolean, lastTarget?: string): void {
    this.evidenceKind = kind;
    this.isDetailEvidence = isDetail;
    this.lastActionTarget = lastTarget ?? "";
    if (!isDetail) {
      if (!this.detailEvidence) {
        this.detailEvidence = { required: false, captured: false, target: lastTarget ?? "", reason: "not_detail_evidence" };
      } else {
        this.detailEvidence.required = false;
      }
    }
    console.log(`[evidence:scenario] finalClassification evidenceKind=${kind} isDetail=${isDetail} detailRequired=${this.detailEvidence?.required ?? false} lastTarget="${lastTarget ?? ""}"`);
  }

  /**
   * Set the expected final product click step index.
   * Used for validation in evidence gate.
   */
  setFinalProductClickStepIndex(stepIndex: number): void {
    this.finalProductClickStepIndex = stepIndex;
    console.log(`[detail-evidence] finalProductClickStepIndex set to ${stepIndex}`);
  }

  /**
   * Set whether detail screen actually opened after final click.
   * Used for validation in evidence gate.
   */
  setDetailOpened(opened: boolean): void {
    this.detailOpened = opened;
    console.log(`[detail-evidence] detailOpened set to ${opened}`);
  }

  async finish(page?: Page): Promise<EvidenceScenarioRecord> {
    if (!this.config.enabled) {
      this.finished = true;
      return buildRecord(this.context, this.steps, undefined, undefined, undefined, this.detailEvidence, undefined, undefined, undefined, undefined, this.initialScreenEvidence);
    }

    if (this.finished) {
      return buildRecord(this.context, this.steps, this.paths.docxPath, this.paths.evidenceJsonPath, undefined, this.detailEvidence, undefined, undefined, undefined, undefined, this.initialScreenEvidence);
    }
    this.finished = true;

    // If page is provided and we have no screenshots, capture a final screenshot
    if (page && this.config.screenshotMode === "after_step") {
      const existingScreenshots = this.steps.filter(s => {
        if (!s.screenshotPath) return false;
        const ext = path.extname(s.screenshotPath).toLowerCase();
        return ext === ".png" || ext === ".jpg" || ext === ".jpeg";
      });

      if (existingScreenshots.length === 0 && this.steps.length > 0) {
        console.log(`[evidence:scenario] WARNING: No per-step screenshots found, using fallback final screenshot scenarioId=${this.context.scenarioId}`);
        try {
          const lastStep = this.steps[this.steps.length - 1];
          const filename = buildScreenshotFilename(lastStep.index, lastStep.stepText);
          const screenshotPath = path.join(this.paths.screenshotsDir, filename);

          await page.screenshot({ path: screenshotPath, fullPage: this.config.fullPage });
          lastStep.screenshotPath = screenshotPath;

          const stats = await fs.promises.stat(screenshotPath);
          console.log(`[evidence:scenario] fallback screenshot captured scenarioId=${this.context.scenarioId} path=${screenshotPath} size=${stats.size}`);
        } catch (err: any) {
          console.log(`[evidence:scenario] fallback screenshot failed: ${err.message}`);
        }
      } else if (existingScreenshots.length > 0) {
        console.log(`[evidence:scenario] per-step screenshots captured count=${existingScreenshots.length} scenarioId=${this.context.scenarioId}`);
      }
    }

    let status = this.initialScreenEvidence?.status === "load_failed" ? "Fallido" : deriveScenarioStatus(this.steps);

    // EVIDENCE GATE: Validate detail screenshot requirement
    // Task 2: Skip detail screenshot requirement for listing/navigation scenarios (no detailTarget AND no finalProductClickStepIndex)
    const isListingOrNavigationScenario = !this.detailTarget && !this.finalProductClickStepIndex;
    if (isListingOrNavigationScenario) {
      console.log(
        `[evidence-gate] detailScreenshotRequired=false reason=listing_or_navigation_scenario ` +
        `detailTarget=${this.detailTarget ?? "none"} finalProductClickStepIndex=${this.finalProductClickStepIndex ?? "none"}`
      );
      console.log(
        `[evidence:scenario] finalScreenEvidence captured=${this.steps.some((step) => Boolean(step.screenshotPath))} source=last_successful_action ` +
        `scenario=${this.context.scenarioId} finalStepsCount=${this.steps.length}`
      );
      // Clear detailEvidence so downstream (DOCX) doesn't use it
      this.detailEvidence = undefined;
    } else if (this.detailEvidence?.required) {
      const detailFound = this.detailEvidence.captured && this.detailEvidence.screenshotPath;
      const capturedAfterStep = this.detailEvidence.capturedAfterStep;
      const expectedStepIndex = this.finalProductClickStepIndex;
      const detailActuallyOpened = this.detailOpened;

      console.log(
        `[evidence-gate] scenario=${this.context.scenarioId} detailScreenshotRequired=true found=${detailFound} ` +
        `capturedAfterStep=${capturedAfterStep ?? 'undefined'} finalProductClickStepIndex=${expectedStepIndex ?? 'undefined'} ` +
        `detailOpened=${detailActuallyOpened ?? 'undefined'}`
      );

      if (!detailFound) {
        // Override status to failed if detail screenshot is missing
        const originalStatus = status;
        status = "Fallido";
        console.log(
          `[evidence-gate] scenario=${this.context.scenarioId} detailScreenshotRequired=true found=false ` +
          `statusOverride=failed originalStatus=${originalStatus} reason=missing_detail_screenshot`
        );

        // Add error to last step
        if (this.steps.length > 0) {
          const lastStep = this.steps[this.steps.length - 1];
          lastStep.status = "failed";
          lastStep.errorMessage = lastStep.errorMessage
            ? `${lastStep.errorMessage}; Missing detail screenshot`
            : "Missing detail screenshot for detail page validation";
        }
      } else if (detailActuallyOpened === false) {
        // Override status to failed if detail didn't actually open
        const originalStatus = status;
        status = "Fallido";
        console.log(
          `[evidence-gate] scenario=${this.context.scenarioId} detailScreenshotRequired=true found=${detailFound} ` +
          `statusOverride=failed originalStatus=${originalStatus} reason=detail_not_opened`
        );

        // Add error to last step
        if (this.steps.length > 0) {
          const lastStep = this.steps[this.steps.length - 1];
          lastStep.status = "failed";
          lastStep.errorMessage = lastStep.errorMessage
            ? `${lastStep.errorMessage}; Detail screen did not open (missing exclusive detail signals)`
            : "Detail screen did not open - missing exclusive detail signals (sections/buttons/transition)";
        }
      } else if (expectedStepIndex !== undefined && capturedAfterStep !== undefined && capturedAfterStep < expectedStepIndex) {
        // Override status to failed if detail screenshot captured too early
        const originalStatus = status;
        status = "Fallido";
        console.log(
          `[evidence-gate] scenario=${this.context.scenarioId} detailScreenshotRequired=true found=true ` +
          `statusOverride=failed originalStatus=${originalStatus} reason=detail_screenshot_captured_too_early ` +
          `capturedAfterStep=${capturedAfterStep} finalProductClickStepIndex=${expectedStepIndex}`
        );

        // Add error to last step
        if (this.steps.length > 0) {
          const lastStep = this.steps[this.steps.length - 1];
          lastStep.status = "failed";
          lastStep.errorMessage = lastStep.errorMessage
            ? `${lastStep.errorMessage}; Detail screenshot captured at step ${capturedAfterStep}, expected after step ${expectedStepIndex}`
            : `Detail screenshot captured too early (step ${capturedAfterStep} instead of ${expectedStepIndex})`;
        }
      } else {
        // Detail screenshot found, detail opened, and captured at correct step - log success
        console.log(
          `[evidence-gate] scenario=${this.context.scenarioId} detailScreenshotRequired=true found=true ` +
          `screenshotPath=${this.detailEvidence.screenshotPath} target="${this.detailEvidence.target}" ` +
          `capturedAfterStep=${this.detailEvidence.capturedAfterStep} finalProductClickStepIndex=${expectedStepIndex} ` +
          `detailOpened=${detailActuallyOpened}`
        );
      }
    }

    const date = new Date().toLocaleDateString("es-ES", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const finalScreenshot = [...this.steps].reverse().find((step) => Boolean(step.screenshotPath))?.screenshotPath ?? null;
    const record = buildRecord(this.context, this.steps, this.paths.docxPath, this.paths.evidenceJsonPath, status, this.detailEvidence, date, this.evidenceKind, this.isDetailEvidence, this.lastActionTarget, this.initialScreenEvidence, {
      captured: Boolean(finalScreenshot),
      path: finalScreenshot,
      capturedAt: new Date().toISOString(),
    });

    console.log(`[evidence:scenario] persisted evidenceKind=${this.evidenceKind ?? "unknown"} isDetail=${this.isDetailEvidence ?? false} detailRequired=${this.detailEvidence?.required ?? false}`);
    console.log(`[evidence:scenario] finalClassification evidenceKind=${this.evidenceKind ?? "unknown"} isDetail=${this.isDetailEvidence ?? false} detailRequired=${this.detailEvidence?.required ?? false} lastTarget="${this.lastActionTarget ?? ""}"`);

    // Save evidence.json
    try {
      await fs.promises.writeFile(this.paths.evidenceJsonPath, JSON.stringify(record, null, 2), "utf8");
      console.log(`[evidence:scenario] saved evidence.json path=${this.paths.evidenceJsonPath}`);
    } catch (err: any) {
      const msg = `Failed to save evidence.json: ${err.message}`;
      if (this.config.failOnError) throw new Error(msg);
      console.log(`[evidence:scenario] ${msg}`);
    }

    // Count real screenshots (not snapshots)
    const realScreenshots = this.steps.filter(s => {
      if (!s.screenshotPath) return false;
      const ext = path.extname(s.screenshotPath).toLowerCase();
      return ext === ".png" || ext === ".jpg" || ext === ".jpeg";
    }).length;

    const snapshotCount = this.steps.filter(s => s.snapshotPath).length;

    console.log(`[evidence:scenario] finalized scenarioId=${record.scenarioId} status=${status} steps=${this.steps.length} screenshots=${realScreenshots} snapshots=${snapshotCount}`);

    // Generate per-scenario DOCX only if enabled
    if (this.config.docxEnabled && this.config.perScenarioDocx) {
      try {
        const templatePath = this.context.templatePath ?? this.config.templatePath;
        const resolvedTemplate = path.resolve(templatePath);
        const result = await generateEvidenceDocx(record, resolvedTemplate, this.paths.docxPath);
        if (result.success) {
          console.log(`[evidence:scenario] generated per-scenario evidencia.docx path=${result.outputPath}`);
        } else {
          console.log(`[evidence:scenario] per-scenario docx generation skipped: ${result.error}`);
        }
      } catch (err: any) {
        const msg = `per-scenario docx generation error: ${err.message}`;
        if (this.config.failOnError) throw new Error(msg);
        console.log(`[evidence:scenario] ${msg}`);
      }
    } else if (this.config.docxEnabled && !this.config.perScenarioDocx) {
      console.log(`[evidence:scenario] per-scenario docx disabled (EVIDENCE_PER_SCENARIO_DOCX=false)`);
    }

    return record;
  }
}

function buildRecord(
  context: EvidenceScenarioContext,
  steps: EvidenceStepRecord[],
  docxPath?: string,
  evidenceJsonPath?: string,
  status?: string,
  detailEvidence?: DetailEvidenceMetadata,
  date?: string,
  evidenceKind?: string,
  isDetailEvidence?: boolean,
  lastActionTarget?: string,
  initialScreenEvidence?: InitialScreenEvidence,
  finalScreenEvidence?: EvidenceScenarioRecord["finalScreenEvidence"],
): EvidenceScenarioRecord {
  return {
    scenarioId: context.scenarioId,
    scenarioTitle: context.scenarioTitle,
    requirement: context.sectionName
      ? `Automatización - ${context.sectionName}`
      : `Automatización - ${context.sectionSlug}`,
    analyst: context.analystName ?? "",
    date: date ?? new Date().toLocaleDateString("es-ES", {
      year: "numeric", month: "long", day: "numeric",
    }),
    status: (status ?? deriveScenarioStatus(steps)) as any,
    appSlug: context.appSlug,
    sectionSlug: context.sectionSlug,
    sectionName: context.sectionName,
    initialScreenEvidence,
    steps,
    finalScreenEvidence,
    docxPath,
    evidenceJsonPath,
    detailEvidence,
    evidenceKind,
    isDetailEvidence,
    lastActionTarget,
  };
}
