import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PortalDbError } from "./portal-requests-db";
import { describePortalDbAccess, resolvePortalDbTarget } from "./portal-db-target";

const credential = async () => ({ username: "svc-user", password: "svc-pass" });

test("target = server and database from the environment + user and password from the encrypted store", async () => {
  const target = await resolvePortalDbTarget("portal-comercial", {
    env: { PORTAL_DB_SERVER: " db.example.test ", PORTAL_DB_DATABASE: "PortalDb" } as NodeJS.ProcessEnv, readCredential: credential,
  });
  assert.deepEqual(target, { server: "db.example.test", database: "PortalDb", user: "svc-user", password: "svc-pass", source: "env_and_panel" });
});

test("a missing location or credential is reported with a clear code, never a guessed default", async () => {
  const rejects = (promise: Promise<unknown>, code: string) =>
    assert.rejects(promise, (error: unknown) => error instanceof PortalDbError && error.code === code);
  await rejects(resolvePortalDbTarget("p", { env: {} as NodeJS.ProcessEnv, readCredential: credential }), "db_not_configured");
  await rejects(resolvePortalDbTarget("p", { env: { PORTAL_DB_SERVER: "x" } as NodeJS.ProcessEnv, readCredential: credential }), "db_not_configured");
  await rejects(resolvePortalDbTarget("p", { env: { PORTAL_DB_SERVER: "x", PORTAL_DB_DATABASE: "y" } as NodeJS.ProcessEnv, readCredential: async () => undefined }), "credentials_required");
});

const tempSettings = (content: string, name = "appsettings.json") => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qalab-target-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
};
const dbSettings = JSON.stringify({ DatabaseSettings: { Default: "Server=172.20.15.161;Database=PortalComercialApiDb;User Id=ArgentoDBUser;pwd=Fi1e-Pass;Connect Timeout=120;" } });

test("PORTAL_API_APPSETTINGS: server, database, user and password all come from the file; nothing is read from the store", async () => {
  const { file, cleanup } = tempSettings(dbSettings);
  let storeTouched = false;
  const target = await resolvePortalDbTarget("portal-comercial", {
    env: { PORTAL_API_APPSETTINGS: file, PORTAL_DB_SERVER: "ignored", PORTAL_DB_DATABASE: "ignored" } as NodeJS.ProcessEnv,
    readCredential: async () => { storeTouched = true; return { username: "panel", password: "panel" }; },
  });
  assert.deepEqual(target, { server: "172.20.15.161", database: "PortalComercialApiDb", user: "ArgentoDBUser", password: "Fi1e-Pass", source: "settings_file" });
  assert.equal(storeTouched, false);
  cleanup();
});

test("PORTAL_API_APPSETTINGS: a relative path is resolved from the project folder", async () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), ".tmp-portal-api-"));
  try {
    fs.writeFileSync(path.join(dir, "appsettings.json"), dbSettings);
    const relative = path.relative(process.cwd(), path.join(dir, "appsettings.json"));
    const target = await resolvePortalDbTarget("p", { env: { PORTAL_API_APPSETTINGS: relative } as NodeJS.ProcessEnv });
    assert.equal(target.user, "ArgentoDBUser");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("PORTAL_API_APPSETTINGS pointing to an unusable file is an explicit error (it never silently falls back)", async () => {
  const { file, cleanup } = tempSettings("{ no es json");
  await assert.rejects(resolvePortalDbTarget("p", { env: { PORTAL_API_APPSETTINGS: file, PORTAL_DB_SERVER: "x", PORTAL_DB_DATABASE: "y" } as NodeJS.ProcessEnv, readCredential: credential }),
    (error: unknown) => error instanceof PortalDbError && error.code === "settings_file_unusable");
  await assert.rejects(resolvePortalDbTarget("p", { env: { PORTAL_API_APPSETTINGS: "C:/no/existe/appsettings.json" } as NodeJS.ProcessEnv }),
    (error: unknown) => error instanceof PortalDbError && error.code === "settings_file_unusable");
  cleanup();
});

test("describe: reports the source and the user but never the password", async () => {
  const { file, cleanup } = tempSettings(dbSettings);
  const fromFile = await describePortalDbAccess("p", { env: { PORTAL_API_APPSETTINGS: file } as NodeJS.ProcessEnv });
  assert.deepEqual(fromFile, { source: "settings_file", configured: true, server: "172.20.15.161", database: "PortalComercialApiDb", username: "ArgentoDBUser" });
  assert.equal(JSON.stringify(fromFile).includes("Fi1e-Pass"), false);
  const missing = await describePortalDbAccess("p", { env: {} as NodeJS.ProcessEnv, readCredential: credential });
  assert.equal(missing.configured, false);
  assert.equal(missing.problem, "db_not_configured");
  cleanup();
});
