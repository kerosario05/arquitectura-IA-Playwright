import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type {
  PromotedAutomationIndex,
  PromotedAutomationIndexEntry
} from "../types/automation-promotion.types";

const DEFAULT_INDEX_PATH = "automations/index.json";
const INDEX_IO_RETRIES = 3;
const INDEX_IO_RETRY_DELAY_MS = 50;

function inferIndexKind(indexPath: string): "automation" | "page-object" | "flow" | "section" | "unknown" {
  const normalized = indexPath.replace(/\\/g, "/").toLowerCase();
  if (normalized.endsWith("/page-objects.index.json")) return "page-object";
  if (normalized.endsWith("/flows.index.json")) return "flow";
  if (normalized.endsWith("/index.json")) {
    return normalized.includes("/sections/") ? "section" : "automation";
  }
  return "unknown";
}

function inferAppSlugFromIndexPath(indexPath: string): string | undefined {
  const normalized = indexPath.replace(/\\/g, "/");
  const match = normalized.match(/automations\/apps\/([^/]+)\//i);
  return match?.[1];
}

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

function isLegacyBootstrapIndex(parsed: unknown): parsed is {
  appSlug?: string;
  name?: string;
  createdAt?: string;
  entries?: unknown[];
} {
  return Boolean(
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    "entries" in parsed &&
    Array.isArray((parsed as any).entries) &&
    !("automations" in parsed)
  );
}

function migrateLegacyBootstrapIndex(parsed: { createdAt?: string }): PromotedAutomationIndex {
  return {
    version: "1.0",
    updatedAt: parsed.createdAt ?? new Date().toISOString(),
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

  if (isLegacyBootstrapIndex(parsed)) {
    const appSlug = inferAppSlugFromIndexPath(resolved) ?? parsed.appSlug ?? "unknown";
    console.log(`[index-loader] path=${resolved} version=undefined appSlug=${appSlug} kind=${inferIndexKind(resolved)} legacyBootstrap=true`);
    return migrateLegacyBootstrapIndex(parsed);
  }

  if (parsed.version !== "1.0") {
    const appSlug = inferAppSlugFromIndexPath(resolved) ?? (parsed as any)?.appSlug ?? "unknown";
    console.log(`[index-loader] path=${resolved} version=${String((parsed as any)?.version)} appSlug=${appSlug} kind=${inferIndexKind(resolved)}`);
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

export async function linkJiraAutomationToTestRailCase(input: {
  appSlug: string;
  externalId: string;
  caseId: number;
  automationId?: string;
}): Promise<{ linked: boolean; reason: string; automationId?: string }> {
  const appSlug = input.appSlug.trim().toLowerCase();
  const externalId = input.externalId.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(appSlug) || !externalId || !Number.isSafeInteger(input.caseId) || input.caseId <= 0) {
    return { linked: false, reason: "invalid_link_identity" };
  }

  const indexPath = path.join("automations", "apps", appSlug, "index.json");
  const index = await loadAutomationIndex(indexPath);
  const candidates = index.automations.filter((entry) =>
    entry.externalId === externalId
    && (entry.appSlug ?? entry.appProfile)?.trim().toLowerCase() === appSlug
    && entry.tags?.includes("jira_generated")
    && (!input.automationId || entry.id === input.automationId),
  );
  if (candidates.length === 0) return { linked: false, reason: "jira_promotion_not_found" };
  if (candidates.length !== 1) return { linked: false, reason: "jira_promotion_ambiguous" };

  const entry = candidates[0];
  const generation = entry.metadata?.specGeneration;
  if (entry.status !== "active"
    || entry.specVerificationStatus !== "passed"
    || generation?.promotionAllowed !== true
    || generation.specWritten !== true
    || generation.specsValidated < 1
    || generation.specsRejected !== 0) {
    return { linked: false, reason: "jira_promotion_not_verified", automationId: entry.id };
  }
  if (entry.caseId !== undefined && entry.caseId !== input.caseId) {
    return { linked: false, reason: "jira_promotion_case_conflict", automationId: entry.id };
  }

  const appRoot = path.resolve("automations", "apps", appSlug);
  const specPath = path.isAbsolute(entry.specPath)
    ? path.resolve(entry.specPath)
    : path.resolve(entry.specPath.replace(/[\\/]+/g, path.sep));
  const relativeSpecPath = path.relative(appRoot, specPath);
  if (relativeSpecPath.startsWith("..") || path.isAbsolute(relativeSpecPath) || !fsSync.existsSync(specPath)) {
    return { linked: false, reason: "jira_spec_outside_app_or_missing", automationId: entry.id };
  }

  const specHash = createHash("sha256").update(fsSync.readFileSync(specPath)).digest("hex");
  const updatedEntry: PromotedAutomationIndexEntry = {
    ...entry,
    caseId: input.caseId,
    promotionPersisted: true,
    promotedSpecPath: specPath,
    promotedSpecHash: specHash,
  };
  await saveAutomationIndex({
    ...index,
    automations: index.automations.map((candidate) => candidate.id === entry.id ? updatedEntry : candidate),
  }, indexPath);
  return { linked: true, reason: entry.caseId === input.caseId ? "already_linked" : "linked", automationId: entry.id };
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
