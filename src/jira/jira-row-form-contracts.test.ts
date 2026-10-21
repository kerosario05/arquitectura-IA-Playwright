import test from "node:test";
import assert from "node:assert/strict";
import { jiraRowFormContractErrors, JIRA_ROW_FORM_REQUIREMENTS } from "./jira-row-form-contracts";
import { normalizeJiraAssertionSyntax } from "./jira-assertion-syntax";
import { jiraGenerationContractErrors } from "./jira-generation-contract";
import type { JiraIssueSource } from "../scenarios/scenario-types";

// Synthetic story: generic list + form criteria, no project data.
const issue = { acceptanceCriteria: [
  "AC2 — Al guardar los nuevos datos se muestra el mensaje exacto Guardado correctamente. y el nombre y el alias aparecen en la lista.",
  "AC3 — Al buscar por nombre o alias se filtra la lista y se mantiene visible la fila coincidente.",
  "AC4 — Si se registra una cuenta ya existente o el alias Atlas, se muestra el mensaje exacto Ya existe un registro. y el formulario Alta permanece abierto.",
].join("\n") } as JiraIssueSource;
const draft = (refs: string[], steps: string[], observedUi?: unknown) => ({ title: "t", expectedResult: "r", acceptanceCriteriaRefs: refs, steps, ...(observedUi ? { observedUi } : {}) });
const errorsOf = (...args: Parameters<typeof draft>) => jiraRowFormContractErrors(draft(...args), issue);

test("row cells: all required values must be asserted in one row step", () => {
  const entry = ['Ingresar "Ana Perez" en "Nombre"', 'Ingresar "anita" en "Alias"', 'Ingresar "00112233" en "Numero de cuenta"', 'Presionar "Guardar"'];
  assert.deepEqual(errorsOf(["AC2"], [...entry, 'Validar que la fila contenga "Ana Perez" y "anita"']), []);
  assert.deepEqual(errorsOf(["AC2"], [...entry, 'Validar que se muestre "Ana Perez"', 'Validar que se muestre "anita"']), ["JIRA_ROW_CELLS_UNBOUND"]);
  assert.deepEqual(errorsOf(["AC2"], [...entry, 'Validar que la fila contenga "Ana Perez"']), ["JIRA_ROW_CELLS_UNBOUND"]);
  // Wired into the shared contract gate.
  assert.ok(jiraGenerationContractErrors(draft(["AC2"], [...entry, 'Validar que se muestre "anita"']), issue).includes("JIRA_ROW_CELLS_UNBOUND"));
});

test("normalized field-pair row wording binds both Name and Alias; a one-field row stays unbound", () => {
  const entry = ['Ingresar "Ana Perez" en "Nombre"', 'Ingresar "anita" en "Alias"', 'Presionar "Guardar"'];
  for (const raw of ['Validar que el nombre y el alias ingresados aparezcan en una misma fila de "Lista"', 'Validar que el nombre y el alias del beneficiario coincidente aparezcan juntos en una fila de "Lista"', 'Validar que el nombre y el alias del beneficiario no coincidente aparezcan juntos en una fila de "Lista"']) {
    assert.deepEqual(errorsOf(["AC2"], [...entry, normalizeJiraAssertionSyntax(raw)]), []);
  }
  assert.deepEqual(errorsOf(["AC2"], [...entry, 'Validar que la fila coincidente con el nombre ingresado aparezca en "Lista"']), ["JIRA_ROW_CELLS_UNBOUND"]);
  assert.deepEqual(errorsOf(["AC2"], [...entry, 'Validar que se muestre "Ana Perez"', 'Validar que se muestre "anita"']), ["JIRA_ROW_CELLS_UNBOUND"]);
});

test("filter effect: filter stays fail-closed when no non-matching row was observed", () => {
  assert.deepEqual(errorsOf(["AC3"], ['Ingresar "Ana" en "Buscar"', 'Validar que se muestre "Ana Perez"', 'Validar que no se muestre "Luis Gomez"']), ["JIRA_FILTER_EFFECT_EVIDENCE_REQUIRED"]);
});

test("filter effect: a non-matching row seen before must be absent after; no evidence blocks", () => {
  const rows = { rows: [["Ana Perez", "anita"], ["Luis Gomez", "lucho"]] };
  const proven = ['Ingresar "Ana" en "Buscar"', 'Validar que se muestre "Ana Perez"', 'Validar que no se muestre "Luis Gomez"'];
  assert.deepEqual(errorsOf(["AC3"], proven, rows), []);
  // Matching row only: filter effect unproven.
  assert.deepEqual(errorsOf(["AC3"], proven.slice(0, 2), rows), ["JIRA_FILTER_EFFECT_UNPROVEN"]);
  // Absence of a row that was never observed is not an effect.
  assert.deepEqual(errorsOf(["AC3"], ['Ingresar "Ana" en "Buscar"', 'Validar que no se muestre "Otro Nombre"'], rows), ["JIRA_FILTER_EFFECT_UNPROVEN"]);
  // No observed rows and no earlier visibility assertion: blocked with a requirement.
  assert.deepEqual(errorsOf(["AC3"], ['Ingresar "Ana" en "Buscar"', 'Validar que no se muestre "Luis Gomez"']), ["JIRA_FILTER_EFFECT_EVIDENCE_REQUIRED"]);
  // An earlier visibility assertion on a non-matching row is enough evidence without observedUi.
  assert.deepEqual(errorsOf(["AC3"], ['Validar que se muestre "Luis Gomez"', ...proven.slice(0, 1), 'Validar que no se muestre "Luis Gomez"']), []);
});

test("dialog anchor: open/stays-open is tied to the dialog container or an exclusive label", () => {
  const steps = (label: string) => ['Ingresar "Atlas" en "Alias"', 'Presionar "Guardar"', 'Validar que se muestre "Ya existe un registro"', `Validar que se muestre "${label}"`];
  const dialog = { dialog: { name: "Nuevo registro", exclusiveLabels: ["Numero de cuenta"] } };
  assert.ok(!errorsOf(["AC4.2"], steps("Numero de cuenta"), dialog).some(code => code.startsWith("JIRA_DIALOG")));
  assert.ok(!errorsOf(["AC4.2"], steps("Nuevo registro"), dialog).some(code => code.startsWith("JIRA_DIALOG")));
  // Text that also exists behind the dialog (page button / shared label) does not prove it is open.
  assert.deepEqual(errorsOf(["AC4.2"], steps("Alta"), dialog), ["JIRA_DIALOG_ANCHOR_MISSING"]);
  // No observed dialog: the form's own entered field label is the exclusive anchor; page text still fails closed.
  assert.deepEqual(errorsOf(["AC4.2"], steps("Alta")), ["JIRA_DIALOG_ANCHOR_MISSING"]);
  assert.ok(!errorsOf(["AC4.2"], steps("Alias")).some(code => code.startsWith("JIRA_DIALOG")));
  // A filter/search label or text quoted before the form's first entry is not form evidence.
  assert.deepEqual(errorsOf(["AC4.2"], ['Validar que se muestre "Nombre"', 'Ingresar "Zoe" en "Nombre"', 'Presionar "Guardar"', 'Validar que se muestre "Nombre"']), ["JIRA_DIALOG_ANCHOR_EVIDENCE_REQUIRED"]);
  assert.deepEqual(errorsOf(["AC4.2"], ['Ingresar "Ana" en "Buscar"', 'Validar que se muestre "Buscar"']), ["JIRA_DIALOG_ANCHOR_EVIDENCE_REQUIRED"]);
});

test("dialog anchor: labels asserted after the opener click are form labels, not background", () => {
  const steps = ['Presionar "Añadir"', 'Validar que se muestre "Nombre"', 'Ingresar "Zoe" en "Nombre"', 'Presionar "Guardar"', 'Validar que se muestre "Ya existe un registro"', 'Validar que se muestre "Nombre"'];
  assert.ok(!errorsOf(["AC4.2"], steps).some(code => code.startsWith("JIRA_DIALOG")));
  // Text asserted before the opener is still background.
  assert.deepEqual(errorsOf(["AC4.2"], ['Validar que se muestre "Nombre"', 'Presionar "Añadir"', 'Ingresar "Zoe" en "Nombre"', 'Presionar "Guardar"', 'Validar que se muestre "Nombre"']), ["JIRA_DIALOG_ANCHOR_EVIDENCE_REQUIRED"]);
});

test("row cells: executable matching-row wording binds fills by label, not by literal value", () => {
  const entry = ['Ingresar "Ana Perez" en "Nombre del beneficiario"', 'Ingresar "anita" en "Alias"', 'Presionar "Guardar"'];
  const row = (wording: string) => errorsOf(["AC2"], [...entry, wording]);
  assert.deepEqual(row('Validar que la fila coincidente del beneficiario con su alias permanezca visible en la lista Destinatarios guardados'), []);
  // Alias label not reflected in the wording stays unbound; plain visibility never binds.
  assert.deepEqual(row('Validar que la fila coincidente del beneficiario permanezca visible en la lista Destinatarios guardados'), ["JIRA_ROW_CELLS_UNBOUND"]);
  assert.deepEqual(row('Validar que la fila del beneficiario con su alias permanezca visible'), ["JIRA_ROW_CELLS_UNBOUND"]);
});

test("observed duplicate is a precondition; other fields stay clear of seed data", () => {
  const seed = { existingValues: ["Atlas", "0099887766"] };
  const message = 'Validar que se muestre "Ya existe un registro"';
  const dialog = { dialog: { exclusiveLabels: ["Numero de cuenta"] } };
  const open = 'Validar que se muestre "Numero de cuenta"';
  const ok = ['Ingresar "Zoe" en "Nombre"', 'Ingresar "0011" en "Numero de cuenta"', 'Ingresar "Atlas" en "Alias"', 'Presionar "Guardar"', message, open];
  assert.deepEqual(errorsOf(["AC4"], ok, { ...seed, ...dialog }), []);
  // Fabricated initial alta of a value that is already seed: redundant setup.
  const redundant = ['Ingresar "Zoe" en "Nombre"', 'Ingresar "Atlas" en "Alias"', 'Presionar "Guardar"', 'Ingresar "Atlas" en "Alias"', 'Presionar "Guardar"', message, open];
  assert.deepEqual(errorsOf(["AC4"], redundant, { ...seed, ...dialog }), ["JIRA_DUPLICATE_SETUP_REDUNDANT"]);
  // Duplicating the alias while reusing a seed account may be rejected for the account instead.
  const collide = ['Ingresar "Zoe" en "Nombre"', 'Ingresar "0099887766" en "Numero de cuenta"', 'Ingresar "Atlas" en "Alias"', 'Presionar "Guardar"', message, open];
  assert.deepEqual(errorsOf(["AC4"], collide, { ...seed, ...dialog }), ["JIRA_DUPLICATE_ISOLATION_VIOLATED"]);
});

test("every blocking code explains its missing requirement", () => {
  for (const code of ["JIRA_ROW_CELLS_UNBOUND", "JIRA_FILTER_EFFECT_UNPROVEN", "JIRA_FILTER_EFFECT_EVIDENCE_REQUIRED", "JIRA_DIALOG_ANCHOR_EVIDENCE_REQUIRED", "JIRA_DIALOG_ANCHOR_MISSING", "JIRA_DUPLICATE_SETUP_REDUNDANT", "JIRA_DUPLICATE_ISOLATION_VIOLATED"]) {
    assert.ok(JIRA_ROW_FORM_REQUIREMENTS[code]?.length > 20, code);
  }
});
