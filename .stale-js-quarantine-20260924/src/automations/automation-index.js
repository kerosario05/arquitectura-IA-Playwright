"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadAutomationIndex = loadAutomationIndex;
exports.saveAutomationIndex = saveAutomationIndex;
exports.upsertAutomationIndexEntry = upsertAutomationIndexEntry;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const DEFAULT_INDEX_PATH = "automations/index.json";
const INDEX_IO_RETRIES = 3;
const INDEX_IO_RETRY_DELAY_MS = 50;
function inferIndexKind(indexPath) {
    const normalized = indexPath.replace(/\\/g, "/").toLowerCase();
    if (normalized.endsWith("/page-objects.index.json"))
        return "page-object";
    if (normalized.endsWith("/flows.index.json"))
        return "flow";
    if (normalized.endsWith("/index.json")) {
        return normalized.includes("/sections/") ? "section" : "automation";
    }
    return "unknown";
}
function inferAppSlugFromIndexPath(indexPath) {
    const normalized = indexPath.replace(/\\/g, "/");
    const match = normalized.match(/automations\/apps\/([^/]+)\//i);
    return match?.[1];
}
function isMissingFileError(error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
function isTransientFsError(error) {
    const code = error && typeof error === "object" && "code" in error
        ? error.code
        : undefined;
    return code === "EBUSY" || code === "EPERM" || code === "EACCES" || code === "EMFILE" || code === "ENFILE";
}
async function delay(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}
async function readIndexFileWithRetry(indexPath) {
    for (let attempt = 0; attempt <= INDEX_IO_RETRIES; attempt += 1) {
        try {
            return await promises_1.default.readFile(indexPath, "utf-8");
        }
        catch (error) {
            if (isMissingFileError(error)) {
                return undefined;
            }
            if (isTransientFsError(error) && attempt < INDEX_IO_RETRIES) {
                await delay(INDEX_IO_RETRY_DELAY_MS * (attempt + 1));
                continue;
            }
            throw error;
        }
    }
    return undefined;
}
async function writeFileAtomic(filePath, content) {
    const dir = node_path_1.default.dirname(filePath);
    await promises_1.default.mkdir(dir, { recursive: true });
    for (let attempt = 0; attempt <= INDEX_IO_RETRIES; attempt += 1) {
        const tempPath = node_path_1.default.join(dir, `${node_path_1.default.basename(filePath)}.${process.pid}.${Date.now()}.${attempt}.tmp`);
        try {
            await promises_1.default.writeFile(tempPath, content, "utf-8");
            await promises_1.default.rename(tempPath, filePath).catch(async (error) => {
                if (isTransientFsError(error) || (error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
                    await promises_1.default.rm(filePath, { force: true }).catch(() => undefined);
                    await promises_1.default.rename(tempPath, filePath);
                    return;
                }
                throw error;
            });
            return;
        }
        catch (error) {
            await promises_1.default.rm(tempPath, { force: true }).catch(() => undefined);
            if (isTransientFsError(error) && attempt < INDEX_IO_RETRIES) {
                await delay(INDEX_IO_RETRY_DELAY_MS * (attempt + 1));
                continue;
            }
            throw error;
        }
    }
}
function createEmptyIndex() {
    return {
        version: "1.0",
        updatedAt: new Date().toISOString(),
        automations: []
    };
}
function isLegacyBootstrapIndex(parsed) {
    return Boolean(parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        "entries" in parsed &&
        Array.isArray(parsed.entries) &&
        !("automations" in parsed));
}
function migrateLegacyBootstrapIndex(parsed) {
    return {
        version: "1.0",
        updatedAt: parsed.createdAt ?? new Date().toISOString(),
        automations: []
    };
}
async function loadAutomationIndex(indexPath) {
    const resolved = indexPath ?? DEFAULT_INDEX_PATH;
    const content = await readIndexFileWithRetry(resolved);
    if (content === undefined) {
        return createEmptyIndex();
    }
    const parsed = JSON.parse(content);
    if (isLegacyBootstrapIndex(parsed)) {
        const appSlug = inferAppSlugFromIndexPath(resolved) ?? parsed.appSlug ?? "unknown";
        console.log(`[index-loader] path=${resolved} version=undefined appSlug=${appSlug} kind=${inferIndexKind(resolved)} legacyBootstrap=true`);
        return migrateLegacyBootstrapIndex(parsed);
    }
    if (parsed.version !== "1.0") {
        const appSlug = inferAppSlugFromIndexPath(resolved) ?? parsed?.appSlug ?? "unknown";
        console.log(`[index-loader] path=${resolved} version=${String(parsed?.version)} appSlug=${appSlug} kind=${inferIndexKind(resolved)}`);
        throw new Error(`Unsupported index version: ${parsed.version}`);
    }
    return parsed;
}
async function saveAutomationIndex(index, indexPath) {
    const resolved = indexPath ?? DEFAULT_INDEX_PATH;
    const updated = {
        ...index,
        updatedAt: new Date().toISOString()
    };
    await writeFileAtomic(resolved, JSON.stringify(updated, null, 2));
}
function upsertAutomationIndexEntry(index, entry) {
    const existingIdx = index.automations.findIndex((a) => a.id === entry.id);
    const updatedEntry = {
        ...entry,
        updatedAt: new Date().toISOString()
    };
    if (existingIdx >= 0) {
        const updated = [...index.automations];
        updated[existingIdx] = {
            ...updatedEntry,
            createdAt: index.automations[existingIdx].createdAt
        };
        return { ...index, automations: updated };
    }
    return {
        ...index,
        automations: [...index.automations, updatedEntry]
    };
}
