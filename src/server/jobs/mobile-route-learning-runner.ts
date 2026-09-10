import { randomUUID } from "node:crypto";
import { jobStore } from "./job-store";
import { resolveMobileTarget, ensureMobileInfra } from "./mobile-test-runner";
import { acquireSession, releaseSessionLock, buildLockKey } from "../../mobile/appium-session-coordinator";
import { createSession, closeSession } from "../../mobile/appium-session";
import { getStatus as getEmulatorStatus } from "../../mobile/emulator-manager";
import { getStatus as getAppiumStatus } from "../../mobile/appium-server-manager";
import { executeMobileStep } from "../../mobile/mobile-step-executor";
import { extractMobileScreenSnapshot, type MobileScreenSnapshot } from "../../mobile/mobile-knowledge-extractor";
import { persistMobileScreen, persistMobileRoute } from "../../mobile/mobile-knowledge-persister";
import {
  resolveScreenData,
  findActionableControls,
  findInputControls,
  inputControlToTarget,
  controlLabel,
  isSubmitLabel,
  isBlockedSubmitLabel,
  type LearnerStopReason,
  type LearnerFieldData,
} from "../../mobile/mobile-route-learner";
import { isContinueLabel } from "../../mobile/mobile-passthrough-screen";
import { createGeneralAiProvider } from "../../ai/ai-provider-factory";
import {
  decideNextActionInterpreted,
  aiSynthesizeScreenData,
  type HuContext,
  type InterpretiveContext,
} from "../../mobile/mobile-route-learner-ai";
import { ensureConsentCheckboxChecked } from "../../mobile/mobile-consent-checkbox";
import { loadMobileRouteProfile, saveMobileRouteProfile } from "../../mobile/mobile-route-profile";
import type { MobileFlow, MobileStepHint, MobileRouteProfile, MobileScreen, MobileElement } from "../../mobile/mobile-route-profile.types";
import type { MobileStep } from "../../mobile/mobile-step-types";

/**
 * Mobile route learning: walks an app to capture REAL screens and records the traversed
 * path as a named flow in mobile.config.json.
 *
 * This is the mobile counterpart of the web route-discovery endpoints (which drive
 * Playwright and therefore cannot serve a native app). Learning was previously only a
 * side effect of /api/mobile/tests/run, which required hand-writing every step before
 * knowing what the screen contained — a chicken-and-egg the learner removes by deciding
 * the next tap from what it just observed.
 *
 * Safety: the walk never presses a control that would commit the flow (see
 * mobile-route-learner's submit guard) unless stopBeforeSubmit is explicitly disabled.
 */

export type MobileRouteLearningParams = {
  appSlug: string;
  apkPath?: string;
  appPackage?: string;
  appActivity?: string;
  avdName?: string;
  headless?: boolean;
  systemPort?: number;
  /** Flow id to record, e.g. "registro". Recorded first in the profile's flows map. */
  flowId?: string;
  flowDescription?: string;
  /** Lowercased substrings that match a Jira story to this flow. */
  triggerKeywords?: string[];
  /** Seed path: steps the learner cannot infer. Prefer preferLabels — a seed step races
   *  the app's first paint, while the learner taps only what it has just observed. */
  entrySteps?: MobileStep[];
  /** Labels to steer the walk down a known branch, e.g. ["primera vez"] to enter registration. */
  preferLabels?: string[];
  /**
   * Submit labels this walk may press despite the commit guard. Naming one control is far
   * safer than stopBeforeSubmit:false, which would authorize every commit in the flow.
   * Pressing one has REAL side effects (an OTP is actually sent), so it is opt-in per run.
   */
  allowSubmitLabels?: string[];
  /**
   * Values the walk may type so it can cross screens that ask for input. Without a matching
   * entry the walk stops rather than inventing data. Mark an entry `otp: true` to have the
   * code resolved at runtime instead of typed from the payload.
   */
  screenData?: LearnerFieldData[];
  /** Tick consent checkboxes that gate the advance control. Default true. */
  autoAcceptConsent?: boolean;
  /** Maximum screens to capture before stopping. Default 12. */
  maxScreens?: number;
  /** Refuse to press controls that commit the flow. Default true. */
  stopBeforeSubmit?: boolean;
  /** Settle time after each tap before snapshotting. Default 2500ms. */
  waitAfterActionMs?: number;
  /**
   * User-story context. When present and AI is enabled, the interpretive layer uses it to
   * resolve ambiguous screens and synthesize form data autonomously (no hand-fed seed steps).
   */
  huContext?: HuContext;
};

export type LearnedScreenReport = {
  index: number;
  screenKey: string;
  title: string;
  fingerprint: string;
  controls: number;
  clickTargets: string[];
  persisted: boolean;
};

export type MobileRouteLearningResult = {
  appSlug: string;
  flowId?: string;
  screensLearned: number;
  screens: LearnedScreenReport[];
  traversed: MobileStepHint[];
  stopReason: LearnerStopReason | "completed";
  stopDetail?: string;
  profileWritten: boolean;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Strips accents and every separator, so a value and its masked rendering compare equal. */
function compactValue(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

/**
 * True when the field already contains the value the walk was about to type.
 *
 * A field's label IS its current content once something has been typed into it, and the app
 * reformats as you type ("40229993734" comes back as "402-2999373-4"), so the comparison has
 * to ignore separators. An OTP is never considered already present: its value is resolved at
 * runtime and a stale code is worse than retyping.
 */
export function fieldAlreadyHolds(fill: { label: string; value?: string; otp?: boolean }): boolean {
  if (fill.otp) return false;
  const value = compactValue((fill.value ?? "").trim());
  if (!value) return false;
  return compactValue(fill.label) === value;
}

/**
 * Reads the current screen, retrying while it comes back empty.
 *
 * Right after a submit the app renders a blank frame for a moment; snapshotting into that
 * gap yields a screen with no controls, which the decision core can only read as a dead
 * end. Re-reading distinguishes "still painting" from "genuinely nothing here".
 */
async function snapshotScreen(
  browser: WebdriverIO.Browser,
  opts: { retries?: number; delayMs?: number; onLog?: (line: string) => void } = {},
): Promise<MobileScreenSnapshot> {
  const retries = opts.retries ?? 4;
  const delayMs = opts.delayMs ?? 2500;
  let snapshot = extractMobileScreenSnapshot(await browser.getPageSource());
  for (let attempt = 1; attempt <= retries && snapshot.observedControls.length === 0; attempt++) {
    opts.onLog?.(`[mobile:learn] pantalla vacia, reintentando lectura (${attempt}/${retries})`);
    await new Promise((r) => setTimeout(r, delayMs));
    snapshot = extractMobileScreenSnapshot(await browser.getPageSource());
  }
  return snapshot;
}

/**
 * Puts the app on screen AT ITS ENTRY POINT before the walk starts.
 *
 * Two distinct failures make this necessary, and both are silent:
 *
 * 1. A resolved Appium session does not mean the app is on screen. With `noReset` the driver
 *    may attach without starting the activity, and even when it starts one, the session
 *    resolves before the first frame paints — so the foreground app is still the launcher.
 *    The launcher is a fully populated screen, so `snapshotScreen`'s empty-screen retry never
 *    fires; the walk reads Play Store / Gmail icons as its first "app screen" and stops with
 *    `no_actionable`, since `findActionableControls` drops controls not owned by the app.
 *
 * 2. `noReset` also preserves the previous run's state, so a second walk resumes wherever the
 *    first one ended — a terminal error screen, a half-filled form. The flow is recorded as
 *    `entrySteps` from the app's start, so a walk that begins mid-flow records nonsense (or,
 *    as happened here, stops immediately on a dead-end screen it never navigated to).
 *
 * Terminating before activating costs one app restart and makes every walk start from the
 * same place. App data survives — this is a process restart, not a reset.
 */
async function ensureAppInForeground(
  browser: WebdriverIO.Browser,
  appPackage: string | undefined,
  onLog: (line: string) => void,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<boolean> {
  if (!appPackage) return true;
  const attempts = opts.attempts ?? 5;
  const delayMs = opts.delayMs ?? 2000;

  try {
    await browser.terminateApp(appPackage);
    onLog(`[mobile:learn] app cerrada para arrancar desde su pantalla inicial`);
  } catch (e) {
    onLog(`[mobile:learn] no se pudo cerrar ${appPackage} (puede no estar corriendo): ${e instanceof Error ? e.message : String(e)}`);
  }
  try {
    await browser.activateApp(appPackage);
    onLog(`[mobile:learn] app activada`);
  } catch (e) {
    onLog(`[mobile:learn] no se pudo activar ${appPackage}: ${e instanceof Error ? e.message : String(e)}`);
  }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let current: string | undefined;
    try {
      current = await browser.getCurrentPackage();
    } catch (e) {
      onLog(`[mobile:learn] no se pudo leer el paquete en primer plano: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (current === appPackage) {
      // The package flips to the app before its first frame paints, so this alone is not
      // enough — a walk that trusted it snapshotted the launcher that was still on screen and
      // stopped with no_actionable. What settles it is the hierarchy actually containing
      // controls the app owns.
      const painted = await browser
        .getPageSource()
        .then((src) => src.includes(`package="${appPackage}"`))
        .catch(() => false);
      if (painted) {
        onLog(`[mobile:learn] app en primer plano y pintada (intento ${attempt}/${attempts})`);
        return true;
      }
      onLog(`[mobile:learn] app en primer plano pero aun sin pintar (intento ${attempt}/${attempts})`);
    } else {
      onLog(`[mobile:learn] primer plano=${current ?? "desconocido"}, esperado=${appPackage} (intento ${attempt}/${attempts})`);
    }
    await sleep(delayMs);
  }

  try {
    return (await browser.getCurrentPackage()) === appPackage;
  } catch {
    return false;
  }
}

/**
 * Turns the screens the walk actually saw into the profile's element inventory.
 *
 * The generator's prompt has a "PANTALLAS REALES CONOCIDAS" section that tells the AI to use
 * EXACTLY the strategy/value listed for each element instead of inventing one — but the walk
 * only ever recorded `flows`, so that section arrived empty and the AI had to guess. It
 * guessed `accessibilityId "Cédula"` for a control whose real content-desc is ", Cédula";
 * accessibility-id matching is exact, so that locator resolves to nothing at runtime and the
 * authority gate correctly refuses to back it. Publishing the locator the learner itself
 * derived closes that gap: the AI reuses an identity that was observed, not imagined.
 *
 * Only elements a scenario can target are published (tappable controls and inputs) — text the
 * walk merely read is noise in the prompt and has no locator worth reusing.
 */
export function buildLearnedScreens(
  snapshots: MobileScreenSnapshot[],
  appPackage?: string,
  now: string = new Date().toISOString(),
): Record<string, MobileScreen> {
  const screens: Record<string, MobileScreen> = {};
  const fingerprintById = new Map<string, string>();

  for (const [index, snapshot] of snapshots.entries()) {
    // Distinct screens routinely share a screenKey (this app labels several "screen"), so a
    // key collision with a different fingerprint gets a suffix instead of overwriting.
    let screenId = snapshot.screenKey || `screen_${index}`;
    if (fingerprintById.has(screenId) && fingerprintById.get(screenId) !== snapshot.fingerprint) {
      let suffix = 2;
      while (fingerprintById.has(`${screenId}_${suffix}`) && fingerprintById.get(`${screenId}_${suffix}`) !== snapshot.fingerprint) suffix++;
      screenId = `${screenId}_${suffix}`;
    }
    if (fingerprintById.get(screenId) === snapshot.fingerprint) continue; // already captured
    fingerprintById.set(screenId, snapshot.fingerprint);

    const inputs = findInputControls(snapshot, appPackage);
    const elements: MobileElement[] = [];
    const seen = new Set<string>();

    for (const input of inputs) {
      const locator = inputControlToTarget(input, inputs);
      if (!locator) continue;
      const key = `${locator.strategy}:${locator.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      elements.push({
        label: controlLabel(input) || input.label || "(campo sin etiqueta)",
        role: "input",
        locator,
        hasAccessibilityLabel: Boolean((input.contentDesc ?? "").trim()),
      });
    }

    for (const actionable of findActionableControls(snapshot, appPackage)) {
      const key = `${actionable.target.strategy}:${actionable.target.value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      elements.push({
        label: actionable.label,
        role: "button",
        locator: actionable.target,
        hasAccessibilityLabel: Boolean((actionable.control.contentDesc ?? "").trim()),
      });
    }

    if (elements.length === 0) continue;
    screens[screenId] = {
      screenId,
      title: snapshot.title ?? screenId,
      ...(index === 0 ? { isEntryScreen: true } : {}),
      elements,
      discoveredAt: now,
      discoverySource: "automated_discovery",
    };
  }
  return screens;
}

/**
 * Merges the learned flow into the app profile, placing it FIRST so the registration
 * flow leads the file (flows are matched by keyword, but order documents intent).
 */
export function upsertFlowFirst(
  profile: MobileRouteProfile,
  flowId: string,
  flow: MobileFlow,
): MobileRouteProfile {
  const existing = profile.flows ?? {};
  const rest = Object.fromEntries(Object.entries(existing).filter(([id]) => id !== flowId));
  return { ...profile, flows: { [flowId]: flow, ...rest }, updatedAt: new Date().toISOString() };
}

/** A Jira-style issue key, e.g. "AA-93" — never appears in the text a flow is matched against. */
const ISSUE_KEY_RE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

/** Words too generic to identify a flow: matching on them would route unrelated stories here. */
const GENERIC_KEYWORDS = new Set([
  "aplicacion", "aplicaciones", "cliente", "clientes", "usuario", "usuarios", "sistema",
  "pantalla", "pantallas", "opcion", "opciones", "boton", "botones", "campo", "campos",
  "datos", "quiero", "necesito", "poder", "puede", "debe", "desde", "hasta", "sobre",
  "cuando", "donde", "manera", "forma", "proceso", "correcta", "correctamente",
]);

/**
 * Trigger keywords that let a learned flow be matched by a later generation.
 *
 * Flows are matched against the SCENARIO text — title, preconditions, step descriptions —
 * which never contains the Jira key. A caller that passes only the issue key (as the QA-lab
 * launch flow does) therefore records a flow that nothing can ever match, and the story stays
 * blocked on route learning forever. When the issue key is all we were given, fall back to the
 * story's own distinctive words: that is exactly the text the matcher will read.
 */
export function deriveTriggerKeywords(
  callerKeywords: string[] | undefined,
  hu: HuContext | undefined,
  flowId: string,
): string[] {
  const usable = (callerKeywords ?? [])
    .map((k) => k.trim())
    .filter((k) => k.length > 0 && !ISSUE_KEY_RE.test(k));
  if (usable.length > 0) return usable;

  const corpus = `${hu?.summary ?? ""} ${hu?.intent ?? ""}`
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  const words = Array.from(
    new Set(corpus.split(/\s+/).filter((w) => w.length >= 5 && !GENERIC_KEYWORDS.has(w))),
  );
  if (words.length > 0) return words.slice(0, 6);

  // Last resort: the flow id, unless it is itself an issue key (which would match nothing).
  return ISSUE_KEY_RE.test(flowId) ? [] : [flowId];
}

export async function startMobileRouteLearningJob(jobId: string): Promise<void> {
  const job = jobStore.getInternal(jobId);
  if (!job) return;
  const params = job.params as unknown as MobileRouteLearningParams;
  const onLog = (line: string) => jobStore.appendLog(jobId, line);

  jobStore.update(jobId, { status: "running", startedAt: new Date().toISOString() });

  const maxScreens = params.maxScreens ?? 12;
  const settleMs = params.waitAfterActionMs ?? 2500;
  const stopBeforeSubmit = params.stopBeforeSubmit !== false;
  const runId = randomUUID();

  // AI is optional: when enabled it powers the interpretive layer (resolve ambiguity,
  // synthesize form data). If unavailable, the walk degrades to the deterministic learner.
  let aiProvider: Awaited<ReturnType<typeof createGeneralAiProvider>> | undefined;
  try {
    aiProvider = await createGeneralAiProvider();
    onLog(`[mobile:learn:ai] capa interpretativa activa (${aiProvider.providerName}/${aiProvider.model})`);
  } catch {
    onLog(`[mobile:learn:ai] IA no disponible; se usa solo la lógica de reglas`);
  }
  const aiCtx: InterpretiveContext = { ai: aiProvider, huContext: params.huContext };

  const screens: LearnedScreenReport[] = [];
  // Kept alongside the report so the profile's element inventory is built from what the walk
  // actually observed, not from the summary (which carries no locators).
  const observedSnapshots: MobileScreenSnapshot[] = [];
  const traversed: MobileStepHint[] = [];
  const visited = new Set<string>();
  const clickedLabels: string[] = [];
  let skipLoopCheckOnce = false;
  /** Signature of the fills last executed, to recognize a form that already holds them. */
  let lastFillSignature: string | null = null;
  let stopReason: LearnerStopReason | "completed" = "completed";
  let stopDetail: string | undefined;

  let sessionHandle: { browser: WebdriverIO.Browser; lockKey: string; lockOwner: string } | null = null;
  // Tracked separately from sessionHandle: when acquireSession() throws, the coordinator
  // leaves the lock entry behind, so the release below must still know what to free.
  let pendingLock: { lockKey: string; lockOwner: string } | null = null;

  try {
    const target = resolveMobileTarget({
      avdName: params.avdName,
      headless: params.headless,
      appSlug: params.appSlug,
      apkPath: params.apkPath,
      appPackage: params.appPackage,
      appActivity: params.appActivity,
      systemPort: params.systemPort,
    });
    onLog(`[mobile:learn] target appSlug=${params.appSlug} pkg=${target.appPackage ?? "-"} apk=${target.apkPath ? "si" : "no"} stopBeforeSubmit=${stopBeforeSubmit} maxScreens=${maxScreens}`);

    await ensureMobileInfra(target, onLog, { runId });

    const appiumHost = process.env.APPIUM_SERVER_HOST?.trim() || "127.0.0.1";
    const deviceId = getEmulatorStatus().deviceId || `${appiumHost}:${target.appiumPort}`;
    const lockOwner = `${runId}:route-learning`;
    pendingLock = { lockKey: buildLockKey(appiumHost, target.appiumPort, deviceId, target.systemPort), lockOwner };
    const handle = await acquireSession({
      runId,
      lockOwner,
      deviceId,
      systemPort: target.systemPort,
      appiumHost,
      appiumPort: target.appiumPort,
      factory: () =>
        createSession({
          appiumPort: target.appiumPort,
          apkPath: target.apkPath,
          appPackage: target.appPackage,
          appActivity: target.appActivity,
          deviceId,
          systemPort: target.systemPort,
          maxSessionAttempts: 1,
        }),
      emulatorStartedByRunner: false,
      canRetry: async () => {
        const appiumReady = getAppiumStatus().ready === true;
        const emu = getEmulatorStatus();
        return appiumReady && emu.running && emu.bootCompleted
          ? { allowed: true, reason: "infra_healthy" }
          : { allowed: false, reason: "infra_unhealthy" };
      },
      onLog,
    });
    sessionHandle = { browser: handle.browser, lockKey: handle.lockKey, lockOwner };
    const browser = handle.browser;

    if (!(await ensureAppInForeground(browser, target.appPackage, onLog))) {
      stopReason = "no_actionable";
      stopDetail = `la app ${target.appPackage ?? "(sin package)"} no llego a primer plano; el recorrido habria leido el launcher`;
      onLog(`[mobile:learn] ${stopDetail}`);
    }

    // ── Seed path: the steps the learner cannot infer on its own ──
    const seed = stopReason === "completed" ? (params.entrySteps ?? []) : [];
    for (let i = 0; i < seed.length; i++) {
      const step = seed[i];
      onLog(`[mobile:learn] seed step ${i + 1}/${seed.length} action=${step.action} target=${step.target?.value ?? "-"}`);
      const result = await executeMobileStep(browser, step, i);
      if (result.status !== "passed") {
        stopReason = "no_actionable";
        stopDetail = `el paso semilla ${i + 1} (${step.action} ${step.target?.value ?? ""}) fallo: ${result.errorMessage ?? "sin detalle"}`;
        onLog(`[mobile:learn] seed step failed -> ${stopDetail}`);
        break;
      }
      if (step.action !== "launchApp" && step.action !== "screenshot" && step.target) {
        traversed.push({ action: step.action as MobileStepHint["action"], description: step.description, target: step.target, value: step.value });
        if (step.action === "click") clickedLabels.push(step.target.value);
      }
      await sleep(settleMs);
    }

    // ── Exploratory walk ──
    if (stopReason === "completed") {
      for (let i = 0; i < maxScreens; i++) {
        const snapshot = await snapshotScreen(browser, { onLog });
        const persisted = snapshot.clickTargets.length > 0 || snapshot.assertionTargets.length > 0;
        if (persisted) {
          await persistMobileScreen(params.appSlug, snapshot, {
            scenarioTitle: `route-learning:${params.flowId ?? "walk"}`,
            status: "partial",
          });
        }
        screens.push({
          index: i,
          screenKey: snapshot.screenKey,
          title: snapshot.title,
          fingerprint: snapshot.fingerprint,
          controls: snapshot.observedControls.length,
          clickTargets: snapshot.clickTargets.slice(0, 12),
          persisted,
        });
        observedSnapshots.push(snapshot);
        onLog(`[mobile:learn] screen ${i + 1}/${maxScreens} key=${snapshot.screenKey} controls=${snapshot.observedControls.length} clickTargets=${snapshot.clickTargets.length}`);

        const decideOpts = {
          stopBeforeSubmit,
          // After filling a form the screen keeps its structure, so its fingerprint is
          // unchanged — skipping the loop check once lets the now-enabled advance control
          // be pressed instead of being mistaken for a screen that did not react.
          visitedFingerprints: skipLoopCheckOnce ? undefined : visited,
          appPackage: target.appPackage,
          preferLabels: params.preferLabels,
          allowSubmitLabels: params.allowSubmitLabels,
        };
        // Interpretive layer: rules first, AI only when they stop on a recoverable case.
        const decision = await decideNextActionInterpreted(snapshot, decideOpts, aiCtx, onLog);
        skipLoopCheckOnce = false;
        visited.add(snapshot.fingerprint);

        // A screen asking for input is crossable when the caller supplied the values.
        if (decision.kind === "stop" && decision.reason === "needs_input") {
          let resolved = resolveScreenData(snapshot, params.screenData, target.appPackage);
          if (!resolved.ok) {
            // Interpretive fallback: let the AI synthesize valid test data for the missing
            // fields, then retry with caller data + AI data merged.
            const aiFills = await aiSynthesizeScreenData(snapshot, decideOpts, aiCtx, onLog, params.screenData);
            if (aiFills) {
              const retry = resolveScreenData(snapshot, [...(params.screenData ?? []), ...aiFills], target.appPackage);
              if (retry.ok) resolved = retry;
            }
          }

          // A filled form still reports its fields as inputs, so the rules stop on it again.
          // Deciding "already filled" by screen fingerprint does not work: typing CHANGES the
          // fingerprint (the value becomes the field's text), so the screen came back as new
          // and got filled a second time — which is how the recorded flow ended up typing the
          // same document twice into the same field and tapping its selector twice.
          //
          // Comparing values is not enough either, because the app reformats what was typed:
          // "40229993734" is displayed back as "402-2999373-4", so the next round reads a
          // different string and retypes the very value already in the field. Separators are
          // presentation, so the comparison ignores them.
          if (resolved.ok) {
            const pending = resolved.fills.filter((f) => !fieldAlreadyHolds(f));
            if (pending.length < resolved.fills.length) {
              const skipped = resolved.fills.length - pending.length;
              onLog(`[mobile:learn] ${skipped} campo(s) ya contienen el valor; no se reescriben`);
            }
            resolved = { ...resolved, fills: pending };
          }
          const fillSignature = resolved.ok
            ? resolved.fills.map((f) => `${f.target.strategy}:${f.target.value}=${f.otp ? "<otp>" : f.value ?? ""}`).join("|")
            : "";
          // No fill left to make means the form already holds everything it was going to get.
          if (resolved.ok && (resolved.fills.length === 0 || fillSignature === lastFillSignature)) {
            const advance = findActionableControls(snapshot, target.appPackage).find(
              (a) => isContinueLabel(a.label) && !isBlockedSubmitLabel(a.label, params.allowSubmitLabels),
            );
            if (!advance) {
              stopReason = "needs_input";
              stopDetail = `el formulario se completo pero no habilito ningun control de avance en ${snapshot.screenKey}`;
              onLog(`[mobile:learn] ${stopDetail}`);
              break;
            }
            onLog(`[mobile:learn] formulario ya contiene los datos, avanzando con "${advance.label}"`);
            const advStep: MobileStep = {
              action: "click",
              description: `Avanzar con "${advance.label}"`,
              target: advance.target,
            };
            const advRes = await executeMobileStep(browser, advStep, screens.length);
            if (advRes.status !== "passed") {
              stopReason = "no_actionable";
              stopDetail = `no se pudo avanzar con "${advance.label}": ${advRes.errorMessage ?? "sin detalle"}`;
              onLog(`[mobile:learn] ${stopDetail}`);
              break;
            }
            traversed.push({ action: "click", description: advStep.description, target: advance.target });
            clickedLabels.push(advance.target.value);
            lastFillSignature = null;
            await sleep(settleMs);
            continue;
          }

          if (!resolved.ok) {
            stopReason = "needs_input";
            stopDetail = `faltan datos para: ${resolved.missing.join(", ")}`;
            onLog(`[mobile:learn] stop reason=needs_input ${stopDetail}`);
            break;
          }

          let fillFailed: string | undefined;
          for (const fill of resolved.fills) {
            if (fill.selectFirst) {
              const selectStep: MobileStep = {
                action: "click",
                description: `Seleccionar "${fill.selectFirst}"`,
                target: { strategy: "androidUiAutomator", value: `new UiSelector().descriptionContains("${fill.selectFirst.replace(/"/g, '\\"')}")` },
              };
              onLog(`[mobile:learn] select -> "${fill.selectFirst}"`);
              const selRes = await executeMobileStep(browser, selectStep, screens.length);
              if (selRes.status !== "passed") {
                fillFailed = `no se pudo seleccionar "${fill.selectFirst}": ${selRes.errorMessage ?? "sin detalle"}`;
                break;
              }
              traversed.push({ action: "click", description: selectStep.description, target: selectStep.target });
              await sleep(settleMs);
            }

            const fillStep: MobileStep = {
              action: "fill",
              description: `Completar "${fill.label}"`,
              target: fill.target,
              value: fill.otp ? "" : (fill.value ?? ""),
              ...(fill.otp ? { otp: { required: true as const } } : {}),
            };
            onLog(`[mobile:learn] fill -> "${fill.label}"${fill.otp ? " (OTP resuelto en runtime)" : ""}`);
            const fillRes = await executeMobileStep(browser, fillStep, screens.length, undefined, {
              appSlug: params.appSlug,
            });
            if (fillRes.status !== "passed") {
              fillFailed = `no se pudo completar "${fill.label}": ${fillRes.errorMessage ?? "sin detalle"}`;
              break;
            }
            traversed.push({
              action: "fill",
              description: fillStep.description,
              target: fill.target,
              ...(fill.otp ? {} : { value: fill.value }),
            });
            await sleep(settleMs);
          }

          if (fillFailed) {
            stopReason = "needs_input";
            stopDetail = fillFailed;
            onLog(`[mobile:learn] ${fillFailed}`);
            break;
          }

          if (params.autoAcceptConsent !== false) {
            try {
              const { ticked } = await ensureConsentCheckboxChecked(browser, onLog);
              if (ticked.length > 0) onLog(`[mobile:learn] consentimiento marcado: ${ticked.join(" | ")}`);
            } catch (e) {
              onLog(`[mobile:learn] no se pudo marcar el consentimiento: ${e instanceof Error ? e.message : String(e)}`);
            }
          }

          // The form is filled; re-read the screen so the next decision sees the enabled
          // advance control instead of the gated one captured before typing.
          lastFillSignature = fillSignature;
          skipLoopCheckOnce = true;
          continue;
        }

        if (decision.kind === "stop") {
          stopReason = decision.reason;
          stopDetail = decision.detail;
          onLog(`[mobile:learn] stop reason=${decision.reason} detail=${decision.detail ?? "-"}`);
          break;
        }

        onLog(`[mobile:learn] advance -> "${decision.label}"`);
        const step: MobileStep = {
          action: "click",
          description: `Avanzar con "${decision.label}"`,
          target: decision.target,
        };
        const result = await executeMobileStep(browser, step, screens.length);
        if (result.status !== "passed") {
          stopReason = "no_actionable";
          stopDetail = `no se pudo pulsar "${decision.label}": ${result.errorMessage ?? "sin detalle"}`;
          onLog(`[mobile:learn] ${stopDetail}`);
          break;
        }
        traversed.push({ action: "click", description: step.description, target: decision.target });
        clickedLabels.push(decision.target.value);
        await sleep(settleMs);

        if (i === maxScreens - 1) {
          stopReason = "max_screens";
          stopDetail = `se alcanzo el limite de ${maxScreens} pantallas`;
        }
      }
    }

    if (clickedLabels.length > 0) {
      await persistMobileRoute(params.appSlug, clickedLabels, {
        scenarioTitle: `route-learning:${params.flowId ?? "walk"}`,
        status: "partial",
        expectedAppPackage: target.appPackage,
      });
    }

    // ── Record the flow AND the observed element inventory in the app profile ──
    let profileWritten = false;
    if (observedSnapshots.length > 0) {
      const profile = loadMobileRouteProfile(params.appSlug);
      if (!profile) {
        onLog(`[mobile:learn] no existe mobile.config.json para ${params.appSlug}; no se escribe el perfil`);
      } else {
        // Screens are written even when no flow was recorded: the generator's prompt reuses
        // these locators, so a walk that stopped early is still worth what it saw.
        const learnedScreens = buildLearnedScreens(observedSnapshots, target.appPackage);
        let next: MobileRouteProfile = {
          ...profile,
          screens: { ...(profile.screens ?? {}), ...learnedScreens },
          updatedAt: new Date().toISOString(),
        };
        const elementCount = Object.values(learnedScreens).reduce((n, s) => n + s.elements.length, 0);
        onLog(`[mobile:learn] inventario escrito: ${Object.keys(learnedScreens).length} pantalla(s), ${elementCount} elemento(s) con locator observado`);

        if (params.flowId && traversed.length > 0) {
          const triggerKeywords = deriveTriggerKeywords(params.triggerKeywords, params.huContext, params.flowId);
          const flow: MobileFlow = {
            description: params.flowDescription ?? `Flujo ${params.flowId} aprendido del recorrido real`,
            triggerKeywords,
            entryFromScreen: screens[0]?.screenKey,
            entrySteps: traversed,
          };
          next = upsertFlowFirst(next, params.flowId, flow);
          onLog(`[mobile:learn] flujo "${params.flowId}" escrito en mobile.config.json con ${traversed.length} pasos, keywords=${triggerKeywords.join("|") || "-"}`);
        }
        saveMobileRouteProfile(params.appSlug, next);
        profileWritten = true;
      }
    }

    const result: MobileRouteLearningResult = {
      appSlug: params.appSlug,
      flowId: params.flowId,
      screensLearned: screens.length,
      screens,
      traversed,
      stopReason,
      stopDetail,
      profileWritten,
    };
    jobStore.update(jobId, {
      status: "done",
      completedAt: new Date().toISOString(),
      summary: result as unknown as never,
    });
    onLog(`[mobile:learn] finished screens=${screens.length} steps=${traversed.length} stop=${stopReason} profileWritten=${profileWritten}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onLog(`[mobile:learn] failed: ${message}`);
    jobStore.update(jobId, { status: "failed", completedAt: new Date().toISOString(), errorMessage: message });
  } finally {
    if (sessionHandle) {
      try {
        await closeSession(sessionHandle.browser);
      } catch {
        /* session already gone */
      }
    }
    // Release whether or not a session was obtained: a failed acquireSession() still
    // leaves the lock entry behind, and an unreleased lock blocks every later run with
    // "lock already held" until the server restarts.
    const lock = sessionHandle ?? pendingLock;
    if (lock) {
      releaseSessionLock({ lockKey: lock.lockKey, lockOwner: lock.lockOwner, runId, onLog });
    }
  }
}
