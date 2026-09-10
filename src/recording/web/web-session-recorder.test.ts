import assert from "node:assert/strict";
import test from "node:test";
import { buildWebRecorderContextOptions, isSensitiveField } from "./web-session-recorder";

test("passes the project HTTPS policy to the recording context", () => {
  assert.deepEqual(buildWebRecorderContextOptions(true), { ignoreHTTPSErrors: true });
  assert.deepEqual(buildWebRecorderContextOptions(false), { ignoreHTTPSErrors: false });
  assert.deepEqual(buildWebRecorderContextOptions(undefined), { ignoreHTTPSErrors: false });
});

test("redacts credential identifiers without relying on app-specific values", () => {
  assert.equal(isSensitiveField({ label: "Nombre de usuario", inputType: "text" } as any), true);
  assert.equal(isSensitiveField({ label: "RNC de la empresa", inputType: "text" } as any), true);
  assert.equal(isSensitiveField({ label: "Ingresos", inputType: "text" } as any), false);
});
