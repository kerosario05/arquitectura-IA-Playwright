"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeExecutionPlansToFile = writeExecutionPlansToFile;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
async function writeExecutionPlansToFile(plans, outputPath) {
    await (0, promises_1.mkdir)(node_path_1.default.dirname(outputPath), { recursive: true });
    const payload = {
        generatedAt: new Date().toISOString(),
        count: plans.length,
        plans
    };
    await (0, promises_1.writeFile)(outputPath, JSON.stringify(payload, null, 2), "utf-8");
}
