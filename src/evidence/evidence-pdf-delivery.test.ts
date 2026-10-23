import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import { buildEvidenceHtml, generateConsolidatedEvidencePdf } from "./evidence-pdf-generator";
import { chromium } from "@playwright/test";
import { buildEvidenceDocumentModel } from "./evidence-document-model";
import type { EvidenceScenarioRecord } from "./evidence-types";

test("PDF embeds valid images on Windows paths exceeding 260 characters and keeps text-only sections beside captures", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdf-delivery-"));
  try {
    const nested = path.join(dir, "a".repeat(95), "b".repeat(95), "c".repeat(40));
    fs.mkdirSync(nested, { recursive: true });
    const imagePath = path.join(nested, "screenshot.png");
    assert.ok(imagePath.length > 260);
    fs.writeFileSync(imagePath, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64"));
    const scenario: EvidenceScenarioRecord = {
      scenarioId: "fixture", scenarioTitle: "Generic flow", requirement: "Fixture", analyst: "QA", date: "2026-10-20", status: "Exitoso", appSlug: "fixture", sectionSlug: "fixture",
      steps: ["Opening", "Selection", "Result"].map((title, index) => ({
        index: index + 1, stepIndex: index + 2, stepText: `Action ${index + 2}`, screenId: title, screenTitle: title, timestamp: "2026-10-20T00:00:00Z", status: "passed",
        ...(index === 2 ? { screenshotPath: imagePath } : {}),
      })),
    };
    assert.deepEqual(buildEvidenceDocumentModel([scenario]).scenarios[0].screens.flatMap(screen => screen.steps.map(step => step.number)), [2, 3, 4]);
    const output = path.join(dir, "report.pdf");
    const result = await generateConsolidatedEvidencePdf([scenario], path.resolve("templates/evidence/execution-evidence-template.docx"), output);
    assert.equal(result.success, true, result.error);
    const bytes = fs.readFileSync(output);
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
    assert.equal((bytes.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length, 4, "template cover, summary, case evidence, and conclusion");
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(buildEvidenceHtml(buildEvidenceDocumentModel([scenario]), { logoUrl: null, fontsDir: dir,
        imageDataUrls: { [path.resolve(imagePath)]: `data:image/png;base64,${fs.readFileSync(imagePath).toString("base64")}` },
      }));
      await page.evaluate(() => (window as any).__layoutEvidence());
      const caption = await page.locator(".shot span").boundingBox();
      const screenshot = await page.locator(".shot img").boundingBox();
      assert.ok(caption && screenshot && caption.height >= 13 && screenshot.y >= caption.y + caption.height, "caption is readable and does not overlap its image");
    } finally { await browser.close(); }
  } finally {
    assert.equal(path.dirname(dir), os.tmpdir());
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
