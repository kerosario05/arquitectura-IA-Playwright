import assert from "node:assert/strict";
import test from "node:test";
import { pickDefectIssueType } from "./jira.client";
import { buildDefectTitle, buildStructuredDefectDescription, readableStep } from "../server/services/defect-content-builder";

test("defect issue type: Bug when offered, else Task, else Story; never Epic or a sub-task", () => {
  assert.equal(pickDefectIssueType([{ name: "Story" }, { name: "Bug" }]), "Bug");
  assert.equal(pickDefectIssueType([{ name: "Epic" }, { name: "Story" }, { name: "Task" }]), "Task");
  assert.equal(pickDefectIssueType([{ name: "Epic" }, { name: "Story" }]), "Story", "GDD offers only Epic and Story");
  assert.equal(pickDefectIssueType([{ name: "Epic" }, { name: "Sub-task", subtask: true }, { name: "Spike" }]), "Spike");
  assert.equal(pickDefectIssueType([]), "Bug", "nothing known: keep the old default");
});

test("failed step reads as the action the step asked for", () => {
  assert.equal(readableStep('Ingresar "Numero de Identificacion"'), "Ingresar Numero de Identificacion");
  assert.equal(readableStep(undefined), undefined);
  const tc = { reasonCode: "x", failedAtStep: 10, failedTarget: "Numero de Identificacion", failedStepText: 'Ingresar "Numero de Identificacion"' };
  assert.match(buildStructuredDefectDescription({ scenarioId: "s", scenarioTitle: "t", technicalContext: tc }), /Paso fallido:\nPaso 10: Ingresar Numero de Identificacion/);
  assert.match(buildDefectTitle({ scenarioId: "s", scenarioTitle: "Caso", severity: "medium", technicalContext: tc }), /Falló el paso: Ingresar Numero de Identificacion \(paso 10\)/);
});
