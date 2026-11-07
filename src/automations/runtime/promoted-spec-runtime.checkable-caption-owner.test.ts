import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { createPromotedSpecRuntime } from "./promoted-spec-runtime";

test("promoted checkable-caption click resolves the visible switch and ignores a stale internal input ref", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <section>
        <span>¿No posee correo electrónico?</span>
        <input type="checkbox" data-pc-section="input" style="display:none">
        <div role="switch" aria-checked="false" onclick="this.setAttribute('aria-checked', 'true')">Switch visible</div>
      </section>
    `);
    await page.evaluate("globalThis.__name = (value) => value");
    const runtime = createPromotedSpecRuntime(page as any, { enabled: false, actionTimeoutMs: 500, retryEnabled: false });
    await page.route("**/*", (route) => route.abort());
    (runtime as any).markBoundaryProgress = async () => undefined;
    (runtime as any).ensureInitialEvidence = async () => undefined;
    (runtime as any).recordActionEvidence = async () => undefined;

    let callbackInvoked = false;
    await runtime.clickPromotedTarget({
      stepIndex: 11,
      target: "label:¿No posee correo electrónico?",
      technicalTargetRefs: ['css:input[data-pc-section="input"]'],
      associatedField: "¿No posee correo electrónico?",
      checkableCaptionOwner: true,
      actionIntent: "click",
      expectedEffect: "none",
      action: async () => { callbackInvoked = true; },
    });

    assert.equal(await page.getByRole("switch").getAttribute("aria-checked"), "true");
    assert.equal(await page.locator('input[data-pc-section="input"]').isChecked(), false);
    assert.equal(callbackInvoked, false, "the generic callback must not bypass the validated caption owner");
  } finally {
    await browser.close();
  }
});

test("promoted checkable-caption click fails closed when the caption has multiple visible checkable owners", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <section>
        <span>¿No posee correo electrónico?</span>
        <div role="switch" aria-checked="false">First switch</div>
        <input type="checkbox" aria-label="Second switch">
      </section>
    `);
    await page.evaluate("globalThis.__name = (value) => value");
    const runtime = createPromotedSpecRuntime(page as any, { enabled: false, actionTimeoutMs: 500, retryEnabled: false });
    await page.route("**/*", (route) => route.abort());
    (runtime as any).markBoundaryProgress = async () => undefined;
    (runtime as any).ensureInitialEvidence = async () => undefined;
    (runtime as any).recordActionEvidence = async () => undefined;

    let callbackInvoked = false;
    await assert.rejects(runtime.clickPromotedTarget({
      stepIndex: 11,
      target: "label:¿No posee correo electrónico?",
      technicalTargetRefs: ['css:input[data-pc-section="input"]'],
      associatedField: "¿No posee correo electrónico?",
      checkableCaptionOwner: true,
      actionIntent: "click",
      expectedEffect: "none",
      action: async () => { callbackInvoked = true; },
    }), /checkable_caption_owner_not_uniquely_resolved/);

    assert.equal(await page.getByRole("switch").getAttribute("aria-checked"), "false");
    assert.equal(await page.getByRole("checkbox").isChecked(), false);
    assert.equal(callbackInvoked, false, "ambiguous live owners must not fall through to a generic callback");
  } finally {
    await browser.close();
  }
});
