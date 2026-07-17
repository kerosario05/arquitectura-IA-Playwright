"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureEvidenceDir = ensureEvidenceDir;
exports.sanitizeFileName = sanitizeFileName;
exports.getTimestampedRunName = getTimestampedRunName;
exports.getRunEvidenceDir = getRunEvidenceDir;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
async function ensureEvidenceDir(dir) {
    await (0, promises_1.mkdir)(dir, { recursive: true });
}
function sanitizeFileName(value) {
    return value
        .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "")
        .toLowerCase();
}
function getTimestampedRunName(prefix = "run") {
    const iso = new Date().toISOString().replace(/[:.]/g, "-");
    return `${sanitizeFileName(prefix)}-${iso}`;
}
async function getRunEvidenceDir(baseDir, runName) {
    const safeRunName = sanitizeFileName(runName);
    const fullPath = node_path_1.default.join(baseDir, safeRunName);
    await ensureEvidenceDir(fullPath);
    return fullPath;
}
