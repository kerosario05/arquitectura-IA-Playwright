import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  cancelOpenRequestsOfIdentity,
  cancelRequestsByIds,
  createDbCedulaReleaser,
  creatorFilter,
  listCancellableRequests,
  PortalDbError,
  type OpenSession,
  type PortalDbTarget,
  type QueryResult,
} from "./portal-requests-db";

const target: PortalDbTarget = { server: "db.example.test", database: "PortalDb", user: "u", password: "p" };

/** A scripted session: records every call and answers queries from `answer`. */
function fakeSession(answer: (text: string, params: Record<string, unknown>) => QueryResult) {
  const log: Array<{ op: string; text?: string; params?: Record<string, unknown> }> = [];
  const open: OpenSession = async () => ({
    async query(text, params = {}) { log.push({ op: "query", text, params }); return answer(text, params); },
    async begin() { log.push({ op: "begin" }); },
    async commit() { log.push({ op: "commit" }); },
    async rollback() { log.push({ op: "rollback" }); },
    async close() { log.push({ op: "close" }); },
  });
  return { open, log, ops: () => log.map((entry) => entry.op) };
}
const rows = (count: number) => Array.from({ length: count }, (_, index) => ({ Id: 100 + index, Status: "BORRADOR", SubStatus: "kyc", SerializedDataByType: "{}", UpdatedBy: null, UpdatedOnUtc: null }));
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "qalab-portaldb-"));

test("creator filter: exact e-mail or the user name before '@' of its own e-mail; wildcards are escaped", () => {
  const byName = creatorFilter("Radames");
  assert.equal(byName.params.creator, "radames");
  assert.equal(byName.params.creatorLike, "radames@%");
  assert.equal(creatorFilter("radames@bsc.com.do").params.creator, "radames@bsc.com.do");
  assert.equal(creatorFilter("a_b").params.creatorLike, "a\\_b@%", "an underscore is not a wildcard");
  for (const bad of ["", "ab", "a b", "x".repeat(65), "radames';drop table dbo.Requests;--", "ra%mes"]) {
    assert.throws(() => creatorFilter(bad), (error: unknown) => error instanceof PortalDbError && error.code === "creator_invalid");
  }
});

test("list: only active requests of that creator, masked identity, read-only (a single SELECT)", async () => {
  const { open, log } = fakeSession(() => ({
    rowsAffected: [],
    recordset: [{ Id: 11174, Type: "MULTIPRODNATURAL", Status: "BORRADOR", SubStatus: "compliance", Stage: "compliance", CustomIdentifier: "", Ident: "00112345678", CreatedOnUtc: new Date("2026-11-02T10:00:00Z"), UpdatedOnUtc: null }],
  }));
  const result = await listCancellableRequests(target, "radames", open);
  assert.deepEqual(result.requests.map((request) => request.id), [11174]);
  assert.equal(result.requests[0].identityHint, "•••••••5678");
  assert.equal(JSON.stringify(result).includes("00112345678"), false);
  const queries = log.filter((entry) => entry.op === "query");
  assert.equal(queries.length, 1);
  assert.match(queries[0].text!, /^\s*SELECT/i);
  assert.doesNotMatch(queries[0].text!, /\b(UPDATE|DELETE|INSERT|DROP)\b/i);
  assert.match(queries[0].text!, /Status IN \('BORRADOR','EN_PROGRESO'\)/);
  assert.equal(queries[0].params!.creator, "radames");
  assert.deepEqual(log.map((entry) => entry.op).slice(-1), ["close"]);
});

test("cancel: requires confirmation, a valid id list and a valid creator before touching the database", async () => {
  const { open, log } = fakeSession(() => ({ recordset: [], rowsAffected: [0] }));
  const dir = tempDir();
  const base = { createdBy: "radames", ids: [1, 2], confirmed: true, backupDir: dir };
  await assert.rejects(cancelRequestsByIds(target, { ...base, confirmed: undefined }, open), (e: unknown) => e instanceof PortalDbError && e.code === "confirmation_required");
  for (const ids of [[], undefined, [1, 1], [0], [-3], ["abc"], [1.5], Array.from({ length: 1001 }, (_, index) => index + 1)]) {
    await assert.rejects(cancelRequestsByIds(target, { ...base, ids }, open), (e: unknown) => e instanceof PortalDbError && e.code === "ids_invalid");
  }
  await assert.rejects(cancelRequestsByIds(target, { ...base, createdBy: "x" }, open), (e: unknown) => e instanceof PortalDbError && e.code === "creator_invalid");
  assert.equal(log.length, 0, "no connection was opened");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("cancel: saves a backup, updates exactly the selection inside one transaction and commits", async () => {
  const dir = tempDir();
  const { open, log, ops } = fakeSession((text) => {
    if (/^\s*UPDATE/i.test(text)) return { recordset: [], rowsAffected: [3] };
    return { recordset: rows(3), rowsAffected: [] };
  });
  const outcome = await cancelRequestsByIds(target, { createdBy: "radames", ids: [100, 101, 102], confirmed: true, actor: "admin", backupDir: dir, now: () => new Date("2026-11-09T20:00:00Z") }, open);
  assert.deepEqual(outcome, { dryRun: false, requested: 3, cancelled: 3, backupFile: outcome.backupFile });
  assert.deepEqual(ops(), ["begin", "query", "query", "commit", "close"]);
  const saved = JSON.parse(fs.readFileSync(outcome.backupFile, "utf8"));
  assert.equal(saved.rows.length, 3, "the rows as they were are saved before the update");
  assert.equal(saved.createdBy, "radames");
  const update = log.find((entry) => entry.op === "query" && /^\s*UPDATE/i.test(entry.text ?? ""))!;
  assert.match(update.text!, /LOWER\(r\.CreatedBy\)/, "the update is also filtered by creator");
  assert.match(update.text!, /Status IN \('BORRADOR','EN_PROGRESO'\)/);
  assert.match(update.text!, /IN \(@id0,@id1,@id2\)/, "ids are parameters, never concatenated");
  assert.deepEqual([update.params!.id0, update.params!.id1, update.params!.id2], [100, 101, 102]);
  assert.equal(update.params!.actor, "admin");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("cedula release: cancels every active request of that identity in one transaction, with a backup", async () => {
  const dir = tempDir();
  const { open, log, ops } = fakeSession((text) => /^\s*UPDATE/i.test(text) ? { recordset: [], rowsAffected: [2] } : { recordset: rows(2), rowsAffected: [] });
  const outcome = await cancelOpenRequestsOfIdentity(target, "001-0323453-0", { backupDir: dir }, open);
  assert.equal(outcome.cancelled, 2);
  assert.deepEqual(ops(), ["begin", "query", "query", "commit", "close"]);
  assert.equal(log[1].params!.identity, "00103234530", "dashes are ignored and the value is a parameter");
  assert.equal(JSON.parse(fs.readFileSync(outcome.backupFile!, "utf8")).rows.length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("cedula release: nothing open -> nothing written; invalid cédula never reaches the database", async () => {
  const { open, ops } = fakeSession(() => ({ recordset: [], rowsAffected: [] }));
  assert.deepEqual(await cancelOpenRequestsOfIdentity(target, "00103234530", {}, open), { cancelled: 0 });
  assert.deepEqual(ops(), ["begin", "query", "rollback", "close"]);
  assert.equal(await createDbCedulaReleaser(target, open)("00103234530"), "already_free");
  assert.equal(await createDbCedulaReleaser(target, open)("12"), "blocked");
});

test("cedula release: a row count different from what was found is rolled back and the cédula is blocked", async () => {
  const dir = tempDir();
  const { open, ops } = fakeSession((text) => /^\s*UPDATE/i.test(text) ? { recordset: [], rowsAffected: [1] } : { recordset: rows(2), rowsAffected: [] });
  await assert.rejects(cancelOpenRequestsOfIdentity(target, "00103234530", { backupDir: dir }, open), (e: unknown) => e instanceof PortalDbError && e.code === "unexpected_row_count");
  assert.ok(ops().includes("rollback") && !ops().includes("commit"));
  assert.equal(await createDbCedulaReleaser(target, open, dir)("00103234530"), "blocked");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("cancel: if the selection is no longer exactly active and the creator's, nothing changes (rollback, no update)", async () => {
  const dir = tempDir();
  const { open, log, ops } = fakeSession(() => ({ recordset: rows(2), rowsAffected: [] }));
  await assert.rejects(cancelRequestsByIds(target, { createdBy: "radames", ids: [100, 101, 102], confirmed: true, backupDir: dir }, open),
    (e: unknown) => e instanceof PortalDbError && e.code === "selection_changed");
  assert.deepEqual(ops(), ["begin", "query", "rollback", "close"]);
  assert.equal(log.some((entry) => /^\s*UPDATE/i.test(entry.text ?? "")), false);
  assert.equal(fs.readdirSync(dir).length, 0, "no backup is written for a refused change");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("cancel: a row count different from the selection is rolled back", async () => {
  const dir = tempDir();
  const { open, ops } = fakeSession((text) => /^\s*UPDATE/i.test(text) ? { recordset: [], rowsAffected: [5] } : { recordset: rows(3), rowsAffected: [] });
  await assert.rejects(cancelRequestsByIds(target, { createdBy: "radames", ids: [100, 101, 102], confirmed: true, backupDir: dir }, open),
    (e: unknown) => e instanceof PortalDbError && e.code === "unexpected_row_count");
  assert.deepEqual(ops(), ["begin", "query", "query", "rollback", "close"]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("dry run: does everything and always rolls back, even without confirmation", async () => {
  const dir = tempDir();
  const { open, ops } = fakeSession((text) => /^\s*UPDATE/i.test(text) ? { recordset: [], rowsAffected: [2] } : { recordset: rows(2), rowsAffected: [] });
  const outcome = await cancelRequestsByIds(target, { createdBy: "radames", ids: [100, 101], confirmed: undefined, dryRun: true, backupDir: dir }, open);
  assert.equal(outcome.dryRun, true);
  assert.equal(outcome.cancelled, 0, "nothing is kept");
  assert.equal(outcome.requested, 2);
  assert.deepEqual(ops(), ["begin", "query", "query", "rollback", "close"]);
  assert.equal(ops().includes("commit"), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("driver errors become clear codes without leaking connection details", async () => {
  const open: OpenSession = async () => { throw Object.assign(new Error("Login failed for user 'u' pwd=secret"), { code: "ELOGIN" }); };
  await assert.rejects(listCancellableRequests(target, "radames", open), (e: unknown) => e instanceof PortalDbError && e.code === "db_login_failed" && !/secret/.test(e.message));
  const failing: OpenSession = async () => ({
    async query() { throw Object.assign(new Error("boom with secret"), { code: "EREQUEST" }); },
    async begin() {}, async commit() {}, async rollback() {}, async close() {},
  });
  await assert.rejects(listCancellableRequests(target, "radames", failing), (e: unknown) => e instanceof PortalDbError && e.code === "db_error" && !/secret/.test(e.message));
});
