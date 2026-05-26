/**
 * JSON Utilities
 */

import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * Safely write JSON to a file, creating directories if needed
 */
export async function writeJsonSafe(filePath: string, data: unknown, options?: { pretty?: boolean }): Promise<void> {
  const dir = path.dirname(filePath);
  await mkdir(dir, { recursive: true });
  const content = JSON.stringify(data, null, options?.pretty !== false ? 2 : undefined);
  await writeFile(filePath, content, "utf-8");
}

/**
 * Read JSON from a file safely
 */
export async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  const { readFile } = await import("node:fs/promises");
  try {
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  const { access } = await import("node:fs/promises");
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
