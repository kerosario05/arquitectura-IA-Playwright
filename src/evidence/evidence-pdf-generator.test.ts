import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { generateConsolidatedEvidenceDocx } from "./evidence-docx-generator";
import { dropRepeatedScreenshots, generateConsolidatedEvidencePdf } from "./evidence-pdf-generator";
import { buildEvidenceDocumentModel } from "./evidence-document-model";
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

    await test("keeps the settled final screen when its screenshot belongs to a validation step", () => {
      const finalScreen = path.join(dir, "final-screen.png");
      fs.writeFileSync(finalScreen, PORTRAIT_PNG);
      const input = scenario("S-final", "Caso con pantalla final", [landscape, finalScreen]);
      input.steps[1].stepText = "Validar que se muestre Continuar";
      input.finalScreenEvidence = {
        captured: true,
        path: finalScreen,
        capturedAt: new Date().toISOString(),
      };

      const model = buildEvidenceDocumentModel([input]);
      const images = model.scenarios[0].images;
      assert.strictEqual(images.at(-1)?.path, path.resolve(finalScreen));
      assert.strictEqual(images.at(-1)?.stepText, "Pantalla final después del último paso");
    });

    await test("places the final checkpoint after later screens even when its screenId repeats", () => {
      const finalScreen = path.join(dir, "final-transfer.png");
      fs.writeFileSync(finalScreen, LANDSCAPE_PNG);
      const input = scenario("S-final-repeat", "Transferencia con segundo token", [landscape, portrait]);
      input.steps[0].screenId = "transfer-screen";
      input.steps[0].screenTitle = "Transferencias";
      input.steps[1].screenId = "token-screen";
      input.steps[1].screenTitle = "Token de Seguridad";
      input.steps.push({
        index: 3,
        stepIndex: 3,
        stepText: "Pantalla resultante tras el último paso",
        status: "passed",
        screenshotPath: finalScreen,
        screenId: "transfer-screen",
        screenTitle: "Transferencias",
        timestamp: new Date().toISOString(),
      });
      input.finalScreenEvidence = {
        captured: true,
        path: finalScreen,
        capturedAt: new Date().toISOString(),
      };

      const screens = buildEvidenceDocumentModel([input]).scenarios[0].screens;
      assert.strictEqual(screens.at(-1)?.title, "Transferencias");
      assert.strictEqual(screens.at(-1)?.images.at(-1)?.path, path.resolve(finalScreen));
      assert.strictEqual(screens.at(-1)?.steps.length, 0);
    });

    await test("keeps a same-title final checkpoint with its last screen instead of repeating the title", () => {
      const finalScreen = path.join(dir, "final-dashboard.png");
      fs.writeFileSync(finalScreen, PORTRAIT_PNG);
      const input = scenario("S-dashboard-final", "Login satisfactorio", [landscape]);
      input.steps[0].screenId = "dashboard";
      input.steps[0].screenTitle = "Pantalla dashboard";
      input.finalScreenEvidence = {
        captured: true,
        path: finalScreen,
        capturedAt: new Date().toISOString(),
      };

      const screens = buildEvidenceDocumentModel([input]).scenarios[0].screens;
      assert.strictEqual(screens.length, 1);
      assert.strictEqual(screens[0].title, "Pantalla dashboard");
      assert.strictEqual(screens[0].steps.length, 1);
      assert.strictEqual(screens[0].images.at(-1)?.path, path.resolve(finalScreen));
    });

    await test("preserves the initial page before the later completed form checkpoint", () => {
      const input = scenario("S-login", "Inicio de sesión", [landscapeCopy]);
      input.initialScreenEvidence = {
        status: "ready",
        captured: true,
        path: landscape,
        completedFormCheckpointPath: landscapeCopy,
        capturedAt: new Date().toISOString(),
      };

      const images = buildEvidenceDocumentModel([input]).scenarios[0].images;
      assert.strictEqual(images[0].path, path.resolve(landscape));
      assert.strictEqual(images[1].path, path.resolve(landscapeCopy));
    });

    await test("Jira and Recording attach the initial frame to the first screen", () => {
      const makeInput = (id: string, evidenceKind?: string) => {
        const input = scenario(id, id, [landscape, portrait]);
        input.evidenceKind = evidenceKind;
        input.steps[0].screenId = "screen-one";
        input.steps[0].screenTitle = "Primera pantalla";
        input.steps[1].screenId = "screen-two";
        input.steps[1].screenTitle = "Segunda pantalla";
        input.initialScreenEvidence = {
          status: "ready",
          captured: true,
          path: landscapeCopy,
          capturedAt: new Date().toISOString(),
        };
        return input;
      };
      const jiraScreens = buildEvidenceDocumentModel([makeInput("jira-initial", "jira_semantic")]).scenarios[0].screens;
      const recordingScreens = buildEvidenceDocumentModel([makeInput("recording-initial")]).scenarios[0].screens;
      const initialPath = path.resolve(landscapeCopy);
      assert.equal(jiraScreens.findIndex(screen => screen.images.some(image => path.resolve(image.path) === initialPath)), 0);
      assert.equal(recordingScreens.findIndex(screen => screen.images.some(image => path.resolve(image.path) === initialPath)), 0);
    });

    await test("keeps Jira's representative screenshot when it is attached to a validation step; Recording still omits it", () => {
      const makeInput = (id: string, evidenceKind?: string) => {
        const input = scenario(id, id, [landscape, portrait]);
        input.evidenceKind = evidenceKind;
        input.steps[0].screenId = "form#visit-1";
        input.steps[0].screenTitle = "Formulario";
        input.steps[1].stepText = 'Validar que se muestre "Confirmación"';
        input.steps[1].screenId = "confirmation#visit-1";
        input.steps[1].screenTitle = "Confirmación";
        return input;
      };

      const jira = buildEvidenceDocumentModel([makeInput("jira-validation-image", "jira_semantic")]).scenarios[0];
      const recording = buildEvidenceDocumentModel([makeInput("recording-validation-image")]).scenarios[0];
      assert.equal(jira.screens[1].images[0]?.path, path.resolve(portrait));
      assert.equal(recording.screens[1].images.length, 0, "Recording validation screenshot policy remains unchanged");
    });

    await test("describes a post-login dashboard validation as the main screen, not as a credential field", () => {
      const input = scenario("S-dashboard", "Dashboard", [landscape]);
      input.steps[0].stepText = 'Validar que se muestre "Contraseña*".';
      input.steps[0].target = "role:textbox|Contraseña*";
      input.steps[0].screenId = "authenticated-dashboard";
      input.steps[0].screenTitle = "Pantalla dashboard";

      const screens = buildEvidenceDocumentModel([input]).scenarios[0].screens;
      assert.strictEqual(screens[0].steps[0].text, "Validar que se muestre la pantalla principal.");
    });

    await test("renders cover + one page run per scenario, without Office", async () => {
      const output = path.join(dir, "evidencia.pdf");
      const firstScenario = scenario("S1", "Caso <uno> & más", [landscape, portrait]);
      const secondScenario = scenario("S2", "Caso dos", [landscape, landscapeCopy]);
      firstScenario.evidenceKind = "jira_semantic";
      secondScenario.evidenceKind = "jira_semantic";
      secondScenario.steps.forEach(step => {
        step.screenId = "same-screen-visit";
        step.screenTitle = "Una pantalla";
      });
      const result = await generateConsolidatedEvidencePdf(
        [firstScenario, secondScenario],
        TEMPLATE,
        output,
      );
      assert.strictEqual(result.success, true, result.error);
      assert.strictEqual(fs.readFileSync(output).subarray(0, 5).toString(), "%PDF-");
      assert.strictEqual(countPdfPages(output), 5, "template cover, summary, two cases, and conclusion");
      assert.deepStrictEqual(fs.readdirSync(dir).filter(name => name.startsWith(".evidence-pdf")), []);
    });

    await test("deduplicates identical Jira images while preserving every step in the evidence model", async () => {
      const output = path.join(dir, "jira-identical-steps.pdf");
      const input = scenario("Jira-steps", "Jira con dos pantallas iguales", [landscape, landscapeCopy]);
      input.evidenceKind = "jira_semantic";
      input.steps[0].screenId = "first-screen";
      input.steps[0].screenTitle = "Primera pantalla";
      input.steps[1].screenId = "second-screen";
      input.steps[1].screenTitle = "Segunda pantalla";
      const logs: string[] = [];
      const originalLog = console.log;
      console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
      try {
        const result = await generateConsolidatedEvidencePdf([input], TEMPLATE, output);
        assert.strictEqual(result.success, true, result.error);
      } finally {
        console.log = originalLog;
      }
      assert.ok(logs.some(line => /generated .*scenarios=1 images=1/.test(line)), logs.join("\n"));
      assert.equal(countPdfPages(output), 4, "template cover, summary, case and conclusion");
      const pdfModel = await dropRepeatedScreenshots(buildEvidenceDocumentModel([input]));
      const screens = pdfModel.scenarios[0].screens;
      assert.equal(pdfModel.scenarios[0].images.length, 1);
      assert.equal(screens.length, 2, "logical screens stay separate when their pixels are identical");
      assert.deepEqual(screens.map(screen => screen.title), ["Primera pantalla", "Segunda pantalla"]);
      assert.deepEqual(screens.map(screen => screen.steps.length), [1, 1], "each action remains under the screen where it was observed");
      assert.deepEqual(screens.map(screen => screen.images.length), [1, 0], "the identical screenshot is embedded only once");
    });

    await test("Jira keeps one representative image per screen visit and all steps on one page", async () => {
      const output = path.join(dir, "jira-one-image-per-screen.pdf");
      const input = scenario("Jira-one-screen", "Jira con dos pasos en una pantalla", [landscape, landscapeCopy]);
      input.evidenceKind = "jira_semantic";
      input.steps.forEach(step => {
        step.screenId = "login-screen#visit-1";
        step.screenTitle = "Inicio de sesión";
      });
      input.initialScreenEvidence = {
        status: "ready",
        captured: true,
        path: portrait,
        screenId: "login-screen",
        screenTitle: "Inicio de sesión",
        capturedAt: new Date().toISOString(),
      };

      const model = buildEvidenceDocumentModel([input]).scenarios[0];
      assert.equal(model.screens.length, 1);
      assert.equal(model.screens[0].steps.length, 2);

      const result = await generateConsolidatedEvidencePdf([input], TEMPLATE, output);
      assert.equal(result.success, true, result.error);
      assert.equal(countPdfPages(output), 4, "cover, summary, case and conclusion");
      const pdfModel = await dropRepeatedScreenshots(buildEvidenceDocumentModel([input]));
      assert.equal(pdfModel.scenarios[0].images.length, 1);
      assert.equal(pdfModel.scenarios[0].screens[0].images.length, 1);
      assert.equal(pdfModel.scenarios[0].screens[0].steps.length, 2);
    });

    await test("Jira and Recording retain portrait captures with identical certification sections", async () => {
      const makeLongScreen = (id: string, evidenceKind?: string) => {
        const input = scenario(id, id, Array.from({ length: 12 }, () => portrait));
        input.evidenceKind = evidenceKind;
        input.steps.forEach((step, index) => {
          step.stepText = `Paso ${index + 1}: completar la acción y comprobar el resultado en esta pantalla`;
          step.screenId = "single-screen";
          step.screenTitle = "Pantalla con captura alta";
        });
        return input;
      };

      const jiraOutput = path.join(dir, "jira-tall-screen.pdf");
      const jira = await generateConsolidatedEvidencePdf([makeLongScreen("jira-tall", "jira_semantic")], TEMPLATE, jiraOutput);
      assert.equal(jira.success, true, jira.error);
      assert.equal(countPdfPages(jiraOutput), 4, "cover, summary, case details with the tiny fixture image, and conclusion");

      const recordingOutput = path.join(dir, "recording-tall-screen.pdf");
      const recording = await generateConsolidatedEvidencePdf([makeLongScreen("recording-tall")], TEMPLATE, recordingOutput);
      assert.equal(recording.success, true, recording.error);
      assert.equal(countPdfPages(recordingOutput), 4, "Recording uses the same template pagination as Jira");
    });

    await test("deduplicates Recording screenshots without moving its steps between screen blocks", async () => {
      const input = scenario("recording-identical-steps", "Recording con dos pantallas iguales", [landscape, landscapeCopy]);
      input.steps[0].screenId = "screen-one";
      input.steps[1].screenId = "screen-two";
      const model = buildEvidenceDocumentModel([input]);
      const result = await dropRepeatedScreenshots(model);
      const screens = result.scenarios[0].screens;
      assert.equal(result.scenarios[0].images.length, 1);
      assert.equal(screens.length, 2);
      assert.deepEqual(screens.map(screen => screen.steps.length), [1, 1]);
      assert.deepEqual(screens.map(screen => screen.images.length), [1, 0]);
    });

    await test("fails clearly when the template is missing", async () => {
      const result = await generateConsolidatedEvidencePdf([scenario("S1", "x", [landscape])], path.join(dir, "none.docx"), path.join(dir, "x.pdf"));
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, "evidence_template_not_found");
    });

    await test("does not create a blank PDF or DOCX when no scenarios were consolidated", async () => {
      const pdfPath = path.join(dir, "empty.pdf");
      const docxPath = path.join(dir, "empty.docx");
      const [pdf, docx] = await Promise.all([
        generateConsolidatedEvidencePdf([], TEMPLATE, pdfPath),
        generateConsolidatedEvidenceDocx([], TEMPLATE, docxPath),
      ]);
      assert.strictEqual(pdf.success, false);
      assert.strictEqual(pdf.error, "evidence_scenarios_empty");
      assert.strictEqual(docx.success, false);
      assert.strictEqual(docx.error, "evidence_scenarios_empty");
      assert.strictEqual(fs.existsSync(pdfPath), false);
      assert.strictEqual(fs.existsSync(docxPath), false);
    });

    await test("EVIDENCE_FORMAT selects the documents to generate", () => {
      assert.deepStrictEqual(resolveEvidenceFormats({ EVIDENCE_FORMAT: "pdf" }), ["pdf"]);
      assert.deepStrictEqual(resolveEvidenceFormats({ EVIDENCE_FORMAT: "docx" }), ["pdf"]);
      assert.deepStrictEqual(resolveEvidenceFormats({ EVIDENCE_FORMAT: "both" }), ["pdf"]);
      assert.strictEqual(resolveEvidenceFormats({})[0], "pdf");
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

void main();
