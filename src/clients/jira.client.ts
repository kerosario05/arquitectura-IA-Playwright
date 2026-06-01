import type { RequiredJiraRuntimeConfig, RawJiraIssue, JiraSearchResult, JiraProject, JiraBoard, JiraSprint } from "../types/jira.types";

type ApiErrorPayload = {
  errorMessages?: string[];
  errors?: Record<string, string>;
  message?: string;
};

function formatFetchError(error: unknown, prefix: string): Error {
  if (!(error instanceof Error)) return new Error(`${prefix}: ${String(error)}`);
  const cause = (error as NodeJS.ErrnoException & { cause?: unknown }).cause;
  const causeMsg = cause instanceof Error
    ? ` → ${(cause as NodeJS.ErrnoException).code ? `[${(cause as NodeJS.ErrnoException).code}] ` : ""}${cause.message}`
    : "";
  return new Error(`${prefix}: ${error.message}${causeMsg}`);
}

type JiraProjectsResponse = {
  values?: JiraProject[];
  isLast?: boolean;
};

type JiraBoardsResponse = {
  values?: JiraBoard[];
  isLast?: boolean;
  total?: number;
};

type JiraSprintsResponse = {
  values?: JiraSprint[];
  isLast?: boolean;
};

const DEFAULT_FIELDS = ["summary", "description", "status", "issuetype", "priority"];

export class JiraClient {
  private readonly baseApiUrl: string;
  private readonly agileApiUrl: string;
  private readonly authHeader: string;

  constructor(private readonly config: RequiredJiraRuntimeConfig) {
    const base = config.baseUrl.replace(/\/+$/, "");
    this.baseApiUrl = `${base}/rest/api/3`;
    this.agileApiUrl = `${base}/rest/agile/1.0`;
    this.authHeader = `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString("base64")}`;
  }

  async getIssue(issueKey: string, fields?: string[]): Promise<RawJiraIssue> {
    const fieldList = fields ?? [...DEFAULT_FIELDS];
    if (this.config.acceptanceCriteriaField && !fieldList.includes(this.config.acceptanceCriteriaField)) {
      fieldList.push(this.config.acceptanceCriteriaField);
    }
    const params = new URLSearchParams({ fields: fieldList.join(",") });
    const payload = await this.requestJson<RawJiraIssue>(`issue/${encodeURIComponent(issueKey)}?${params}`);
    if (!payload || typeof payload.key !== "string") {
      throw new Error(`Invalid response for issue ${issueKey}.`);
    }
    return payload;
  }

  async searchIssues(jql: string, fields?: string[], maxResults = 50): Promise<RawJiraIssue[]> {
    const fieldList = fields ?? [...DEFAULT_FIELDS];
    if (this.config.acceptanceCriteriaField && !fieldList.includes(this.config.acceptanceCriteriaField)) {
      fieldList.push(this.config.acceptanceCriteriaField);
    }

    const allIssues: RawJiraIssue[] = [];
    let nextPageToken: string | undefined;

    while (allIssues.length < maxResults) {
      const batchSize = Math.min(maxResults - allIssues.length, 100);
      const body: Record<string, unknown> = { jql, maxResults: batchSize, fields: fieldList };
      if (nextPageToken) body.nextPageToken = nextPageToken;

      const payload = await this.requestJson<JiraSearchResult>("search/jql", "POST", body);
      const batch = payload.issues ?? [];
      allIssues.push(...batch);

      if (!payload.nextPageToken || batch.length === 0) break;
      nextPageToken = payload.nextPageToken;
    }

    return allIssues;
  }

  async getProjects(): Promise<JiraProject[]> {
    const projects: JiraProject[] = [];
    let startAt = 0;

    while (true) {
      const params = new URLSearchParams({ startAt: String(startAt), maxResults: "50" });
      const payload = await this.requestJson<JiraProjectsResponse | JiraProject[]>(`project/search?${params}`);
      const page = Array.isArray(payload) ? payload : (payload.values ?? []);
      projects.push(...page);
      if (Array.isArray(payload) || (payload as JiraProjectsResponse).isLast || page.length === 0) break;
      startAt += page.length;
    }

    return projects;
  }

  async getBoards(projectKeyOrId: string): Promise<JiraBoard[]> {
    const boards: JiraBoard[] = [];
    let startAt = 0;

    while (true) {
      const params = new URLSearchParams({
        projectKeyOrId,
        startAt: String(startAt),
        maxResults: "50"
      });
      const payload = await this.requestAgileJson<JiraBoardsResponse>(`board?${params}`);
      const page = payload.values ?? [];
      boards.push(...page);
      if (payload.isLast || page.length === 0) break;
      startAt += page.length;
    }

    return boards;
  }

  async getSprints(
    boardId: number,
    states: Array<"active" | "future" | "closed"> = ["active", "future", "closed"]
  ): Promise<JiraSprint[]> {
    const sprints: JiraSprint[] = [];
    let startAt = 0;

    while (true) {
      const params = new URLSearchParams({
        state: states.join(","),
        startAt: String(startAt),
        maxResults: "50"
      });
      const payload = await this.requestAgileJson<JiraSprintsResponse>(`board/${boardId}/sprint?${params}`);
      const page = payload.values ?? [];
      sprints.push(...page);
      if (payload.isLast || page.length === 0) break;
      startAt += page.length;
    }

    return sprints;
  }

  async getActiveSprint(projectKey: string): Promise<JiraSprint | undefined> {
    const boards = await this.getBoards(projectKey);
    const scrumBoard = boards.find((b) => b.type === "scrum") ?? boards[0];
    if (!scrumBoard) return undefined;
    const sprints = await this.getSprints(scrumBoard.id, ["active"]);
    return sprints.find((s) => s.state === "active");
  }

  async testConnection(): Promise<{ ok: boolean; displayName?: string; email?: string }> {
    const payload = await this.requestJson<{ displayName?: string; emailAddress?: string }>("myself");
    return { ok: true, displayName: payload.displayName, email: payload.emailAddress };
  }

  private async requestJson<T>(
    endpoint: string,
    method: "GET" | "POST" = "GET",
    body?: Record<string, unknown>
  ): Promise<T> {
    return this.fetch<T>(this.baseApiUrl, endpoint, method, body);
  }

  private async requestAgileJson<T>(
    endpoint: string,
    method: "GET" | "POST" = "GET",
    body?: Record<string, unknown>
  ): Promise<T> {
    return this.fetch<T>(this.agileApiUrl, endpoint, method, body);
  }

  private async fetch<T>(
    baseUrl: string,
    endpoint: string,
    method: "GET" | "POST" = "GET",
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${baseUrl}/${endpoint.replace(/^\/+/, "")}`;

    let response: Response;
    try {
      response = await globalThis.fetch(url, {
        method,
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (error) {
      throw formatFetchError(error, `Jira request failed [${method} ${url}]`);
    }

    const rawText = await response.text();
    let payload: unknown = {};
    if (rawText.trim()) {
      try {
        payload = JSON.parse(rawText);
      } catch {
        throw new Error(`Invalid JSON response from Jira (HTTP ${response.status}).`);
      }
    }

    if (!response.ok) {
      const err = payload as ApiErrorPayload;
      const messages =
        err.errorMessages?.join("; ") ||
        Object.values(err.errors ?? {}).join("; ") ||
        err.message ||
        "Unknown Jira API error";
      throw new Error(`Jira API error (HTTP ${response.status}): ${messages}`);
    }

    return payload as T;
  }
}
