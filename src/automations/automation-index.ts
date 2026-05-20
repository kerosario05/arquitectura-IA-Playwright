import fs from "node:fs/promises";
import path from "node:path";
import type {
  PromotedAutomationIndex,
  PromotedAutomationIndexEntry
} from "../types/automation-promotion.types";

const DEFAULT_INDEX_PATH = "automations/index.json";

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

  try {
    const content = await fs.readFile(resolved, "utf-8");
    const parsed = JSON.parse(content) as PromotedAutomationIndex;

    if (parsed.version !== "1.0") {
      throw new Error(`Unsupported index version: ${parsed.version}`);
    }

    return parsed;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return createEmptyIndex();
    }
    throw error;
  }
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

  const dir = path.dirname(resolved);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(resolved, JSON.stringify(updated, null, 2), "utf-8");
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