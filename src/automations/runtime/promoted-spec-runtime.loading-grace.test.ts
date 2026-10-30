import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { PromotedSpecRuntime } from "./promoted-spec-runtime";

// Job cb758288: after "Continuar" the app showed "Cargando..." for ~10 s while it validated the
// identity. A loader outlasting the stability window is the app still working, not an unstable UI.

const LOADING = `<main><p>Cargando...</p></main>`;
const LOADED = `<main><h1>Selecciona la cuenta de tu preferencia</h1><button>Continuar</button><button>Comparar</button></main>`;

test("a loader that outlasts the stability window gets a bounded grace and then passes", async () => {
  const browser = await chromium.launch({ headless: true });
  const previous = process.env.PROMOTED_RUNTIME_LOADING_GRACE_MS;
  try {
    process.env.PROMOTED_RUNTIME_LOADING_GRACE_MS = "6000";
    const page = await browser.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.setContent(LOADING);
    const runtime = new PromotedSpecRuntime(page, { captureDiagnostics: false, stabilityTimeoutMs: 1000, actionTimeoutMs: 2500 } as any);
    setTimeout(() => void page.setContent(LOADED).catch(() => undefined), 2500);
    await runtime.waitForPromotedUiStable(6, "css:[id=\"btn-identity-validate\"]");
  } finally {
    if (previous === undefined) delete process.env.PROMOTED_RUNTIME_LOADING_GRACE_MS;
    else process.env.PROMOTED_RUNTIME_LOADING_GRACE_MS = previous;
    await browser.close();
  }
});

test("a loader that never ends still fails once the grace is spent, naming the reason", async () => {
  const browser = await chromium.launch({ headless: true });
  const previous = process.env.PROMOTED_RUNTIME_LOADING_GRACE_MS;
  try {
    process.env.PROMOTED_RUNTIME_LOADING_GRACE_MS = "1500";
    const page = await browser.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.setContent(LOADING);
    const runtime = new PromotedSpecRuntime(page, { captureDiagnostics: false, stabilityTimeoutMs: 1000, actionTimeoutMs: 2500 } as any);
    await assert.rejects(runtime.waitForPromotedUiStable(6, "x"), /UI not stable after step 6 target="x" reason=loading/);
  } finally {
    if (previous === undefined) delete process.env.PROMOTED_RUNTIME_LOADING_GRACE_MS;
    else process.env.PROMOTED_RUNTIME_LOADING_GRACE_MS = previous;
    await browser.close();
  }
});
