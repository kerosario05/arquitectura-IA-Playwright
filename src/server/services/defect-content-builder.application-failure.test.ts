import assert from "node:assert/strict";
import test from "node:test";
import { classifyPreviewFailure } from "../../cli/discovery-preview";
import { buildDefectTitle, buildStructuredDefectDescription, mapReasonCodeToHuman } from "./defect-content-builder";

/**
 * Recording cd227d7b ("roque 7"): every step ran, the final "Generar Turno" got
 * `POST /api/turns/generate` -> 400 from the application. The defect must read as an application
 * failure, never as an automation/locator problem ("No se encontró ...").
 */

const technicalContext = {
  reasonCode: "application_http_error",
  rawError: "Falla del aplicativo: POST /api/turns/generate respondió HTTP 400",
  failureOrigin: "application",
  failedAtStep: 18,
  failedTarget: "Generar Turno",
};

test("the preview classifies an application rejection as application_error", () => {
  const result = classifyPreviewFailure({
    status: "failed",
    failedReason: "application_http_error",
    failedTargets: [],
    failedAssertions: [],
  } as any);
  assert.deepEqual(result, { failureType: "application_error", phase: "application_response" });
});

test("a visible application error is classified the same way", () => {
  const result = classifyPreviewFailure({ status: "failed", failedReason: "application_error_visible" } as any);
  assert.equal(result.failureType, "application_error");
});

test("an automation failure is not classified as an application failure", () => {
  const result = classifyPreviewFailure({ status: "failed", failedReason: "RECORDED_POSTCONDITION_NOT_REACHED", failedTargets: ["Tarjeta"] } as any);
  assert.notEqual(result.failureType, "application_error");
});

test("the human summary names the application and the rejected request", () => {
  const summary = mapReasonCodeToHuman(technicalContext.reasonCode, technicalContext.rawError);
  assert.match(summary, /^Falla del aplicativo: POST \/api\/turns\/generate respondió HTTP 400\./);
  assert.match(summary, /el error lo devolvió la aplicación/);
});

test("the defect title never says the actioned target was not found", () => {
  const title = buildDefectTitle({ scenarioId: "REC-CD227D7B-01", scenarioTitle: "roque 7", severity: "high", technicalContext });
  assert.equal(title, '[Alta] Falla del aplicativo al accionar "Generar Turno": POST /api/turns/generate respondió HTTP 400 (paso 18) — roque 7');
  assert.doesNotMatch(title, /No se encontró/);
});

test("the structured description's 'Qué pasó' carries the application failure", () => {
  const description = buildStructuredDefectDescription({ scenarioId: "REC-CD227D7B-01", scenarioTitle: "roque 7", technicalContext });
  assert.match(description, /Qué pasó:\nFalla del aplicativo: POST \/api\/turns\/generate respondió HTTP 400\./);
});
