/** Jira-only workflow grammar. Recording retains its own capture/replay contract. */
export type JiraWorkflowOperation =
  | { kind: "application"; alias: string }
  | { kind: "capture"; field: string; variable: string }
  | { kind: "fillCaptured"; field: string; variable: string }
  | { kind: "clickCapturedRow"; container: string; variable: string; action: string }
  | { kind: "documents"; container: string; optional: boolean };

export function parseJiraWorkflowStep(text: string): JiraWorkflowOperation | undefined {
  const step = text.trim().replace(/[.]$/, "");
  let match = step.match(/^Cambiar a la aplicación ["“]([^"”]+)["”]$/i);
  if (match) return { kind: "application", alias: match[1] };
  match = step.match(/^Capturar el valor de ["“]([^"”]+)["”] como ["“]([a-zA-Z][\w.-]{0,79})["”]$/i);
  if (match) return { kind: "capture", field: match[1], variable: match[2] };
  match = step.match(/^Ingresar el valor capturado ["“]([a-zA-Z][\w.-]{0,79})["”] en ["“]([^"”]+)["”]$/i);
  if (match) return { kind: "fillCaptured", field: match[2], variable: match[1] };
  match = step.match(/^Presionar ["“]([^"”]+)["”] en la fila del valor capturado ["“]([a-zA-Z][\w.-]{0,79})["”] en ["“]([^"”]+)["”]$/i);
  if (match) return { kind: "clickCapturedRow", action: match[1], variable: match[2], container: match[3] };
  match = step.match(/^Adjuntar los documentos requeridos en ["“]([^"”]+)["”]( si aparece)?$/i);
  if (match) return { kind: "documents", container: match[1], optional: Boolean(match[2]) };
}

export function jiraWorkflowErrors(steps: string[], applicationAliases?: string[]): string[] {
  const captures = new Set<string>();
  return steps.flatMap((text, index) => {
    const op = parseJiraWorkflowStep(text);
    if (!op) return [];
    if (op.kind === "application" && applicationAliases && !applicationAliases.includes(op.alias)) return [`JIRA_WORKFLOW_APPLICATION_NOT_CONFIGURED:${index + 1}`];
    if (op.kind === "capture") {
      if (captures.has(op.variable)) return [`JIRA_WORKFLOW_CAPTURE_DUPLICATE:${index + 1}`];
      captures.add(op.variable);
    }
    return (op.kind === "fillCaptured" || op.kind === "clickCapturedRow") && !captures.has(op.variable) ? [`JIRA_WORKFLOW_CAPTURE_NOT_DECLARED:${index + 1}`] : [];
  });
}

export type JiraApplication = { baseUrl: string };
export function jiraWorkflowApplications(profile: Record<string, unknown>): Record<string, JiraApplication> {
  const raw = profile.jiraApplications;
  if (raw === undefined) return {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("JIRA_WORKFLOW_APPLICATIONS_INVALID");
  const result: Record<string, JiraApplication> = Object.create(null);
  for (const [alias, value] of Object.entries(raw)) {
    if (alias === "principal" || !/^[\p{L}\p{N} _.-]{1,80}$/u.test(alias) || ["__proto__", "constructor", "prototype"].includes(alias) || !value || typeof value !== "object") throw new Error("JIRA_WORKFLOW_APPLICATIONS_INVALID");
    const baseUrl = (value as Record<string, unknown>).baseUrl;
    if (typeof baseUrl !== "string") throw new Error("JIRA_WORKFLOW_APPLICATION_URL_INVALID");
    const url = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("JIRA_WORKFLOW_APPLICATION_URL_INVALID");
    result[alias] = { baseUrl: url.href };
  }
  return result;
}

export function parseJiraDocumentSet(value: string): Record<string, string> {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("JIRA_DOCUMENT_SET_INVALID"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length > 50) throw new Error("JIRA_DOCUMENT_SET_INVALID");
  const entries = Object.entries(parsed);
  if (entries.some(([label, ref]) => !label.trim() || typeof ref !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(ref))) throw new Error("JIRA_DOCUMENT_SET_INVALID");
  return Object.fromEntries(entries);
}

export const JIRA_WORKFLOW_INSTRUCTIONS = `
## Jira journeys across applications and dynamic documents
Only when the story explicitly requires another application, keep the complete business journey in one scenario, with separate explicit login inputs/actions for each application. Application changes are not identity changes inside one application. Use only application aliases configured in jiraApplications; never invent URLs, aliases, credentials, identifiers, selectors or document labels.
Supported workflow steps (preserve this exact grammar and quotes):
Cambiar a la aplicación "<configured alias>" (use "principal" to return to the original page and session).
Capturar el valor de "<source-backed visible field label>" como "<variableKey>".
Ingresar el valor capturado "<variableKey>" en "<exact destination field label>".
Presionar "<exact action label>" en la fila del valor capturado "<variableKey>" en "<exact table/list name>".
Adjuntar los documentos requeridos en "<exact named dialog, region or group>".
Adjuntar los documentos requeridos en "<exact named dialog, region or group>" si aparece (only when the source explicitly makes this dialog optional).
Capture once after creation; use the same run-scoped variable for the exact search. Never turn the captured identifier into editable test data or a literal. Search-result selection must be uniquely anchored to that captured identifier. For dynamic documents, return one file-set input requirement for the group; users supply a map of exact document labels to stored project file references. Runtime processes every observed document field, verifies attached filenames, and fails with the missing field when no matching fixture exists. Never invent counts or silently skip required fields. Keep ordinary submit/approve actions and explicit outcome assertions as separate steps. Recording is a different producer and must not be described as using Jira generation.
`;
