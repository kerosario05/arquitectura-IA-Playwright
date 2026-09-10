import assert from "node:assert/strict";
import test from "node:test";
import { buildWebRecorderContextOptions, isSensitiveField } from "./web-session-recorder";

test("passes the project HTTPS policy to the recording context", () => {
  assert.deepEqual(buildWebRecorderContextOptions(true), { ignoreHTTPSErrors: true });
  assert.deepEqual(buildWebRecorderContextOptions(false), { ignoreHTTPSErrors: false });
  assert.deepEqual(buildWebRecorderContextOptions(undefined), { ignoreHTTPSErrors: false });
});

test("keeps identifiers as action inputs and detects actual secrets", () => {
  assert.equal(isSensitiveField({ label: "Nombre de usuario", inputType: "text" } as any), false);
  assert.equal(isSensitiveField({ label: "RNC de la empresa", inputType: "text" } as any), false);
  assert.equal(isSensitiveField({ label: "Clave de acceso", inputType: "password" } as any), true);
  assert.equal(isSensitiveField({ label: "Ingresos", inputType: "text" } as any), false);
});
