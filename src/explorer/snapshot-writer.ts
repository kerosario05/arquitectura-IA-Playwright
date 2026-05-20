import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PageSnapshot } from "../types/page-snapshot.types";

export async function writePageSnapshot(snapshot: PageSnapshot, outputPath: string): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, JSON.stringify(snapshot, null, 2), "utf-8");
}
