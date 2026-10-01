import fs from "node:fs";
import path from "node:path";
import type { TaskContract } from "./types";

// Search a bounded but useful log window; backend logs can be multi-megabyte and the
// recording seed may be older than the last few hundred KiB.
const MAX_READ_BYTES = 16 * 1024 * 1024;
const MAX_LINES = 20;
const MAX_LINE_LENGTH = 240;

function redactLogLine(line: string): string {
  return line
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [REDACTED]")
    .replace(/\b(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,}|AKIA[A-Z0-9]{16})\b/g, "[REDACTED_TOKEN]")
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|credential|secret|token|cookie|authorization)\s*[=:]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:token|key|password|secret|code)=)[^&\s]+/gi, "$1[REDACTED]");
}

function readTail(file: string): string {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const signature = Buffer.alloc(2);
    fs.readSync(fd, signature, 0, signature.length, 0);
    const utf16 = signature[0] === 0xff && signature[1] === 0xfe;
    let start = Math.max(0, size - MAX_READ_BYTES);
    if (utf16 && start % 2) start += 1;
    let length = size - start;
    if (utf16 && length % 2) length -= 1;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    return buffer.toString(utf16 ? "utf16le" : "utf8").replace(/^\uFEFF/, "");
  } finally {
    fs.closeSync(fd);
  }
}

/** Bounded, secret-redacted operational context. It never grants fresh-evidence authority. */
export function readQaLabBackendLogContext(repoRoot: string, task: Pick<TaskContract, "projectSlug" | "threadContext" | "objective" | "currentFrontier" | "qaLabReference">): string {
  const file = path.join(repoRoot, "qalab-backend.log");
  if (!fs.existsSync(file)) return `source=qalab-backend.log unavailable; path=${file}`;

  const searchText = [task.projectSlug, task.qaLabReference?.id, task.threadContext, task.objective, task.currentFrontier].filter(Boolean).join(" ");
  const recordingIds = [...searchText.matchAll(/\b[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}\b/gi)].map((match) => match[0]);
  const needles = [...new Set([...recordingIds, ...(task.qaLabReference?.id ? [task.qaLabReference.id] : []), ...(task.projectSlug ? [task.projectSlug] : [])])];
  const logText = readTail(file);
  const relevantLine = (line: string) => {
    if (!line.trim()) return false;
    return /recording|scenario|capture|control|project|derive|runtime-knowledge|recording-readiness|\b(error|warn|failed|exception|4\d\d|5\d\d)\b/i.test(line);
  };
  const belongsToTaskProject = (line: string) => {
    const explicitProject = line.match(/\b(?:projectSlug|project)\s*[:=]\s*["']?([a-z0-9][a-z0-9_-]*)/i)?.[1];
    return !task.projectSlug || !explicitProject || explicitProject.toLowerCase() === task.projectSlug.toLowerCase();
  };
  const allLines = logText.split(/\r?\n/);
  const seedMatches = allLines.filter((line) => relevantLine(line)
    && needles.some((needle) => line.toLowerCase().includes(needle.toLowerCase())));
  // Every review gets both historical matches for the task's explicit seed and the newest
  // operational lines, so a fresh recording created during this run is visible on the next turn.
  const recentMatches = logText.slice(-128 * 1024).split(/\r?\n/).filter((line) => relevantLine(line) && belongsToTaskProject(line));
  const selected = [...new Set([...seedMatches.slice(-8), ...recentMatches.slice(-12)])]
    .slice(-MAX_LINES).map((line) => redactLogLine(line).slice(0, MAX_LINE_LENGTH));

  return [
    `source=qalab-backend.log; readAt=${new Date().toISOString()}; reference=${task.qaLabReference?.kind ?? "unclassified"}:${task.qaLabReference?.id ?? "missing"}; filteredLines=${selected.length}`,
    ...selected,
    selected.length ? "Logs are diagnostic context only; use only this iteration's fresh physical result as physical authority." : "No matching operational lines in the bounded log tail.",
  ].join("\n");
}
