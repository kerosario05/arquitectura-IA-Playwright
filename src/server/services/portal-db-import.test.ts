import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parseConnectionString, PortalDbImportError, readPortalDbSettingsFile } from "./portal-db-import";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qalab-appsettings-"));
const write = (name: string, content: string) => { const file = path.join(dir, name); fs.writeFileSync(file, content); return file; };
const settings = (connection: unknown) => JSON.stringify({ DatabaseSettings: { Default: connection }, Other: { Secret: "no-se-usa" } });
const rejects = (action: () => unknown, code: string) =>
  assert.throws(action, (error: unknown) => error instanceof PortalDbImportError && error.code === code);

test("connection string: any key case, spaces, quoted values and a password with special characters", () => {
  assert.deepEqual(parseConnectionString("Server=10.0.0.1;Database=Db;User Id=svc;pwd=p@ss=w0rd!;Connect Timeout=120;"),
    { server: "10.0.0.1", database: "Db", "user id": "svc", pwd: "p@ss=w0rd!", "connect timeout": "120" });
  assert.deepEqual(parseConnectionString(`Data Source = srv ; Initial Catalog = Db ; UID = u ; Password = "a;b c"`),
    { "data source": "srv", "initial catalog": "Db", uid: "u", password: "a;b c" });
});

test("import: reads server, database, user and password from DatabaseSettings:Default (BOM tolerated)", () => {
  const file = write("appsettings.json", "﻿" + settings("Server=172.20.15.161;Database=PortalComercialApiDb;User Id=ArgentoDBUser;pwd=Sup3r;Secret;Connect Timeout=120;"));
  assert.deepEqual(readPortalDbSettingsFile(file), { server: "172.20.15.161", database: "PortalComercialApiDb", user: "ArgentoDBUser", password: "Sup3r" });
  assert.deepEqual(readPortalDbSettingsFile(`"${file}"`).user, "ArgentoDBUser", "a path pasted with quotes works");
  const named = write("appsettings.Production.json", settings("Server=a;Database=b;User Id=c;Password=d"));
  assert.equal(readPortalDbSettingsFile(named).database, "b");
});

test("import: only appsettings*.json files are read, never another file", () => {
  const other = write("secrets.json", settings("Server=a;Database=b;User Id=c;pwd=d"));
  rejects(() => readPortalDbSettingsFile(other), "file_not_allowed");
  rejects(() => readPortalDbSettingsFile(path.join(dir, "..", "..", "windows", "win.ini")), "file_not_allowed");
  rejects(() => readPortalDbSettingsFile(path.join(dir, "appsettings.json.bak")), "file_not_allowed");
  rejects(() => readPortalDbSettingsFile(dir), "file_not_allowed");
  rejects(() => readPortalDbSettingsFile(""), "path_required");
  rejects(() => readPortalDbSettingsFile(undefined), "path_required");
});

test("import: clear errors for a missing file, invalid JSON, a missing or incomplete connection string; no secret in messages", () => {
  rejects(() => readPortalDbSettingsFile(path.join(dir, "no", "appsettings.json")), "file_not_found");
  rejects(() => readPortalDbSettingsFile(write("appsettings.Bad.json", "{ no es json")), "file_invalid");
  rejects(() => readPortalDbSettingsFile(write("appsettings.Empty.json", JSON.stringify({ Other: 1 }))), "connection_string_missing");
  const incomplete = write("appsettings.Integrated.json", settings("Server=a;Database=b;Integrated Security=true;pwd="));
  try { readPortalDbSettingsFile(incomplete); assert.fail("must throw"); }
  catch (error) {
    assert.ok(error instanceof PortalDbImportError);
    assert.equal(error.code, "connection_string_incomplete");
    assert.match(error.message, /usuario/);
  }
  const huge = write("appsettings.Huge.json", settings("Server=a;Database=b;User Id=c;pwd=d") + " ".repeat(1024 * 1024 + 1));
  rejects(() => readPortalDbSettingsFile(huge), "file_not_allowed");
  fs.rmSync(dir, { recursive: true, force: true });
});
