import type { QaLabReference } from "./types";

/** Recording and job ids may share the same UUID format, so only their explicit labels classify them. */
export function parseQaLabReference(text: string): QaLabReference | undefined {
  const matches = [...text.matchAll(/\b(recordingId|recordId|jobId)\s*[:=]\s*["'`]?([a-zA-Z0-9][a-zA-Z0-9._-]{2,127})/gi)];
  const jobUris = [...text.matchAll(/\bjob:\/\/([a-zA-Z0-9][a-zA-Z0-9._-]{2,127})/gi)];
  const all = [...matches.map((match) => ({ label: match[1], id: match[2] })), ...jobUris.map((match) => ({ label: "jobId", id: match[1] }))];
  if (all.length !== 1) return undefined;
  const { label, id: rawId } = all[0];
  const id = rawId.replace(/[.,;!?]+$/, "");
  if (id.length < 3) return undefined;
  return { kind: label.toLowerCase() === "jobid" ? "discovery-job" : "recording", id };
}

export function qaLabReferenceError(text: string): string | undefined {
  const matches = [...text.matchAll(/\b(recordingId|recordId|jobId)\s*[:=]\s*["'`]?([a-zA-Z0-9][a-zA-Z0-9._-]{2,127})/gi)];
  const jobUris = [...text.matchAll(/\bjob:\/\/([a-zA-Z0-9][a-zA-Z0-9._-]{2,127})/gi)];
  const count = matches.length + jobUris.length;
  if (count === 0) return "Incluye un recordingId o jobId para que el Orchestrator seleccione el ciclo QA Lab correcto.";
  if (count > 1) return "Envía un solo ID por tarea: recordingId para Recording o jobId para Discovery/Auto-POM.";
  return undefined;
}
