import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildJiraEvidenceScenarioRecords, jiraEvidenceScreenIdentityFields } from "./jira-evidence";
import { buildEvidenceDocumentModel } from "../evidence/evidence-document-model";

test("Jira evidence includes terminal outcomes and shows test data in step text", () => {
  const records = buildJiraEvidenceScenarioRecords([
    {
      scenarioId: "PREVIEW-001",
      title: "Autenticación",
      sourceIssueKey: "AA-88",
      steps: ['Ingresar "secreto123" en "Contraseña"', 'Validar que se muestre "Inicio"'],
      expectedResult: "El usuario inicia sesión",
    },
    {
      scenarioId: "PREVIEW-002",
      title: "Productos",
      sourceIssueKey: "AA-88",
      steps: ['Clic en "Explora nuestros productos"', 'Seleccionar el primer elemento visible del listado', 'Validar que se muestre "Productos"'],
      expectedResult: "La navegación redirige directamente a Productos",
    },
  ], [
    { scenarioId: "PREVIEW-001", status: "passed", initialScreenshotPath: ".artifacts/run/initial.png", stepScreenshotPaths: { "1": ".artifacts/run/first-step.png", "2": ".artifacts/run/second-step.png" }, evidenceScreenshotPath: ".artifacts/run/second-step.png" },
    { scenarioId: "PREVIEW-002", status: "failed", failedAtStep: 2, screenshotPath: ".artifacts/run/failed.png" },
  ], { appSlug: "kiosko", sectionSlug: "jira-aa-88", sectionName: "AA-88", date: "2026-10-09T12:00:00.000Z" });

  assert.equal(records.length, 2);
  assert.equal(records[0].status, "Exitoso");
  assert.equal(records[0].evidenceKind, "jira_semantic");
  assert.equal(records[0].date, "9 de octubre de 2026");
  assert.equal(records[0].initialScreenEvidence?.path, ".artifacts/run/initial.png");
  assert.equal(records[0].steps[0].stepText, 'Ingresar "secreto123" en "Contraseña"');
  assert.equal(records[0].steps[0].stepText.includes("secreto123"), true);
  assert.equal(records[0].steps[0].screenshotPath, ".artifacts/run/first-step.png");
  assert.equal(records[0].steps[1].screenshotPath, ".artifacts/run/second-step.png");
  assert.equal(records[0].finalScreenEvidence?.path, ".artifacts/run/second-step.png");
  assert.equal(records[1].steps.length, 2, "unsupported ordinal placeholder is absent from the executed flow");
  assert.equal(records[1].steps[0].status, "passed");
  assert.equal(records[1].steps[1].status, "failed");
  assert.equal(records[1].steps[1].screenshotPath, ".artifacts/run/failed.png");
  assert.equal(records[1].status, "Fallido");
});

test("evidence document retains the initial screen, each step screenshot, and the final capture", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-step-evidence-"));
  try {
    const first = path.join(tempDir, "step-1.png");
    const second = path.join(tempDir, "step-2.png");
    const initial = path.join(tempDir, "initial.png");
    await Promise.all([fs.writeFile(first, "image fixture"), fs.writeFile(second, "image fixture"), fs.writeFile(initial, "initial image fixture")]);
    const [record] = buildJiraEvidenceScenarioRecords([{
      scenarioId: "PREVIEW-001",
      title: "Consulta",
      sourceIssueKey: "AA-88",
      steps: ['Clic en "Consulta"', 'Validar que se muestre "Autenticación"'],
      expectedResult: "Se muestra Autenticación",
    }], [{
      scenarioId: "PREVIEW-001",
      status: "passed",
      initialScreenshotPath: initial,
      stepScreenshotPaths: { "1": first, "2": second },
      evidenceScreenshotPath: second,
    }], { appSlug: "kiosko", sectionSlug: "jira-aa-88" });

    const [scenario] = buildEvidenceDocumentModel([record]).scenarios;
    assert.equal(scenario.images.length, 3);
    assert.equal(scenario.images[0].path, initial);
    assert.equal(scenario.images[1].path, first);
    assert.equal(scenario.images[2].path, second);
    assert.deepEqual(
      scenario.screens[0].images.map(image => image.path),
      [initial, first],
      "the initial menu screenshot must precede the first action screenshot on the first screen",
    );
    assert.equal(scenario.finalIncluded, true);
    assert.equal(scenario.finalIsLast, true);
    assert.equal(scenario.screens.length, 2, "final checkpoint for a captured step must not create an empty screen section");
    assert.equal(scenario.screens[1].images.at(-1)?.path, second);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("Jira evidence keeps every step but one representative screenshot per observed screen visit", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-screen-evidence-"));
  try {
    const initial = path.join(tempDir, "initial.png");
    const screenshots = Object.fromEntries([1, 2, 3, 4].map((step) => [String(step), path.join(tempDir, `step-${step}.png`)]));
    await Promise.all([initial, ...Object.values(screenshots)].map((file) => fs.writeFile(file, "image fixture")));
    const [record] = buildJiraEvidenceScenarioRecords([{
      scenarioId: "HU-1:jira:1",
      title: "Journey across two screens",
      sourceIssueKey: "HU-1",
      steps: ["Open app", "Enter user", "Submit login", "Choose account"],
      expectedResult: "Account is selected",
    }], [{
      scenarioId: "HU-1:jira:1",
      status: "passed",
      initialScreenshotPath: initial,
      initialScreenIdentity: { id: "login", title: "Login" },
      stepScreenshotPaths: screenshots,
      stepScreenIdentities: {
        "1": { id: "login", title: "Login" },
        "2": { id: "login", title: "Login" },
        "3": { id: "dashboard", title: "Dashboard" },
        "4": { id: "accounts", title: "Accounts" },
      },
      evidenceScreenshotPath: screenshots["4"],
    }], { appSlug: "portal-a", sectionSlug: "jira-hu-1" });

    assert.equal(record.steps.length, 4, "all executed actions remain in the evidence document");
    assert.deepEqual(record.steps.map((step) => step.screenshotPath), [undefined, screenshots["2"], screenshots["3"], screenshots["4"]]);
    const model = buildEvidenceDocumentModel([record]).scenarios[0];
    assert.deepEqual(model.screens.map((screen) => screen.title), ["Login", "Dashboard", "Accounts"]);
    assert.deepEqual(model.screens.map((screen) => screen.steps.length), [2, 1, 1]);
    assert.deepEqual(model.screens[0].images.map((image) => image.path), [initial, screenshots["2"]]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("runner screen identities survive the outcome-to-document handoff", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-outcome-screen-handoff-"));
  try {
    const screenshots = Object.fromEntries([1, 2, 3].map((step) => [String(step), path.join(tempDir, `step-${step}.png`)]));
    await Promise.all(Object.values(screenshots).map((file) => fs.writeFile(file, "image fixture")));
    const identities = {
      initialScreenIdentity: { id: "login", title: "Login" },
      stepScreenIdentities: {
        "1": { id: "login", title: "Login" },
        "2": { id: "login", title: "Login" },
        "3": { id: "dashboard", title: "Dashboard" },
      },
    };
    const outcome = {
      scenarioId: "HU-transport:jira:1",
      status: "passed" as const,
      initialScreenshotPath: path.join(tempDir, "initial.png"),
      stepScreenshotPaths: screenshots,
      ...jiraEvidenceScreenIdentityFields(identities),
    };
    await fs.writeFile(outcome.initialScreenshotPath, "initial image fixture");
    const [record] = buildJiraEvidenceScenarioRecords([{
      scenarioId: "HU-transport:jira:1",
      title: "Login then dashboard",
      sourceIssueKey: "HU-transport",
      steps: ["Enter username", "Submit login", "View dashboard"],
      expectedResult: "Dashboard appears",
    }], [outcome], { appSlug: "sample-project", sectionSlug: "jira-hu-transport" });

    assert.deepEqual(record.steps.map((step) => step.screenId), ["login", "login", "dashboard"]);
    assert.deepEqual(record.steps.map((step) => step.screenshotPath), [undefined, screenshots["2"], screenshots["3"]]);
    assert.equal(record.initialScreenEvidence?.screenId, "login");
    assert.deepEqual(buildEvidenceDocumentModel([record]).scenarios[0].screens.map((screen) => screen.steps.length), [2, 1]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("Jira evidence groups all unexecuted tail steps without inventing application screens", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jira-unexecuted-evidence-"));
  try {
    const initial = path.join(tempDir, "initial.png");
    const first = path.join(tempDir, "step-1.png");
    const failed = path.join(tempDir, "failed.png");
    await Promise.all([initial, first, failed].map((file) => fs.writeFile(file, file)));
    const [record] = buildJiraEvidenceScenarioRecords([{
      scenarioId: "HU-2:jira:1",
      title: "Verify access",
      sourceIssueKey: "HU-2",
      steps: ["Open app", "Submit login", "Request code", "Enter code", "Continue"],
      expectedResult: "Access is denied",
    }], [{
      scenarioId: "HU-2:jira:1",
      status: "failed",
      failedAtStep: 2,
      initialScreenshotPath: initial,
      initialScreenIdentity: { id: "login", title: "Login" },
      stepScreenshotPaths: { "1": first },
      stepScreenIdentities: {
        "1": { id: "login", title: "Login" },
        "2": { id: "login-error", title: "Login error" },
      },
      screenshotPath: failed,
      evidenceScreenshotPath: failed,
    }], { appSlug: "fenix", sectionSlug: "jira-hu-2" });

    assert.deepEqual(record.steps.slice(2).map((step) => step.status), ["skipped", "skipped", "skipped"]);
    assert.deepEqual(record.steps.slice(2).map((step) => step.screenTitle), [
      "Pasos no ejecutados", "Pasos no ejecutados", "Pasos no ejecutados",
    ]);
    const model = buildEvidenceDocumentModel([record]).scenarios[0];
    assert.deepEqual(model.screens.map((screen) => screen.title), ["Login", "Login error", "Pasos no ejecutados"]);
    assert.deepEqual(model.screens.map((screen) => screen.steps.length), [1, 1, 3]);
    assert.equal(model.screens[2].images.length, 0, "unexecuted steps must not claim a captured application screen");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});
