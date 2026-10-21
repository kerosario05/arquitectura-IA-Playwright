import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { EvidenceRecorder } from "./evidence-recorder";
import { buildEvidenceDocumentModel } from "./evidence-document-model";

test("opening frame survives unsettled loading as diagnostic and later images do not illustrate uncaptured steps", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "initial-evidence-"));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<h1>Opening</h1><div role="progressbar">Loading</div>');
    const recorder = new EvidenceRecorder({ appSlug: "fixture", sectionSlug: "fixture", scenarioId: "fixture", scenarioTitle: "Fixture", runId: "isolated", outputRoot: dir }, {
      outputRoot: dir, enabled: true, docxEnabled: false, settleTimeoutMs: 300, settleQuietMs: 20, finalSettleTimeoutMs: 1000,
    });
    assert.equal(await recorder.captureInitialScreen(page, "promoted_reuse", undefined, { alreadyReady: true }), true);
    await recorder.captureStep(page, 1, "Open application", { sourceStepIndex: 1 });
    await page.setContent('<h1>Next screen</h1><p>Complete</p>');
    await recorder.captureStep(page, 2, "Observe next screen", { sourceStepIndex: 2 });
    const record = await recorder.finish(page);
    assert.equal(record.initialScreenEvidence?.captured, true);
    assert.equal(record.initialScreenEvidence?.settled, false);
    assert.ok(record.initialScreenEvidence?.path && fs.existsSync(record.initialScreenEvidence.path));
    assert.ok(record.steps[0].screenshotPath, "the actual loading frame must be retained rather than discarded");
    assert.equal(record.steps[0].screenshotSettled, false);
    assert.notEqual(record.steps[0].screenshotPath, record.steps[1].screenshotPath, "a later screen must not replace the observed loading frame");
    assert.ok(record.steps[1].screenshotPath);
    const model = buildEvidenceDocumentModel([record]);
    assert.equal(model.scenarios[0].images[0].path, path.resolve(record.initialScreenEvidence!.path!));
    assert.equal(model.scenarios[0].images[0].stepText, "ESTADO INICIAL");
    assert.ok(model.scenarios[0].images.some(image => image.path === path.resolve(record.steps[0].screenshotPath!)), "observed frame crosses the report boundary");
  } finally {
    await browser.close();
    assert.equal(path.dirname(dir), os.tmpdir());
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
