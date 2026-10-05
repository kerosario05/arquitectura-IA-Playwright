import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { isMeaningfulEvidenceCellText, readScreenSignature, waitForVisualSettle } from "./screen-settle";

test("table completion ignores placeholder text and untouched numeric masks", () => {
  assert.equal(isMeaningfulEvidenceCellText("Indicar..."), false);
  assert.equal(isMeaningfulEvidenceCellText("000-000-0000"), false);
  assert.equal(isMeaningfulEvidenceCellText("Seleccione una cuenta"), false);
  assert.equal(isMeaningfulEvidenceCellText("cédula"), true);
  assert.equal(isMeaningfulEvidenceCellText("0"), true);
  assert.equal(isMeaningfulEvidenceCellText("5,000.00"), true);
});

test("a table row becomes an evidence checkpoint only after real cell values replace placeholders", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table><tbody><tr>
        <td>cédula</td><td>104-0014423-3</td><td>Indicar...</td>
        <td>Indicar...</td><td>000-000-0000</td>
      </tr></tbody></table>
    `);
    const partial = await readScreenSignature(page);
    assert.match(partial, /completeRows=0$/);

    await page.locator("tbody tr").evaluate(row => {
      row.querySelectorAll("td")[2].textContent = "Analista";
      row.querySelectorAll("td")[3].textContent = "30000";
      row.querySelectorAll("td")[4].textContent = "809-221-2121";
    });
    const complete = await readScreenSignature(page);
    assert.match(complete, /completeRows=1$/);
  } finally {
    await browser.close();
  }
});

test("a form becomes an evidence checkpoint only after every visible enabled field is filled", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<form>
      <input id="company"><input id="user"><input id="password">
      <input id="token1"><input id="token2">
    </form>`);
    for (const [field, value] of [["company", "company-value"], ["user", "user-value"], ["password", "password-value"], ["token1", "1"]]) {
      await page.locator(`#${field}`).fill(value);
    }
    assert.match(await readScreenSignature(page), /completeForms=0\|completeRows=0$/);

    await page.locator("#token2").fill("2");
    assert.match(await readScreenSignature(page), /completeForms=1\|completeRows=0$/);
  } finally {
    await browser.close();
  }
});

const SPINNER_PAGE = `
<style>@keyframes spin{to{transform:rotate(360deg)}} #s{width:24px;height:24px;border:3px solid #999;border-radius:50%;animation:spin 1s linear infinite}</style>
<div id="s"></div><div id="result"></div>
<script>setTimeout(()=>{document.getElementById('s').remove();document.getElementById('result').textContent='done'},700)</script>`;

test("waits for an infinite-animation spinner to disappear before reporting settled", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(SPINNER_PAGE);
    const result = await waitForVisualSettle(page, { timeoutMs: 5000, quietMs: 200 });
    assert.equal(result.settled, true);
    assert.ok(result.waitedMs >= 650, `waited only ${result.waitedMs}ms`);
    assert.equal(await page.locator("#s").count(), 0);
  } finally {
    await browser.close();
  }
});

test("an already static page settles after the quiet window only", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent("<p>static</p>");
    const result = await waitForVisualSettle(page, { timeoutMs: 5000, quietMs: 200 });
    assert.equal(result.settled, true);
    assert.ok(result.waitedMs < 2000);
  } finally {
    await browser.close();
  }
});

test("a spinner that never ends is bounded by the timeout and reported", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<style>@keyframes spin{to{transform:rotate(360deg)}}#s{width:24px;height:24px;animation:spin 1s linear infinite;background:#000}</style><div id="s"></div>');
    const result = await waitForVisualSettle(page, { timeoutMs: 800, quietMs: 200 });
    assert.equal(result.settled, false);
  } finally {
    await browser.close();
  }
});
