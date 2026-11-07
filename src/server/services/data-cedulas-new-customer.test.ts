import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DATA_CEDULAS_CANDIDATE_BATCH_QUERY,
  dataCedulasSearchWindowSize,
  buildDataCedulasIdentifierBindPlan,
  buildDataCedulasExistingIdsQuery,
  buildDataCedulasPlaftIdsQuery,
  dataCedulasSqlRequestTimeoutMs,
  dataCedulasRandomPoolSize,
  dataCedulasScoreMaxAgeDays,
  dataCedulasMinScore,
  dataCedulasMinIncomeEstimator,
  dataCedulasDebtLimits,
  dataCedulasLexisTimeoutMs,
  dataCedulasLexisScreenPoolSize,
  dataCedulasPlaftMode,
  dataCedulasPlaftModeForDatabase,
  DataCedulasPlaftUnavailableError,
  listDataCedulasTnsAliases,
  selectRandomDataCedulasCustomers,
  validateDataCedulasDatabase,
} from "./data-cedulas-new-customer";
import { projectDataCedulasCustomer, projectDataCedulasCustomers } from "../routes/data-cedulas";

test('only unassigned instances fall back locally; configured QA1 stays strict even with incomplete credentials or URL', () => {
  const config = {DATA_CEDULAS_PLAFT_MODE:'strict', DATA_CEDULAS_LEXIS_TRANSPORT:'mdw', DATA_CEDULAS_LEXIS_MDW_DATABASE:'QA1'};
  assert.equal(dataCedulasPlaftModeForDatabase('qa1',config),'strict');
  assert.equal(dataCedulasPlaftModeForDatabase('QA2',config),'local_only');
  assert.equal(dataCedulasPlaftModeForDatabase('QA22',config),'local_only');
  assert.equal(dataCedulasPlaftModeForDatabase('QA2',{}),'local_only');
  assert.equal(dataCedulasPlaftModeForDatabase('QA2',{DATA_CEDULAS_LEXIS_TRANSPORT:'portal',DATA_CEDULAS_LEXIS_PORTAL_DATABASE:'QA2'}),'strict');
});

test("Data_Cedulas groups database reads without exceeding the logical search budget or Oracle IN limit", () => {
  assert.equal(dataCedulasSearchWindowSize(100), 200);
  assert.equal(dataCedulasSearchWindowSize(3), 30);
  assert.equal(dataCedulasSearchWindowSize(1), 10);
  assert.equal(dataCedulasSearchWindowSize(0), 0);
  const ids = Array.from({ length: dataCedulasSearchWindowSize(100) }, (_, i) => String(i).padStart(11, "0"));
  const plan = buildDataCedulasIdentifierBindPlan(ids);
  assert.equal(Object.keys(plan.bindVariables).length, 400);
});

test("Data_Cedulas validates selectable TNS aliases without opening a database connection", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "data-cedulas-tns-"));
  const previous = process.env.DATA_CEDULAS_ORACLE_TNS_ADMIN;
  process.env.DATA_CEDULAS_ORACLE_TNS_ADMIN = tempDir;
  try {
    fs.writeFileSync(path.join(tempDir, "tnsnames.ora"), "QA1 =\n (DESCRIPTION=...)\nQA2=\n (DESCRIPTION=...)\n");
    assert.deepEqual(listDataCedulasTnsAliases(), ["QA1", "QA2"]);
    assert.equal(validateDataCedulasDatabase("qa1"), "QA1");
    assert.throws(() => validateDataCedulasDatabase("QA3"), /no existe en tnsnames/);
  } finally {
    if (previous === undefined) delete process.env.DATA_CEDULAS_ORACLE_TNS_ADMIN;
    else process.env.DATA_CEDULAS_ORACLE_TNS_ADMIN = previous;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("Data_Cedulas response projects only the cedula", () => {
  const response = projectDataCedulasCustomer({
    customer: { Cedula: "00100003615", PrimerNombre: "no debe salir" },
  });

  assert.deepEqual(response, { ok: true, cedula: "00100003615" });
  assert.equal("PrimerNombre" in response, false);
});

test("Data_Cedulas multi-value response preserves only the requested cedulas", () => {
  const response = projectDataCedulasCustomers({
    customers: [
      { Cedula: "00100003615", PrimerNombre: "no debe salir" },
      { Cedula: "00100003616", PrimerApellido: "no debe salir" },
    ],
  });

  assert.deepEqual(response, { ok: true, cedula: "00100003615", cedulas: ["00100003615", "00100003616"] });
  assert.equal("PrimerNombre" in response, false);
});

test("Data_Cedulas SQL request timeout is configurable and defaults above the driver limit", () => {
  const previous = process.env.DATA_CEDULAS_SQL_REQUEST_TIMEOUT_MS;
  try {
    delete process.env.DATA_CEDULAS_SQL_REQUEST_TIMEOUT_MS;
    assert.equal(dataCedulasSqlRequestTimeoutMs(), 60000);
    process.env.DATA_CEDULAS_SQL_REQUEST_TIMEOUT_MS = "90000";
    assert.equal(dataCedulasSqlRequestTimeoutMs(), 90000);
    process.env.DATA_CEDULAS_SQL_REQUEST_TIMEOUT_MS = "invalid";
    assert.equal(dataCedulasSqlRequestTimeoutMs(), 60000);
  } finally {
    if (previous === undefined) delete process.env.DATA_CEDULAS_SQL_REQUEST_TIMEOUT_MS;
    else process.env.DATA_CEDULAS_SQL_REQUEST_TIMEOUT_MS = previous;
  }
});

test("Data_Cedulas uses a configurable random pool and selects distinct customers", () => {
  const previous = process.env.DATA_CEDULAS_RANDOM_POOL_SIZE;
  try {
    delete process.env.DATA_CEDULAS_RANDOM_POOL_SIZE;
    assert.equal(dataCedulasRandomPoolSize(), 10);
    process.env.DATA_CEDULAS_RANDOM_POOL_SIZE = "25";
    assert.equal(dataCedulasRandomPoolSize(), 25);
    process.env.DATA_CEDULAS_RANDOM_POOL_SIZE = "invalid";
    assert.equal(dataCedulasRandomPoolSize(), 10);

    const customers = [
      { Cedula: "A", Score: 900 },
      { Cedula: "B", Score: 899 },
      { Cedula: "C", Score: 898 },
    ];
    const selected = selectRandomDataCedulasCustomers(customers, 2, () => 0.999);
    assert.deepEqual(selected.map((customer) => customer.Cedula), ["C", "B"]);
    assert.equal(new Set(selected.map((customer) => customer.Cedula)).size, 2);
  } finally {
    if (previous === undefined) delete process.env.DATA_CEDULAS_RANDOM_POOL_SIZE;
    else process.env.DATA_CEDULAS_RANDOM_POOL_SIZE = previous;
  }
});

test("Data_Cedulas candidate query prioritizes the highest CVScore", () => {
  assert.match(DATA_CEDULAS_CANDIDATE_BATCH_QUERY, /LEFT JOIN latest_score AS cv/i);
  assert.match(DATA_CEDULAS_CANDIDATE_BATCH_QUERY, /FROM dbo\.CVScore AS c/i);
  assert.match(DATA_CEDULAS_CANDIDATE_BATCH_QUERY, /ROW_NUMBER\(\) OVER \(PARTITION BY LTRIM\(RTRIM\(c\.Cedula\)\) ORDER BY c\.FechaConsulta DESC/i);
  assert.match(DATA_CEDULAS_CANDIDATE_BATCH_QUERY, /MAX\(cv\.Score\) AS Score/i);
  assert.match(DATA_CEDULAS_CANDIDATE_BATCH_QUERY, /ORDER BY CASE WHEN Score IS NULL THEN 1 ELSE 0 END,\s*Score DESC,\s*Cedula/i);
});

test("Data_Cedulas existing-id query excludes both B2000 clients and physical persons", () => {
  const query = buildDataCedulasExistingIdsQuery("PA", ":id0, :id1");

  assert.match(query, /FROM PA\.CLIENTES_B2000/i);
  assert.match(query, /FROM PA\.PERSONAS_FISICAS pf/i);
  assert.match(query, /INNER JOIN PA\.PERSONAS p/i);
  assert.match(query, /INNER JOIN PA\.ID_PERSONAS i/i);
  assert.match(query, /TRIM\(i\.NUM_ID\)/i);
  assert.match(query, /UNION/i);
  assert.match(query, /WHERE c\.NUMERO_IDENTIFICACION IN \(:id0, :id1\)/i);
  assert.match(query, /WHERE i\.NUM_ID IN \(:id0, :id1\)/i);
});

test("Data_Cedulas binds indexed identifier variants instead of scanning normalized columns", () => {
  const plan = buildDataCedulasIdentifierBindPlan(["22300299389", "223-0029938-9"]);

  assert.deepEqual(plan.bindVariables, {
    id0: "22300299389",
    id1: "223-0029938-9",
  });
  assert.equal(plan.idList, ":id0, :id1");
});

test("Data_Cedulas PLAFT query follows Portal Comercial direct list sources", () => {
  const query = buildDataCedulasPlaftIdsQuery("PA", ":id0, :id1");

  assert.match(query, /FROM PA\.LISTA_NEGRA ln/i);
  assert.match(query, /FROM PA\.ID_PERSONAS i/i);
  assert.match(query, /FROM PA\.LISTA_NEGRA_NO_CLIENTE n/i);
  assert.match(query, /FROM PA\.MAESTRO_PEP m/i);
  assert.match(query, /NVL\(ln\.INCLUIDO, 'N'\) = 'S'/i);
  assert.match(query, /NVL\(n\.INCLUIDO, 'N'\) = 'S'/i);
  assert.match(query, /NVL\(m\.ESTATUS, 'A'\) = 'A'/i);
  assert.match(query, /FECHA_CESE_FN/i);
  assert.match(query, /REGEXP_REPLACE\(UPPER\(TRIM\(m\.NUM_ID\)\)/i);
  assert.match(query, /WHERE i\.NUM_ID IN \(:id0, :id1\)/i);
  assert.match(query, /AND n\.NUM_ID IN \(:id0, :id1\)/i);
  assert.match(query, /AND m\.NUM_ID IN \(:id0, :id1\)/i);
});

test("Data_Cedulas Lexis screening is fail-closed and bounded", () => {

  const previousTimeout = process.env.DATA_CEDULAS_LEXIS_TIMEOUT_MS;
  const previousPool = process.env.DATA_CEDULAS_LEXIS_SCREEN_POOL_SIZE;
  try {
    delete process.env.DATA_CEDULAS_LEXIS_TIMEOUT_MS;
    delete process.env.DATA_CEDULAS_LEXIS_SCREEN_POOL_SIZE;
    assert.equal(dataCedulasLexisTimeoutMs(), 5000);
    assert.equal(dataCedulasLexisScreenPoolSize(), 3);
    process.env.DATA_CEDULAS_LEXIS_TIMEOUT_MS = "9000";
    process.env.DATA_CEDULAS_LEXIS_SCREEN_POOL_SIZE = "5";
    assert.equal(dataCedulasLexisTimeoutMs(), 9000);
    assert.equal(dataCedulasLexisScreenPoolSize(), 5);
  } finally {
    if (previousTimeout === undefined) delete process.env.DATA_CEDULAS_LEXIS_TIMEOUT_MS;
    else process.env.DATA_CEDULAS_LEXIS_TIMEOUT_MS = previousTimeout;
    if (previousPool === undefined) delete process.env.DATA_CEDULAS_LEXIS_SCREEN_POOL_SIZE;
    else process.env.DATA_CEDULAS_LEXIS_SCREEN_POOL_SIZE = previousPool;
  }
});

test("Data_Cedulas PLAFT mode supports the explicit local-only fallback", () => {
  const previous = process.env.DATA_CEDULAS_PLAFT_MODE;
  try {
    delete process.env.DATA_CEDULAS_PLAFT_MODE;
    assert.equal(dataCedulasPlaftMode(), "strict");
    process.env.DATA_CEDULAS_PLAFT_MODE = "local_only";
    assert.equal(dataCedulasPlaftMode(), "local_only");
    process.env.DATA_CEDULAS_PLAFT_MODE = "local-only";
    assert.equal(dataCedulasPlaftMode(), "local_only");
    process.env.DATA_CEDULAS_PLAFT_MODE = "unexpected";
    assert.equal(dataCedulasPlaftMode(), "strict");
  } finally {
    if (previous === undefined) delete process.env.DATA_CEDULAS_PLAFT_MODE;
    else process.env.DATA_CEDULAS_PLAFT_MODE = previous;
  }
});

test("Data_Cedulas exposes a distinct 502 contract when PLAFT cannot be confirmed", () => {
  const error = new DataCedulasPlaftUnavailableError();
  assert.equal(error.code, "data_cedulas_plaft_unavailable");
  assert.match(error.message, /validación PLAFT/i);
});

test("score freshness: the candidate query filters by FechaConsulta age and the env default is 30 days", () => {
  assert.match(DATA_CEDULAS_CANDIDATE_BATCH_QUERY, /@maxScoreAgeDays <= 0 OR cv\.FechaConsulta >= DATEADD\(day, -@maxScoreAgeDays, GETDATE\(\)\)/i);
  const previous = { age: process.env.DATA_CEDULAS_SCORE_MAX_AGE_DAYS, prepare: process.env.DATA_CEDULAS_PREPARE };
  try {
    delete process.env.DATA_CEDULAS_SCORE_MAX_AGE_DAYS;
    process.env.DATA_CEDULAS_PREPARE = "false";
    assert.equal(dataCedulasScoreMaxAgeDays(), 30);
    process.env.DATA_CEDULAS_SCORE_MAX_AGE_DAYS = "0";
    assert.equal(dataCedulasScoreMaxAgeDays(), 0);
    process.env.DATA_CEDULAS_SCORE_MAX_AGE_DAYS = "invalid";
    assert.equal(dataCedulasScoreMaxAgeDays(), 30);
    delete process.env.DATA_CEDULAS_SCORE_MAX_AGE_DAYS;
    delete process.env.DATA_CEDULAS_PREPARE;
    assert.equal(dataCedulasScoreMaxAgeDays(), 0, "preparing renews the master date, so age stops limiting the pool");
  } finally {
    if (previous.age === undefined) delete process.env.DATA_CEDULAS_SCORE_MAX_AGE_DAYS; else process.env.DATA_CEDULAS_SCORE_MAX_AGE_DAYS = previous.age;
    if (previous.prepare === undefined) delete process.env.DATA_CEDULAS_PREPARE; else process.env.DATA_CEDULAS_PREPARE = previous.prepare;
  }
});

test("decision engine: the candidate query requires a minimum score and income estimator", () => {
  assert.match(DATA_CEDULAS_CANDIDATE_BATCH_QUERY, /@minScore <= 0 OR cv\.Score >= @minScore/);
  assert.match(DATA_CEDULAS_CANDIDATE_BATCH_QUERY, /@minIncomeEstimator <= 0 OR li\.Monto >= @minIncomeEstimator/);
  assert.match(DATA_CEDULAS_CANDIDATE_BATCH_QUERY, /@requiredSegment = '' OR cv\.SgmtCode = @requiredSegment/);
  for (const param of ["maxActiveLoans", "maxActiveCards", "maxUtilization", "maxLoanPaymentRatio", "requireCleanHistory"]) {
    assert.match(DATA_CEDULAS_CANDIDATE_BATCH_QUERY, new RegExp(`@${param}\\b`));
  }
  assert.match(DATA_CEDULAS_CANDIDATE_BATCH_QUERY, /FROM dbo\.Activas AS a/);
  const previousLimits = { loans: process.env.DATA_CEDULAS_MAX_ACTIVE_LOANS, clean: process.env.DATA_CEDULAS_REQUIRE_CLEAN_HISTORY };
  try {
    delete process.env.DATA_CEDULAS_MAX_ACTIVE_LOANS;
    delete process.env.DATA_CEDULAS_REQUIRE_CLEAN_HISTORY;
    assert.deepEqual(dataCedulasDebtLimits(), { requiredSegment: "EXP", minAge: 21, maxAge: 66, maxActiveLoans: 5, maxActiveCards: 8, maxUtilization: 0.6, maxLoanPaymentRatio: 0.25, requireCleanHistory: true });
    process.env.DATA_CEDULAS_MAX_ACTIVE_LOANS = "-1";
    process.env.DATA_CEDULAS_REQUIRE_CLEAN_HISTORY = "false";
    assert.equal(dataCedulasDebtLimits().maxActiveLoans, 5, "negative values fall back to the default");
    assert.equal(dataCedulasDebtLimits().requireCleanHistory, false);
  } finally {
    if (previousLimits.loans === undefined) delete process.env.DATA_CEDULAS_MAX_ACTIVE_LOANS; else process.env.DATA_CEDULAS_MAX_ACTIVE_LOANS = previousLimits.loans;
    if (previousLimits.clean === undefined) delete process.env.DATA_CEDULAS_REQUIRE_CLEAN_HISTORY; else process.env.DATA_CEDULAS_REQUIRE_CLEAN_HISTORY = previousLimits.clean;
  }
  const previous = { score: process.env.DATA_CEDULAS_MIN_SCORE, income: process.env.DATA_CEDULAS_MIN_INCOME_ESTIMATOR };
  try {
    delete process.env.DATA_CEDULAS_MIN_SCORE;
    delete process.env.DATA_CEDULAS_MIN_INCOME_ESTIMATOR;
    assert.equal(dataCedulasMinScore(), 780);
    assert.equal(dataCedulasMinIncomeEstimator(), 60000);
    process.env.DATA_CEDULAS_MIN_SCORE = "0";
    process.env.DATA_CEDULAS_MIN_INCOME_ESTIMATOR = "invalid";
    assert.equal(dataCedulasMinScore(), 0);
    assert.equal(dataCedulasMinIncomeEstimator(), 60000);
  } finally {
    if (previous.score === undefined) delete process.env.DATA_CEDULAS_MIN_SCORE;
    else process.env.DATA_CEDULAS_MIN_SCORE = previous.score;
    if (previous.income === undefined) delete process.env.DATA_CEDULAS_MIN_INCOME_ESTIMATOR;
    else process.env.DATA_CEDULAS_MIN_INCOME_ESTIMATOR = previous.income;
  }
});



