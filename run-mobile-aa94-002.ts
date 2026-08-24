/**
 * Execute MOBILE-AA-94-002 end-to-end with full diagnostics.
 * Reuses applyDataOverrides from the framework. No logic duplication.
 */
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { applyDataOverrides } from "./src/mobile/mobile-step-types";
import type { MobileStep, MobileDataField } from "./src/mobile/mobile-step-types";
import { ensureConsentCheckboxChecked } from "./src/mobile/mobile-consent-checkbox";

const RUN_ID = "5b8ac38a-c4f8-4309-a9ea-d721aaee83a3";
const SCENARIO_ID = "MOBILE-AA-94-002";
const APK = process.env.ANDROID_APK_PATH || "C:\\Users\\radames\\Downloads\\app-release-4.apk";
const PACKAGE = "com.appconversacionalbsc";
const ACTIVITY = "com.appconversacionalbsc.MainActivity";
const MANIFEST_PATH = path.resolve(process.cwd(), `.artifacts/mobile-launch-runs/${RUN_ID}/mobile-execution-manifest.json`);
const OUTPUT_DIR = path.resolve(process.cwd(), `.artifacts/evidence/mobile/com_appconversacionalbsc/runs/diag-${Date.now()}`);
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ManifestParams {
  scenarios: Array<{ scenarioId: string; steps: MobileStep[]; requiredData?: MobileDataField[] }>;
  dataOverrides?: Record<string, Record<number, string>>;
}
interface Manifest { params: ManifestParams; }

interface StepResult {
  stepIndex: number;
  description: string;
  action: string;
  targetStrategy?: string;
  targetValue?: string;
  status: "passed" | "failed" | "skipped";
  reasonCode?: string;
  error?: string;
  beforeFingerprint: string;
  afterFingerprint: string;
  beforeScreenSummary: string;
  afterScreenSummary: string;
  transitionPersistCandidate: boolean;
  discardReason?: string;
}

function loadEffectiveSteps() {
  const manifest: Manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  const scenario = manifest.params.scenarios.find((s) => s.scenarioId === SCENARIO_ID)!;
  const dataOverrides = manifest.params.dataOverrides?.[SCENARIO_ID] ?? {};
  const requiredData = scenario.requiredData ?? [];
  return { steps: applyDataOverrides(scenario.steps, dataOverrides, requiredData), dataOverrides, requiredData, originalSteps: scenario.steps };
}

function extractFingerprint(xml: string): string {
  const tokens: string[] = [];
  const re = /(?:text|content-desc)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) { const v = m[1].trim(); if (v) tokens.push(v); }
  tokens.sort();
  let h = 0; const s = tokens.join("|");
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return "fp_" + (h >>> 0).toString(16).padStart(8, "0");
}

function screenSummary(xml: string): string {
  const texts: string[] = []; const re = /text="([^"]+)"/g; let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) { const v = m[1].trim(); if (v && v.length > 2 && v.length < 60) texts.push(v); }
  return texts.slice(0, 12).join(" | ");
}

function selectorFromTarget(target: { strategy: string; value: string }): string {
  switch (target.strategy) {
    case "accessibilityId": return `android=new UiSelector().description("${target.value}")`;
    case "androidUiAutomator": return `android=${target.value}`;
    case "text": return `android=new UiSelector().text("${target.value}")`;
    default: return `android=new UiSelector().description("${target.value}")`;
  }
}

async function executeStep(browser: any, step: MobileStep, index: number): Promise<{ passed: boolean; error?: string }> {
  if (step.action === "launchApp") return { passed: true };

  if (step.action === "click") {
    if (!step.target) return { passed: false, error: "click requires target" };
    const isConsent = step.description?.toLowerCase().includes("acepto") || step.description?.toLowerCase().includes("terminos");
    if (isConsent) {
      const r = await ensureConsentCheckboxChecked(browser, console.log);
      return { passed: true };
    }
    const sel = selectorFromTarget(step.target);
    try {
      const el = await browser.$(sel);
      if (!(await el.isExisting())) return { passed: false, error: `element not found: ${sel}` };
      await el.click();
      return { passed: true };
    } catch (e: any) { return { passed: false, error: e.message?.slice(0, 200) }; }
  }

  if (step.action === "fill") {
    if (!step.target) return { passed: false, error: "fill requires target" };
    const sel = selectorFromTarget(step.target);
    try {
      const el = await browser.$(sel);
      if (!(await el.isExisting())) return { passed: false, error: `fill target not found: ${sel}` };
      await el.setValue(step.value ?? "");
      try { await browser.hideKeyboard(); } catch {}
      return { passed: true };
    } catch (e: any) { return { passed: false, error: e.message?.slice(0, 200) }; }
  }

  if (step.action === "assertVisible") {
    if (!step.target) return { passed: false, error: "assertVisible requires target" };
    const sel = selectorFromTarget(step.target);
    try {
      const el = await browser.$(sel);
      return { passed: await el.isExisting() };
    } catch { return { passed: false, error: "assertVisible failed" }; }
  }

  return { passed: true };
}

async function main() {
  console.log("=== MOBILE-AA-94-002 FULL EXECUTION ===\n");

  const { steps, dataOverrides, requiredData, originalSteps } = loadEffectiveSteps();
  console.log(`Effective steps: ${steps.length}`);
  console.log(`dataOverrides: ${JSON.stringify(dataOverrides)}\n`);

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const t = s.target ? ` ${s.target.strategy}:${s.target.value.slice(0, 40)}` : "";
    const v = s.value ? ` val="${s.value.slice(0, 20)}"` : "";
    const otp = s.otp?.required ? " [OTP]" : "";
    console.log(`  [${i}] ${s.action}${t}${v}${otp}  // ${s.description}`);
  }

  try { execSync(`adb shell am force-stop ${PACKAGE}`, { stdio: "pipe" }); } catch {}
  await delay(1000);
  try { execSync(`adb shell am start -n ${PACKAGE}/${ACTIVITY}`, { stdio: "pipe" }); } catch {}
  await delay(3000);

  const wdio = require("webdriverio");
  const browser = await wdio.remote({
    hostname: "127.0.0.1", port: 4723, path: "/",
    capabilities: {
      platformName: "Android", "appium:automationName": "UiAutomator2",
      "appium:app": APK, "appium:appPackage": PACKAGE, "appium:appActivity": ACTIVITY,
      "appium:noReset": true, "appium:autoGrantPermissions": true, "appium:newCommandTimeout": 300,
    },
  });

  const results: StepResult[] = [];
  const transitions: Array<{ stepIndex: number; beforeFingerprint: string; afterFingerprint: string; beforeScreen: string; afterScreen: string; persistCandidate: boolean; discardReason?: string }> = [];
  let firstFailure: StepResult | null = null;
  let lastFingerprint = "";
  let lastScreen = "";

  try {
    await delay(8000);
    let xml = await browser.getPageSource();
    lastFingerprint = extractFingerprint(xml);
    lastScreen = screenSummary(xml);
    console.log(`\nInitial: ${lastScreen} [${lastFingerprint}]\n`);

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const beforeFp = lastFingerprint;
      const beforeScreen = lastScreen;

      console.log(`[${i}] ${step.action}: ${step.description}`);
      const result = await executeStep(browser, step, i);

      if (step.action !== "launchApp") {
        await delay(step.action === "fill" ? 3000 : 5000);
      }

      xml = await browser.getPageSource();
      const afterFp = extractFingerprint(xml);
      const afterScreen = screenSummary(xml);
      const fpChanged = beforeFp !== afterFp;

      const stepResult: StepResult = {
        stepIndex: i,
        description: step.description ?? "",
        action: step.action,
        targetStrategy: step.target?.strategy,
        targetValue: step.target?.value?.slice(0, 60),
        status: result.passed ? "passed" : "failed",
        reasonCode: result.passed ? undefined : result.error?.slice(0, 100),
        error: result.error,
        beforeFingerprint: beforeFp,
        afterFingerprint: afterFp,
        beforeScreenSummary: beforeScreen,
        afterScreenSummary: afterScreen,
        transitionPersistCandidate: fpChanged,
        discardReason: fpChanged ? undefined : "same_fingerprint",
      };
      results.push(stepResult);

      if (fpChanged) {
        transitions.push({ stepIndex: i, beforeFingerprint: beforeFp, afterFingerprint: afterFp, beforeScreen: beforeScreen, afterScreen: afterScreen, persistCandidate: true });
      }

      const statusIcon = result.passed ? "OK" : "FAIL";
      console.log(`  [${statusIcon}] fp=${afterFp} screen=${afterScreen.slice(0, 60)}`);

      if (!result.passed && !firstFailure) {
        firstFailure = stepResult;
        console.log(`  *** FIRST FAILURE at step ${i}: ${result.error}`);
      }

      if (!result.passed) {
        console.log(`  Stopping at step ${i} due to failure.`);
        break;
      }

      lastFingerprint = afterFp;
      lastScreen = afterScreen;
    }

    console.log("\n=== RESULTS TABLE ===");
    console.log("stepIndex | action        | status  | reasonCode");
    console.log("----------|---------------|---------|-----------");
    for (const r of results) {
      const idx = String(r.stepIndex).padStart(9);
      const act = r.action.padEnd(13);
      const st = r.status.padEnd(7);
      const rc = r.reasonCode ?? "";
      console.log(`${idx} | ${act} | ${st} | ${rc}`);
    }

    console.log("\n=== TRANSITION CAPTURES ===");
    console.log("stepIndex | beforeFp       | afterFp        | persist | discardReason");
    console.log("----------|----------------|----------------|---------|---------------");
    for (const t of transitions) {
      console.log(`${String(t.stepIndex).padStart(9)} | ${t.beforeFingerprint} | ${t.afterFingerprint} | ${t.persistCandidate} | ${t.discardReason ?? ""}`);
    }

    console.log("\n=== FIRST FAILURE DETAIL ===");
    if (firstFailure) {
      console.log(`stepIndex: ${firstFailure.stepIndex}`);
      console.log(`action: ${firstFailure.action}`);
      console.log(`target: ${firstFailure.targetStrategy}:${firstFailure.targetValue}`);
      console.log(`beforeFingerprint: ${firstFailure.beforeFingerprint}`);
      console.log(`afterFingerprint: ${firstFailure.afterFingerprint}`);
      console.log(`error: ${firstFailure.error}`);
      console.log(`reasonCode: ${firstFailure.reasonCode}`);
      console.log(`beforeScreen: ${firstFailure.beforeScreenSummary}`);
      console.log(`afterScreen: ${firstFailure.afterScreenSummary}`);
    } else {
      console.log("No failure — scenario completed successfully.");
    }

    const lastStep = results[results.length - 1];
    console.log(`\n=== FINAL STATUS ===`);
    console.log(`status: ${firstFailure ? "failed" : "passed"}`);
    console.log(`lastStep: ${lastStep?.stepIndex} (${lastStep?.action})`);
    console.log(`reachedScreen: ${lastScreen.slice(0, 80)}`);

    // OTP diagnostics
    const otpStep = steps.findIndex((s) => s.otp?.required);
    if (otpStep >= 0) {
      const otpResult = results.find((r) => r.stepIndex === otpStep);
      console.log(`\n=== OTP DIAGNOSTICS ===`);
      console.log(`otpStepIndex: ${otpStep}`);
      console.log(`otpReached: ${otpResult ? "true" : "false"}`);
      console.log(`otpStatus: ${otpResult?.status ?? "not_reached"}`);
    }

    // Persist diagnostics
    fs.mkdirSync(path.join(OUTPUT_DIR, "diagnostics"), { recursive: true });
    fs.writeFileSync(path.join(OUTPUT_DIR, "diagnostics", "results.json"), JSON.stringify(results, null, 2));
    fs.writeFileSync(path.join(OUTPUT_DIR, "diagnostics", "transition-captures.jsonl"), transitions.map((t) => JSON.stringify(t)).join("\n"));
    console.log(`\nDiagnostics written to: ${OUTPUT_DIR}`);

  } catch (e: any) {
    console.error("FATAL:", e.message);
  } finally {
    try { await browser.deleteSession(); } catch {}
  }
}

main();
