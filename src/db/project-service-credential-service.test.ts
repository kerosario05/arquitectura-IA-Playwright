import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Isolated database + key for this test file: set BEFORE the db module reads its configuration.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qalab-credential-"));
process.env.DB_DRIVER = "sqlite";
process.env.SQLITE_DB_PATH = path.join(dir, "test.db");
process.env.QA_LAB_SECRET_KEY_FILE = path.join(dir, "secret.key");
delete process.env.QA_LAB_SECRETS_KEY;

test("save / status / read / replace / delete; the password is encrypted at rest and never in the status", async (t) => {
  const { withConnection } = await import("./sql-connection");
  const service = await import("./project-service-credential-service");
  // The SQLite file stays locked on Windows until the process ends: cleanup is best effort.
  t.after(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp dir */ } });

  await withConnection(async (conn) => {
    await conn.query("INSERT INTO dbo.Projects (slug, name, projectType) VALUES (?, ?, 1)", ["portal-comercial", "Portal Comercial"]);
  });
  const key = service.PORTAL_LOGIN_CREDENTIAL;

  assert.deepEqual(await service.getServiceCredentialStatus("portal-comercial", key), { configured: false });
  assert.equal(await service.readServiceCredential("portal-comercial", key), undefined);

  const status = await service.saveServiceCredential("portal-comercial", key, { username: "radames", password: "Secreta#1" }, "admin");
  assert.equal(status.configured, true);
  assert.equal((status as { username: string }).username, "radames");
  assert.equal(JSON.stringify(status).includes("Secreta#1"), false, "the status never carries the password");
  assert.deepEqual(await service.readServiceCredential("portal-comercial", key), { username: "radames", password: "Secreta#1" });

  const raw = await withConnection((conn) => conn.query<{ passwordCipher: string }>("SELECT passwordCipher FROM dbo.ProjectServiceCredential"));
  assert.equal(raw.length, 1);
  assert.equal(raw[0].passwordCipher.includes("Secreta#1"), false, "stored encrypted");

  await service.saveServiceCredential("portal-comercial", key, { username: "radames", password: "Nueva#2" }, "admin");
  assert.equal((await service.readServiceCredential("portal-comercial", key))?.password, "Nueva#2");
  const count = await withConnection((conn) => conn.query<{ n: number }>("SELECT COUNT(*) AS n FROM dbo.ProjectServiceCredential"));
  assert.equal(Number(count[0].n), 1, "replacing keeps a single row");

  await service.deleteServiceCredential("portal-comercial", key);
  assert.deepEqual(await service.getServiceCredentialStatus("portal-comercial", key), { configured: false });
});

test("invalid input is rejected with a clear code and a missing project is a 404", async () => {
  const service = await import("./project-service-credential-service");
  const rejects = async (promise: Promise<unknown>, code: string) =>
    assert.rejects(promise, (error: unknown) => error instanceof service.ServiceCredentialError && error.code === code);
  await rejects(service.saveServiceCredential("portal-comercial", service.PORTAL_LOGIN_CREDENTIAL, { username: "", password: "x" }), "username_invalid");
  await rejects(service.saveServiceCredential("portal-comercial", service.PORTAL_LOGIN_CREDENTIAL, { username: "u", password: "" }), "password_invalid");
  await rejects(service.saveServiceCredential("portal-comercial", "no valida!", { username: "u", password: "p" }), "credential_key_invalid");
  await rejects(service.saveServiceCredential("no-existe", service.PORTAL_LOGIN_CREDENTIAL, { username: "u", password: "p" }), "project_not_found");
});
