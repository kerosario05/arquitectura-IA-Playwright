"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getArtifactsTmpRoot = getArtifactsTmpRoot;
exports.getTestTempDir = getTestTempDir;
exports.ensureTestTempDir = ensureTestTempDir;
exports.cleanTestTempDir = cleanTestTempDir;
exports.cleanAllArtifactsTmp = cleanAllArtifactsTmp;
exports.listTestTempDirs = listTestTempDirs;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const ARTIFACTS_TMP_ROOT = node_path_1.default.resolve(process.cwd(), ".artifacts/tmp");
function getArtifactsTmpRoot() {
    return ARTIFACTS_TMP_ROOT;
}
function getTestTempDir(name) {
    return node_path_1.default.resolve(ARTIFACTS_TMP_ROOT, name);
}
async function ensureTestTempDir(name) {
    const dir = getTestTempDir(name);
    await (0, promises_1.mkdir)(dir, { recursive: true });
    return dir;
}
async function cleanTestTempDir(name) {
    const dir = getTestTempDir(name);
    await (0, promises_1.rm)(dir, { recursive: true, force: true });
}
async function cleanAllArtifactsTmp() {
    await (0, promises_1.rm)(ARTIFACTS_TMP_ROOT, { recursive: true, force: true });
}
async function listTestTempDirs() {
    try {
        const entries = await (0, promises_1.readdir)(ARTIFACTS_TMP_ROOT, { withFileTypes: true });
        return entries.filter(e => e.isDirectory()).map(e => e.name);
    }
    catch {
        return [];
    }
}
