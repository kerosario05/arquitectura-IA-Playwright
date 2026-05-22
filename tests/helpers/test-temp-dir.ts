import { mkdir, rm, readdir } from "node:fs/promises";
import path from "node:path";

const ARTIFACTS_TMP_ROOT = path.resolve(process.cwd(), ".artifacts/tmp");

export function getArtifactsTmpRoot(): string {
  return ARTIFACTS_TMP_ROOT;
}

export function getTestTempDir(name: string): string {
  return path.resolve(ARTIFACTS_TMP_ROOT, name);
}

export async function ensureTestTempDir(name: string): Promise<string> {
  const dir = getTestTempDir(name);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function cleanTestTempDir(name: string): Promise<void> {
  const dir = getTestTempDir(name);
  await rm(dir, { recursive: true, force: true });
}

export async function cleanAllArtifactsTmp(): Promise<void> {
  await rm(ARTIFACTS_TMP_ROOT, { recursive: true, force: true });
}

export async function listTestTempDirs(): Promise<string[]> {
  try {
    const entries = await readdir(ARTIFACTS_TMP_ROOT, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}
