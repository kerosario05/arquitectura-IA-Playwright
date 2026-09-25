"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadDotenvWithPowerShellSupport = loadDotenvWithPowerShellSupport;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const dotenv_1 = __importDefault(require("dotenv"));
const VALID_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const POWERSHELL_ENV_PREFIX = "$env:";
function parsePowerShellStyleEnvLines(rawEnvContent) {
    const normalizedLines = [];
    const lines = rawEnvContent.split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
            continue;
        }
        if (!trimmed.startsWith(POWERSHELL_ENV_PREFIX)) {
            continue;
        }
        const assignment = trimmed.slice(POWERSHELL_ENV_PREFIX.length);
        const equalsIndex = assignment.indexOf("=");
        if (equalsIndex <= 0) {
            continue;
        }
        const key = assignment.slice(0, equalsIndex).trim();
        if (!VALID_ENV_KEY.test(key)) {
            continue;
        }
        const value = assignment.slice(equalsIndex + 1);
        normalizedLines.push(`${key}=${value}`);
    }
    if (normalizedLines.length === 0) {
        return {};
    }
    return dotenv_1.default.parse(normalizedLines.join("\n"));
}
function applyEnvEntries(targetEnv, entries, overrideExisting) {
    for (const [key, value] of Object.entries(entries)) {
        if (!overrideExisting && typeof targetEnv[key] === "string") {
            continue;
        }
        targetEnv[key] = value;
    }
}
function loadDotenvWithPowerShellSupport(options = {}) {
    const targetEnv = options.env ?? process.env;
    const overrideExisting = options.overrideExisting === true;
    const envPath = options.envPath ? node_path_1.default.resolve(options.envPath) : node_path_1.default.resolve(process.cwd(), ".env");
    if (!node_fs_1.default.existsSync(envPath)) {
        return;
    }
    const raw = node_fs_1.default.readFileSync(envPath, "utf8");
    const standardEntries = dotenv_1.default.parse(raw);
    const powerShellEntries = parsePowerShellStyleEnvLines(raw);
    applyEnvEntries(targetEnv, standardEntries, overrideExisting);
    applyEnvEntries(targetEnv, powerShellEntries, overrideExisting);
}
