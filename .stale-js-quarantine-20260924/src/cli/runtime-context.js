"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadRuntimeContextFromPath = loadRuntimeContextFromPath;
exports.resolveRuntimeEntriesForCase = resolveRuntimeEntriesForCase;
const promises_1 = __importDefault(require("node:fs/promises"));
/** Load only the case-scoped runtime data needed by promoted execution. */
async function loadRuntimeContextFromPath(contextPath) {
    if (!contextPath)
        return undefined;
    try {
        const parsed = JSON.parse(await promises_1.default.readFile(contextPath, "utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("runtime_context_invalid");
        }
        for (const entries of Object.values(parsed)) {
            if (!Array.isArray(entries) || entries.some((entry) => !entry || typeof entry !== "object" || typeof entry.key !== "string")) {
                throw new Error("runtime_context_invalid");
            }
        }
        return parsed;
    }
    catch (error) {
        if (error?.code === "ENOENT")
            return undefined;
        if (error instanceof Error && error.message === "runtime_context_invalid")
            throw error;
        throw new Error("runtime_context_unreadable");
    }
}
function resolveRuntimeEntriesForCase(context, caseId) {
    if (!context)
        return undefined;
    const entries = context[String(caseId)];
    return Array.isArray(entries) && entries.length > 0 ? entries : undefined;
}
