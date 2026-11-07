import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { dataCedulasPrepareEnabled, dataCedulasPrepareFreshDays, prepareCedulaRecord, type SqlRunner } from "./data-cedulas-prepare";

function database(days: number | undefined) {
  const statements: string[] = [];
  const run: SqlRunner = async (text, params) => {
    statements.push(text.replace(/\s+/g, " ").trim());
    assert.equal(params.c, "03103393165");
    if (/DATEDIFF/.test(text)) return { rows: days === undefined ? [] : [{ days }], rowsAffected: 0 };
    if (/^SELECT \*/.test(text.trim())) return { rows: [{ Cedula: "03103393165", marker: text.match(/dbo\.(\w+)/)![1] }], rowsAffected: 1 };
    if (/^UPDATE dbo\.DatosGenerales SET FechaProceso = GETDATE\(\)/.test(text.trim())) return { rows: [], rowsAffected: 1 };
    throw new Error(`unexpected statement ${text}`);
  };
  return { run, statements };
}

const withDir = async (body: (dir: string) => Promise<void>) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "prepare-"));
  try { await body(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
};

test("a master date the Portal already trusts is left alone: nothing is read or written", async () => {
  await withDir(async (backupDir) => {
    const { run, statements } = database(12);
    assert.deepEqual(await prepareCedulaRecord(run, "03103393165", { freshDays: 30, backupDir }), { status: "fresh", days: 12 });
    assert.equal(statements.length, 1);
    assert.equal(existsSync(backupDir) && readdirCount(backupDir) === 0, true);
  });
});

test("an old master date is saved first and then set to today", async () => {
  await withDir(async (backupDir) => {
    const { run, statements } = database(342);
    const result = await prepareCedulaRecord(run, "03103393165", { freshDays: 30, backupDir, now: new Date("2026-11-03T12:00:00Z") });
    assert.equal(result.status, "prepared");
    if (result.status !== "prepared") return;
    const saved = JSON.parse(readFileSync(result.backupFile, "utf8"));
    assert.equal(saved.masterAgeDays, 342);
    assert.deepEqual(Object.keys(saved.tables), ["DatosGenerales", "CVScore", "CVIncomeEstimator", "BSCVariables", "Activas", "Inactivas"]);
    assert.ok(statements.at(-1)!.startsWith("UPDATE dbo.DatosGenerales"), "the write comes after every backup read");
    assert.equal(statements.filter((statement) => statement.startsWith("UPDATE")).length, 1);
  });
});

test("a cédula with no master record is reported missing and never written", async () => {
  await withDir(async (backupDir) => {
    const { run, statements } = database(undefined);
    assert.deepEqual(await prepareCedulaRecord(run, "03103393165", { freshDays: 30, backupDir }), { status: "missing" });
    assert.equal(statements.some((statement) => statement.startsWith("UPDATE")), false);
  });
});

test("preparing is on by default and its freshness window is configurable", () => {
  assert.equal(dataCedulasPrepareEnabled({} as any), true);
  assert.equal(dataCedulasPrepareEnabled({ DATA_CEDULAS_PREPARE: "false" } as any), false);
  assert.equal(dataCedulasPrepareFreshDays({} as any), 30);
  assert.equal(dataCedulasPrepareFreshDays({ DATA_CEDULAS_PREPARE_FRESH_DAYS: "7" } as any), 7);
  assert.equal(dataCedulasPrepareFreshDays({ DATA_CEDULAS_PREPARE_FRESH_DAYS: "x" } as any), 30);
});

function readdirCount(dir: string): number {
  return require("node:fs").readdirSync(dir).length;
}
