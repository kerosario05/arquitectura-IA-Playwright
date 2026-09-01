import * as fs from "node:fs";
import * as path from "node:path";
import type { Page } from "@playwright/test";
import { extractRuntimeUiSnapshot, type RuntimeUiSnapshot } from "./runtime-knowledge-extractor";
import { persistRuntimeSnapshot } from "./runtime-knowledge-persister";

function loadAppConfigSync(appSlug: string): Record<string, unknown> | null {
  try {
    const p = path.join(process.cwd(), "automations", "apps", appSlug, "app.config.json");
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function getBaseUrl(appConfig: Record<string, unknown> | null): string | null {
  return (
    (appConfig?.baseUrl as string) ??
    ((appConfig?.appProfile as Record<string, unknown> | undefined)?.baseUrl as string) ??
    null
  );
}

async function detectAuthGate(page: Page): Promise<boolean> {
  const currentUrl = page.url().toLowerCase();
  const pageText = await page.evaluate(() => document.body?.textContent ?? "").catch(() => "");
  const hasAuthUrl = /auth|login|identificaci|otp|phone|verificac/i.test(currentUrl);
  const hasAuthText = /(iniciar sesi|autentic|identificac|otp|c.digo|contrase|password)/i.test(pageText);
  return hasAuthUrl || hasAuthText;
}

async function applyAuth(page: Page, appConfig: Record<string, unknown> | null): Promise<boolean> {
  const loginMode = (appConfig?.loginMode as string) || "no_login";
  if (loginMode !== "password") return false;

  const username = (appConfig?.username as string) || process.env.APP_USERNAME || "";
  const password = (appConfig?.password as string) || process.env.APP_PASSWORD || "";
  if (!username || !password) return false;

  try {
    const usernameLocators = [
      page.getByLabel(/usuario|username|email|c.dula|identificac/i),
      page.locator('input[type="text"]').first(),
      page.locator('input[name*="user" i], input[name*="email" i], input[name*="ident" i]').first(),
    ];
    const passwordLocators = [
      page.getByLabel(/contraseña|password|pin|clave/i),
      page.locator('input[type="password"]').first(),
    ];
    const submitLocators = [
      page.getByRole("button", { name: /ingresar|acceder|entrar|login|continuar|iniciar/i }),
      page.getByRole("button").first(),
    ];

    for (const loc of usernameLocators) {
      try { await loc.fill(username); break; } catch { continue; }
    }
    for (const loc of passwordLocators) {
      try { await loc.fill(password); break; } catch { continue; }
    }
    for (const loc of submitLocators) {
      try { await loc.click({ timeout: 5000 }); break; } catch { continue; }
    }
    return true;
  } catch {
    return false;
  }
}

export type WebBootstrapResult = {
  ok: boolean;
  snapshot?: RuntimeUiSnapshot;
  reason?: string;
};

/**
 * Web bootstrap: open baseUrl (applying existing auth when applicable), observe the
 * initial screen, and persist the evidence via persistRuntimeSnapshot() into
 * ProjectKnowledge. Never writes learned data to app.config.json.
 */
export async function bootstrapWebRouteSnapshot(appSlug: string): Promise<WebBootstrapResult> {
  const appConfig = loadAppConfigSync(appSlug);
  const baseUrl = getBaseUrl(appConfig);
  if (!baseUrl) return { ok: false, reason: "no_base_url" };

  let browser: { newContext: (opts?: Record<string, unknown>) => Promise<{ newPage: () => Promise<Page> }>; close: () => Promise<void> } | undefined;
  try {
    const { chromium } = await import("playwright");
    const { waitForPageReady } = await import("../browser/page-readiness");

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();

    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await waitForPageReady(page, { domContentLoadedTimeoutMs: 10000, stabilizationMs: 500 });

    const authDetected = await detectAuthGate(page);
    if (authDetected) {
      await applyAuth(page, appConfig);
      await waitForPageReady(page, { domContentLoadedTimeoutMs: 10000, stabilizationMs: 500 });
    }

    const snapshot = await extractRuntimeUiSnapshot(page);
    await browser.close().catch(() => {});
    browser = undefined;

    if (!snapshot.clickTargets || snapshot.clickTargets.length === 0) {
      console.log(`[route-bootstrap] appSlug=${appSlug} result=insufficient_evidence`);
      return { ok: false, reason: "insufficient_evidence" };
    }

    const loginMode = (appConfig?.loginMode as string) || "no_login";
    await persistRuntimeSnapshot(appSlug, snapshot, {
      status: "passed",
      accessLevel: loginMode === "no_login" ? "public" : "authenticated",
    });
    console.log(`[route-bootstrap] appSlug=${appSlug} persisted=true`);

    return { ok: true, snapshot };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.log(`[route-bootstrap] appSlug=${appSlug} browser_error=${(err as Error).message}`);
    return { ok: false, reason: "browser_error" };
  }
}