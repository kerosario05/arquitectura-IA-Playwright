import assert from "node:assert/strict";
import test from "node:test";
import { aliasPositionalCredentialEntries, resolveDataKey } from "./data-key-resolver";

// Entries as the launch wizard sends them for a case: opaque keys, position only.
const entries = [
  { key: "jira_edit_5d765e4e632a7f7f_2", value: "qa.user", source: "explicit_runtime_input" },
  { key: "jira_edit_5d765e4e632a7f7f_3", value: "qa-secret-pass", source: "explicit_runtime_input" },
  { key: "rnc_cliente_activo", value: "10200982", source: "explicit_runtime_input" },
];
const steps = [
  { index: 1, label: "Abrir la aplicación configurada del proyecto", actionType: "action_click" },
  { index: 2, label: "Usuario", actionType: "action_fill" },
  { index: 3, label: "Contraseña", actionType: "action_fill" },
  { index: 4, label: "Iniciar Sesion", actionType: "action_click" },
];

test("values keyed by step position become the credentials of the field that step fills", () => {
  const result = aliasPositionalCredentialEntries(entries, steps)!;
  assert.equal(result.find((entry) => entry.key === "auth.username")?.value, "qa.user");
  assert.equal(result.find((entry) => entry.key === "auth.password")?.value, "qa-secret-pass");
  assert.equal((result.find((entry) => entry.key === "auth.password") as { sensitive?: boolean } | undefined)?.sensitive, true);
  assert.equal(result.find((entry) => entry.key === "auth.password")?.source, "user_provided_qa_credentials");
});

test("the secure resolver then resolves the canonical credential key, masked", () => {
  const aliased = aliasPositionalCredentialEntries(entries, steps)!;
  const resolution = resolveDataKey("auth.username", { runtimeEntries: aliased as never });
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.masked, true);
});

test("without aliasing, the same entries leave the credential missing (the reported failure)", () => {
  const resolution = resolveDataKey("auth.username", { runtimeEntries: entries as never });
  assert.notEqual(resolution.status, "resolved");
});

test("a position with no value, an ambiguous position, or a non-fill step is never aliased", () => {
  assert.equal(aliasPositionalCredentialEntries([{ key: "jira_edit_5d765e4e632a7f7f_2", value: "  " }], steps)?.length, 1);
  const twice = [
    { key: "jira_edit_5d765e4e632a7f7f_2", value: "a" },
    { key: "jira_edit_aaaaaaaaaaaaaaaa_2", value: "b" },
  ];
  assert.equal(aliasPositionalCredentialEntries(twice, steps)?.length, 2);
  assert.equal(aliasPositionalCredentialEntries(entries, [{ index: 2, label: "Usuario", actionType: "action_click" }])?.length, entries.length);
});

test("an existing canonical credential is never overridden and nothing is aliased by order", () => {
  const withCanonical = [...entries, { key: "auth.username", value: "configured" }];
  const result = aliasPositionalCredentialEntries(withCanonical, steps)!;
  assert.equal(result.filter((entry) => entry.key === "auth.username").length, 1);
  assert.equal(result.find((entry) => entry.key === "auth.username")?.value, "configured");
  const shifted = [{ key: "jira_edit_5d765e4e632a7f7f_7", value: "x" }];
  assert.equal(aliasPositionalCredentialEntries(shifted, steps)?.length, 1);
});
