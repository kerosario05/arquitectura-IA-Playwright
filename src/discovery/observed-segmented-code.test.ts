import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { observeSegmentedCodeEvidence } from "./observed-segmented-code";
import { attemptSegmentedInputFill } from "./target-resolver";
import { bindAuthoredRuntimeField, parseScenarioStepsForDiscovery } from "./case-discovery";
import { detectCredentialRole, resolveDataKey } from "../data/data-key-resolver";
import type { TestScenario } from "../types/testrail.types";

const slots = (name: string, count = 6) => Array.from({ length: count }, (_, index) =>
  `<input type="text" name="${name}" tabindex="${index + 1}" maxlength="1">`).join("");

test("login and authorization keep independent data through segmented observation and serialized execution", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const entries = [{ key: "codigo_acceso", value: "123456", source: "explicit_runtime_input" },
      { key: "token_autorizacion", value: "654321", source: "explicit_runtime_input" }];
    const scenario: TestScenario = { source: "testrail", caseId: 1, externalId: "synthetic", title: "synthetic",
      steps: [
        { index: 1, action: 'Ingresar el código de acceso en "Código".', dataHints: [] },
        { index: 2, action: 'Ingresar el token de autorización en "Token".', dataHints: [] },
      ] };
    const targets = parseScenarioStepsForDiscovery(scenario).actionTargets;
    for (const [index, target] of targets.entries()) {
      await page.setContent(`<form id="verification">${slots(index === 0 ? "verification[]" : "authorization[]")}</form>`);
      assert.equal(bindAuthoredRuntimeField(scenario, target, entries), true);
      assert.equal(target.valueKey, entries[index].key);
      const observed = await observeSegmentedCodeEvidence(page, target.valueKey);
      assert.equal(observed?.kind, "segmented_input", target.valueKey);
      const plan = JSON.parse(JSON.stringify({ valueKey: target.valueKey, playwrightRecorderEvidence: observed }));
      const resolved = resolveDataKey(plan.valueKey, { runtimeEntries: entries });
      assert.equal(resolved.source, "explicit_runtime_input");
      assert.equal(resolved.masked, true);
      assert.equal((await attemptSegmentedInputFill(page, plan.playwrightRecorderEvidence, resolved.value!)).ok, true);
      assert.equal(await page.locator('input[type="text"]').evaluateAll(elements => elements.map(el => (el as HTMLInputElement).value).join("")), entries[index].value);
      assert.equal(JSON.stringify(plan).includes(entries[index].value), false);
    }
    assert.equal(detectCredentialRole("token_autorizacion"), undefined, "widget support never reclassifies the data as a login OTP");
    assert.equal(resolveDataKey("auth.otp", { runtimeEntries: entries }).value, entries[0].value);
    assert.equal(await observeSegmentedCodeEvidence(page, "monto"), undefined);
    assert.equal(await observeSegmentedCodeEvidence(page, "tokenized_label"), undefined);
  } finally { await browser.close(); }
});

test("observed ordered code group survives plan serialization and uses existing segmented runtime", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const [scope, name] of [["identity-form", "ctoken[]"], ["verification-panel", "verification[]"]]) {
      await page.setContent(`<form id="${scope}"><p>Enter verification code</p>${slots(name)}<input type="submit"></form>`);
      const observed = await observeSegmentedCodeEvidence(page);
      assert.equal(observed?.kind, "segmented_input");
      assert.equal(observed?.segmentCount, 6);
      const transported = JSON.parse(JSON.stringify({ action: "fill", valueKey: "auth.otp", playwrightRecorderEvidence: observed }));
      assert.equal(JSON.stringify(transported).includes("654321"), false);
      assert.equal((await attemptSegmentedInputFill(page, transported.playwrightRecorderEvidence, "654321")).ok, true);
      assert.deepEqual(await page.locator('input[type="text"]').evaluateAll(elements => elements.map(el => (el as HTMLInputElement).value)), ["6", "5", "4", "3", "2", "1"]);
      assert.equal((await attemptSegmentedInputFill(page, observed, "123")).ok, false);
    }
    await page.setContent(`<form id="a">${slots("a")}</form><form id="b">${slots("b")}</form>`);
    assert.equal(await observeSegmentedCodeEvidence(page), undefined, "two groups cannot be selected implicitly");
    await page.setContent(`<form id="a">${slots("a").replace('tabindex="3"', 'tabindex="2"')}</form>`);
    assert.equal(await observeSegmentedCodeEvidence(page), undefined, "duplicate positions are rejected");
    await page.setContent(`<form id="a">${slots("a").replace('tabindex="3"', 'readonly tabindex="3"')}</form>`);
    assert.equal(await observeSegmentedCodeEvidence(page), undefined, "incomplete writable sequence is rejected");
    await page.setContent('<form id="normal"><input name="document" tabindex="1"></form>');
    assert.equal(await observeSegmentedCodeEvidence(page), undefined, "ordinary field stays ordinary");
  } finally { await browser.close(); }
});
