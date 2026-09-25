"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeScenariosToFile = writeScenariosToFile;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
async function writeScenariosToFile(scenarios, outputPath, options) {
    const includeRaw = options?.includeRaw ?? false;
    const dirName = node_path_1.default.dirname(outputPath);
    await (0, promises_1.mkdir)(dirName, { recursive: true });
    const serialized = includeRaw
        ? scenarios
        : scenarios.map(({ raw: _raw, ...scenario }) => scenario);
    await (0, promises_1.writeFile)(outputPath, JSON.stringify(serialized, null, 2), "utf-8");
}
