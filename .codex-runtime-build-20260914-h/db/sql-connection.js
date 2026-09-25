"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDriverName = resolveDriverName;
exports.describeDatasource = describeDatasource;
exports.getConnection = getConnection;
exports.withConnection = withConnection;
exports.closeConnection = closeConnection;
exports.withTransaction = withTransaction;
const dotenv_1 = require("dotenv");
const sqlite = __importStar(require("./sqlite-connection"));
const sqlserver = __importStar(require("./sqlserver-connection"));
(0, dotenv_1.config)();
function resolveDriverName() {
    const raw = (process.env.DB_DRIVER || "sqlite").trim().toLowerCase();
    if (raw === "sqlserver" || raw === "mssql")
        return "sqlserver";
    if (raw === "sqlite")
        return "sqlite";
    throw new Error(`Unsupported DB_DRIVER "${raw}" — expected "sqlite" or "sqlserver"`);
}
function driver() {
    return resolveDriverName() === "sqlserver" ? sqlserver : sqlite;
}
/** Human-readable description of the active datastore, for logs and CLIs. */
function describeDatasource() {
    if (resolveDriverName() === "sqlserver") {
        const server = process.env.SQL_SERVER_HOST?.trim() || "localhost";
        const database = process.env.SQL_SERVER_DATABASE?.trim() || "QA_LAB";
        return `sqlserver ${server}/${database}`;
    }
    return `sqlite ${sqlite.resolveDbPath()}`;
}
async function getConnection() {
    return driver().getConnection();
}
async function withConnection(fn) {
    const conn = await odbc.connect(connectionString);
    try {
        return await fn(conn);
    }
    finally {
        try {
            await conn.close();
        }
        catch {
            // preserve the operation result or error
        }
    }
}
async function closeConnection() {
    return driver().closeConnection();
}
async function withTransaction(fn) {
    return driver().withTransaction(fn);
}
