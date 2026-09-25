"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveQaBrowserProfilePath = resolveQaBrowserProfilePath;
const node_path_1 = __importDefault(require("node:path"));
function resolveQaBrowserProfilePath(rawValue, cwd = process.cwd()) {
    const configured = rawValue?.trim();
    if (!configured)
        return undefined;
    return node_path_1.default.resolve(cwd, configured);
}
