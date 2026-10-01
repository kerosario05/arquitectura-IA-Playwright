import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import JSZip from "jszip";
import type { EvidenceScenarioRecord } from "./evidence-types";
import { buildEvidenceDocumentModel, type EvidenceDocumentModel } from "./evidence-document-model";

/**
 * Evidence document as PDF, rendered by the Chromium that Playwright already ships — no Office
 * on the server. The page reproduces the corporate Word template
 * (templates/evidence/execution-evidence-template.docx) and the layout Word COM produces from
 * it: cover page, then per scenario the "Caso de prueba / Fecha / Estado" table followed by the
 * screenshots, one scenario per page run.
 *
 * Every measure below comes from the template XML (twips/EMU → CSS px at 96 dpi) and was checked
 * against Word's own PDF export of a generated evidencia.docx. The logo is read from the .docx so
 * the template stays the single source for it; the fonts are the template's (Aptos, Aptos
 * Display, Calibri) shipped in templates/evidence/fonts so the server needs none installed.
 */

type PdfResult = { success: boolean; error?: string; outputPath?: string };

const FONT_FILES: Array<{ family: string; file: string; weight: number }> = [
  { family: "EvidenceAptos", file: "Aptos.ttf", weight: 400 },
  { family: "EvidenceAptosDisplay", file: "Aptos-Display.ttf", weight: 400 },
  { family: "EvidenceAptosDisplay", file: "Aptos-Display-Bold.ttf", weight: 700 },
  { family: "EvidenceCalibri", file: "Calibri-Bold.ttf", weight: 700 },
];

export async function generateConsolidatedEvidencePdf(
  scenarios: EvidenceScenarioRecord[],
  templatePath: string,
  outputPath: string,
): Promise<PdfResult> {
  if (!fs.existsSync(templatePath)) {
    return { success: false, error: "evidence_template_not_found" };
  }
  try {
    const model = await dropRepeatedScreenshots(buildEvidenceDocumentModel(scenarios));
    return await renderEvidencePdf(model, templatePath, outputPath);
  } catch (err: any) {
    return { success: false, error: `evidence_pdf_error: ${err?.message ?? err}` };
  }
}

export async function generateEvidencePdf(
  record: EvidenceScenarioRecord,
  templatePath: string,
  outputPath: string,
): Promise<PdfResult> {
  return generateConsolidatedEvidencePdf([record], templatePath, outputPath);
}

async function renderEvidencePdf(
  model: EvidenceDocumentModel,
  templatePath: string,
  outputPath: string,
): Promise<PdfResult> {
  const outputDir = path.dirname(outputPath);
  await fs.promises.mkdir(outputDir, { recursive: true });

  const stamp = `${Date.now()}-${process.pid}`;
  const logo = await extractTemplateLogo(templatePath);
  const logoPath = logo ? path.join(outputDir, `.evidence-pdf-logo-${stamp}${logo.ext}`) : null;
  const htmlPath = path.join(outputDir, `.evidence-pdf-${stamp}.html`);
  const fontsDir = resolveFontsDir(templatePath);
  const missingFontFiles = FONT_FILES.filter(font => !fs.existsSync(path.join(fontsDir, font.file)));
  if (missingFontFiles.length > 0) {
    console.log(`[evidence:pdf] warning fonts not loaded: ${missingFontFiles.map(font => font.file).join(", ")} (dir=${fontsDir})`);
  }

  const browser = await chromium.launch({ headless: true });
  try {
    if (logo && logoPath) await fs.promises.writeFile(logoPath, logo.data);
    await fs.promises.writeFile(
      htmlPath,
      buildEvidenceHtml(model, { logoUrl: logoPath ? pathToFileURL(logoPath).href : null, fontsDir }),
      "utf8",
    );

    const page = await browser.newPage();
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => (window as any).__layoutEvidence());
    if (layout.brokenImages.length > 0) {
      return { success: false, error: `evidence_pdf_images_not_loaded: ${layout.brokenImages.join(", ")}` };
    }
    if (layout.missingFonts.length > 0) {
      console.log(`[evidence:pdf] warning fonts not loaded: ${layout.missingFonts.join(", ")}`);
    }

    const tmpPdf = `${outputPath}.${stamp}.tmp`;
    await page.pdf({ path: tmpPdf, preferCSSPageSize: true, printBackground: true });
    await fs.promises.rename(tmpPdf, outputPath);

    console.log(
      `[evidence:pdf] generated path=${outputPath} pages=${layout.pages} scenarios=${model.scenarios.length} images=${layout.images}`,
    );
    return { success: true, outputPath };
  } finally {
    await browser.close().catch(() => undefined);
    for (const tmp of [htmlPath, logoPath]) {
      if (tmp) await fs.promises.unlink(tmp).catch(() => undefined);
    }
  }
}

/**
 * Word stores identical pictures once, and normalizeWordComDocxOutput then removes the repeated
 * embeds within a scenario — so in the DOCX a screenshot whose bytes repeat an earlier one of the
 * same scenario never shows. The PDF shows the same set.
 */
async function dropRepeatedScreenshots(model: EvidenceDocumentModel): Promise<EvidenceDocumentModel> {
  const scenarios = [];
  for (const scenario of model.scenarios) {
    const seen = new Set<string>();
    const images = [];
    for (const image of scenario.images) {
      const hash = createHash("sha1").update(await fs.promises.readFile(image.path)).digest("hex");
      if (seen.has(hash)) {
        console.log(`[evidence:pdf] skippedRepeatedScreenshot scenario=${scenario.scenarioId} path=${image.path}`);
        continue;
      }
      seen.add(hash);
      images.push(image);
    }
    scenarios.push({ ...scenario, images });
  }
  return { ...model, scenarios };
}

function resolveFontsDir(templatePath: string): string {
  const configured = process.env.EVIDENCE_PDF_FONTS_DIR?.trim();
  return configured ? path.resolve(configured) : path.join(path.dirname(templatePath), "fonts");
}

/** The logo the template's header and cover use (first image in word/media). */
async function extractTemplateLogo(templatePath: string): Promise<{ data: Buffer; ext: string } | null> {
  const zip = await JSZip.loadAsync(await fs.promises.readFile(templatePath));
  const media = Object.keys(zip.files)
    .filter(name => /^word\/media\/[^/]+\.(png|jpe?g)$/i.test(name))
    .sort();
  if (media.length === 0) return null;
  const data = await zip.file(media[0])!.async("nodebuffer");
  return { data, ext: path.extname(media[0]).toLowerCase() };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

export function buildEvidenceHtml(
  model: EvidenceDocumentModel,
  assets: { logoUrl: string | null; fontsDir: string },
): string {
  const fontFaces = FONT_FILES
    .filter(font => fs.existsSync(path.join(assets.fontsDir, font.file)))
    .map(font => `@font-face { font-family: "${font.family}"; font-weight: ${font.weight}; src: url("${pathToFileURL(path.join(assets.fontsDir, font.file)).href}"); }`)
    .join("\n");
  const logo = (cls: string) => assets.logoUrl ? `<img class="${cls}" src="${escapeHtml(assets.logoUrl)}" alt="">` : "";

  const scenarios = model.scenarios.map((scenario, index) => {
    const images = scenario.images
      .map(image => `<p class="shot"><img src="${escapeHtml(pathToFileURL(image.path).href)}" alt=""></p>`)
      .join("\n");
    return `
<section class="scenario" data-index="${index}">
  <table class="case">
    <colgroup><col style="width:294px"><col style="width:378px"></colgroup>
    <tr><td colspan="2">Caso de prueba: ${escapeHtml(scenario.title)}</td></tr>
    <tr><td>Fecha: ${escapeHtml(model.fecha)}</td><td>Estado: ${escapeHtml(scenario.status)}</td></tr>
  </table>
  ${images}
</section>`;
  }).join("\n");

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Evidencia Ejecución de pruebas</title>
<style>
${fontFaces}
@page { size: 8.5in 11in; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: "EvidenceAptos", "Aptos", sans-serif; font-size: 16px; color: #000; }
.page { position: relative; width: 816px; height: 1056px; overflow: hidden; break-after: page; }
.page:last-child { break-after: auto; }

/* Header/footer text boxes common to every page (header2/header3, footer2/footer3). */
.classification { position: absolute; font-family: "EvidenceAptos", "Aptos", sans-serif; font-size: 13.333px; color: #0000FF; white-space: nowrap; line-height: normal; }
.classification.top { left: 26.667px; top: 19.7px; }
.classification.bottom { left: 0; right: 0; bottom: 21.1px; text-align: center; }

/* Cover page (first-page header/footer + cover content). */
.cover-logo { position: absolute; left: 48px; top: 101.9px; width: 232px; height: 91.2px; }
.cover-title { position: absolute; left: 172.2px; top: 490.3px; width: 547.7px; padding: 4.8px 9.6px; font-family: "EvidenceAptosDisplay", "Aptos Display", sans-serif; font-size: 48px; line-height: normal; text-transform: uppercase; color: #2C7FCE; font-kerning: none; }
.cover-meta { position: absolute; left: 186.1px; top: 642px; width: 514.7px; height: 46.2px; border: 0.667px dashed #F2F2F2; font-size: 18.667px; line-height: normal; color: #808080; display: flex; flex-direction: column; justify-content: flex-end; }
.cover-meta div { position: relative; top: 1.3px; white-space: nowrap; }
.cover-dash { position: absolute; left: 446.9px; top: 742.3px; width: 253.7px; padding: 4.8px 9.6px; text-align: right; font-family: "EvidenceAptosDisplay", "Aptos Display", sans-serif; font-weight: 700; font-size: 24px; line-height: normal; color: #808080; }

/* Content pages (default header/footer). */
.header-title { position: absolute; right: 48px; top: 47.6px; font-size: 16px; line-height: normal; color: #156082; white-space: nowrap; }
.header-logo { position: absolute; left: 48px; top: 67.7px; width: 182.9px; height: 71.9px; }
.footer-title { position: absolute; right: 47.3px; bottom: 46.9px; font-size: 16px; line-height: normal; color: #0070C0; }
.body { position: absolute; left: 48px; width: 720px; top: var(--body-top); height: var(--body-height); }

table.case { margin-top: 7.2px; border-collapse: collapse; width: 672px; table-layout: fixed; font-family: "EvidenceCalibri", "Calibri", sans-serif; font-weight: 700; font-size: 18.667px; color: #808080; }
table.case td { border: 0.667px solid #BFBFBF; padding: 0 7.2px; line-height: normal; vertical-align: top; }
p.shot { margin: 0 0 10.667px 0; text-align: center; line-height: 0; }
p.shot img { display: inline-block; }
.first-gap { height: var(--first-gap); }
#source { display: none; }
</style>
</head>
<body>
<div class="page cover">
  <div class="classification top">Clasificación: Información Interna</div>
  ${logo("cover-logo")}
  <div class="cover-title">Formato evidencia EJECUCIÓN de pruebas</div>
  <div class="cover-meta"><div>Requerimiento: ${escapeHtml(model.requerimiento)}</div><div>Analista: ${escapeHtml(model.analista)}</div></div>
  <div class="cover-dash">-</div>
  <div class="classification bottom">Clasificación: Información Interna</div>
</div>
<template id="content-page">
  <div class="page content">
    <div class="classification top">Clasificación: Información Interna</div>
    <div class="header-title">Evidencia Ejecución de pruebas</div>
    ${logo("header-logo")}
    <div class="body"></div>
    <div class="footer-title">2da VP Calidad TI</div>
    <div class="classification bottom">Clasificación: Información Interna</div>
  </div>
</template>
<div id="source">
${scenarios}
</div>
<script>
// Word geometry, in CSS px: body area of a content page, and the empty paragraphs the template
// leaves before its {{ESCENARIOS_EVIDENCIA}} marker, which push the first scenario's table down.
const BODY_TOP = 140.4;
const BODY_BOTTOM = 988;
const FIRST_SCENARIO_GAP = 99.7;
// Screenshots end up 432pt wide in the Word document (normalizeZeroImageExtents), whatever their
// height. Word then clips a screenshot taller than the page; here it is shrunk to fit instead.
const IMAGE_WIDTH = 432 * 96 / 72;
const IMAGE_MAX_HEIGHT = BODY_BOTTOM - BODY_TOP;

window.__layoutEvidence = function () {
  document.documentElement.style.setProperty("--body-top", BODY_TOP + "px");
  document.documentElement.style.setProperty("--body-height", (BODY_BOTTOM - BODY_TOP) + "px");
  document.documentElement.style.setProperty("--first-gap", FIRST_SCENARIO_GAP + "px");

  const brokenImages = [];
  let imageCount = 0;
  for (const img of document.querySelectorAll("#source img")) {
    if (!img.complete || img.naturalWidth === 0) { brokenImages.push(decodeURIComponent(img.getAttribute("src") || "")); continue; }
    let width = IMAGE_WIDTH;
    let height = width * img.naturalHeight / img.naturalWidth;
    if (height > IMAGE_MAX_HEIGHT) { height = IMAGE_MAX_HEIGHT; width = height * img.naturalWidth / img.naturalHeight; }
    img.style.width = width + "px";
    img.style.height = height + "px";
    imageCount++;
  }

  const template = document.getElementById("content-page");
  let body = null;
  const newPage = () => {
    const page = template.content.firstElementChild.cloneNode(true);
    document.body.insertBefore(page, template);
    body = page.querySelector(".body");
    return body;
  };
  // Word moves a block to the next page when its content (not its space-after) would cross
  // the bottom of the body area, unless it is already the first block on the page.
  const place = (block) => {
    body.appendChild(block);
    const bottom = block.offsetTop + block.offsetHeight;
    if (bottom > body.clientHeight && body.children.length > 1) {
      newPage().appendChild(block);
    }
  };

  const sections = Array.from(document.querySelectorAll("#source .scenario"));
  sections.forEach((section, index) => {
    newPage();
    if (index === 0) {
      const gap = document.createElement("div");
      gap.className = "first-gap";
      body.appendChild(gap);
    }
    for (const block of Array.from(section.children)) place(block);
  });
  document.getElementById("source").remove();

  const missingFonts = Array.from(document.fonts)
    .filter(font => font.status === "error")
    .map(font => font.family + " " + font.weight);
  return { pages: document.querySelectorAll(".page").length, images: imageCount, brokenImages, missingFonts };
};
</script>
</body>
</html>`;
}
