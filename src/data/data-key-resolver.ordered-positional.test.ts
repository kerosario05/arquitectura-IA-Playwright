import assert from "node:assert/strict";
import test from "node:test";
import { aliasPositionalCredentialEntries, runtimeInputKeyForField, alignOrderedPositionalEntries } from "./data-key-resolver";

// C57449 as launched: the wizard keys kept an older revision's numbers (7 and 8) for the fields at steps 9 and 10.
const entries = [
  { key: "jira_edit_5d765e4e632a7f7f_2", value: "user" },
  { key: "jira_edit_5d765e4e632a7f7f_3", value: "pass" },
  { key: "jira_edit_a024a07ed42dbdf4_7", value: "Registro Nacional de Contribuyentes" },
  { key: "jira_edit_5d765e4e632a7f7f_8", value: "10200982" },
];
const steps = [
  { index: 1, label: "Abrir", actionType: "action_click" },
  { index: 2, label: "Usuario", actionType: "action_fill" },
  { index: 3, label: "Contraseña", actionType: "action_fill" },
  { index: 4, label: "Iniciar Sesion", actionType: "action_click" },
  { index: 9, label: "Tipo de identificacion", actionType: "action_select" },
  { index: 10, label: "Numero de identificacion", actionType: "action_fill" },
];

test("equal counts of value-less steps and unused position keys pair up in authoring order", () => {
  const result = alignOrderedPositionalEntries(entries, steps)!;
  assert.equal(result.find((e) => e.key === "jira_step_9")?.value, "Registro Nacional de Contribuyentes");
  assert.equal(result.find((e) => e.key === "jira_step_10")?.value, "10200982");
  assert.equal(result.length, entries.length + 2);
});

test("credential positions are never paired as ordinary values", () => {
  const result = alignOrderedPositionalEntries(entries, steps)!;
  assert.equal(result.some((e) => e.key.startsWith("jira_step_") && ["user", "pass"].includes(e.value as string)), false);
});

test("different counts assign nothing: no guessing", () => {
  assert.equal(alignOrderedPositionalEntries(entries.slice(0, 3), steps)!.length, 3);
  assert.equal(alignOrderedPositionalEntries(entries, steps.slice(0, 5))!.length, 4);
});

test("a step that already has an entry at its own position, or an authored literal, is left alone", () => {
  const own = [...entries, { key: "jira_edit_aaaaaaaaaaaaaaaa_9", value: "own" }];
  // step 9 owns an entry; step 10 lacks one but two keys (7, 8) are unused: counts differ, so nothing is assigned.
  assert.equal(alignOrderedPositionalEntries(own, steps)!.length, own.length);
  const literal = steps.map((s) => (s.index === 10 ? { ...s, hasLiteralValue: true } : s));
  assert.equal(alignOrderedPositionalEntries(entries, literal)!.length, entries.length);
});


test("stale positional credentials cannot become business inputs", () => {
 const supplied = [
  {key:"jira_edit_aaaaaaaaaaaaaaaa_13", value:"synthetic-user"},
  {key:"jira_edit_aaaaaaaaaaaaaaaa_14", value:"synthetic-secret"},
  {key:"auth.username",value:"synthetic-user",source:"user_provided_qa_credentials"},
  {key:"auth.password",value:"synthetic-secret",source:"user_provided_qa_credentials"},
  {key:"type_business",value:"Company"},
  {key:"number_business",value:"synthetic-number"},
 ];
 const result=alignOrderedPositionalEntries(supplied,steps)!;
 assert.equal(result.some(entry=>entry.key==="jira_step_9"||entry.key==="jira_step_10"),false);
});


test("field identity transports edited keys independently of old positions",()=>{
 const values=[
  {key:"jira_edit_aaaaaaaaaaaaaaaa_13",fieldLabel:"Usuario",value:"synthetic-user"},
  {key:"tipo_cancelacion",fieldLabel:"Tipo de identificación",value:"Company"},
 ];
 assert.equal(runtimeInputKeyForField("Tipo de identificacion",values),"tipo_cancelacion");
 assert.equal(aliasPositionalCredentialEntries(values,steps)?.find(entry=>entry.key==="auth.username")?.value,"synthetic-user");
 assert.equal(alignOrderedPositionalEntries(values,steps)?.some(entry=>entry.key==="jira_step_9"),false);
});
