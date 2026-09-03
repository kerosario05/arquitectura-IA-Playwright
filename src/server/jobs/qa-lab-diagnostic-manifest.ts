import fs from "node:fs";
import path from "node:path";

export type DiagnosticPhase =
  | "generation"
  | "coverage"
  | "launch"
  | "execution"
  | "result_sync"
  | "completed";

export type QaLabDiagnosticManifest = {
  schemaVersion: 1;
  runId: string;
  createdAt: string;
  updatedAt: string;
  request?: Record<string, unknown>;
  phases: Partial<Record<DiagnosticPhase, {
    recordedAt: string;
    status: string;
    data?: unknown;
  }>>;
};

const SECRET_KEY = /(password|secret|token|authorization|cookie|otp|credential|api[-_]?key)/i;

function sanitize(value: unknown, key = ""): unknown {
  if (SECRET_KEY.test(key)) return "[redacted]";
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([entryKey]) => !SECRET_KEY.test(entryKey))
    .map(([entryKey, entryValue]) => [entryKey, sanitize(entryValue, entryKey)]));
}

function writeManifest(filePath: string, manifest: QaLabDiagnosticManifest): void {
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(manifest, null, 2), "utf-8");
  fs.renameSync(temporaryPath, filePath);
}

export function createQaLabDiagnosticManifest(
  artifactDir: string,
  runId: string,
  request?: Record<string, unknown>,
): string {
  fs.mkdirSync(artifactDir, { recursive: true });
  const now = new Date().toISOString();
  const manifest: QaLabDiagnosticManifest = {
    schemaVersion: 1,
    runId,
    createdAt: now,
    updatedAt: now,
    request: request ? sanitize(request) as Record<string, unknown> : undefined,
    phases: {},
  };
  const filePath = path.join(artifactDir, "diagnostic-manifest.json");
  writeManifest(filePath, manifest);
  return filePath;
}

export function recordQaLabDiagnosticPhase(
  filePath: string,
  phase: DiagnosticPhase,
  status: string,
  data?: unknown,
): void {
  try {
    if (!fs.existsSync(filePath)) return;
    const manifest = JSON.parse(fs.readFileSync(filePath, "utf-8")) as QaLabDiagnosticManifest;
    manifest.updatedAt = new Date().toISOString();
    manifest.phases[phase] = {
      recordedAt: manifest.updatedAt,
      status,
      ...(data === undefined ? {} : { data: sanitize(data) }),
    };
    writeManifest(filePath, manifest);
  } catch {
    // Diagnostics must never change the outcome of the run.
  }
}
