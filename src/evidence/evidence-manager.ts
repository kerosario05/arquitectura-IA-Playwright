import { mkdir } from "node:fs/promises";
import path from "node:path";

export async function ensureEvidenceDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export function sanitizeFileName(value: string): string {
  return value
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .toLowerCase();
}

export function getTimestampedRunName(prefix = "run"): string {
  const iso = new Date().toISOString().replace(/[:.]/g, "-");
  return `${sanitizeFileName(prefix)}-${iso}`;
}

export async function getRunEvidenceDir(baseDir: string, runName: string): Promise<string> {
  const safeRunName = sanitizeFileName(runName);
  const fullPath = path.join(baseDir, safeRunName);
  await ensureEvidenceDir(fullPath);
  return fullPath;
}
