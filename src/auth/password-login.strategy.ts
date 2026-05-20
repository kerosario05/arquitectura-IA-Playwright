import type { Page } from "@playwright/test";
import type { LoginStrategy } from "../types/login.types";

const usernameSelectors = [
  'input[name="username"]',
  'input[name="user"]',
  'input[name="email"]',
  'input[type="email"]',
  'input[id*="user" i]',
  'input[placeholder*="usuario" i]',
  'input[placeholder*="user" i]',
  'input[placeholder*="email" i]'
];

const passwordSelectors = [
  'input[name="password"]',
  'input[type="password"]',
  'input[id*="password" i]',
  'input[placeholder*="contrasena" i]',
  'input[placeholder*="password" i]'
];

const submitSelectors = ['button[type="submit"]', 'input[type="submit"]'];

async function findFirstVisible(page: Page, selectors: string[]) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0 && (await locator.isVisible())) {
      return locator;
    }
  }
  return null;
}

export const passwordLoginStrategy: LoginStrategy = {
  name: "password",
  async execute(page, config) {
    const username = config.app.username;
    const password = config.app.password;

    if (!username || !password) {
      throw new Error(
        "Password login mode requires APP_USERNAME and APP_PASSWORD. Use manual mode or configure credentials."
      );
    }

    await page.goto(config.app.baseUrl, { waitUntil: "domcontentloaded" });

    const usernameInput = await findFirstVisible(page, usernameSelectors);
    const passwordInput = await findFirstVisible(page, passwordSelectors);

    if (!usernameInput || !passwordInput) {
      throw new Error(
        "Could not find username/password fields. Use APP_LOGIN_MODE=manual or implement a custom login strategy in a future phase."
      );
    }

    await usernameInput.fill(username);
    await passwordInput.fill(password);

    const extraFields = config.app.extraLoginFields;
    if (extraFields) {
      for (const [selector, value] of Object.entries(extraFields)) {
        const locator = page.locator(selector).first();
        if ((await locator.count()) > 0) {
          await locator.fill(value);
        }
      }
    }

    const submitInput = await findFirstVisible(page, submitSelectors);
    const submitByRole = page.getByRole("button", {
      name: /login|log in|sign in|iniciar|entrar|acceder|continuar/i
    });

    if (submitInput) {
      await submitInput.click();
    } else if ((await submitByRole.count()) > 0) {
      await submitByRole.first().click();
    } else {
      throw new Error(
        "Could not find login submit button. Use APP_LOGIN_MODE=manual or implement a custom login strategy in a future phase."
      );
    }

    await page.waitForLoadState("domcontentloaded", { timeout: config.execution.defaultTimeoutMs });
  }
};
