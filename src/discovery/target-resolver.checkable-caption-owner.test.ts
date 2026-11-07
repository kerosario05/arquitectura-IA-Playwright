import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import type { PageSnapshot } from "../types/page-snapshot.types";
import { resolveActionTarget } from "./target-resolver";

const snapshotFor = (field: string): PageSnapshot => ({
  version: "1.0",
  url: "http://localhost/",
  title: "fixture",
  capturedAt: new Date(0).toISOString(),
  elements: [
    {
      id: "caption",
      type: "text",
      text: field,
      label: field,
      tagName: "span",
      visible: true,
      nearbyText: field,
      candidateLocators: [{ strategy: "text", value: field, exact: true, confidence: 0.9 }],
      dataHints: [],
      actionability: "NON_ACTIONABLE",
    },
    {
      id: "switch",
      type: "checkbox",
      tagName: "input",
      role: "switch",
      inputType: "checkbox",
      visible: true,
      candidateLocators: [],
      dataHints: [],
      actionability: "NATIVE_ACTIONABLE",
    },
  ],
  summary: { totalElements: 2, buttons: 0, links: 0, inputs: 1, selects: 0, tables: 0, dialogs: 0, headings: 0 },
});

test("plain caption resolves its unique nearby native switch and the click changes that switch", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <main>
        <section class="field">
          <span>¿No posee correo electrónico?</span>
          <div class="p-inputswitch"><input type="checkbox" role="switch"></div>
        </section>
        <section class="field"><span>Correo electrónico</span><input type="text"></section>
      </main>
    `);

    const result = await resolveActionTarget(page, snapshotFor("¿No posee correo electrónico?"), "¿No posee correo electrónico?", {
      actionType: "action_click",
      recordingActionType: "click",
      associatedField: "¿No posee correo electrónico?",
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.matchReason, "unique_checkable_control_in_caption_scope");
    assert.ok(result.certifiedTechnicalTarget, "the uniquely observed caption-to-switch relationship must carry its structural certificate into the plan");
    assert.equal(result.certifiedTechnicalTarget.certificationTier, 3);
    assert.equal(result.certifiedTechnicalTarget.locatorCandidates[0]?.strategy, "css");
    await result.locator!.click();
    assert.equal(await page.locator('input[type="checkbox"]').isChecked(), true);
  } finally {
    await browser.close();
  }
});

test("an exact authored caption can resolve its unique switch when the contract has no associatedField", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <main>
        <section class="field">
          <span>¿No posee correo electrónico?</span>
          <div class="p-inputswitch"><input id="no-email" type="checkbox" role="switch"></div>
        </section>
        <section class="field"><span>Correo electrónico</span><input type="text"></section>
      </main>
    `);

    const result = await resolveActionTarget(page, snapshotFor("¿No posee correo electrónico?"), "¿No posee correo electrónico?", {
      actionType: "action_click",
      recordingActionType: "click",
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.matchReason, "unique_checkable_control_in_caption_scope");
    await result.locator!.click();
    assert.equal(await page.locator("#no-email").isChecked(), true);
  } finally {
    await browser.close();
  }
});

test("duplicate exact captions do not authorize a switch click", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <section><span>¿No posee correo electrónico?</span><input type="checkbox" role="switch"></section>
      <section><span>¿No posee correo electrónico?</span><input type="checkbox" role="switch"></section>
    `);
    const result = await resolveActionTarget(page, snapshotFor("¿No posee correo electrónico?"), "¿No posee correo electrónico?", {
      actionType: "action_click",
      recordingActionType: "click",
      associatedField: "¿No posee correo electrónico?",
    });
    assert.notEqual(result.status, "resolved");
    assert.equal(await page.locator('input[type="checkbox"]').evaluateAll((nodes) => nodes.some((node) => (node as HTMLInputElement).checked)), false);
  } finally {
    await browser.close();
  }
});

test("a caption container with multiple switches fails closed", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <section><span>¿No posee correo electrónico?</span>
        <div><input type="checkbox" role="switch"><input type="checkbox" role="switch"></div>
      </section>
    `);
    const result = await resolveActionTarget(page, snapshotFor("¿No posee correo electrónico?"), "¿No posee correo electrónico?", {
      actionType: "action_click",
      recordingActionType: "click",
      associatedField: "¿No posee correo electrónico?",
    });
    assert.notEqual(result.status, "resolved");
    assert.equal(await page.locator('input[type="checkbox"]').evaluateAll((nodes) => nodes.some((node) => (node as HTMLInputElement).checked)), false);
  } finally {
    await browser.close();
  }
});
