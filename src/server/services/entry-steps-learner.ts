import { chromium } from "@playwright/test";
import type { Page } from "@playwright/test";

export type EntryStepConfig = {
  action: "click" | "type" | "select" | "navigate";
  target: string;
  when?: string;
  reason?: string;
};

export type LearnedEntryStepsResult = {
  entrySteps: EntryStepConfig[];
  confidence: "full" | "none";
  reason: string;
};

type VisibleControl = {
  label: string;
  type: string;
};

async function captureVisibleControls(page: Page): Promise<VisibleControl[]> {
  return page.evaluate(() => {
    const controls: Array<{ label: string; type: string }> = [];
    const selectors = [
      "button",
      "a",
      "[role='button']",
      "[role='menuitem']",
      "input[type='submit']",
      "input[type='button']",
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const htmlEl = el as HTMLElement;
        let text: string | undefined = htmlEl.innerText?.trim();
        if (!text) {
          const input = el as HTMLInputElement;
          text = input.value?.trim();
        }
        if (!text) {
          text = htmlEl.getAttribute("aria-label")?.trim() ?? undefined;
        }
        if (!text) continue;
        controls.push({
          label: text,
          type:
            el.tagName.toLowerCase() === "button"
              ? "button"
              : el.tagName.toLowerCase() === "a"
                ? "link"
                : htmlEl.getAttribute("role") || el.tagName.toLowerCase(),
        });
      }
    }
    return controls;
  });
}

async function tryFormLogin(page: Page, username: string, password: string): Promise<void> {
  const usernameField = page
    .locator(
      'input[name="username"], input[name="user"], input[name="email"], input[type="email"], input[id*="user" i], input[placeholder*="usuario" i], input[placeholder*="user" i]',
    )
    .first();
  const passwordField = page
    .locator(
      'input[name="password"], input[type="password"], input[id*="password" i], input[placeholder*="contrasena" i], input[placeholder*="password" i]',
    )
    .first();

  if ((await usernameField.count()) > 0 && (await passwordField.count()) > 0) {
    await usernameField.fill(username);
    await passwordField.fill(password);

    const submitBtn = page
      .locator(
        'button[type="submit"], input[type="submit"], button:has-text("Iniciar"), button:has-text("Ingresar"), button:has-text("Entrar")',
      )
      .first();
    if ((await submitBtn.count()) > 0) {
      await submitBtn.click();
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    }
  }
}

export async function learnEntryStepsFromSnapshot(
  baseUrl: string,
  options: {
    loginMode?: string;
    username?: string;
    password?: string;
    scenarioFirstSteps: string[];
  },
): Promise<LearnedEntryStepsResult> {
  const { loginMode, username, password, scenarioFirstSteps } = options;

  if (!baseUrl || !scenarioFirstSteps.length) {
    return { entrySteps: [], confidence: "none", reason: "Missing baseUrl or scenario steps" };
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext(
      username && password ? { httpCredentials: { username, password } } : undefined,
    );
    const page = await context.newPage();

    await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);

    if (loginMode === "password" && username && password) {
      await tryFormLogin(page, username, password);
      await page.waitForTimeout(2000);
    }

    const visibleControls = await captureVisibleControls(page);

    const firstTarget = scenarioFirstSteps.find((s) => s && s.length > 0);
    if (!firstTarget) {
      return { entrySteps: [], confidence: "none", reason: "No scenario first step available" };
    }

    const targetNormalized = firstTarget
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    const firstTargetVisible = visibleControls.some((c) => {
      const label = c.label
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      return label.includes(targetNormalized) || targetNormalized.includes(label);
    });

    if (firstTargetVisible) {
      return {
        entrySteps: [],
        confidence: "full",
        reason: `First target already visible on initial page`,
      };
    }

    const iniciarButton = visibleControls.find((c) => {
      const label = c.label
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      return (
        label === "iniciar" ||
        label === "iniciar sesion" ||
        label === "iniciar sesión" ||
        label === "login" ||
        label === "ingresar" ||
        label === "entrar"
      );
    });

    if (iniciarButton) {
      return {
        entrySteps: [
          { action: "click", target: iniciarButton.label, when: "before_first_functional_step" },
        ],
        confidence: "full",
        reason: `"${iniciarButton.label}" detected on page snapshot`,
      };
    }

    const clickableControls = visibleControls.filter(
      (c) => c.type === "button" || c.type === "link" || c.type === "menuitem",
    );
    if (clickableControls.length > 0) {
      return {
        entrySteps: [],
        confidence: "none",
        reason: `First target not visible. Controls: ${clickableControls.map((c) => `"${c.label}"`).join(", ")}`,
      };
    }

    return {
      entrySteps: [],
      confidence: "none",
      reason: "No actionable controls found on page",
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return { entrySteps: [], confidence: "none", reason: `Snapshot learning failed: ${errorMessage}` };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
