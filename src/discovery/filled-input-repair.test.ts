import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { FilledInputRegistry, isButtonTargetDisabled, isSecretInput, typeLikeUser } from "./filled-input-repair";

test("only real secrets are excluded from the registry", async () => {
  const browser = await chromium.launch();
  try {
    const tab = await (await browser.newContext()).newPage();
    await tab.setContent(`<input id="weight"><input id="pw" type="password"><input id="code" autocomplete="one-time-code"><input id="otp-field"><input id="peso-bruto">`);
    assert.equal(await isSecretInput(tab.locator("#weight")), false);
    assert.equal(await isSecretInput(tab.locator("#peso-bruto")), false);
    assert.equal(await isSecretInput(tab.locator("#pw")), true);
    assert.equal(await isSecretInput(tab.locator("#code")), true);
    assert.equal(await isSecretInput(tab.locator("#otp-field")), true);
  } finally {
    await browser.close();
  }
});

// The app clears the weight when the height changes and keeps "Actualizar" disabled until it is back.
// Like a masked numeric widget, the weight only reaches the app's model through key events: a value
// set in one shot is wiped on the next re-render, a typed one survives it.
const page = `
<input id="weight" placeholder="Ingrese el peso en lbs">
<input id="feet"><input id="inches">
<button id="go" disabled>Actualizar</button>
<button id="other">Otro</button>
<script>
  const weight = document.getElementById('weight'), go = document.getElementById('go');
  let model = '';
  weight.addEventListener('keydown', (event) => { if (/^\\d$/.test(event.key)) model += event.key; });
  document.getElementById('inches').addEventListener('input', () => { weight.value = model; go.disabled = model === ''; });
  weight.addEventListener('input', () => { go.disabled = weight.value.trim() === ''; });
</script>`;

async function withPage<T>(run: (tab: import("playwright").Page) => Promise<T>): Promise<T> {
  const browser = await chromium.launch();
  try {
    const tab = await (await browser.newContext()).newPage();
    await tab.setContent(page);
    return await run(tab);
  } finally {
    await browser.close();
  }
}

test("a cleared input is reported once and retyped only while it is empty", async () => {
  await withPage(async (tab) => {
    const registry = new FilledInputRegistry();
    const lines: string[] = [];
    const log = (line: string) => lines.push(line);
    const commit = typeLikeUser;
    await tab.locator("#weight").fill("175");
    registry.remember({ stepIndex: 52, label: "Peso (lbs)", locator: tab.locator("#weight"), value: "175" });
    await tab.locator("#inches").fill("11");

    await registry.reportCleared(55, log);
    await registry.reportCleared(56, log);
    assert.deepEqual(lines, ['[fill-watch] field="Peso (lbs)" filledAtStep=52 emptyAtStep=55']);

    assert.equal(await isButtonTargetDisabled(tab, "Actualizar"), true);
    assert.deepEqual(await registry.repairCleared(commit, log), ["Peso (lbs)"]);
    assert.equal(await tab.locator("#weight").inputValue(), "175");
    assert.equal(await tab.locator("#go").isEnabled(), true);
    assert.deepEqual(await registry.repairCleared(commit, log), [], "a filled input is left alone");
  });
});

test("an enabled, missing or other button is never treated as disabled", async () => {
  await withPage(async (tab) => {
    assert.equal(await isButtonTargetDisabled(tab, "Otro"), false);
    assert.equal(await isButtonTargetDisabled(tab, "No existe"), false);
  });
});
