"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.bootstrapWebRouteSnapshot = bootstrapWebRouteSnapshot;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const runtime_knowledge_extractor_1 = require("./runtime-knowledge-extractor");
const runtime_knowledge_persister_1 = require("./runtime-knowledge-persister");
function loadAppConfigSync(appSlug) {
    try {
        const p = path.join(process.cwd(), "automations", "apps", appSlug, "app.config.json");
        if (!fs.existsSync(p))
            return null;
        return JSON.parse(fs.readFileSync(p, "utf-8"));
    }
    catch {
        return null;
    }
}
function getBaseUrl(appConfig) {
    return (appConfig?.baseUrl ??
        appConfig?.appProfile?.baseUrl ??
        null);
}
async function detectAuthGate(page) {
    const currentUrl = page.url().toLowerCase();
    const pageText = await page.evaluate(() => document.body?.textContent ?? "").catch(() => "");
    const hasAuthUrl = /auth|login|identificaci|otp|phone|verificac/i.test(currentUrl);
    const hasAuthText = /(iniciar sesi|autentic|identificac|otp|c.digo|contrase|password)/i.test(pageText);
    return hasAuthUrl || hasAuthText;
}
async function applyAuth(page, appConfig) {
    const loginMode = appConfig?.loginMode || "no_login";
    if (loginMode !== "password")
        return false;
    const username = appConfig?.username || process.env.APP_USERNAME || "";
    const password = appConfig?.password || process.env.APP_PASSWORD || "";
    if (!username || !password)
        return false;
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
            try {
                await loc.fill(username);
                break;
            }
            catch {
                continue;
            }
        }
        for (const loc of passwordLocators) {
            try {
                await loc.fill(password);
                break;
            }
            catch {
                continue;
            }
        }
        for (const loc of submitLocators) {
            try {
                await loc.click({ timeout: 5000 });
                break;
            }
            catch {
                continue;
            }
        }
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Web bootstrap: open baseUrl (applying existing auth when applicable), observe the
 * initial screen, and persist the evidence via persistRuntimeSnapshot() into
 * ProjectKnowledge. Never writes learned data to app.config.json.
 */
async function bootstrapWebRouteSnapshot(appSlug) {
    const appConfig = loadAppConfigSync(appSlug);
    const baseUrl = getBaseUrl(appConfig);
    if (!baseUrl)
        return { ok: false, reason: "no_base_url" };
    let browser;
    try {
        const { chromium } = await Promise.resolve().then(() => __importStar(require("playwright")));
        const { waitForPageReady } = await Promise.resolve().then(() => __importStar(require("../browser/page-readiness")));
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
        const snapshot = await (0, runtime_knowledge_extractor_1.extractRuntimeUiSnapshot)(page);
        await browser.close().catch(() => { });
        browser = undefined;
        if (!snapshot.clickTargets || snapshot.clickTargets.length === 0) {
            console.log(`[route-bootstrap] appSlug=${appSlug} result=insufficient_evidence`);
            return { ok: false, reason: "insufficient_evidence" };
        }
        const loginMode = appConfig?.loginMode || "no_login";
        await (0, runtime_knowledge_persister_1.persistRuntimeSnapshot)(appSlug, snapshot, {
            status: "passed",
            accessLevel: loginMode === "no_login" ? "public" : "authenticated",
        });
        console.log(`[route-bootstrap] appSlug=${appSlug} persisted=true`);
        return { ok: true, snapshot };
    }
    catch (err) {
        if (browser)
            await browser.close().catch(() => { });
        console.log(`[route-bootstrap] appSlug=${appSlug} browser_error=${err.message}`);
        return { ok: false, reason: "browser_error" };
    }
}
