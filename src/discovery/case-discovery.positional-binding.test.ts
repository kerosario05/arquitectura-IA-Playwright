import assert from "node:assert/strict";
import test from "node:test";
import { bindAuthoredRuntimeField } from "./case-discovery";

const scenario = { source: "testrail" } as never;
const entries = [
  { key: "jira_edit_fe0b5654b9a8ba2a_8" },
  { key: "jira_edit_fe0b5654b9a8ba2a_9" },
  { key: "rnc_cliente_activo" },
];
const select = (index: number, field = "Tipo de identificacion") =>
  ({ actionType: "action_select", target: field, index } as never as Parameters<typeof bindAuthoredRuntimeField>[1]);

test("a select with no value in its text takes the entry keyed by its own step position", () => {
  const target = select(8);
  assert.equal(bindAuthoredRuntimeField(scenario, target, entries), true);
  assert.equal((target as { valueKey?: string }).valueKey, "jira_edit_fe0b5654b9a8ba2a_8");
  assert.equal((target as { valueSource?: string }).valueSource, "test_data");
});

test("the next field takes the next position, not the previous entry", () => {
  const target = { actionType: "action_fill", target: "Numero de identificacion", index: 9 } as never as Parameters<typeof bindAuthoredRuntimeField>[1];
  assert.equal(bindAuthoredRuntimeField(scenario, target, entries), true);
  assert.equal((target as { valueKey?: string }).valueKey, "jira_edit_fe0b5654b9a8ba2a_9");
});

test("a step with no entry at its position, or two entries at it, binds nothing", () => {
  assert.equal(bindAuthoredRuntimeField(scenario, select(7), entries), false);
  const twice = [{ key: "jira_edit_aaaaaaaaaaaaaaaa_8" }, { key: "jira_edit_bbbbbbbbbbbbbbbb_8" }];
  assert.equal(bindAuthoredRuntimeField(scenario, select(8), twice), false);
});

test("a name match still wins over the position", () => {
  const named = [...entries, { key: "tipo_de_identificacion" }];
  const target = select(8);
  bindAuthoredRuntimeField(scenario, target, named);
  assert.equal((target as { valueKey?: string }).valueKey, "tipo_de_identificacion");
});
