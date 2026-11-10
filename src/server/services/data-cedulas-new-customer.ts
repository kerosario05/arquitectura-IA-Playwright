import fs from "node:fs";
import path from "node:path";
import oracledb from "oracledb";
import sql, { ConnectionPool, config as SqlConfig } from "mssql";
import { screenPortalLexis } from './data-cedulas-portal-lexis';
import { screenMdwLexis } from './data-cedulas-mdw-lexis';
import { createCedulaReleaser, createSessionCedulaReleaser, withPortalSession, type CedulaReleaser, type PortalLogin } from './data-cedulas-reuse';
import { dataCedulasPrepareEnabled, dataCedulasPrepareFreshDays, prepareCedulaRecord, type SqlRunner } from './data-cedulas-prepare';
import { ficoApprovesLoan } from './fico-engine-probe';
import { dataCedulasReadyEnabled, holdReadyCedulas, listReadyCedulas, markReadyCedulasUsed } from './data-cedulas-ready';

const BATCH_SIZE = 10;
// Fetch/check several logical batches in one round trip. Oracle receives at
// most 400 binds (plain and formatted IDs), below its 1000-item IN limit.
const SEARCH_WINDOW_SIZE = 200;

export function dataCedulasSearchWindowSize(remainingBatches: number): number {
  return Math.min(SEARCH_WINDOW_SIZE, Math.max(0, Math.floor(remainingBatches)) * BATCH_SIZE);
}
let sqlPoolPromise: Promise<ConnectionPool> | undefined;
let oracleInitialized = false;

export type DataCedulasCustomer = Record<string, unknown> & { Cedula: string };

export type DataCedulasIdentifierBindPlan = {
  idList: string;
  bindVariables: Record<string, string>;
};

// The credit engine pulls the bureau live and rejects on debt load, not only on score/income
// (Flag 50 active loans, Flag 44/46 debt capacity, Flag 41 utilization, Flags 8-13/16/22 arrears,
// Flag 4 multiple ids). This snapshot-based filter keeps clearly low-risk customers as a proxy.
export const DATA_CEDULAS_CANDIDATE_BATCH_QUERY = `
      WITH latest_score AS (
        SELECT LTRIM(RTRIM(c.Cedula)) AS Cedula, c.Score, c.SgmtCode, c.FechaConsulta,
               ROW_NUMBER() OVER (PARTITION BY LTRIM(RTRIM(c.Cedula)) ORDER BY c.FechaConsulta DESC, c.ID DESC) AS rn
        FROM dbo.CVScore AS c
      ),
      latest_income AS (
        SELECT LTRIM(RTRIM(i.Cedula)) AS Cedula, i.Monto,
               ROW_NUMBER() OVER (PARTITION BY LTRIM(RTRIM(i.Cedula)) ORDER BY i.FechaConsulta DESC, i.ID DESC) AS rn
        FROM dbo.CVIncomeEstimator AS i
      ),
      latest_bsc AS (
        SELECT LTRIM(RTRIM(v.Cedula)) AS Cedula, v.porcentaje_utilizacion_promedio_ult_3_meses,
               v.cantidad_atrasos_a_90_dias_o_mas_ult_12m, v.cantidad_atrasos_a_90_dias_o_mas_ult_6m,
               v.cantidad_atrasos_a_60_dias_ult_12m, v.cantidad_atrasos_a_60_dias_ult_6m,
               v.cantidad_atrasos_a_30_dias_ult_12m, v.cantidad_atrasos_a_30_dias_ult_6m,
               v.cantidad_cuentas_activas_estatus_adverso_ult_24m_sf, v.variacion_negativa_en_cvscore, v.perfilMultiplesCedulas,
               ROW_NUMBER() OVER (PARTITION BY LTRIM(RTRIM(v.Cedula)) ORDER BY v.FechaConsulta DESC, v.ID DESC) AS rn
        FROM dbo.BSCVariables AS v
      ),
      debt AS (
        SELECT LTRIM(RTRIM(a.Cedula)) AS Cedula,
               SUM(CASE WHEN a.Categoria = 'PR' THEN 1 ELSE 0 END) AS PrActivos,
               SUM(CASE WHEN a.Categoria = 'PR' THEN ISNULL(a.MontoCuotas, 0) ELSE 0 END) AS CuotasPr,
               SUM(CASE WHEN a.Categoria = 'TC' THEN 1 ELSE 0 END) AS TcActivas
        FROM dbo.Activas AS a
        GROUP BY LTRIM(RTRIM(a.Cedula))
      ),
      candidate_ids AS (
        SELECT LTRIM(RTRIM(dg.Cedula)) AS Cedula,
               MAX(cv.Score) AS Score,
               MAX(NULLIF(LTRIM(RTRIM(dg.PrimerNombre)), '')) AS PrimerNombre,
               MAX(NULLIF(LTRIM(RTRIM(dg.SegundoNombre)), '')) AS SegundoNombre,
               MAX(NULLIF(LTRIM(RTRIM(dg.PrimerApellido)), '')) AS PrimerApellido,
               MAX(NULLIF(LTRIM(RTRIM(dg.SegundoApellido)), '')) AS SegundoApellido,
               MAX(dg.FechaNacimiento) AS FechaNacimiento,
               MAX(NULLIF(LTRIM(RTRIM(dg.Sexo)), '')) AS Sexo,
               MAX(NULLIF(LTRIM(RTRIM(dg.Nacionalidad)), '')) AS Nacionalidad
        FROM dbo.DatosGenerales AS dg
        LEFT JOIN latest_score AS cv
          ON cv.Cedula = LTRIM(RTRIM(dg.Cedula)) AND cv.rn = 1
        LEFT JOIN latest_income AS li
          ON li.Cedula = LTRIM(RTRIM(dg.Cedula)) AND li.rn = 1
        LEFT JOIN latest_bsc AS b
          ON b.Cedula = LTRIM(RTRIM(dg.Cedula)) AND b.rn = 1
        LEFT JOIN debt AS d
          ON d.Cedula = LTRIM(RTRIM(dg.Cedula))
        WHERE NULLIF(LTRIM(RTRIM(dg.Cedula)), '') IS NOT NULL
          AND (@maxScoreAgeDays <= 0 OR cv.FechaConsulta >= DATEADD(day, -@maxScoreAgeDays, GETDATE()))
          AND (@minScore <= 0 OR cv.Score >= @minScore)
          AND (@minAge <= 0 OR (DATEDIFF(year, dg.FechaNacimiento, GETDATE())
                - CASE WHEN DATEADD(year, DATEDIFF(year, dg.FechaNacimiento, GETDATE()), dg.FechaNacimiento) > GETDATE() THEN 1 ELSE 0 END) >= @minAge)
          AND (@maxAge <= 0 OR (DATEDIFF(year, dg.FechaNacimiento, GETDATE())
                - CASE WHEN DATEADD(year, DATEDIFF(year, dg.FechaNacimiento, GETDATE()), dg.FechaNacimiento) > GETDATE() THEN 1 ELSE 0 END) <= @maxAge)
          AND (@requiredSegment = '' OR cv.SgmtCode = @requiredSegment)
          AND (@minIncomeEstimator <= 0 OR li.Monto >= @minIncomeEstimator)
          AND (@maxActiveLoans < 0 OR ISNULL(d.PrActivos, 0) <= @maxActiveLoans)
          AND (@maxActiveCards < 0 OR ISNULL(d.TcActivas, 0) <= @maxActiveCards)
          AND (@maxUtilization <= 0 OR ISNULL(b.porcentaje_utilizacion_promedio_ult_3_meses, 0) <= @maxUtilization)
          AND (@maxLoanPaymentRatio <= 0 OR ISNULL(d.CuotasPr, 0) <= @maxLoanPaymentRatio * ISNULL(NULLIF(li.Monto, 0), 1))
          AND (@requireCleanHistory = 0 OR (
                ISNULL(b.cantidad_atrasos_a_90_dias_o_mas_ult_12m, 0) = 0
            AND ISNULL(b.cantidad_atrasos_a_90_dias_o_mas_ult_6m, 0) = 0
            AND ISNULL(b.cantidad_atrasos_a_60_dias_ult_12m, 0) = 0
            AND ISNULL(b.cantidad_atrasos_a_60_dias_ult_6m, 0) = 0
            AND ISNULL(b.cantidad_atrasos_a_30_dias_ult_12m, 0) = 0
            AND ISNULL(b.cantidad_atrasos_a_30_dias_ult_6m, 0) = 0
            AND ISNULL(b.cantidad_cuentas_activas_estatus_adverso_ult_24m_sf, 0) = 0
            AND ISNULL(b.variacion_negativa_en_cvscore, 0) = 0
            AND ISNULL(b.perfilMultiplesCedulas, 'N') = 'N'))
        GROUP BY LTRIM(RTRIM(dg.Cedula))
      )
      SELECT Cedula, Score, PrimerNombre, SegundoNombre, PrimerApellido, SegundoApellido, FechaNacimiento, Sexo, Nacionalidad
      FROM candidate_ids
      ORDER BY CASE WHEN Score IS NULL THEN 1 ELSE 0 END,
               Score DESC,
               Cedula
      OFFSET @offset ROWS FETCH NEXT @batchSize ROWS ONLY;
    `;

/**
 * Build indexed Oracle predicates without wrapping the identifier columns in
 * REGEXP_REPLACE/TRIM. The normalized value and the Dominican 3-7-1 format
 * cover the two representations used by the source tables while preserving
 * the previous separator-insensitive matching contract.
 */
export function buildDataCedulasIdentifierBindPlan(ids: string[]): DataCedulasIdentifierBindPlan {
  const bindVariables: Record<string, string> = {};
  const bindNames: string[] = [];
  const seen = new Set<string>();

  for (const rawId of ids) {
    const normalized = normalizeId(rawId);
    if (!normalized) continue;

    const variants = [normalized];
    if (/^\d{11}$/.test(normalized)) {
      variants.push(`${normalized.slice(0, 3)}-${normalized.slice(3, 10)}-${normalized.slice(10)}`);
    }

    for (const variant of variants) {
      if (seen.has(variant)) continue;
      seen.add(variant);
      const bindName = `id${bindNames.length}`;
      bindNames.push(`:${bindName}`);
      bindVariables[bindName] = variant;
    }
  }

  return { idList: bindNames.join(", "), bindVariables };
}

export function buildDataCedulasExistingIdsQuery(schema: string, idList: string): string {
  return `
      SELECT DISTINCT normalized_id
      FROM (
        SELECT REGEXP_REPLACE(UPPER(TRIM(c.NUMERO_IDENTIFICACION)), '[^[:alnum:]]', '') AS normalized_id
        FROM ${schema}.CLIENTES_B2000 c
        WHERE c.NUMERO_IDENTIFICACION IN (${idList})
        UNION
        SELECT REGEXP_REPLACE(UPPER(TRIM(i.NUM_ID)), '[^[:alnum:]]', '') AS normalized_id
        FROM ${schema}.PERSONAS_FISICAS pf
        INNER JOIN ${schema}.PERSONAS p
          ON TRIM(p.COD_PER_FISICA) = TRIM(pf.COD_PER_FISICA)
        INNER JOIN ${schema}.ID_PERSONAS i
          ON TRIM(i.COD_PERSONA) = TRIM(p.COD_PERSONA)
        WHERE i.NUM_ID IN (${idList})
      )
      WHERE normalized_id IS NOT NULL
    `;
}

/**
 * Identificaciones que Portal Comercial consulta directamente al validar listas PLAFT.
 * Se conservan únicamente coincidencias activas/configuradas de Lista 01, Lista 02
 * y Lista PEP; no se usa PA_DETALLE_VALIDACION_LISTA porque contiene histórico de validaciones.
 */
export function buildDataCedulasPlaftIdsQuery(schema: string, idList: string): string {
  return `
      SELECT DISTINCT normalized_id
      FROM (
        SELECT REGEXP_REPLACE(UPPER(TRIM(i.NUM_ID)), '[^[:alnum:]]', '') AS normalized_id
        FROM ${schema}.ID_PERSONAS i
        WHERE i.NUM_ID IN (${idList})
          AND EXISTS (
            SELECT 1
            FROM ${schema}.PERSONAS p
            WHERE TRIM(p.COD_PERSONA) = TRIM(i.COD_PERSONA)
          )
          AND EXISTS (
            SELECT 1
            FROM ${schema}.LISTA_NEGRA ln
            WHERE NVL(ln.INCLUIDO, 'N') = 'S'
              AND TRIM(ln.COD_PERSONA) = TRIM(i.COD_PERSONA)
          )
        UNION
        SELECT REGEXP_REPLACE(UPPER(TRIM(n.NUM_ID)), '[^[:alnum:]]', '') AS normalized_id
        FROM ${schema}.LISTA_NEGRA_NO_CLIENTE n
        WHERE NVL(n.INCLUIDO, 'N') = 'S'
          AND n.NUM_ID IN (${idList})
        UNION
        SELECT REGEXP_REPLACE(UPPER(TRIM(m.NUM_ID)), '[^[:alnum:]]', '') AS normalized_id
        FROM ${schema}.MAESTRO_PEP m
        WHERE NVL(m.ESTATUS, 'A') = 'A'
          AND (m.FECHA_CESE_FN IS NULL OR TRUNC(m.FECHA_CESE_FN) >= TRUNC(SYSDATE))
          AND m.NUM_ID IN (${idList})
      )
      WHERE normalized_id IS NOT NULL
    `;
}

export type NewCustomerResult = {
  database: string;
  batchSize: number;
  batchesScanned: number;
  candidatesScanned: number;
  plaftStatus: DataCedulasPlaftStatus;
  customer: DataCedulasCustomer;
};

export type DataCedulasPlaftStatus = "verified" | "local_only_unverified";


export type NewCustomersResult = Omit<NewCustomerResult, "customer"> & {
  customers: DataCedulasCustomer[];
};

export class DataCedulasPlaftUnavailableError extends Error {
  readonly code = "data_cedulas_plaft_unavailable";

  constructor() {
    super("No se pudo confirmar la validación PLAFT de los candidatos");
    this.name = "DataCedulasPlaftUnavailableError";
  }
}

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function requiredEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

function normalizeId(value: unknown): string {
  return String(value ?? "").trim().replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function oracleSchema(): string {
  const schema = (env("DATA_CEDULAS_ORACLE_SCHEMA") || "PA").toUpperCase();
  if (!/^[A-Z][A-Z0-9_$#]*$/.test(schema)) {
    throw new Error("DATA_CEDULAS_ORACLE_SCHEMA no es un identificador Oracle válido");
  }
  return schema;
}

function oracleClientDir(): string {
  return env("DATA_CEDULAS_ORACLE_CLIENT_LIB_DIR") || "C:\\instantclient_19_32";
}

function oracleTnsAdmin(): string {
  return env("DATA_CEDULAS_ORACLE_TNS_ADMIN") || path.join(oracleClientDir(), "network", "admin");
}

export function dataCedulasSqlRequestTimeoutMs(): number {
  const configured = Number(env("DATA_CEDULAS_SQL_REQUEST_TIMEOUT_MS") || 60000);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 60000;
}

/**
 * Maximum age, in days, of the bureau score consultation a candidate must have (the Portal only
 * trusts a recent consultation to load rates). 0 disables the freshness filter.
 */
export function dataCedulasScoreMaxAgeDays(): number {
  // Preparing a cédula renews its master date when it is handed out, so its age no longer limits the pool.
  const fallback = dataCedulasPrepareEnabled() ? 0 : 30;
  const raw = env("DATA_CEDULAS_SCORE_MAX_AGE_DAYS");
  const configured = raw === undefined ? fallback : Number(raw);
  return Number.isFinite(configured) && configured >= 0 ? Math.floor(configured) : fallback;
}

function nonNegativeIntEnv(name: string, fallback: number): number {
  const raw = env(name);
  const configured = raw === undefined ? fallback : Number(raw);
  return Number.isFinite(configured) && configured >= 0 ? Math.floor(configured) : fallback;
}

/** Minimum bureau score so the credit decision engine does not reject by "CVScore minimum for income". 0 disables. */
export function dataCedulasMinScore(): number {
  return nonNegativeIntEnv("DATA_CEDULAS_MIN_SCORE", 780);
}

/** Minimum adjusted CV income estimator (BSCVariables) so the engine's income rule passes. 0 disables. */
export function dataCedulasMinIncomeEstimator(): number {
  // The engine's Flag 17 states its own minimum: "Ingreso menor a al mínimo de 60000".
  return nonNegativeIntEnv("DATA_CEDULAS_MIN_INCOME_ESTIMATOR", 60000);
}

function nonNegativeNumberEnv(name: string, fallback: number): number {
  const configured = env(name);
  const parsed = configured === undefined || configured.trim() === "" ? Number.NaN : Number(configured);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Debt-load limits that mimic the credit engine's rejections; 0 disables utilization/payment-ratio limits. */
export function dataCedulasDebtLimits() {
  return {
    // Only the standard bureau segment maps to the Portal's rate table; "" disables the check.
    requiredSegment: (env("DATA_CEDULAS_REQUIRED_SEGMENT") ?? "EXP").trim(),
    // The engine rejects the whole participant outside an age range (Flag 5). Observed against it:
    // 29 and 66 pass, 71 and 87 are rejected, so the limits stay inside what was seen to pass.
    minAge: Math.floor(nonNegativeNumberEnv("DATA_CEDULAS_MIN_AGE", 21)),
    maxAge: Math.floor(nonNegativeNumberEnv("DATA_CEDULAS_MAX_AGE", 66)),
    // Defaults are the engine's measured thresholds; the candidates are still checked against the engine itself.
    maxActiveLoans: Math.floor(nonNegativeNumberEnv("DATA_CEDULAS_MAX_ACTIVE_LOANS", 5)),
    maxActiveCards: Math.floor(nonNegativeNumberEnv("DATA_CEDULAS_MAX_ACTIVE_CARDS", 8)),
    maxUtilization: nonNegativeNumberEnv("DATA_CEDULAS_MAX_UTILIZATION", 0.6),
    maxLoanPaymentRatio: nonNegativeNumberEnv("DATA_CEDULAS_MAX_LOAN_PAYMENT_RATIO", 0.25),
    requireCleanHistory: env("DATA_CEDULAS_REQUIRE_CLEAN_HISTORY")?.trim().toLowerCase() !== "false",
  };
}

export function dataCedulasRandomPoolSize(): number {
  const configured = Number(env("DATA_CEDULAS_RANDOM_POOL_SIZE") || 10);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 10;
}

export function dataCedulasLexisTimeoutMs(): number {
  const configured = Number(env("DATA_CEDULAS_LEXIS_TIMEOUT_MS") || 5000);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 5000;
}

export function dataCedulasLexisScreenPoolSize(): number {
  const configured = Number(env("DATA_CEDULAS_LEXIS_SCREEN_POOL_SIZE") || 3);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 3;
}

/**
 * strict: local filters plus the external Lexis Nexis procedure are required.
 * local_only: use the local Oracle PLAFT lists and return candidates even when
 * the external MDT4/Lexis service is unavailable. The result is explicitly
 * marked as unverified for the external list.
 */
export function dataCedulasPlaftMode(): "strict" | "local_only" {
  const configured = (env("DATA_CEDULAS_PLAFT_MODE") || "strict").toLowerCase().replace(/-/g, "_");
  return configured === "local_only" ? "local_only" : "strict";
}

/** Missing environment assignment permits local-only; a broken configured
 * environment must still run screening and fail closed on any upstream error. */
export function dataCedulasPlaftModeForDatabase(
  database: string,
  configuration: NodeJS.ProcessEnv = process.env,
): "strict" | "local_only" {
  const mode = (configuration.DATA_CEDULAS_PLAFT_MODE || 'strict').trim().toLowerCase().replace(/-/g, '_');
  if (mode === 'local_only') return 'local_only';
  const transport = configuration.DATA_CEDULAS_LEXIS_TRANSPORT?.trim().toLowerCase() || 'portal';
  if (!['mdw', 'portal'].includes(transport)) return 'strict';
  const assigned = configuration[transport === 'mdw' ? 'DATA_CEDULAS_LEXIS_MDW_DATABASE' : 'DATA_CEDULAS_LEXIS_PORTAL_DATABASE'];
  return assigned?.trim().toUpperCase() === database.trim().toUpperCase() ? 'strict' : 'local_only';
}

export function selectRandomDataCedulasCustomers(
  customers: DataCedulasCustomer[],
  count: number,
  random: () => number = Math.random,
): DataCedulasCustomer[] {
  const requestedCount = Number.isSafeInteger(count) && count > 0 ? count : 1;
  const remaining = [...customers];
  const selected: DataCedulasCustomer[] = [];
  while (remaining.length > 0 && selected.length < requestedCount) {
    const randomValue = Number(random());
    const boundedRandom = Number.isFinite(randomValue) ? Math.min(Math.max(randomValue, 0), 0.999999999999) : 0;
    const index = Math.floor(boundedRandom * remaining.length);
    selected.push(remaining.splice(index, 1)[0]);
  }
  return selected;
}

function initializeOracle(): void {
  if (oracleInitialized) return;

  const libDir = oracleClientDir();
  const configDir = oracleTnsAdmin();
  if (!fs.existsSync(path.join(libDir, "oci.dll"))) {
    throw new Error(`No se encontró oci.dll en ${libDir}`);
  }
  if (!fs.existsSync(path.join(configDir, "tnsnames.ora"))) {
    throw new Error(`No se encontró tnsnames.ora en ${configDir}`);
  }

  process.env.TNS_ADMIN = configDir;
  if (!oracledb.oracleClientVersionString) {
    oracledb.initOracleClient({ libDir, configDir });
  }
  oracleInitialized = true;
}

export function listDataCedulasTnsAliases(): string[] {
  const contentsPath = path.join(oracleTnsAdmin(), "tnsnames.ora");
  if (!fs.existsSync(contentsPath)) return [];

  const contents = fs.readFileSync(contentsPath, "utf8");
  const aliases = new Set<string>();
  for (const match of contents.matchAll(/^\s*([A-Za-z][A-Za-z0-9_$#]*)\s*=\s*$/gm)) {
    aliases.add(match[1].toUpperCase());
  }
  return [...aliases].sort();
}

export function validateDataCedulasDatabase(value: unknown): string {
  const alias = String(value || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_$#]*$/.test(alias)) {
    throw new Error("El parámetro db debe ser un alias TNS válido, por ejemplo QA1");
  }
  const aliases = listDataCedulasTnsAliases();
  if (aliases.length > 0 && !aliases.includes(alias)) {
    throw new Error(`El alias TNS ${alias} no existe en tnsnames.ora`);
  }
  return alias;
}

async function sqlPool(): Promise<ConnectionPool> {
  if (!sqlPoolPromise) {
    const config: SqlConfig = {
      server: requiredEnv("DATA_CEDULAS_SQL_SERVER"),
      database: requiredEnv("DATA_CEDULAS_SQL_DATABASE"),
      user: requiredEnv("DATA_CEDULAS_SQL_USER"),
      password: requiredEnv("DATA_CEDULAS_SQL_PASSWORD"),
      requestTimeout: dataCedulasSqlRequestTimeoutMs(),
      options: { encrypt: false, trustServerCertificate: true },
    };
    sqlPoolPromise = new sql.ConnectionPool(config).connect();
  }
  return sqlPoolPromise;
}

const runSql: SqlRunner = async (text, params) => {
  const request = (await sqlPool()).request();
  for (const [name, value] of Object.entries(params)) request.input(name, sql.VarChar, value);
  const result = await request.query(text);
  return { rows: result.recordset ?? [], rowsAffected: result.rowsAffected[0] ?? 0 };
};

async function fetchCandidateBatch(offset: number, batchSize = BATCH_SIZE, minIncomeEstimator = 0): Promise<DataCedulasCustomer[]> {
  const pool = await sqlPool();
  const limits = dataCedulasDebtLimits();
  const result = await pool.request()
    .input("requiredSegment", sql.VarChar, limits.requiredSegment)
    .input("minAge", sql.Int, limits.minAge)
    .input("maxAge", sql.Int, limits.maxAge)
    .input("maxActiveLoans", sql.Int, limits.maxActiveLoans)
    .input("maxActiveCards", sql.Int, limits.maxActiveCards)
    .input("maxUtilization", sql.Float, limits.maxUtilization)
    .input("maxLoanPaymentRatio", sql.Float, limits.maxLoanPaymentRatio)
    .input("requireCleanHistory", sql.Bit, limits.requireCleanHistory)
    .input("offset", sql.Int, offset)
    .input("batchSize", sql.Int, batchSize)
    .input("maxScoreAgeDays", sql.Int, dataCedulasScoreMaxAgeDays())
    .input("minScore", sql.Int, dataCedulasMinScore())
    .input("minIncomeEstimator", sql.Int, Math.max(dataCedulasMinIncomeEstimator(), Math.floor(minIncomeEstimator)))
    .query(DATA_CEDULAS_CANDIDATE_BATCH_QUERY);

  return result.recordset.map(customerFromRow);
}

function customerFromRow(row: unknown): DataCedulasCustomer {
  const record = row as Record<string, unknown>;
  const rawScore = record.Score;
  const parsedScore = rawScore === null || rawScore === undefined || rawScore === ""
    ? null
    : Number(rawScore);
  return {
    Cedula: String(record.Cedula ?? "").trim(),
    Score: parsedScore !== null && Number.isFinite(parsedScore) ? parsedScore : null,
    PrimerNombre: record.PrimerNombre == null ? "" : String(record.PrimerNombre).trim(),
    Sexo: record.Sexo == null ? "" : String(record.Sexo).trim(),
    SegundoNombre: record.SegundoNombre == null ? "" : String(record.SegundoNombre).trim(),
    PrimerApellido: record.PrimerApellido == null ? "" : String(record.PrimerApellido).trim(),
    SegundoApellido: record.SegundoApellido == null ? "" : String(record.SegundoApellido).trim(),
    FechaNacimiento: record.FechaNacimiento instanceof Date ? record.FechaNacimiento : null,
    Nacionalidad: record.Nacionalidad == null ? "Republica Dominicana" : String(record.Nacionalidad).trim(),
  };
}

/** Customer rows for known ids (the prepared stock), in the same shape the search returns. */
async function fetchCustomersByIds(ids: string[]): Promise<DataCedulasCustomer[]> {
  if (ids.length === 0) return [];
  const request = (await sqlPool()).request();
  const names = ids.map((id, index) => { request.input(`c${index}`, sql.VarChar, id); return `@c${index}`; });
  const result = await request.query(`
    SELECT LTRIM(RTRIM(dg.Cedula)) AS Cedula,
           MAX(cv.Score) AS Score,
           MAX(NULLIF(LTRIM(RTRIM(dg.PrimerNombre)), '')) AS PrimerNombre, MAX(NULLIF(LTRIM(RTRIM(dg.SegundoNombre)), '')) AS SegundoNombre,
           MAX(NULLIF(LTRIM(RTRIM(dg.PrimerApellido)), '')) AS PrimerApellido, MAX(NULLIF(LTRIM(RTRIM(dg.SegundoApellido)), '')) AS SegundoApellido,
           MAX(dg.FechaNacimiento) AS FechaNacimiento, MAX(NULLIF(LTRIM(RTRIM(dg.Sexo)), '')) AS Sexo,
           MAX(NULLIF(LTRIM(RTRIM(dg.Nacionalidad)), '')) AS Nacionalidad
    FROM dbo.DatosGenerales AS dg
    OUTER APPLY (SELECT TOP 1 c.Score FROM dbo.CVScore AS c WHERE LTRIM(RTRIM(c.Cedula)) = LTRIM(RTRIM(dg.Cedula)) ORDER BY c.FechaConsulta DESC, c.ID DESC) AS cv
    WHERE LTRIM(RTRIM(dg.Cedula)) IN (${names.join(",")})
    GROUP BY LTRIM(RTRIM(dg.Cedula))`);
  return result.recordset.map(customerFromRow);
}

async function findExistingIds(connection: oracledb.Connection, ids: string[]): Promise<Set<string>> {
  const { idList, bindVariables } = buildDataCedulasIdentifierBindPlan(ids);
  if (!idList) return new Set<string>();
  const schema = oracleSchema();
  const result = await connection.execute(
    buildDataCedulasExistingIdsQuery(schema, idList),
    bindVariables,
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );

  const existing = new Set<string>();
  for (const row of (result.rows || []) as Array<Record<string, unknown>>) {
    const normalizedId = String(row.NORMALIZED_ID ?? row.normalized_id ?? "");
    if (normalizedId) existing.add(normalizedId);
  }
  return existing;
}

async function findPlaftIds(connection: oracledb.Connection, ids: string[]): Promise<Set<string>> {
  const { idList, bindVariables } = buildDataCedulasIdentifierBindPlan(ids);
  if (!idList) return new Set<string>();
  const schema = oracleSchema();
  const result = await connection.execute(
    buildDataCedulasPlaftIdsQuery(schema, idList),
    bindVariables,
    { outFormat: oracledb.OUT_FORMAT_OBJECT },
  );

  const matches = new Set<string>();
  for (const row of (result.rows || []) as Array<Record<string, unknown>>) {
    const normalizedId = String(row.NORMALIZED_ID ?? row.normalized_id ?? "");
    if (normalizedId) matches.add(normalizedId);
  }
  return matches;
}


async function closeDataCedulasOracleConnection(connection: oracledb.Connection): Promise<void> {
  // Oracle can keep a PL/SQL call alive after a client-side timeout. Do not let
  // cleanup hold the HTTP request open indefinitely; the connection is dropped
  // and any late close error is intentionally ignored.
  const closePromise = connection.close({ drop: true }).catch(() => undefined);
  await Promise.race([
    closePromise,
    new Promise<void>((resolve) => setTimeout(resolve, 1500)),
  ]);
}

function scheduleDataCedulasOracleConnectionClose(connection: oracledb.Connection): void {
  // Calling close() while a remote PL/SQL call is still active can block inside
  // the native Oracle driver. Schedule cleanup after the caller has resumed so
  // the API can finish its fail-closed response first.
  setImmediate(() => {
    void closeDataCedulasOracleConnection(connection);
  });
}


type FindCriteria = { minIncomeEstimator?: number; release?: CedulaReleaser | null; portalLogin?: PortalLogin };

// Cancelling open requests signs in with the job's own Portal credentials when the caller has them.
function releaserFor(criteria: FindCriteria): CedulaReleaser | undefined {
  return criteria.release !== undefined
    ? criteria.release ?? undefined
    : (criteria.portalLogin && createSessionCedulaReleaser(criteria.portalLogin)) || createCedulaReleaser();
}

/** Hands out prepared (engine-approved) cédulas first; the search below only covers what the stock cannot. */
export async function findNextDataCedulasCustomers(
  database: string,
  count = 1,
  excludeIds: string[] = [],
  /** `release` frees a cédula (cancels its active Portal cases) before it is handed out; `null` disables it. */
  criteria: FindCriteria = {},
): Promise<NewCustomersResult | null> {
  const requestedCount = Number.isSafeInteger(count) && count > 0 ? count : 1;
  const stock = dataCedulasReadyEnabled() ? await takeReadyCustomers(database, requestedCount, excludeIds, criteria) : [];
  if (stock.length === 0) return searchDataCedulasCustomers(database, requestedCount, excludeIds, criteria);
  const plaftStatus: DataCedulasPlaftStatus = dataCedulasPlaftModeForDatabase(database) === "strict" ? "verified" : "local_only_unverified";
  const fromStock = { database, batchSize: BATCH_SIZE, batchesScanned: 0, candidatesScanned: 0, plaftStatus, customers: stock };
  if (stock.length >= requestedCount) return fromStock;
  const rest = await searchDataCedulasCustomers(database, requestedCount - stock.length, [...excludeIds, ...stock.map((customer) => customer.Cedula)], criteria);
  return rest ? { ...rest, customers: [...stock, ...rest.customers] } : fromStock;
}

async function takeReadyCustomers(database: string, count: number, excludeIds: string[], criteria: FindCriteria): Promise<DataCedulasCustomer[]> {
  const ids = listReadyCedulas({ excluded: excludeIds });
  if (ids.length === 0) return [];
  const release = releaserFor(criteria);
  initializeOracle();
  const connection = await oracledb.getConnection({
    user: requiredEnv("DATA_CEDULAS_ORACLE_USER"),
    password: requiredEnv("DATA_CEDULAS_ORACLE_PASSWORD"),
    connectString: database,
  });
  const picked: DataCedulasCustomer[] = [];
  const usedNow: string[] = [];
  try {
    for (let start = 0; start < ids.length && picked.length < count; start += 50) {
      const customers = await fetchCustomersByIds(ids.slice(start, start + 50));
      const normalized = customers.map((customer) => normalizeId(customer.Cedula)).filter(Boolean);
      const [existing, plaft] = normalized.length > 0
        ? await Promise.all([findExistingIds(connection, normalized), findPlaftIds(connection, normalized)])
        : [new Set<string>(), new Set<string>()];
      for (const customer of customers) {
        if (picked.length >= count) break;
        const id = normalizeId(customer.Cedula);
        // Became a customer or entered a list since it was prepared: leave it out.
        if (id && existing.has(id)) usedNow.push(id); // a customer now: out of the stock for good
        if (!id || existing.has(id) || plaft.has(id)) continue;
        if (release && await release(String(customer.Cedula).trim()) === "blocked") continue;
        picked.push(customer);
      }
    }
    markReadyCedulasUsed(usedNow);
    if (picked.length > 0) holdReadyCedulas(picked.map((customer) => customer.Cedula));
    console.log(`[data-cedulas][ready] requested=${count} fromStock=${picked.length} stockAvailable=${ids.length}`);
    return picked;
  } finally {
    scheduleDataCedulasOracleConnectionClose(connection);
  }
}

/** `minIncomeEstimator` raises (never lowers) the configured floor, e.g. to the income a flow declares: the credit engine rejects estimators below it (Flag 17). */
async function searchDataCedulasCustomers(
  database: string,
  count = 1,
  excludeIds: string[] = [],
  criteria: FindCriteria = {},
): Promise<NewCustomersResult | null> {
  const requestedCount = Number.isSafeInteger(count) && count > 0 ? count : 1;
  const release = releaserFor(criteria);
  const prepare = dataCedulasPrepareEnabled();
  const engineCheck = Boolean(criteria.portalLogin) && env("DATA_CEDULAS_ENGINE_CHECK")?.trim().toLowerCase() !== "false";
  const hasHandOutChecks = Boolean(release) || prepare || engineCheck;
  // A cédula is handed out only when it is free, its stored bureau data stays valid, and the engine approves it.
  const isFree = async (customer: DataCedulasCustomer): Promise<boolean> => {
    const id = String(customer.Cedula).trim();
    if (release) {
      const outcome = await release(id);
      console.log(`[data-cedulas][reuse] release=${outcome}`);
      if (outcome === "blocked") return false;
    }
    if (prepare) {
      const prepared = await prepareCedulaRecord(runSql, id, { freshDays: dataCedulasPrepareFreshDays(), backupDir: path.join(process.cwd(), ".artifacts", "data-cedulas-backups") });
      console.log(`[data-cedulas][prepare] status=${prepared.status}${prepared.status === "missing" ? "" : ` days=${prepared.days}`}`);
      if (prepared.status === "missing") return false;
    }
    if (engineCheck) {
      const verdict = await withPortalSession(criteria.portalLogin!, (http) => ficoApprovesLoan(http as any, id));
      console.log(`[data-cedulas][engine] approved=${verdict.approved}${verdict.approved ? "" : ` ${verdict.detail}`}`);
      if (!verdict.approved) return false;
    }
    return true;
  };
  initializeOracle();
  const connection = await oracledb.getConnection({
    user: requiredEnv("DATA_CEDULAS_ORACLE_USER"),
    password: requiredEnv("DATA_CEDULAS_ORACLE_PASSWORD"),
    connectString: database,
  });
  const configuredMaxBatches = Number(env("DATA_CEDULAS_MAX_BATCHES") || 100);
  const maxBatches = Number.isFinite(configuredMaxBatches) && configuredMaxBatches > 0
    ? Math.floor(configuredMaxBatches)
    : 100;
  const randomPoolSize = Math.max(requestedCount, dataCedulasRandomPoolSize());
  const lexisScreenPoolSize = Math.max(requestedCount, Math.min(randomPoolSize, dataCedulasLexisScreenPoolSize()));
  const plaftMode = dataCedulasPlaftModeForDatabase(database);
  const candidatePoolSize = randomPoolSize;
  const plaftStatus: DataCedulasPlaftStatus = plaftMode === "strict" ? "verified" : "local_only_unverified";
  if (plaftMode === "local_only") {
    console.warn("[data-cedulas][plaft] mode=local_only; MDT4/Lexis Nexis is not verified for this response");
  }

  let offset = 0;
  let batchesScanned = 0;
  let candidatesScanned = 0;
  const customers: DataCedulasCustomer[] = [];
  const selectedIds = new Set<string>(excludeIds.map(normalizeId));
  try {
    while (batchesScanned < maxBatches) {
      const batch = await fetchCandidateBatch(offset, dataCedulasSearchWindowSize(maxBatches - batchesScanned), criteria.minIncomeEstimator);
      if (batch.length === 0) break;

      batchesScanned += Math.ceil(batch.length / BATCH_SIZE);
      candidatesScanned += batch.length;
      const ids = batch.map((candidate) => normalizeId(candidate.Cedula)).filter(Boolean);
      const [existing, plaftMatches] = ids.length > 0
        ? await Promise.all([findExistingIds(connection, ids), findPlaftIds(connection, ids)])
        : [new Set<string>(), new Set<string>()];
      for (const customer of batch) {
        const normalizedId = normalizeId(customer.Cedula);
        if (!normalizedId || existing.has(normalizedId) || plaftMatches.has(normalizedId) || selectedIds.has(normalizedId)) continue;
        selectedIds.add(normalizedId);
        customers.push(customer);
        if (customers.length >= candidatePoolSize) break;
      }
      offset += batch.length;
      if (customers.length >= candidatePoolSize) break;
    }
    console.log(`[data-cedulas] candidates=${candidatesScanned} eligibleAfterOracle=${customers.length} requested=${requestedCount}`);
    if (customers.length === 0) return null;
    let resultCustomers = selectRandomDataCedulasCustomers(customers, requestedCount);
    if (plaftMode !== 'strict' && hasHandOutChecks) {
      resultCustomers = [];
      for (const customer of selectRandomDataCedulasCustomers(customers, customers.length)) {
        if (resultCustomers.length >= requestedCount) break;
        if (await isFree(customer)) resultCustomers.push(customer);
      }
    }
    if (plaftMode === 'strict') {
      if (customers.length < requestedCount) {
        throw new Error(`Solo ${customers.length} cédula(s) cumplen los filtros de riesgo y no están en listas/clientes (se pidieron ${requestedCount}). Relaje DATA_CEDULAS_SCORE_MAX_AGE_DAYS, DATA_CEDULAS_MIN_INCOME_ESTIMATOR o DATA_CEDULAS_INCOME_TO_DECLARED_RATIO`);
      }
      // Shuffle eligible high-score candidates first, then screen only as many
      // as needed. Bounded groups share no Oracle connection or browser state.
      const shuffled = selectRandomDataCedulasCustomers(customers, customers.length);
      resultCustomers = [];
      const maxScreens = Math.min(shuffled.length, Math.max(requestedCount, 30));
      const deadline = Date.now() + 30000;
      for (let start = 0; start < maxScreens && Date.now() < deadline; start += lexisScreenPoolSize) {
        const group = shuffled.slice(start, Math.min(maxScreens, start + lexisScreenPoolSize));
        const screen = env('DATA_CEDULAS_LEXIS_TRANSPORT') === 'mdw' ? screenMdwLexis : screenPortalLexis;
        const results = await Promise.all(group.map(c => screen(c, database)));
        console.log(`[data-cedulas][lexis] group=${group.length} results=${results.join(',')}`);
        for (let i = 0; i < group.length && resultCustomers.length < requestedCount; i++) {
          if (results[i] === 'clear' && await isFree(group[i])) resultCustomers.push(group[i]);
        }
        if (resultCustomers.length >= requestedCount) break;
        // One unscreenable candidate (e.g. incomplete name data) is skipped, never handed out; only
        // finishing short of the requested count fails, so a single odd record does not stop the run.
      }
      if (resultCustomers.length < requestedCount) throw new DataCedulasPlaftUnavailableError();
    }
    return {
      database,
      batchSize: BATCH_SIZE,
      batchesScanned,
      candidatesScanned,
      plaftStatus,
      customers: resultCustomers,
    };
  } finally {
    scheduleDataCedulasOracleConnectionClose(connection);
  }
}

export type DataCedulasPoolSummary = {
  candidates: number;
  existingInB2000OrCore: number;
  inPlaftLists: number;
  eligibleAfterOracle: number;
  lexis: { clear: number; match: number; unavailable: number };
  /** Ids a run can use right now (they still go through the release step when handed out). */
  usableIds: string[];
};

/** How many cédulas the generator can hand out: every filter applied, nothing consumed or modified. */
export async function summarizeDataCedulasPool(database: string, criteria: { minIncomeEstimator?: number; skipLexis?: boolean } = {}): Promise<DataCedulasPoolSummary> {
  initializeOracle();
  const connection = await oracledb.getConnection({
    user: requiredEnv("DATA_CEDULAS_ORACLE_USER"),
    password: requiredEnv("DATA_CEDULAS_ORACLE_PASSWORD"),
    connectString: database,
  });
  try {
    const candidates: DataCedulasCustomer[] = [];
    for (let offset = 0; ; offset += 1000) {
      const batch = await fetchCandidateBatch(offset, 1000, criteria.minIncomeEstimator);
      if (batch.length === 0) break;
      candidates.push(...batch);
    }
    const ids = candidates.map((candidate) => normalizeId(candidate.Cedula)).filter(Boolean);
    // Oracle rejects IN lists over 1000 values (each id binds several spellings): ask in chunks.
    const existing = new Set<string>();
    const plaft = new Set<string>();
    for (let start = 0; start < ids.length; start += 250) {
      const chunk = ids.slice(start, start + 250);
      const [chunkExisting, chunkPlaft] = await Promise.all([findExistingIds(connection, chunk), findPlaftIds(connection, chunk)]);
      chunkExisting.forEach((id) => existing.add(id));
      chunkPlaft.forEach((id) => plaft.add(id));
    }
    const eligible = candidates.filter((candidate) => {
      const id = normalizeId(candidate.Cedula);
      return id && !existing.has(id) && !plaft.has(id);
    });
    const screen = env('DATA_CEDULAS_LEXIS_TRANSPORT') === 'mdw' ? screenMdwLexis : screenPortalLexis;
    const lexis = { clear: 0, match: 0, unavailable: 0 };
    const usableIds: string[] = [];
    const poolSize = Math.max(1, dataCedulasLexisScreenPoolSize());
    // `skipLexis` sizes the universe without one Lexis call per cédula (diagnostics only).
    for (let start = 0; !criteria.skipLexis && start < eligible.length; start += poolSize) {
      const group = eligible.slice(start, start + poolSize);
      const results = await Promise.all(group.map((candidate) => screen(candidate, database)));
      results.forEach((result, index) => {
        lexis[result] += 1;
        if (result === 'clear') usableIds.push(String(group[index].Cedula).trim());
      });
    }
    return {
      candidates: candidates.length,
      existingInB2000OrCore: ids.filter((id) => existing.has(id)).length,
      inPlaftLists: ids.filter((id) => plaft.has(id)).length,
      eligibleAfterOracle: eligible.length,
      lexis,
      usableIds,
    };
  } finally {
    scheduleDataCedulasOracleConnectionClose(connection);
  }
}

export async function findNextDataCedulasCustomer(database: string): Promise<NewCustomerResult | null> {
  const result = await findNextDataCedulasCustomers(database, 1);
  if (!result || result.customers.length === 0) return null;
  return { ...result, customer: result.customers[0] };
}
