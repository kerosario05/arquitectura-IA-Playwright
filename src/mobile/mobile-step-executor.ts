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
        const el = await locateTarget(browser, selectorFromTarget(step.target), step.timeoutMs ?? 10000, "displayed");
        if (!el) throw new Error(`click target not found (even after closing any blocking modal): ${JSON.stringify(step.target)}`);
        await el.click();
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
