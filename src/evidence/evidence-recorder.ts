import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { waitForVisualSettle, readScreenSignature } from "./screen-settle";
import type { Page } from "@playwright/test";
import { loadEvidenceConfig, type EvidenceConfig, type EvidenceScenarioContext, type EvidenceStepRecord, type EvidenceScenarioRecord, type DetailEvidenceMetadata, type InitialScreenEvidence, deriveScenarioStatus, type EvidenceCaptureStatus, type EvidenceFunctionalStatus } from "./evidence-types";
import { buildEvidencePaths, buildScreenshotFilename } from "./evidence-paths";
import { generateEvidenceDocx } from "./evidence-docx-generator";

function screenIdentityFromSignature(signature: string): { id: string; title: string } {
  const stableSignature = signature.split("|completeForms=")[0]?.split("|completeRows=")[0] || "unknown-screen";
  const [route = "", ...markerParts] = stableSignature.split("|");
  const markers = markerParts.join("|").split("¦");
  const heading = markers.find(marker => /^(?:h1|h2|h3|heading|legend|dialog|alertdialog):/i.test(marker));
  const headingText = heading?.split(":").slice(1).join(":").replace(/\s+/g, " ").trim().slice(0, 80);
  const routeName = route.split("/").filter(Boolean).at(-1)?.replace(/[-_]+/g, " ");
  return {
    id: createHash("sha1").update(stableSignature).digest("hex").slice(0, 16),
    title: headingText || (routeName ? `Pantalla ${routeName}` : "Pantalla principal"),
  };
}

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
  private initialScreenSignature?: string;
  private discoveryStatus?: string;
  private functionalStatus?: EvidenceFunctionalStatus;
  private lastImage?: { hash: string; path: string };
  private finalScreenEvidence?: EvidenceScenarioRecord["finalScreenEvidence"];
  /** Steps since the last screen change; they share ONE image (the screen before it changed). */
  private pendingGroup: EvidenceStepRecord[] = [];
  /** Latest settled state of the current screen (image kept in memory until committed). */
  private screenState?: { image: Buffer; signature: string };

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

  async captureInitialScreen(
    page: Page,
    executionSource: "full_discovery" | "promoted_reuse",
    timeoutMs = 10000,
    options?: { alreadyReady?: boolean },
  ): Promise<boolean> {
    if (this.initialScreenEvidence) return this.initialScreenEvidence.status === "ready";
    await this.start();
    const capturedAt = new Date().toISOString();
    let ready = false;
    let reason: string | undefined;
    if (options?.alreadyReady) {
      // Caller (promoted runtime's ensureInitialNavigation) already proved readiness via the
      // shared waitForPageReady primitive immediately before this call. Re-running an
      // independent DOM poll here would be a second, weaker readiness authority that can
      // spuriously disagree with the one already proven (e.g. a transient page.evaluate
      // failure) and mislabel a proven-ready page as initial_readiness_timeout.
      ready = !page.isClosed();
      if (!ready) reason = "navigation_failed";
    } else {
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
    }

    let screenshotPath: string | null = null;
    try {
      if (ready) {
        const settle = await waitForVisualSettle(page, { timeoutMs: this.config.settleTimeoutMs, quietMs: this.config.settleQuietMs });
        if (settle.settled) {
          screenshotPath = path.join(this.paths.screenshotsDir, "initial-screen.png");
          await page.screenshot({ path: screenshotPath, fullPage: this.config.fullPage, timeout: this.config.captureTimeoutMs });
        } else {
          reason = settle.loaderVisible ? "initial_loader_still_visible" : "initial_visual_settle_timeout";
          console.log(`[evidence:initial] screenshot skipped scenarioId=${this.context.scenarioId} settled=false waitedMs=${settle.waitedMs} loaderVisible=${settle.loaderVisible}`);
        }
      } else {
        screenshotPath = path.join(this.paths.screenshotsDir, "initial-load-failure.png");
        await page.screenshot({ path: screenshotPath, fullPage: this.config.fullPage, timeout: this.config.captureTimeoutMs });
      }
    } catch {
      screenshotPath = null;
    }
    if (ready && screenshotPath) {
      try {
        this.initialScreenSignature = await readScreenSignature(page);
        const identity = screenIdentityFromSignature(this.initialScreenSignature);
        this.screenState = { image: await fs.promises.readFile(screenshotPath), signature: this.initialScreenSignature };
        this.initialScreenEvidence = {
          status: "ready",
          captured: true,
          path: screenshotPath,
          capturedAt,
          screenId: identity.id,
          screenTitle: identity.title,
        };
      } catch {
        this.screenState = undefined;
      }
    }
    this.initialScreenEvidence ??= {
        status: ready ? "ready" : "load_failed",
        captured: Boolean(screenshotPath),
        path: screenshotPath,
        capturedAt,
        ...(reason ? { reason } : {}),
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
    const actionScreen = this.screenState
      ? screenIdentityFromSignature(this.screenState.signature)
      : undefined;
    const record: EvidenceStepRecord = {
      index: stepIndex,
      stepIndex: options?.sourceStepIndex,
      stepText,
      ...(actionScreen ? { screenId: actionScreen.id, screenTitle: actionScreen.title } : {}),
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

    // Steps share images at useful checkpoints. Route/heading changes close the previous screen;
    // completing a form or a data row commits the current filled state. Intermediate typing stays
    // grouped so OTP digits and long text do not create a screenshot for every keystroke.
    this.steps.push(record);
    this.pendingGroup.push(record);
    try {
      const settle = await waitForVisualSettle(page, { timeoutMs: this.config.settleTimeoutMs, quietMs: this.config.settleQuietMs });
      if (!settle.settled) {
        console.log(`[evidence:scenario] capture deferred scenarioId=${this.context.scenarioId} step=${stepIndex} reason=${settle.loaderVisible ? "loader_still_visible" : "visual_settle_timeout"} waitedMs=${settle.waitedMs}; retaining last settled image`);
        return record;
      }
      const image = await page.screenshot({ fullPage: this.config.fullPage, timeout: this.config.captureTimeoutMs });
      const signature = await readScreenSignature(page);
      const currentScreen = screenIdentityFromSignature(signature);
      if (!record.screenId) {
        record.screenId = currentScreen.id;
        record.screenTitle = currentScreen.title;
      }
      const previousSignature = this.screenState?.signature ?? "";
      const previousBase = previousSignature.split("|completeForms=")[0];
      const currentBase = signature.split("|completeForms=")[0];
      const screenChanged = Boolean(this.screenState && previousBase !== currentBase);
      const previousCheckpoint = previousSignature.match(/\|completeForms=(\d+)\|completeRows=(\d+)/);
      const currentCheckpoint = signature.match(/\|completeForms=(\d+)\|completeRows=(\d+)/);
      const completedFormChanged = Boolean(
        this.screenState && !screenChanged && previousCheckpoint && currentCheckpoint &&
        Number(currentCheckpoint[1]) > Number(previousCheckpoint[1])
      );
      const completedFormOrRowChanged = Boolean(
        completedFormChanged || (this.screenState && !screenChanged && previousCheckpoint && currentCheckpoint &&
          Number(currentCheckpoint[2]) > Number(previousCheckpoint[2]))
      );
      console.log(`[evidence:scenario] settle scenarioId=${this.context.scenarioId} step=${stepIndex} settled=${settle.settled} waitedMs=${settle.waitedMs} loaderVisible=${settle.loaderVisible} screenChanged=${screenChanged}`);
      if (screenChanged && this.screenState) {
        await this.commitScreenGroup(this.screenState.image, "screen_changed");
      } else if (completedFormOrRowChanged) {
        await this.commitScreenGroup(image, "completed_form_or_data_row");
        const initialBase = this.initialScreenSignature?.split("|completeForms=")[0];
        if (
          completedFormChanged && !this.initialScreenEvidence?.completedFormCheckpointPath &&
          this.initialScreenEvidence?.captured && initialBase && initialBase === currentBase && record.screenshotPath
        ) {
          this.initialScreenEvidence = {
            ...this.initialScreenEvidence,
            completedFormCheckpointPath: record.screenshotPath,
          };
          console.log(`[evidence:initial] completedFormCheckpoint=true scenarioId=${this.context.scenarioId} path=${record.screenshotPath}`);
        }
      } else if (record.status === "failed") {
        await this.commitScreenGroup(image, "step_failed");
      }
      this.screenState = { image, signature };
    } catch (err: any) {
      const msg = `Screenshot failed for step ${stepIndex}: ${err.message}`;
      if (this.config.failOnError) {
        throw new Error(msg);
      }
      console.log(`[evidence:scenario] ${msg}`);
    }

    return record;
  }

  /** Synchronize the evidence screen with the UI immediately before the next action dispatch.
   * Step capture happens after an action, so relying only on captureStep can leave the next
   * action attached to the previous screen when an intervening action (for example Enter) was
   * not itself recorded as an evidence step. */
  async prepareForAction(page: Page): Promise<void> {
    if (!this.config.enabled || !this.screenState || page.isClosed()) return;
    try {
      const signature = await readScreenSignature(page);
      const previousBase = this.screenState.signature.split("|completeForms=")[0];
      const currentBase = signature.split("|completeForms=")[0];
      if (previousBase === currentBase) return;

      const settle = await waitForVisualSettle(page, {
        timeoutMs: this.config.settleTimeoutMs,
        quietMs: this.config.settleQuietMs,
      });
      if (!settle.settled) return;
      const image = await page.screenshot({ fullPage: this.config.fullPage, timeout: this.config.captureTimeoutMs });
      const settledSignature = await readScreenSignature(page);
      if (this.pendingGroup.length > 0) {
        await this.commitScreenGroup(this.screenState.image, "screen_changed_before_action");
      }
      this.screenState = { image, signature: settledSignature };
      console.log(`[evidence:scenario] screen synchronized before next action scenarioId=${this.context.scenarioId} screenId=${screenIdentityFromSignature(settledSignature).id}`);
    } catch (error) {
      console.log(`[evidence:scenario] screen synchronization skipped scenarioId=${this.context.scenarioId} reason=${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Writes `image` once (identical consecutive images reuse the file) and assigns it to the pending group. */
  private async commitScreenGroup(image: Buffer, reason: string): Promise<void> {
    const group = this.pendingGroup;
    if (group.length === 0) return;
    this.pendingGroup = [];
    const hash = createHash("sha1").update(image).digest("hex");
    let imagePath: string;
    if (this.lastImage && this.lastImage.hash === hash && fs.existsSync(this.lastImage.path)) {
      imagePath = this.lastImage.path;
    } else {
      const anchor = group[group.length - 1];
      imagePath = path.join(this.paths.screenshotsDir, buildScreenshotFilename(anchor.index, anchor.stepText));
      await fs.promises.writeFile(imagePath, image);
      this.lastImage = { hash, path: imagePath };
    }
    for (const step of group) step.screenshotPath = imagePath;
    console.log(`[evidence:scenario] screen image committed scenarioId=${this.context.scenarioId} reason=${reason} steps=${group.length} path=${imagePath}`);
  }

  /**
   * Closes the evidence once the last step ran: the steps still waiting get the final settled state
   * of their screen, and when the last action itself changed the screen, the resulting screen is
   * added as its own closing entry so the evidence shows what the last step produced.
   */
  private async finalizeScreens(page?: Page): Promise<void> {
    if (this.steps.length === 0) return;
    let image: Buffer | undefined;
    let finalSignature = "";
    let settledNote = "last_settled_state";
    let finalCaptured = false;
    if (page && !page.isClosed()) {
      try {
        const settle = await waitForVisualSettle(page, { timeoutMs: this.config.finalSettleTimeoutMs, quietMs: this.config.settleQuietMs });
        settledNote = `settled=${settle.settled} waitedMs=${settle.waitedMs} loaderVisible=${settle.loaderVisible}`;
        if (settle.settled) {
          image = await page.screenshot({ fullPage: this.config.fullPage, timeout: this.config.captureTimeoutMs });
          finalSignature = await readScreenSignature(page);
          finalCaptured = true;
        } else {
          console.log(`[evidence:scenario] final screenshot omitted scenarioId=${this.context.scenarioId} reason=${settle.loaderVisible ? "loader_still_visible" : "visual_settle_timeout"} waitedMs=${settle.waitedMs}; no unsettled frame saved`);
          image = this.screenState?.image;
        }
      } catch (err: any) {
        console.log(`[evidence:scenario] final state capture skipped: ${err.message}`);
        image = this.screenState?.image;
      }
    } else if (!page) {
      image = this.screenState?.image;
      finalCaptured = Boolean(image);
    } else {
      image = this.screenState?.image;
    }
    if (!image) {
      this.finalScreenEvidence = { captured: false, path: null, capturedAt: new Date().toISOString() };
      return;
    }
    const lastStep = this.steps[this.steps.length - 1];
    if (this.pendingGroup.length > 0) {
      if (finalCaptured) {
        const lastCapturedBase = this.screenState?.signature.split("|completeForms=")[0];
        const finalBase = finalSignature.split("|completeForms=")[0];
        const changedAfterLastStep = Boolean(lastCapturedBase && finalBase && lastCapturedBase !== finalBase);
        if (changedAfterLastStep && this.screenState) {
          // Navigation can finish after captureStep has already recorded the last action. Keep
          // pending actions with the last settled image from their screen, then preserve the
          // asynchronously reached page as a separate final checkpoint.
          await this.commitScreenGroup(this.screenState.image, "screen_changed_after_last_action");
          const finalHash = createHash("sha1").update(image).digest("hex");
          const lastCapturedHash = createHash("sha1").update(this.screenState.image).digest("hex");
          let finalPath: string;
          if (this.lastImage?.hash === finalHash) {
            finalPath = this.lastImage.path;
          } else {
            finalPath = path.join(this.paths.screenshotsDir, "final-state.png");
            await fs.promises.writeFile(finalPath, image);
            this.lastImage = { hash: finalHash, path: finalPath };
          }
          this.finalScreenEvidence = { captured: true, path: finalPath, capturedAt: new Date().toISOString() };
          if (finalHash !== lastCapturedHash) {
            const finalIdentity = screenIdentityFromSignature(finalSignature);
            this.steps.push({
              index: lastStep.index + 1,
              stepText: "Pantalla resultante tras el último paso",
              screenId: finalIdentity.id,
              screenTitle: finalIdentity.title,
              status: lastStep.status === "failed" ? "failed" : "passed",
              timestamp: new Date().toISOString(),
              screenshotPath: finalPath,
            });
          }
          console.log(`[evidence:scenario] late final screen captured scenarioId=${this.context.scenarioId} ${settledNote} path=${finalPath}`);
        } else {
          await this.commitScreenGroup(image, `final_state ${settledNote}`);
        }
      } else if (this.screenState) {
        // Keep the last settled image as evidence for completed inputs, but do not claim it depicts
        // the final result while the page is still loading.
        this.finalScreenEvidence = { captured: false, path: null, capturedAt: new Date().toISOString() };
      }
      return;
    }
    if (!finalCaptured) {
      this.finalScreenEvidence = { captured: false, path: null, capturedAt: new Date().toISOString() };
      return;
    }
    // Last action changed the screen: attach the resulting screen as a closing entry.
    const hash = createHash("sha1").update(image).digest("hex");
    if (this.lastImage?.hash === hash) {
      this.finalScreenEvidence = { captured: true, path: this.lastImage.path, capturedAt: new Date().toISOString() };
      return;
    }
    const finalPath = path.join(this.paths.screenshotsDir, "final-state.png");
    await fs.promises.writeFile(finalPath, image);
    this.lastImage = { hash, path: finalPath };
    this.finalScreenEvidence = { captured: true, path: finalPath, capturedAt: new Date().toISOString() };
    this.steps.push({
      index: lastStep.index + 1,
      stepText: "Pantalla resultante tras el último paso",
      ...(this.screenState ? (() => {
        const identity = screenIdentityFromSignature(this.screenState.signature);
        return { screenId: identity.id, screenTitle: identity.title };
      })() : {}),
      status: lastStep.status === "failed" ? "failed" : "passed",
      timestamp: new Date().toISOString(),
      screenshotPath: finalPath,
    });
    console.log(`[evidence:scenario] final state captured scenarioId=${this.context.scenarioId} ${settledNote} path=${finalPath}`);
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
      screenId?: string;
      screenTitle?: string;
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
      screenId: options?.screenId,
      screenTitle: options?.screenTitle,
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
      // Wait for the detail view and any asynchronous loading indicators to finish.
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
      const settle = await waitForVisualSettle(page, { timeoutMs: this.config.finalSettleTimeoutMs, quietMs: this.config.settleQuietMs });
      if (!settle.settled) {
        const reason = settle.loaderVisible ? "loader_still_visible" : "visual_settle_timeout";
        this.detailEvidence = { required: true, captured: false, target, reason, oracleReason: reason };
        console.log(`[detail-screenshot] captured=false target="${target}" reason=${reason} waitedMs=${settle.waitedMs}`);
        return { captured: false, reason };
      }

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
      await page.screenshot({ path: screenshotPath, fullPage: this.config.fullPage, timeout: this.config.captureTimeoutMs });

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

  setExecutionStatuses(input: { discoveryStatus?: string; functionalStatus?: EvidenceFunctionalStatus }): void {
    this.discoveryStatus = input.discoveryStatus;
    this.functionalStatus = input.functionalStatus;
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

    await this.finalizeScreens(page);

    // If page is provided and we have no screenshots, capture a final screenshot
    if (page && this.config.screenshotMode === "after_step") {
      const existingScreenshots = this.steps.filter(s => {
        if (!s.screenshotPath) return false;
        const ext = path.extname(s.screenshotPath).toLowerCase();
        return ext === ".png" || ext === ".jpg" || ext === ".jpeg";
      });

      if (existingScreenshots.length === 0 && this.steps.length > 0 && this.finalScreenEvidence?.captured !== false) {
        console.log(`[evidence:scenario] WARNING: No per-step screenshots found, using fallback final screenshot scenarioId=${this.context.scenarioId}`);
        try {
          const lastStep = this.steps[this.steps.length - 1];
          const filename = buildScreenshotFilename(lastStep.index, lastStep.stepText);
          const screenshotPath = path.join(this.paths.screenshotsDir, filename);

          const settle = await waitForVisualSettle(page, { timeoutMs: this.config.finalSettleTimeoutMs, quietMs: this.config.settleQuietMs });
          if (!settle.settled) throw new Error(`fallback_visual_settle_failed:${settle.loaderVisible ? "loader_still_visible" : "timeout"}`);
          await page.screenshot({ path: screenshotPath, fullPage: this.config.fullPage, timeout: this.config.captureTimeoutMs });
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

    const captureStatus: EvidenceCaptureStatus = this.initialScreenEvidence?.status === "load_failed" || this.finalScreenEvidence?.captured === false
      ? "failed"
      : this.steps.some((step) => Boolean(step.screenshotPath)) || this.initialScreenEvidence?.captured === true
        ? "success"
        : this.steps.length > 0 ? "failed" : "not_run";
    const discoveryFailed = Boolean(this.discoveryStatus && !["discovered_passed", "repaired_passed", "passed"].includes(this.discoveryStatus));
    let status = this.initialScreenEvidence?.status === "load_failed" || discoveryFailed || this.functionalStatus === "failed"
      ? "Fallido"
      : deriveScenarioStatus(this.steps);

    // EVIDENCE GATE: Validate detail screenshot requirement
    // Task 2: Skip detail screenshot requirement for listing/navigation scenarios (no detailTarget AND no finalProductClickStepIndex)
    const isListingOrNavigationScenario = !this.detailOpened && !this.finalProductClickStepIndex;
    if (isListingOrNavigationScenario) {
      console.log(
        `[evidence-gate] detailScreenshotRequired=false reason=listing_or_navigation_scenario ` +
        `detailTarget=${this.detailOpened ? "opened" : "none"} finalProductClickStepIndex=${this.finalProductClickStepIndex ?? "none"}`
      );
      console.log(
        `[evidence:scenario] finalScreenEvidence captured=${this.finalScreenEvidence?.captured ?? this.steps.some((step) => Boolean(step.screenshotPath))} source=last_settled_action ` +
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
    const finalScreenEvidence = this.finalScreenEvidence ?? {
      captured: Boolean(finalScreenshot),
      path: finalScreenshot,
      capturedAt: new Date().toISOString(),
    };
    const record = buildRecord(this.context, this.steps, this.paths.docxPath, this.paths.evidenceJsonPath, status, this.detailEvidence, date, this.evidenceKind, this.isDetailEvidence, this.lastActionTarget, this.initialScreenEvidence, {
      captured: finalScreenEvidence.captured,
      path: finalScreenEvidence.path,
      capturedAt: finalScreenEvidence.capturedAt,
    }, {
      captureStatus,
      discoveryStatus: this.discoveryStatus,
      functionalStatus: this.functionalStatus ?? (discoveryFailed ? "not_run" : status === "Exitoso" ? "passed" : "failed"),
      statusContradiction: discoveryFailed && status === "Exitoso",
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
  statuses?: Pick<EvidenceScenarioRecord, "captureStatus" | "discoveryStatus" | "functionalStatus" | "statusContradiction">,
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
    ...statuses,
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
