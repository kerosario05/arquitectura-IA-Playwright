import assert from "node:assert/strict";
import test from "node:test";
import { pickSavedPortalCredentials, resolvePortalLogin } from "./portal-login-resolver";

const row = (caseId: number, key: string, value: string, updatedAt: string) => ({ caseId, key, value, updatedAt });

test("saved credentials: newest case that has BOTH user and password, never mixing cases", () => {
  const picked = pickSavedPortalCredentials([
    row(1, "usuario_negocios", "old-user", "2026-11-01T10:00:00Z"),
    row(1, "contrasena_negocios", "old-pass", "2026-11-01T10:00:00Z"),
    row(2, "usuario_negocios", "new-user", "2026-11-08T10:00:00Z"),
    row(2, "contrasena_negocios", "new-pass", "2026-11-08T10:00:01Z"),
    row(3, "usuario", "only-user", "2026-11-09T10:00:00Z"),
  ]);
  assert.deepEqual(picked, { username: "new-user", password: "new-pass" });
});

test("saved credentials: redacted or empty values are ignored; nothing complete -> undefined", () => {
  assert.equal(pickSavedPortalCredentials([
    row(1, "usuario", "[REDACTED]", "2026-11-01T10:00:00Z"),
    row(1, "contrasena", "secret", "2026-11-01T10:00:00Z"),
    row(2, "usuario", "  ", "2026-11-01T10:00:00Z"),
    row(2, "password", "secret", "2026-11-01T10:00:00Z"),
  ]), undefined);
  assert.equal(pickSavedPortalCredentials([row(1, "rnc", "123", "2026-11-01T10:00:00Z")]), undefined);
});

test("resolve: environment override wins, else the project's saved values, else nothing", async () => {
  const saved = async () => ({ username: "saved-user", password: "saved-pass" });
  const base = { baseUrl: "https://qa.example.test:5000/", readSaved: saved, readStored: async () => undefined };
  const fromEnv = await resolvePortalLogin("p", { ...base, env: { DATA_CEDULAS_LEXIS_PORTAL_USERNAME: "env-user", DATA_CEDULAS_LEXIS_PORTAL_PASSWORD: "env-pass" } });
  assert.equal(fromEnv?.source, "environment");
  assert.equal(fromEnv?.login.username, "env-user");
  const fromProject = await resolvePortalLogin("p", { ...base, env: {} });
  assert.equal(fromProject?.source, "project_saved_launch_values");
  assert.equal(fromProject?.login.username, "saved-user");
  assert.equal(fromProject?.login.baseUrl, "https://qa.example.test:5000/");
  assert.equal(await resolvePortalLogin("p", { ...base, env: {}, readSaved: async () => undefined }), undefined);
  assert.equal(await resolvePortalLogin("p", { env: {}, readSaved: saved, baseUrl: "" }), undefined, "no Portal address -> no login");
});

test("resolve: credentials stored from the service panel win over the environment and the launch values", async () => {
  const resolved = await resolvePortalLogin("p", {
    baseUrl: "https://qa.example.test:5000/",
    env: { DATA_CEDULAS_LEXIS_PORTAL_USERNAME: "env-user", DATA_CEDULAS_LEXIS_PORTAL_PASSWORD: "env-pass" },
    readStored: async () => ({ username: "panel-user", password: "panel-pass" }),
    readSaved: async () => ({ username: "saved-user", password: "saved-pass" }),
  });
  assert.equal(resolved?.source, "service_credentials");
  assert.equal(resolved?.login.username, "panel-user");
});
