import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { resolveActionTarget, attemptSegmentedInputFill } from "./target-resolver";
import { observeSegmentedCodeEvidence, resolveSegmentedInputForm } from "./observed-segmented-code";

test("submission after code entry stays in the verified form instead of a similar sidebar link", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<nav><a id="navigation" href="#other">Autorizaciones a Terceros</a></nav>
      <form id="code-form" onsubmit="event.preventDefault();document.getElementById('receipt').hidden=false">
        ${Array.from({ length: 6 }, (_, i) => `<input name="code[]" maxlength="1" tabindex="${i + 1}">`).join("")}
        <input id="submit" type="submit" value="Continuar">
      </form><div id="receipt" hidden>Receipt confirmed</div>`);
    const evidence = await observeSegmentedCodeEvidence(page, "token_autorizacion");
    assert.ok(evidence);
    assert.equal((await attemptSegmentedInputFill(page, evidence, "654321")).ok, true);
    const form = await resolveSegmentedInputForm(page, evidence);
    assert.ok(form);
    const snapshot = { elements: [
      { id: "nav", domId: "navigation", text: "Autorizaciones a Terceros", tagName: "a", type: "link", visible: true,
        candidateLocators: [{ strategy: "css", value: "#navigation", confidence: 1 }] },
      { id: "submit", domId: "submit", tagName: "input", inputType: "submit", type: "input", visible: true,
        candidateLocators: [{ strategy: "css", value: "#submit", confidence: 1 }] },
    ] } as any;
    const result = await resolveActionTarget(page, snapshot, "Autorizar transferencia", { activeContainer: {
      type: "form", reason: "form_opened", containerLocator: form, verifiedSegmentedInput: true,
    } });
    assert.equal(result.status, "resolved");
    assert.equal(await result.locator!.getAttribute("id"), "submit");
    await result.locator!.click();
    assert.equal(await page.locator("#receipt").isVisible(), true);
    assert.equal(await page.evaluate(() => location.hash), "");
  } finally { await browser.close(); }
});

test("verified form submit remains ambiguous with two native submits and rejects an unavailable submit", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const [html, expected] of [
      ['<input type="submit" value="Continue"><button type="submit">Other</button>', "ambiguous"],
      ['<input type="submit" value="Continue" disabled>', "not_found"],
    ]) {
      await page.setContent(`<a href="#other">Authorization settings</a><form id="code-form">${html}</form>`);
      const result = await resolveActionTarget(page, { elements: [] } as any, "Authorize request", { activeContainer: {
        type: "form", reason: "form_opened", containerLocator: page.locator("#code-form"), verifiedSegmentedInput: true,
      } });
      assert.equal(result.status, expected);
      assert.equal(result.locator, undefined);
    }
  } finally { await browser.close(); }
});

test("an exact observed action keeps precedence and scope recovery never guesses another form", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<form id="code-form"><div id="slots"></div><button id="exact" type="button">Authorize request</button><input type="submit" value="Continue"></form>');
    const form = await resolveSegmentedInputForm(page, { kind: "segmented_input", scopeIdentity: { strategy: "css", value: "#slots" }, segmentCount: 6 } as any);
    assert.ok(form);
    const result = await resolveActionTarget(page, { elements: [] } as any, "Authorize request", { activeContainer: {
      type: "form", reason: "form_opened", containerLocator: form, verifiedSegmentedInput: true,
    } });
    assert.equal(result.status, "resolved");
    assert.equal(await result.locator!.getAttribute("id"), "exact");
    await page.setContent('<div id="slots"></div><form><input type="submit"></form>');
    assert.equal(await resolveSegmentedInputForm(page, { kind: "segmented_input", scopeIdentity: { strategy: "css", value: "#slots" } } as any), undefined);
  } finally { await browser.close(); }
});

test("a previous hidden code form does not override a later explicitly named action", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<form id="old" hidden><input type="submit" value="Continue"></form><button id="current">Continue</button>');
    const result = await resolveActionTarget(page, { elements: [] } as any, "Continue", { activeContainer: {
      type: "form", reason: "form_opened", containerLocator: page.locator("#old"), verifiedSegmentedInput: true,
    } });
    assert.equal(result.status, "resolved");
    assert.equal(await result.locator!.getAttribute("id"), "current");
  } finally { await browser.close(); }
});
