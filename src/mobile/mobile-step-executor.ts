import type { MobileStep, MobileStepResult, MobileStepTarget } from "./mobile-step-types";
import { ensureConsentCheckboxChecked, isSubmitLikeClick } from "./mobile-consent-checkbox";
import { dismissBlockingModal } from "./mobile-modal-dismisser";

function selectorFromTarget(target: MobileStepTarget): string {
  switch (target.strategy) {
    case "accessibilityId":
      return `~${target.value}`;
    case "id":
      return `android=new UiSelector().resourceId("${target.value}")`;
    case "xpath":
      return target.value;
    case "androidUiAutomator":
      return `android=${target.value}`;
    case "className":
      return `android=new UiSelector().className("${target.value}")`;
    default:
      throw new Error(`Unsupported locator strategy: ${(target as MobileStepTarget).strategy}`);
  }
}

type WaitMode = "displayed" | "exist";
type WdioElement = Awaited<ReturnType<WebdriverIO.Browser["$"]>>;

async function waitOnce(el: WdioElement, mode: WaitMode, timeoutMs: number): Promise<boolean> {
  const wait = mode === "displayed"
    ? el.waitForDisplayed({ timeout: timeoutMs })
    : el.waitForExist({ timeout: timeoutMs });
  return wait.then(() => true).catch(() => false);
}

/**
 * Locates a step's target and, if it isn't found, tries to recover: something the previous step
 * opened (a modal/dialog/overlay) may be covering the screen and not contain this target. In
 * that case we close the modal and look for the target on the screen underneath. Returns the
 * resolved element, or null if it still can't be found after recovery.
 */
async function locateTarget(
  browser: WebdriverIO.Browser,
  selector: string,
  timeoutMs: number,
  mode: WaitMode
): Promise<WdioElement | null> {
  const el = await browser.$(selector);
  if (await waitOnce(el, mode, timeoutMs)) return el;

  // Target not found on the current (possibly modal-covered) screen → try to close a blocking
  // modal and look for the target outside it. Bounded to a couple of attempts.
  for (let attempt = 0; attempt < 2; attempt++) {
    const dismissed = await dismissBlockingModal(browser, (line) => console.log(line));
    if (!dismissed) break;
    const retried = await browser.$(selector);
    if (await waitOnce(retried, mode, Math.min(timeoutMs, 5000))) return retried;
  }
  return null;
}

/** Reads the enable-before-click flag (default ON; only "false" disables). */
function requireEnabledBeforeClick(): boolean {
  return (process.env.MOBILE_REQUIRE_ENABLED_BEFORE_CLICK ?? "true").toLowerCase() !== "false";
}

/**
 * Whether the element for `selector` is currently ENABLED. Only the `enabled` attribute is used —
 * NOT `clickable`, because many tappable RN rows have a `clickable="false"` inner TextView yet the
 * tap works via a clickable ancestor. Re-queries each call so a disabled→enabled transition (e.g.
 * a form validating, or a consent checkbox getting marked) is picked up. If state can't be read,
 * returns true so we never block a legitimate click.
 */
async function isEnabledNow(browser: WebdriverIO.Browser, selector: string): Promise<boolean> {
  try {
    const el = await browser.$(selector);
    if (!(await el.isExisting())) return true; // let the click path handle a missing element
    return await el.isEnabled();
  } catch {
    return true;
  }
}

/** Polls (briefly) until the element becomes enabled, or the timeout elapses. */
async function waitUntilEnabled(browser: WebdriverIO.Browser, selector: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  if (await isEnabledNow(browser, selector)) return true;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    if (await isEnabledNow(browser, selector)) return true;
  }
  return false;
}

export async function executeMobileStep(
  browser: WebdriverIO.Browser,
  step: MobileStep,
  index: number,
  screenshotPath?: string
): Promise<MobileStepResult> {
  const startedAt = Date.now();

  try {
    switch (step.action) {
      case "launchApp": {
        // App launch is handled at Appium session creation (appium:app / appPackage+appActivity).
        // This step exists as a documentation/evidence marker only.
        break;
      }
      case "click": {
        if (!step.target) throw new Error("click step requires a target");
        // Before pressing an accept/continue/confirm button, tick any un-checked consent/
        // required checkbox on screen (e.g. "Acepto los términos y condiciones"); otherwise the
        // button may stay disabled and the scenario can't complete. Best-effort, never throws.
        if (isSubmitLikeClick(step)) {
          await ensureConsentCheckboxChecked(browser, (line) => console.log(line));
        }
        const clickSelector = selectorFromTarget(step.target);
        const el = await locateTarget(browser, clickSelector, step.timeoutMs ?? 10000, "displayed");
        if (!el) throw new Error(`click target not found (even after closing any blocking modal): ${JSON.stringify(step.target)}`);
        // A visible button can still be DISABLED (e.g. "Continuar" until the form gate is satisfied).
        // Give it a brief window to become enabled (the consent/checkbox handling above may satisfy
        // the gate), then decide on the `enabled` attribute ONLY — never `clickable`, which is
        // `false` on many tappable inner TextViews. If it stays genuinely disabled, tapping it is a
        // no-op, so fail with a precise reason instead of silently "passing" an action that couldn't
        // happen. (Negative scenarios must assert the disabled state via assertDisabled, not click.)
        if (requireEnabledBeforeClick() && !(await waitUntilEnabled(browser, clickSelector, Math.min(step.timeoutMs ?? 10000, 4000)))) {
          throw new Error(`target_disabled: el botón/elemento está deshabilitado y no se puede clickear (no se cumplió la condición para habilitarlo): ${JSON.stringify(step.target)}`);
        }
        // Re-query in case the tree re-rendered while waiting for the enabled state.
        await (await browser.$(clickSelector)).click();
        break;
      }
      case "fill": {
        if (!step.target) throw new Error("fill step requires a target");
        const el = await locateTarget(browser, selectorFromTarget(step.target), step.timeoutMs ?? 10000, "displayed");
        if (!el) throw new Error(`fill target not found (even after closing any blocking modal): ${JSON.stringify(step.target)}`);
        await el.setValue(step.value ?? "");
        break;
      }
      case "assertVisible": {
        if (!step.target) throw new Error("assertVisible step requires a target");
        const el = await locateTarget(browser, selectorFromTarget(step.target), step.timeoutMs ?? 10000, "displayed");
        if (!el) {
          throw new Error(`Expected element to be visible: ${JSON.stringify(step.target)}`);
        }
        break;
      }
      case "assertEnabled": {
        // Validate that a control IS enabled (actionable). Used to confirm a gate was satisfied.
        if (!step.target) throw new Error("assertEnabled step requires a target");
        const el = await locateTarget(browser, selectorFromTarget(step.target), step.timeoutMs ?? 10000, "displayed");
        if (!el) throw new Error(`Expected element to be present and enabled but not found: ${JSON.stringify(step.target)}`);
        const enabled = await el.isEnabled().catch(() => false);
        if (!enabled) throw new Error(`Expected element to be ENABLED but it is disabled: ${JSON.stringify(step.target)}`);
        break;
      }
      case "assertDisabled": {
        // Validate that a control IS disabled — the expected outcome of negative scenarios (e.g. the
        // submit button stays disabled with invalid input). Uses `exist` since a disabled control is
        // still present; passes only when the element exists and reports enabled=false.
        if (!step.target) throw new Error("assertDisabled step requires a target");
        const el = await locateTarget(browser, selectorFromTarget(step.target), step.timeoutMs ?? 10000, "exist");
        if (!el) throw new Error(`Expected element to be present but disabled; not found: ${JSON.stringify(step.target)}`);
        const enabled = await el.isEnabled().catch(() => true);
        if (enabled) throw new Error(`Expected element to be DISABLED but it is enabled: ${JSON.stringify(step.target)}`);
        break;
      }
      case "waitFor": {
        if (!step.target) throw new Error("waitFor step requires a target");
        const el = await locateTarget(browser, selectorFromTarget(step.target), step.timeoutMs ?? 10000, "exist");
        if (!el) throw new Error(`waitFor target not found (even after closing any blocking modal): ${JSON.stringify(step.target)}`);
        break;
      }
      case "screenshot": {
        // Screenshot capture is handled below for every step; nothing extra to do here.
        break;
      }
      default:
        throw new Error(`Unsupported mobile step action: ${(step as MobileStep).action}`);
    }

    if (screenshotPath) {
      await browser.saveScreenshot(screenshotPath);
    }

    return {
      index,
      action: step.action,
      description: step.description,
      status: "passed",
      screenshotPath,
      durationMs: Date.now() - startedAt
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (screenshotPath) {
      try {
        await browser.saveScreenshot(screenshotPath);
      } catch {
        // Best effort — don't let screenshot failure mask the real error.
      }
    }
    return {
      index,
      action: step.action,
      description: step.description,
      status: "failed",
      errorMessage: message,
      screenshotPath,
      durationMs: Date.now() - startedAt
    };
  }
}
