"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadObjectRegistry = loadObjectRegistry;
exports.saveObjectRegistry = saveObjectRegistry;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const object_registry_validator_1 = require("./object-registry-validator");
const defaultRegistryPath = node_path_1.default.resolve("src/registry/object-registry.json");
async function loadObjectRegistry(filePath) {
    const resolvedPath = filePath ? node_path_1.default.resolve(filePath) : defaultRegistryPath;
    const content = await (0, promises_1.readFile)(resolvedPath, "utf-8");
    const parsed = JSON.parse(content);
    (0, object_registry_validator_1.assertValidObjectRegistry)(parsed);
    return parsed;
}
async function saveObjectRegistry(registry, filePath) {
    (0, object_registry_validator_1.assertValidObjectRegistry)(registry);
    const resolvedPath = filePath ? node_path_1.default.resolve(filePath) : defaultRegistryPath;
    await (0, promises_1.mkdir)(node_path_1.default.dirname(resolvedPath), { recursive: true });
    await (0, promises_1.writeFile)(resolvedPath, JSON.stringify(registry, null, 2), "utf-8");
}
