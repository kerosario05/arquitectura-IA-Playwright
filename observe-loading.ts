/**
 * Diagnostic script: observe the post-terms loading state for MOBILE-AA-94-002.
 *
 * Sources:
 *   scenario + dataOverrides: .artifacts/mobile-launch-runs/<runId>/mobile-execution-manifest.json
 *   effectiveSteps: applyDataOverrides(scenario.steps, dataOverrides, requiredData)
 *                   (imported from src/mobile/mobile-step-types.ts — NO logic duplication)
 *
 * Execution: steps 0..7 only (Continue post-terms). Then observe 60s.
 */
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { applyDataOverrides } from "./src/mobile/mobile-step-types";
import type { MobileStep, MobileDataField } from "./src/mobile/mobile-step-types";
import { ensureConsentCheckboxChecked } from "./src/mobile/mobile-consent-checkbox";

// ── Config ──────────────────────────────────────────────────────────────────
const RUN_ID = "5b8ac38a-c4f8-4309-a9ea-d721aaee83a3";
const SCENARIO_ID = "MOBILE-AA-94-002";
const APK = "C:\\Users\\radames\\Downloads\\app-release-4.apk";
const PACKAGE = "com.appconversacionalbsc";
const ACTIVITY = "com.appconversacionalbsc.MainActivity";
const MANIFEST_PATH = path.resolve(
  process.cwd(),
  `.artifacts/mobile-launch-runs/${RUN_ID}/mobile-execution-manifest.json`
);
const OBSERVATION_DURATION_MS = 60_000;
const OBSERVATION_POINTS_MS = [0, 5_000, 10_000, 15_000, 20_000, 30_000, 40_000, 50_000, 60_000];
const CONTINUE_STEP_DESCRIPTION = "Continuar al paso de confirmacion";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Manifest loading ────────────────────────────────────────────────────────
interface ManifestParams {
  scenarios: Array<{ scenarioId: string; steps: MobileStep[]; requiredData?: MobileDataField[] }>;
  dataOverrides?: Record<string, Record<number, string>>;
  appSlug?: string;
}
interface Manifest {
  params: ManifestParams;
}

function loadEffectiveSteps(): { steps: MobileStep[]; dataOverrides: Record<number, string>; requiredData: MobileDataField[] } {
  if (!fs.existsSync(MANIFEST_PATH)) {
    throw new Error(`Manifest not found: ${MANIFEST_PATH}`);
  }
  const manifest: Manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));
  const scenario = manifest.params.scenarios.find((s) => s.scenarioId === SCENARIO_ID);
  if (!scenario) throw new Error(`Scenario ${SCENARIO_ID} not found in manifest`);
  const dataOverrides = manifest.params.dataOverrides?.[SCENARIO_ID] ?? {};
  const requiredData = scenario.requiredData ?? [];
  const effectiveSteps = applyDataOverrides(scenario.steps, dataOverrides, requiredData);
  return { steps: effectiveSteps, dataOverrides, requiredData };
}

// ── Page analysis helpers (same as framework) ───────────────────────────────
function extractFingerprint(xml: string): string {
  const tokens: string[] = [];
  const re = /(?:text|content-desc)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const v = m[1].trim();
    if (v) tokens.push(v);
  }
  tokens.sort();
  let h = 0;
  const s = tokens.join("|");
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return "fp_" + (h >>> 0).toString(16).padStart(8, "0");
}

function hasContent(xml: string): boolean {
  const texts = (xml.match(/text="[^"]+"/g) || []).filter((m) => m.slice(6, -1).trim().length > 0).length;
  const descs = (xml.match(/content-desc="[^"]+"/g) || []).filter((m) => m.slice(13, -1).trim().length > 0).length;
  return texts > 2 || descs > 2;
}

function hasProgressBar(xml: string): boolean {
  return xml.includes("ProgressBar");
}

function classifyState(xml: string): "loading" | "contact_screen" | "error_screen" | "other_content" | "app_closed" {
  if (xml.length < 500) return "app_closed";
  const pb = hasProgressBar(xml);
  const content = hasContent(xml);
  if (pb && !content) return "loading";
  if (xml.includes("Confirmar datos de contacto") || xml.includes("Confirmar")) return "contact_screen";
  if (xml.includes("error") || xml.includes("Error")) return "error_screen";
  if (content) return "other_content";
  return "loading";
}

function screenSummary(xml: string): string {
  const texts: string[] = [];
  const re = /text="([^"]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const v = m[1].trim();
    if (v && v.length > 2 && v.length < 60) texts.push(v);
  }
  return texts.slice(0, 12).join(" | ");
}

// ── Step execution (simplified, reuses framework target resolution) ─────────
function selectorFromTarget(target: { strategy: string; value: string }): string {
  switch (target.strategy) {
    case "accessibilityId":
      return `android=new UiSelector().description("${target.value}")`;
    case "androidUiAutomator":
      return `android=${target.value}`;
    case "text":
      return `android=new UiSelector().text("${target.value}")`;
    case "css":
      return target.value;
    default:
      return `android=new UiSelector().description("${target.value}")`;
  }
}

async function executeStep(
  browser: any,
  step: MobileStep,
  index: number,
  onLog: (msg: string) => void
): Promise<{ passed: boolean; error?: string }> {
  onLog(`  [step ${index}] ${step.action}: ${step.description}`);

  if (step.action === "launchApp") {
    onLog("    launchApp: no-op (handled at session creation)");
    return { passed: true };
  }

  if (step.action === "click") {
    if (!step.target) return { passed: false, error: "click step requires a target" };
    const sel = selectorFromTarget(step.target);
    // Consent steps: use framework's ensureConsentCheckboxChecked (handles modal dismissal + checkbox ticking)
    const isConsent = step.description?.toLowerCase().includes("acepto") ||
      step.description?.toLowerCase().includes("terminos") ||
      step.description?.toLowerCase().includes("consent");
    if (isConsent) {
      onLog("    consent step: using ensureConsentCheckboxChecked");
      const result = await ensureConsentCheckboxChecked(browser, onLog);
      onLog(`    consent ticked: ${result.ticked.length}`);
      return { passed: true };
    }
    try {
      const el = await browser.$(sel);
      if (!(await el.isExisting())) return { passed: false, error: `element not found: ${sel}` };
      await el.click();
      onLog("    clicked");
      return { passed: true };
    } catch (e: any) {
      return { passed: false, error: e.message?.slice(0, 200) };
    }
  }

  if (step.action === "fill") {
    if (!step.target) return { passed: false, error: "fill step requires a target" };
    const sel = selectorFromTarget(step.target);
    try {
      const el = await browser.$(sel);
      if (!(await el.isExisting())) return { passed: false, error: `fill target not found: ${sel}` };
      await el.setValue(step.value ?? "");
      onLog(`    filled: ${(step.value ?? "").slice(0, 20)}...`);
      try { await browser.hideKeyboard(); } catch {}
      return { passed: true };
    } catch (e: any) {
      return { passed: false, error: e.message?.slice(0, 200) };
    }
  }

  if (step.action === "assertVisible") {
    if (!step.target) return { passed: false, error: "assertVisible requires a target" };
    const sel = selectorFromTarget(step.target);
    try {
      const el = await browser.$(sel);
      const exists = await el.isExisting();
      onLog(`    assertVisible: ${exists ? "PASS" : "FAIL"}`);
      return { passed: exists };
    } catch {
      return { passed: false, error: "assertVisible failed" };
    }
  }

  onLog(`    skipped action: ${step.action}`);
  return { passed: true };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== observe-loading.ts ===");
  console.log(`runId: ${RUN_ID}`);
  console.log(`scenarioId: ${SCENARIO_ID}\n`);

  // 1. Load effective steps from manifest
  const { steps, dataOverrides, requiredData } = loadEffectiveSteps();
  console.log(`Loaded ${steps.length} effective steps from manifest`);
  console.log(`dataOverrides: ${JSON.stringify(dataOverrides)}`);
  console.log(`requiredData keys: ${requiredData.map((f) => f.key).join(", ")}\n`);

  // Print effective steps
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const target = s.target ? ` → ${s.target.strategy}:${s.target.value.slice(0, 50)}` : "";
    const val = s.value ? ` value="${s.value.slice(0, 30)}"` : "";
    console.log(`  [${i}] ${s.action}${target}${val}  // ${s.description}`);
  }

  // 2. Find the Continue post-terms step (step index 7 in original = last click before assert)
  const continueStepIdx = steps.findIndex(
    (s) => s.action === "click" && s.description?.toLowerCase().includes("continuar") && s.description?.toLowerCase().includes("confirmacion")
  );
  if (continueStepIdx < 0) {
    console.error("ERROR: Could not find Continue post-terms step in effectiveSteps");
    return;
  }
  console.log(`\nContinue post-terms step index: ${continueStepIdx}`);
  console.log(`Will execute steps 0..${continueStepIdx}, then observe ${OBSERVATION_DURATION_MS / 1000}s\n`);

  // 3. Force-stop and launch app
  try { execSync(`adb shell am force-stop ${PACKAGE}`, { stdio: "pipe" }); } catch {}
  await delay(1000);
  try { execSync(`adb shell am start -n ${PACKAGE}/${ACTIVITY}`, { stdio: "pipe" }); } catch {}
  await delay(3000);

  // 4. Start Appium session
  const wdio = require("webdriverio");
  const browser = await wdio.remote({
    hostname: "127.0.0.1",
    port: 4723,
    path: "/",
    capabilities: {
      platformName: "Android",
      "appium:automationName": "UiAutomator2",
      "appium:app": APK,
      "appium:appPackage": PACKAGE,
      "appium:appActivity": ACTIVITY,
      "appium:noReset": true,
      "appium:autoGrantPermissions": true,
      "appium:newCommandTimeout": 300,
    },
  });

  try {
    await delay(8000);
    let xml = await browser.getPageSource();
    console.log("Initial screen:", screenSummary(xml));
    console.log("Initial fingerprint:", extractFingerprint(xml), "\n");

    // 5. Execute steps 0..continueStepIdx
    for (let i = 0; i <= continueStepIdx; i++) {
      const step = steps[i];
      const result = await executeStep(browser, step, i, console.log);
      if (!result.passed) {
        console.error(`  FATAL at step ${i}: ${result.error}`);
        return;
      }
      // Wait for transition after click/fill (except launchApp)
      if (step.action !== "launchApp") {
        await delay(step.action === "fill" ? 3000 : 5000);
      }
      xml = await browser.getPageSource();
      console.log(`  After step ${i}: ${screenSummary(xml)}\n`);
    }

    // 6. Observe for 60s
    console.log(`\n=== OBSERVING ${OBSERVATION_DURATION_MS / 1000}s AFTER STEP ${continueStepIdx} ===\n`);
    const t0 = Date.now();
    let last = 0;
    let finalState = "loading" as string;
    let endedAt: number | null = null;

    for (const t of OBSERVATION_POINTS_MS) {
      if (t > 0) await delay(t - last);
      last = t;
      const elapsed = Date.now() - t0;
      try {
        xml = await browser.getPageSource();
        const fp = extractFingerprint(xml);
        const hc = hasContent(xml);
        const st = classifyState(xml);
        console.log(`${String(elapsed).padStart(5)}ms | ${fp} | hasContent=${hc} | ${st}`);
        if (st !== "loading") {
          finalState = st;
          endedAt = elapsed;
          console.log(`\n>>> State changed at ${elapsed}ms: ${st} <<<`);
          console.log("Screen:", screenSummary(xml));
          break;
        }
      } catch (e: any) {
        console.log(`${String(elapsed).padStart(5)}ms | ERROR: ${e.message?.slice(0, 60)}`);
      }
    }

    if (!endedAt) console.log("\n>>> 60s elapsed, loading never ended <<<\n");

    // 7. Summary
    console.log("\n=== SUMMARY ===");
    console.log(`finalState=${finalState}`);
    console.log(`loadingEndedAtMs=${endedAt ?? "null"}`);
    console.log(`effectiveStepsCount=${steps.length}`);
    console.log(`dataOverrides=${JSON.stringify(dataOverrides)}`);
    console.log(`continueStepIdx=${continueStepIdx}`);
  } catch (e: any) {
    console.error("FATAL:", e.message);
  } finally {
    try { await browser.deleteSession(); } catch {}
  }
}

main();
