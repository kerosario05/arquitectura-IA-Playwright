import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { PromotedSpecRuntime } from "./promoted-spec-runtime";
import { EvidenceRecorder } from "../../evidence/evidence-recorder";
import { buildEvidenceDocumentModel } from "../../evidence/evidence-document-model";

test("structural navigation clicks retain evidence before the first fill and reach the document model", async () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "structural-evidence-"));
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [appSlug, headings] of [["catalog-fixture", ["Catalog", "Product", "Identity"]], ["inventory-fixture", ["Inventory", "Request", "Contact"]]] as const) {
      const page = await browser.newPage();
      await page.setContent(`<h1>${headings[0]}</h1><button id="open" onclick="document.querySelector('h1').textContent='${headings[1]}'">Open</button><button id="continue" onclick="document.querySelector('h1').textContent='${headings[2]}'">Continue</button><input aria-label="Name">`);
      const recorder = new EvidenceRecorder({ appSlug, sectionSlug: "fixture", scenarioId: "case", scenarioTitle: "Fixture", runId: "local", outputRoot }, {
        enabled: true, outputRoot, docxEnabled: false, settleQuietMs: 50, settleTimeoutMs: 1500,
      });
      await recorder.captureInitialScreen(page, "promoted_reuse", undefined, { alreadyReady: true });
      const runtime: any = new PromotedSpecRuntime(page, { enabled: false });
      runtime.evidenceRecorder = recorder;
      for (const [index, id] of ["open", "continue"].entries()) {
        await recorder.prepareForAction(page);
        await runtime.clickPromotedTargetViaStructuralAuthority({ stepIndex: index + 2, target: `css:#${id}`, actionIntent: "click", expectedEffect: "none", structuralTarget: {
          targetType: "structural", validatedByInteraction: true, confidence: 1,
          locatorCandidates: [{ strategy: "css", value: `#${id}`, confidence: 1 }],
          structuralContext: { owner: { tag: "button" }, stableDirectAttributes: { id }, stableDescendants: [], semanticShape: [], deterministicStructuralIdentity: true, structuralIdentityMatchCount: 1 },
        } });
      }
      await page.getByLabel("Name").fill("Example");
      await recorder.captureStep(page, 3, 'Ingresar dato de prueba en "Name"', { sourceStepIndex: 4 });
      const record = await recorder.finish(page);
      assert.deepEqual(record.steps.filter(step => step.stepIndex !== undefined).map(step => step.stepIndex), [2, 3, 4]);
      for (const step of record.steps.filter(step => step.stepIndex === 2 || step.stepIndex === 3)) {
        assert.ok(step.screenshotPath && fs.existsSync(step.screenshotPath));
      }
      const document = buildEvidenceDocumentModel([record]);
      const screenshots = new Set(document.scenarios[0].images.map(image => path.resolve(image.path)));
      for (const step of record.steps.filter(step => step.stepIndex === 2 || step.stepIndex === 3)) assert.ok(screenshots.has(path.resolve(step.screenshotPath!)));
      assert.equal(document.scenarios[0].screens.flatMap(screen => screen.steps).filter(step => step.text.startsWith("Clic")).length, 2);
      await page.close();
    }
  } finally {
    await browser.close();
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test("an already satisfied structural checkbox records the step without toggling it", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<button id="consent" role="checkbox" aria-checked="true" onclick="this.dataset.clicked=\'yes\'">Consent</button>');
    const runtime: any = new PromotedSpecRuntime(page, { enabled: false });
    const captures: number[] = [];
    runtime.captureClickStep = async (_target: string, _status: string, _error: unknown, index: number) => { captures.push(index); };
    await runtime.clickPromotedTargetViaStructuralAuthority({ stepIndex: 5, target: "css:#consent", actionIntent: "click", expectedEffect: "none", checkState: "checked", structuralTarget: {
      targetType: "structural", validatedByInteraction: true, confidence: 1,
      locatorCandidates: [{ strategy: "css", value: "#consent", confidence: 1 }],
      structuralContext: { owner: { tag: "button" }, stableDirectAttributes: { id: "consent" }, stableDescendants: [], semanticShape: [], deterministicStructuralIdentity: true, structuralIdentityMatchCount: 1 },
    } });
    assert.deepEqual(captures, [5]);
    assert.equal(await page.locator("#consent").getAttribute("data-clicked"), null);
    assert.equal(await page.locator("#consent").getAttribute("aria-checked"), "true");
  } finally { await browser.close(); }
});
