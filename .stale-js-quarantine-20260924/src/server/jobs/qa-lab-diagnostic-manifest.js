"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createQaLabDiagnosticManifest = createQaLabDiagnosticManifest;
exports.recordQaLabDiagnosticPhase = recordQaLabDiagnosticPhase;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const SECRET_KEY = /(password|secret|token|authorization|cookie|otp|credential|api[-_]?key)/i;
function sanitize(value, key = "") {
    if (SECRET_KEY.test(key))
        return "[redacted]";
    if (Array.isArray(value))
        return value.map((item) => sanitize(item));
    if (!value || typeof value !== "object")
        return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([entryKey]) => !SECRET_KEY.test(entryKey))
        .map(([entryKey, entryValue]) => [entryKey, sanitize(entryValue, entryKey)]));
}
function writeManifest(filePath, manifest) {
    const temporaryPath = `${filePath}.tmp`;
    node_fs_1.default.writeFileSync(temporaryPath, JSON.stringify(manifest, null, 2), "utf-8");
    node_fs_1.default.renameSync(temporaryPath, filePath);
}
function createQaLabDiagnosticManifest(artifactDir, runId, request) {
    node_fs_1.default.mkdirSync(artifactDir, { recursive: true });
    const now = new Date().toISOString();
    const manifest = {
        schemaVersion: 1,
        runId,
        createdAt: now,
        updatedAt: now,
        request: request ? sanitize(request) : undefined,
        phases: {},
    };
    const filePath = node_path_1.default.join(artifactDir, "diagnostic-manifest.json");
    writeManifest(filePath, manifest);
    return filePath;
}
function recordQaLabDiagnosticPhase(filePath, phase, status, data) {
    try {
        if (!node_fs_1.default.existsSync(filePath))
            return;
        const manifest = JSON.parse(node_fs_1.default.readFileSync(filePath, "utf-8"));
        manifest.updatedAt = new Date().toISOString();
        manifest.phases[phase] = {
            recordedAt: manifest.updatedAt,
            status,
            ...(data === undefined ? {} : { data: sanitize(data) }),
        };
        writeManifest(filePath, manifest);
    }
    catch {
        // Diagnostics must never change the outcome of the run.
    }
}
