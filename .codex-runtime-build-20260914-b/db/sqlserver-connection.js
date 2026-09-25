"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getConnection = getConnection;
exports.closeConnection = closeConnection;
exports.withTransaction = withTransaction;
const node_module_1 = require("node:module");
/**
 * SQL Server driver (original behaviour), kept behind DB_DRIVER=sqlserver.
 *
 * `odbc` is a native module and is not a declared dependency, so it is required
 * lazily — importing this file with DB_DRIVER=sqlite must never touch it.
 */
const requireModule = (0, node_module_1.createRequire)(__filename);
let odbc = null;
function getOdbc() {
    if (odbc)
        return odbc;
    try {
        odbc = requireModule("odbc");
    }
    catch {
        throw new Error('DB_DRIVER=sqlserver requires the "odbc" package (npm install odbc) plus the ' +
            "ODBC Driver 18 for SQL Server. Use DB_DRIVER=sqlite to run without it.");
    }
    return odbc;
}
function buildConnectionString() {
    const server = process.env.SQL_SERVER_HOST?.trim() || "localhost";
    const database = process.env.SQL_SERVER_DATABASE?.trim() || "QA_LAB";
    const trusted = (process.env.SQL_SERVER_TRUSTED_CONNECTION ?? "true").toLowerCase() === "true";
    return trusted
        ? `Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${database};Trusted_Connection=yes;Encrypt=no;TrustServerCertificate=yes;`
        : `Driver={ODBC Driver 18 for SQL Server};Server=${server};Database=${database};Encrypt=no;TrustServerCertificate=yes;`;
}
let pool = null;
async function getConnection() {
    if (pool)
        return pool;
    pool = await getOdbc().connect(buildConnectionString());
    return pool;
}
async function closeConnection() {
    if (pool) {
        await pool.close();
        pool = null;
    }
}
async function withTransaction(fn) {
    const conn = await getOdbc().connect(buildConnectionString());
    try {
        await conn.beginTransaction();
        const result = await fn(conn);
        await conn.commit();
        return result;
    }
    catch (err) {
        try {
            await conn.rollback();
        }
        catch {
            // ignore rollback failure; original error propagates
        }
        throw err;
    }
    finally {
        try {
            await conn.close();
        }
        catch {
            // ignore close failure
        }
    }
}
