import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { PromotedSpecRuntime } from "./promoted-spec-runtime";

function prepareForBrowserFieldTest(runtime: PromotedSpecRuntime, selector: string): void {
  (runtime as any).markBoundaryProgress = async () => undefined;
  (runtime as any).ensureInitialEvidence = async () => undefined;
  (runtime as any).dismissSessionExpiringWarningIfPresent = async () => undefined;
  (runtime as any).waitForPromotedUiStable = async () => undefined;
  (runtime as any).captureEvidenceStep = async () => undefined;
  (runtime as any).activeContainer = { selector, descriptor: "dialog" };
  (runtime as any).refreshActiveContainerForField = async () => ({
    candidates: [],
    best: { selector, descriptor: "dialog", matchingFieldFound: true },
  });
}

test("unbound fill recovers the unique visible field from dialog snapshot before an unsafe label callback", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <main>
        <section role="dialog" aria-modal="true">
          <div><span>Contacto</span><input type="hidden" placeholder="stale field"></div>
          <div><span>Contacto</span><input type="text" placeholder="contact value"></div>
          <button type="button" aria-label="Añadir contacto">Añadir contacto</button>
        </section>
      </main>
    `);
    const runtime = new PromotedSpecRuntime(page, { enabled: false, evidenceEnabled: false, actionTimeoutMs: 250 });
    prepareForBrowserFieldTest(runtime, '[role="dialog"]');
    let callbackAttempted = false;

    await runtime.fillPromotedField({
      stepIndex: 14,
      target: "Contacto",
      value: "example value",
      fill: async () => {
        callbackAttempted = true;
        await page.getByLabel("Contacto").fill("example value");
      },
    });

    assert.equal(await page.getByPlaceholder("contact value").inputValue(), "example value");
    assert.equal(callbackAttempted, false);
  } finally {
    await browser.close();
  }
});

test("unbound fill keeps a uniquely labeled dialog input on the existing native path", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <section role="dialog" aria-modal="true">
        <label for="primary-contact">Primary contact</label>
        <input id="primary-contact" type="text" placeholder="Contact value">
        <button type="button" aria-label="Add contact">Add contact</button>
      </section>
    `);
    const runtime = new PromotedSpecRuntime(page, { enabled: false, evidenceEnabled: false, actionTimeoutMs: 250 });
    prepareForBrowserFieldTest(runtime, '[role="dialog"]');
    let callbackAttempted = false;

    await runtime.fillPromotedField({
      stepIndex: 3,
      target: "Primary contact",
      value: "example value",
      fill: async () => { callbackAttempted = true; throw new Error("unexpected callback fallback"); },
    });

    assert.equal(await page.getByLabel("Primary contact").inputValue(), "example value");
    assert.equal(callbackAttempted, false);
  } finally {
    await browser.close();
  }
});
