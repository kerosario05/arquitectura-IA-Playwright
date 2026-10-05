import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { chromium } from "@playwright/test";
import { EvidenceRecorder } from "./evidence-recorder";
import { prependInitialScreenImage } from "./evidence-docx-generator";

const LOGIN_PAGE = `
<h1 id="title">Login</h1>
<input id="a" placeholder="user"><input id="b" placeholder="pass"><input id="c" placeholder="otp">
<button id="go" onclick="
  document.getElementById('title').textContent='Home';
  document.querySelectorAll('input,#go').forEach(e=>e.remove());
  setTimeout(()=>{document.body.insertAdjacentHTML('beforeend','<p id=ready>welcome</p>')},500);
">Entrar</button>`;

test("one image per screen: fills share the pre-submit image, final screen is appended", async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-per-screen-"));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(LOGIN_PAGE);
    const recorder = new EvidenceRecorder(
      { appSlug: "app", sectionSlug: "sec", scenarioId: "S1", scenarioTitle: "t", runId: "run" },
      { outputRoot, docxEnabled: false, settleQuietMs: 150, settleTimeoutMs: 3000 },
    );
    await recorder.captureInitialScreen(page, "promoted_reuse");
    await page.fill("#a", "u");
    await recorder.captureStep(page, 1, 'Ingresar "u" en "user"');
    await page.fill("#b", "p");
    await recorder.captureStep(page, 2, 'Ingresar "p" en "pass"');
    await page.fill("#c", "1");
    await recorder.captureStep(page, 3, 'Ingresar "1" en "otp"');
    await page.click("#go");
    await recorder.captureStep(page, 4, 'Presionar "Entrar"');
    const record = await recorder.finish(page);

    const paths = record.steps.map((step) => step.screenshotPath);
    assert.ok(paths.slice(0, 4).every((p) => p && p === paths[0]), `steps 1-4 must share one image: ${JSON.stringify(paths)}`);
    assert.equal(record.steps.length, 5, "closing entry with the resulting screen");
    assert.match(String(record.initialScreenEvidence?.completedFormCheckpointPath), /step-003-ingresar/);
    assert.ok(fs.existsSync(String(record.initialScreenEvidence?.completedFormCheckpointPath)));
    const reportImages = prependInitialScreenImage(record, []);
    assert.deepEqual(reportImages.map(image => path.resolve(image.path)), [
      path.resolve(String(record.initialScreenEvidence?.completedFormCheckpointPath)),
    ]);
    assert.match(String(record.steps[4].screenshotPath), /final-state\.png$/);
    assert.notEqual(record.steps[4].screenshotPath, paths[0]);
    const savedScreenshots = fs.readdirSync(path.dirname(String(paths[0])));
    assert.ok(!savedScreenshots.some((name) => /step-001|step-002/.test(name)));
    assert.ok(savedScreenshots.some((name) => /step-003-ingresar/.test(name)));
  } finally {
    await browser.close();
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});
