import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateConsolidatedEvidencePdf } from "./evidence-pdf-generator";
import { resolveEvidenceFormats } from "./evidence-output";
import type { EvidenceScenarioRecord } from "./evidence-types";

const TEMPLATE = path.resolve("templates/evidence/execution-evidence-template.docx");

type AsyncTestFn = () => void | Promise<void>;

async function test(label: string, fn: AsyncTestFn): Promise<void> {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

// 2x1 and 1x2 opaque PNGs: a landscape and a portrait "screenshot".
const LANDSCAPE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAEElEQVR4nGNgYGD4z8DAAAAGAAH0Lzn3AAAAAElFTkSuQmCC", "base64");
const PORTRAIT_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAIAAAAW4yFwAAAAEElEQVR4nGNgYGBgYGAAAAAKAAEY+nm0AAAAAElFTkSuQmCC", "base64");

function scenario(id: string, title: string, shots: string[]): EvidenceScenarioRecord {
  return {
    scenarioId: id,
    scenarioTitle: title,
    requirement: "Requerimiento de prueba",
    analyst: "QA <Automatización>",
    date: "29 de septiembre de 2026",
    status: "Exitoso",
    appSlug: "app",
    sectionSlug: "section",
    steps: shots.map((shot, index) => ({
      index,
      stepIndex: index,
      stepText: `Paso ${index + 1}`,
      status: "passed",
      screenshotPath: shot,
      timestamp: new Date().toISOString(),
    })),
  };
}

function countPdfPages(file: string): number {
  return (fs.readFileSync(file).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

async function main(): Promise<void> {
  console.log("\nevidence pdf generator");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-pdf-"));
  try {
    const landscape = path.join(dir, "landscape.png");
    const portrait = path.join(dir, "portrait.png");
    const landscapeCopy = path.join(dir, "landscape-copy.png");
    fs.writeFileSync(landscape, LANDSCAPE_PNG);
    fs.writeFileSync(portrait, PORTRAIT_PNG);
    fs.writeFileSync(landscapeCopy, LANDSCAPE_PNG);

    await test("renders cover + one page run per scenario, without Office", async () => {
      const output = path.join(dir, "evidencia.pdf");
      const result = await generateConsolidatedEvidencePdf(
        [
          // Landscape 2:1 → 576x288px: the table + first shot share a page, the second shot follows.
          scenario("S1", "Caso <uno> & más", [landscape, portrait]),
          // A byte-identical repeat is dropped, as Word's media dedupe does in the DOCX.
          scenario("S2", "Caso dos", [landscape, landscapeCopy]),
        ],
        TEMPLATE,
        output,
      );
      assert.strictEqual(result.success, true, result.error);
      assert.strictEqual(fs.readFileSync(output).subarray(0, 5).toString(), "%PDF-");
      // cover, S1 (table + landscape), S1 portrait (848px tall), S2 (table + one landscape)
      assert.strictEqual(countPdfPages(output), 4);
      assert.deepStrictEqual(fs.readdirSync(dir).filter(name => name.startsWith(".evidence-pdf")), []);
    });

    await test("fails clearly when the template is missing", async () => {
      const result = await generateConsolidatedEvidencePdf([scenario("S1", "x", [landscape])], path.join(dir, "none.docx"), path.join(dir, "x.pdf"));
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, "evidence_template_not_found");
    });

    await test("EVIDENCE_FORMAT selects the documents to generate", () => {
      assert.deepStrictEqual(resolveEvidenceFormats({ EVIDENCE_FORMAT: "pdf" }), ["pdf"]);
      assert.deepStrictEqual(resolveEvidenceFormats({ EVIDENCE_FORMAT: "docx" }), ["docx"]);
      assert.deepStrictEqual(resolveEvidenceFormats({ EVIDENCE_FORMAT: "both" }), ["pdf", "docx"]);
      assert.strictEqual(resolveEvidenceFormats({})[0], "pdf");
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

void main();
