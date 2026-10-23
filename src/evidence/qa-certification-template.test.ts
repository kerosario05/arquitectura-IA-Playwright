import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";
import { buildCertificationHtml, QA_CERTIFICATION_TEMPLATE, resolveCertificationTemplate } from "./qa-certification-template";
import { buildEvidenceDocumentModel } from "./evidence-document-model";
import { generateConsolidatedEvidencePdf } from "./evidence-pdf-generator";
import { generateEvidenceDocuments, resolveEvidenceFormats } from "./evidence-output";
import type { EvidenceScenarioRecord } from "./evidence-types";
import { buildJiraEvidenceScenarioRecords } from "../jira/jira-evidence";
import { RunEvidenceRecorder } from "./run-evidence-recorder";

function recording(): EvidenceScenarioRecord {
  return { scenarioId: "REC-01", scenarioTitle: "Consultar un producto", requirement: "QA-101 — Consulta de productos", analyst: "Ana Pérez", date: "23/10/2026", status: "Exitoso", appSlug: "kiosko", sectionSlug: "productos", expectedResult: "Se muestra el producto solicitado.", steps: [{ index: 1, stepText: 'Presionar "Productos"', status: "passed", timestamp: "2026-10-23T12:00:00Z" }] };
}

test("the retained Word template governs Jira and Recording, without invented approvals or placeholders", async () => {
  const jira = buildJiraEvidenceScenarioRecords([{ scenarioId: "QA-102-01", title: 'Transferir <importe>', sourceIssueKey: "QA-102", steps: ['Presionar "Continuar"', 'Validar "Comprobante"'], expectedResult: "Se presenta el comprobante.", preconditions: ["Sesión iniciada"] }], [{ scenarioId: "QA-102-01", status: "failed", failedAtStep: 2 }], { appSlug: "fenix", sectionSlug: "transferencias", analyst: "Ana Pérez" })[0];
  const inputs = [recording(), jira];
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const html = await buildCertificationHtml(page, buildEvidenceDocumentModel(inputs), inputs, QA_CERTIFICATION_TEMPLATE);
    await page.setContent(html);
    const text = await page.locator("body").innerText();
    for (const expected of ["CERTIFICACIÓN DE PRUEBAS", "Ana Pérez", "Consultar un producto", "Transferir <importe>", "Se presenta el comprobante.", "Sesión iniciada", "RECHAZADO", "Pendiente de aprobación.", "Estado", "No informado"]) assert.ok(text.includes(expected), expected);
    assert.ok(!text.includes("[Completar]"));
    assert.ok(!text.includes("CP-03"));
    assert.ok(!text.includes("Proceder con pase"));
    assert.equal(await page.locator("script").count(), 0);
    assert.equal(jira.expectedResult, "Se presenta el comprobante.");
    assert.deepEqual(jira.preconditions, ["Sesión iniciada"]);
  } finally { await browser.close(); }
});

test("PDF is the only generated delivery format, including obsolete DOCX configuration", async () => {
  for (const format of ["auto", "docx", "both", "pdf"]) assert.deepEqual(resolveEvidenceFormats({ EVIDENCE_FORMAT: format }), ["pdf"]);
  assert.equal(resolveCertificationTemplate("templates/evidence/execution-evidence-template.docx"), QA_CERTIFICATION_TEMPLATE);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-certification-"));
  try {
    const pdfPath = path.join(dir, "report.pdf");
    const docxPath = path.join(dir, "report.docx");
    const result = await generateEvidenceDocuments([recording()], QA_CERTIFICATION_TEMPLATE, { pdfPath, docxPath }, ["docx"]);
    assert.equal(result.pdf?.success, true, result.pdf?.error);
    assert.equal(result.docx, undefined);
    assert.equal((await fs.readFile(pdfPath)).subarray(0, 5).toString(), "%PDF-");
    await assert.rejects(fs.access(docxPath));
    assert.equal((await generateConsolidatedEvidencePdf([], QA_CERTIFICATION_TEMPLATE, path.join(dir, "empty.pdf"))).success, false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("run consolidation persists the initiating analyst and advertises only a PDF that exists", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qa-certification-run-"));
  try {
    const recorder = new RunEvidenceRecorder({appSlug: "fixture", sectionSlug: "section", runId: "synthetic-run", outputRoot: root, analystName: "Ana QA"}, {enabled: true, docxEnabled: true});
    await recorder.start();
    recorder.addScenario({...recording(), analyst: "Automatización"});
    const result = await recorder.finish();
    assert.equal(result.scenarios[0].analyst, "Ana QA");
    assert.ok(result.pdfPath);
    assert.equal(result.docxPath, undefined);
    assert.equal((await fs.readFile(result.pdfPath!)).subarray(0, 5).toString(), "%PDF-");
    const stored = JSON.parse(await fs.readFile(result.evidenceJsonPath!, "utf8"));
    assert.equal(stored.pdfPath, result.pdfPath);
    assert.equal(stored.scenarios[0].analyst, "Ana QA");
    const empty = new RunEvidenceRecorder({appSlug: "fixture", sectionSlug: "section", runId: "empty", outputRoot: root}, {enabled: true, docxEnabled: true});
    await empty.start();
    assert.equal((await empty.finish()).pdfPath, undefined);
  } finally { await fs.rm(root, {recursive: true, force: true}); }
});

test("real tall captures fit within the printable evidence area and keep their final caption", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-certification-tall-"));
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage({viewport: {width: 640, height: 800}});
    await page.setContent('<div style="height:2200px;background:linear-gradient(white,lightblue)">Synthetic tall capture</div>');
    const image = path.join(dir, "final.png");
    await page.screenshot({path: image, fullPage: true});
    const input = recording();
    input.steps[0].screenshotPath = image;
    input.finalScreenEvidence = {captured: true, path: image, capturedAt: "2026-10-23T12:00:00Z"};
    const html = await buildCertificationHtml(page, buildEvidenceDocumentModel([input]), [input], QA_CERTIFICATION_TEMPLATE);
    await page.setContent(html, {waitUntil: "load"});
    const bounds = await page.locator("figure img").boundingBox();
    assert.ok(bounds && bounds.height <= 760, "capture must fit the 570pt template evidence limit");
    assert.match(await page.locator("figure figcaption").innerText(), /Estado final/);
    const caption = await page.locator("figure figcaption").boundingBox();
    assert.ok(bounds && caption && caption.y >= bounds.y + bounds.height, "caption must not overlap the screenshot");
  } finally { await browser.close(); await fs.rm(dir, {recursive: true, force: true}); }
});
