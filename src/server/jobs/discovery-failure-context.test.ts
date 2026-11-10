import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseDiscoveryCaseFailure, readDiscoveryScenarioEvidence, targetOfStepText } from "./discovery-failure-context";
import { buildStructuredDefectDescription, mapReasonCodeToHuman } from "../services/defect-content-builder";

const steps = ["Abrir la aplicación", 'Ingresar "Usuario"', 'Presionar "Sí, cancelar"'];
const logs = [
  "[discovery:batch] Running case C57452",
  JSON.stringify({ type: "case_started", caseId: "C57452", steps }),
  JSON.stringify({ type: "case_started", caseId: "C99999", steps: ["otro"] }),
  JSON.stringify({ type: "case_finished", caseId: "C57452", status: "failed", failedAtStep: 3 }),
];

test("step target: the quoted text, else the whole step", () => {
  assert.equal(targetOfStepText('Presionar "Sí, cancelar"'), "Sí, cancelar");
  assert.equal(targetOfStepText("Abrir la aplicación"), "Abrir la aplicación");
});

test("failed step comes from the case's own started/finished events", () => {
  assert.deepEqual(parseDiscoveryCaseFailure(logs, "C57452"), { failedAtStep: 3, failedStepText: 'Presionar "Sí, cancelar"', failedTarget: "Sí, cancelar" });
  assert.deepEqual(parseDiscoveryCaseFailure(logs, "C1"), {}, "another case is never mixed in");
  assert.deepEqual(parseDiscoveryCaseFailure([JSON.stringify({ type: "case_finished", caseId: "C1", status: "passed" })], "C1"), {});
});

test("evidence.json written by discovery (steps numbered by `index`) gives expected result, screenshot and last good step", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qalab-disc-"));
  fs.writeFileSync(path.join(dir, "evidence.json"), JSON.stringify({
    expectedResult: "Se muestra el estado «Caso cancelado».",
    steps: [
      { index: 1, stepText: 'Ingresar "Usuario"', target: "Usuario", status: "passed", screenshotPath: "a.png" },
      { index: 2, stepText: 'Presionar "Nuevo caso"', target: "Nuevo caso", status: "passed", screenshotPath: "b.png" },
    ],
    finalScreenEvidence: { path: "final.png" },
  }));
  const evidence = readDiscoveryScenarioEvidence(dir);
  assert.equal(evidence.expectedResult, "Se muestra el estado «Caso cancelado».");
  assert.equal(evidence.screenshotPath, "final.png");
  assert.deepEqual(evidence.lastSuccessfulStep, { stepIndex: 2, action: 'Presionar "Nuevo caso"', target: "Nuevo caso", evidencePath: "b.png" });
  assert.deepEqual(readDiscoveryScenarioEvidence(path.join(dir, "missing")), {});
  fs.rmSync(dir, { recursive: true, force: true });
});

test("defect text names the failed step and points to the evidence instead of 'no evidence'", () => {
  const description = buildStructuredDefectDescription({
    scenarioId: "TR-CASE-57452",
    scenarioTitle: "Confirmar cancelación del caso",
    technicalContext: {
      reasonCode: "full_discovery_child_status_not_promoted",
      failedAtStep: 3, failedTarget: "Sí, cancelar",
      expectedResult: "Se muestra el estado «Caso cancelado».",
      screenshotPath: "final.png", evidenceDir: "dir",
      lastSuccessfulStep: { stepIndex: 2, target: "Nuevo caso" },
    },
  });
  assert.match(description, /Paso fallido:\nPaso 3: Sí, cancelar/);
  assert.match(description, /no se pudo validar el resultado esperado/);
  assert.match(description, /Resultado esperado:\nSe muestra el estado/);
  assert.match(description, /Evidencia técnica disponible\.\nÚltimo paso correcto: paso 2 \(Nuevo caso\)\./);
  assert.doesNotMatch(description, /No se registró evidencia/);
  assert.doesNotMatch(mapReasonCodeToHuman("full_discovery_child_status_not_promoted"), /código/);
});
