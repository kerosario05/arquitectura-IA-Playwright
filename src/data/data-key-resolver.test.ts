import assert from "node:assert/strict";
import test from "node:test";
import { resolveDataKey, formatDataKeyForLog } from "./data-key-resolver";

/**
 * FIRST_LOSS: Recording V2 already produces `sensitive=true`/`valueKey=<recorded-field-derived
 * key>` correctly, without ever persisting the real literal (RecordedEvent/CanonicalInteraction/
 * RecordingExecutionContract only ever carry the intent, not the value -- confirmed unchanged,
 * not touched this ticket). But the single runtime value resolver Recording Replay execution
 * actually calls (`resolveDataKey`, `case-discovery.ts` line ~6586) only recognized a fixed list
 * of literal, TestRail-canonicalized key spellings ("contrasena_valida", "password_valido", ...)
 * for its credential fallback -- and only checked env vars, never the SAME project-configured
 * `APP_TEST_DATA_JSON` (`auth.*`) the TestRail-discovery CLI path (`secure-runtime-runner.ts`)
 * already reads. A Recording's own valueKey (derived from the recorded field's semantic label,
 * e.g. "contrasena", never "contrasena_valida") never matched, so it always fell through to
 * "missing_sensitive" even when the project's secure source genuinely had the value configured.
 *
 * Fixed by generalizing that one fallback tier: `detectCredentialRole` matches by semantic
 * ROLE/substring (the same vocabulary style `isSensitiveKey` already uses), not by literal key
 * text, and checks `testData["auth.<role>"]` (the exact `auth.*` namespace
 * `secure-runtime-runner.ts` already writes into) before falling back to the pre-existing env
 * var. No second credential system, no per-app/key hardcode. Also hardened `maskValue` (used by
 * `formatDataKeyForLog`) to never reveal ANY trailing characters of a masked value -- it
 * previously leaked the value's last 3 characters into logs.
 */

test("1/secureResolve. a sensitive Recording valueKey with no exact testData match resolves via project-configured auth.* secure source", () => {
  const resolution = resolveDataKey("contrasena", {
    testData: { "auth.password": "s3cr3t-configured-value" },
    env: {},
  });
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.value, "s3cr3t-configured-value");
  assert.equal(resolution.masked, true);
});

test("2/fill. the resolved value is a real, usable string a fill executor can consume directly", () => {
  const resolution = resolveDataKey("entity_1.password", {
    testData: { "auth.password": "another-real-secret" },
    env: {},
  });
  assert.equal(typeof resolution.value, "string");
  assert.equal(resolution.value, "another-real-secret");
});

test("4/logNoLeak. formatDataKeyForLog never includes the real resolved value for a masked resolution", () => {
  const resolution = resolveDataKey("contrasena", {
    testData: { "auth.password": "never-should-appear-in-logs" },
    env: {},
  });
  const logLine = formatDataKeyForLog(resolution);
  assert.ok(!logLine.includes("never-should-appear-in-logs"));
  assert.ok(!logLine.includes("ogs"), "no trailing characters of the secret leak either");
  assert.ok(logLine.includes("contrasena"));
  assert.ok(logLine.includes('value="***"'));
});

test("5/failureNoLeak. a missing sensitive key's error message never contains a real value (there is none to leak, and none is invented)", () => {
  const resolution = resolveDataKey("contrasena", { testData: {}, env: {} });
  assert.equal(resolution.status, "missing_sensitive");
  assert.ok(resolution.error);
  assert.ok(!resolution.value);
});

test("6/mask. the mask/log display is never itself treated as the runtime value -- the real value is what execution receives", () => {
  const resolution = resolveDataKey("contrasena", {
    testData: { "auth.password": "real-value-not-asterisks" },
    env: {},
  });
  assert.notEqual(resolution.value, "***");
  assert.equal(resolution.value, "real-value-not-asterisks");
});

test("7/missingKey. no secure source configured at all for a sensitive key: execution-blocking missing_sensitive, never invented/empty", () => {
  const resolution = resolveDataKey("contrasena", { testData: {}, env: {} });
  assert.equal(resolution.status, "missing_sensitive");
  assert.equal(resolution.value, undefined);
});

test("8/unavailableSource. testData present but without the relevant auth.* entry, and no env fallback either: still missing_sensitive", () => {
  const resolution = resolveDataKey("contrasena", {
    testData: { "auth.username": "someuser" },
    env: {},
  });
  assert.equal(resolution.status, "missing_sensitive");
});

test("9/nonSensitiveRegression. an ordinary non-credential-role key with a direct testData match resolves exactly as before", () => {
  const resolution = resolveDataKey("nombre_cliente", {
    testData: { nombre_cliente: "Empresa Genérica" },
    env: {},
  });
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.value, "Empresa Genérica");
  assert.equal(resolution.source, "APP_TEST_DATA_JSON");
});

test("10/authority. case-scoped explicit runtimeEntries still outrank the project-configured secure source (same priority order as before)", () => {
  const resolution = resolveDataKey("contrasena", {
    testData: { "auth.password": "project-configured-value" },
    env: {},
    runtimeEntries: [{ key: "contrasena", value: "explicit-case-scoped-value" }],
  });
  assert.equal(resolution.value, "explicit-case-scoped-value");
});

test("11/generic. no app/project/key-specific hardcode: an arbitrary semantic field naming still resolves by role, not exact text", () => {
  const resolution = resolveDataKey("campo_de_clave_del_usuario", {
    testData: { "auth.password": "generic-role-matched-value" },
    env: {},
  });
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.value, "generic-role-matched-value");
});

test("12/lineage. the resolution's source records provenance metadata only -- never the secret value itself", () => {
  const resolution = resolveDataKey("contrasena", {
    testData: { "auth.password": "lineage-test-secret" },
    env: {},
  });
  assert.equal(resolution.source, "APP_TEST_DATA_JSON (auth.password)");
  assert.ok(!resolution.source!.includes("lineage-test-secret"));
});

test("env fallback still works when testData has no auth.* entry (pre-existing behavior preserved)", () => {
  const resolution = resolveDataKey("password_valido", {
    testData: {},
    env: { APP_PASSWORD: "env-fallback-secret" },
  });
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.value, "env-fallback-secret");
  assert.equal(resolution.source, "APP_PASSWORD");
});

test("username role resolves the same way as password", () => {
  const resolution = resolveDataKey("usuario", {
    testData: { "auth.username": "qa-user" },
    env: {},
  });
  assert.equal(resolution.status, "resolved");
  assert.equal(resolution.value, "qa-user");
});
