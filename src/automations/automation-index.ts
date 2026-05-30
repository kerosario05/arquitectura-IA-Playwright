import fs from "node:fs/promises";
import path from "node:path";
import type {
  PromotedAutomationIndex,
  PromotedAutomationIndexEntry
} from "../types/automation-promotion.types";

const DEFAULT_INDEX_PATH = "automations/index.json";
const INDEX_IO_RETRIES = 3;
const INDEX_IO_RETRY_DELAY_MS = 50;

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT");
}

function isTransientFsError(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error
    ? (error as NodeJS.ErrnoException).code
    : undefined;
  return code === "EBUSY" || code === "EPERM" || code === "EACCES" || code === "EMFILE" || code === "ENFILE";
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readIndexFileWithRetry(indexPath: string): Promise<string | undefined> {
  for (let attempt = 0; attempt <= INDEX_IO_RETRIES; attempt += 1) {
    try {
      return await fs.readFile(indexPath, "utf-8");
    } catch (error) {
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

async function writeFileAtomic(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  for (let attempt = 0; attempt <= INDEX_IO_RETRIES; attempt += 1) {
    const tempPath = path.join(dir, `${path.basename(filePath)}.${process.pid}.${Date.now()}.${attempt}.tmp`);
    try {
      await fs.writeFile(tempPath, content, "utf-8");
      await fs.rename(tempPath, filePath).catch(async (error) => {
        if (isTransientFsError(error) || (error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST")) {
          await fs.rm(filePath, { force: true }).catch(() => undefined);
          await fs.rename(tempPath, filePath);
          return;
        }
        throw error;
      });
      return;
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
      if (isTransientFsError(error) && attempt < INDEX_IO_RETRIES) {
        await delay(INDEX_IO_RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
}

function createEmptyIndex(): PromotedAutomationIndex {
  return {
    version: "1.0",
    updatedAt: new Date().toISOString(),
    automations: []
  };
}

export async function loadAutomationIndex(
  indexPath?: string
): Promise<PromotedAutomationIndex> {
  const resolved = indexPath ?? DEFAULT_INDEX_PATH;
  const content = await readIndexFileWithRetry(resolved);
  if (content === undefined) {
    return createEmptyIndex();
  }
  const parsed = JSON.parse(content) as PromotedAutomationIndex;

  if (parsed.version !== "1.0") {
    throw new Error(`Unsupported index version: ${parsed.version}`);
  }

  return parsed;
}

export async function saveAutomationIndex(
  index: PromotedAutomationIndex,
  indexPath?: string
): Promise<void> {
  const resolved = indexPath ?? DEFAULT_INDEX_PATH;
  const updated: PromotedAutomationIndex = {
    ...index,
    updatedAt: new Date().toISOString()
  };

  await writeFileAtomic(resolved, JSON.stringify(updated, null, 2));
}

export function upsertAutomationIndexEntry(
  index: PromotedAutomationIndex,
  entry: PromotedAutomationIndexEntry
): PromotedAutomationIndex {
  const existingIdx = index.automations.findIndex((a) => a.id === entry.id);

  const updatedEntry: PromotedAutomationIndexEntry = {
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
