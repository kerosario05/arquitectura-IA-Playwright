"use strict";
/**
 * JSON Utilities
 */
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeJsonSafe = writeJsonSafe;
exports.readJsonSafe = readJsonSafe;
exports.fileExists = fileExists;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
/**
 * Safely write JSON to a file, creating directories if needed
 */
async function writeJsonSafe(filePath, data, options) {
    const dir = node_path_1.default.dirname(filePath);
    await (0, promises_1.mkdir)(dir, { recursive: true });
    const content = JSON.stringify(data, null, options?.pretty !== false ? 2 : undefined);
    await (0, promises_1.writeFile)(filePath, content, "utf-8");
}
/**
 * Read JSON from a file safely
 */
async function readJsonSafe(filePath) {
    const { readFile } = await Promise.resolve().then(() => __importStar(require("node:fs/promises")));
    try {
        const content = await readFile(filePath, "utf-8");
        return JSON.parse(content);
    }
    catch {
        return null;
    }
}
/**
 * Check if a file exists
 */
async function fileExists(filePath) {
    const { access } = await Promise.resolve().then(() => __importStar(require("node:fs/promises")));
    try {
        await access(filePath);
        return true;
    }
    catch {
        return false;
    }
}
