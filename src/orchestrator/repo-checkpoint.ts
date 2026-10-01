import fs from "node:fs";
import path from "node:path";

export const ORCHESTRATOR_CHECKPOINT_FILES = [
  "CLAUDE.md",
  "AGENTS.md",
  "docs/ai/00-current-state.md",
] as const;

/** Load the authoritative repository guidance in full for each fresh agent process. */
export function readRepositoryCheckpoint(repoRoot: string): string {
  return ORCHESTRATOR_CHECKPOINT_FILES.map((relativePath) => {
    const absolutePath = path.join(repoRoot, relativePath);
    return `--- ${relativePath} ---\n${fs.existsSync(absolutePath)
      ? fs.readFileSync(absolutePath, "utf8")
      : "(missing from authoritative repository)"}`;
  }).join("\n\n");
}
