import type { RequiredTestRailRuntimeConfig } from "../types/env.types";
import type {
  AddCaseInput,
  AddResultForCaseInput,
  CreateRunInput,
  RawTestRailCase,
  TestRailRun,
  UpdateCaseInput
} from "../types/testrail.types";

type ApiErrorPayload = {
  error?: string;
  message?: string;
};

type CasesPagePayload = {
  cases?: RawTestRailCase[];
  offset?: number;
  limit?: number;
  size?: number;
  _links?: {
    next?: string | null;
  };
};

export class TestRailClient {
  private readonly baseApiUrl: string;

  private readonly authHeader: string;

  constructor(private readonly config: RequiredTestRailRuntimeConfig) {
    this.baseApiUrl = `${config.url}/index.php?/api/v2`;
    this.authHeader = `Basic ${Buffer.from(`${config.email}:${config.apiKey}`).toString("base64")}`;
  }

  async getCase(caseId: number): Promise<RawTestRailCase> {
    const payload = await this.requestJson<RawTestRailCase>(`get_case/${caseId}`);
    if (!payload || typeof payload.id !== "number" || typeof payload.title !== "string") {
      throw new Error(`Invalid get_case response for case ${caseId}.`);
    }
    return payload;
  }

  async getCasesByIds(caseIds: number[]): Promise<RawTestRailCase[]> {
    const uniqueIds = Array.from(new Set(caseIds));
    const cases: RawTestRailCase[] = [];

    for (const caseId of uniqueIds) {
      try {
        const testCase = await this.getCase(caseId);
        cases.push(testCase);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to fetch TestRail case ${caseId}: ${message}`);
      }
    }

    return cases;
  }

  async getCases(projectId: string, suiteId?: string, sectionId?: string): Promise<RawTestRailCase[]> {
    const cases: RawTestRailCase[] = [];
    let endpoint = this.buildCasesEndpoint(projectId, suiteId, sectionId);

    while (endpoint) {
      const payload = await this.requestJson<RawTestRailCase[] | CasesPagePayload>(endpoint);

      if (Array.isArray(payload)) {
        cases.push(...payload);
        break;
      }

      const pageCases = payload.cases ?? [];
      cases.push(...pageCases);

      if (payload._links?.next && payload._links.next.trim()) {
        endpoint = payload._links.next.replace(/^\//, "");
      } else {
        endpoint = "";
      }
    }

    return cases;
  }

  async testConnection(): Promise<{ ok: boolean; userEmail?: string }> {
    try {
      const endpoint = `get_user_by_email&email=${encodeURIComponent(this.config.email)}`;
      const payload = await this.requestJson<{ email?: string }>(endpoint);
      return { ok: true, userEmail: payload.email ?? this.config.email };
    } catch {
      await this.requestJson<unknown>("get_statuses");
      return { ok: true, userEmail: this.config.email };
    }
  }

  async addRun(input: CreateRunInput): Promise<TestRailRun> {
    const endpoint = `add_run/${input.projectId}`;
    const body: Record<string, unknown> = {
      name: input.name
    };
    if (input.suiteId) {
      body.suite_id = Number(input.suiteId);
    }
    if (input.description) {
      body.description = input.description;
    }
    if (input.caseIds && input.caseIds.length > 0) {
      body.include_all = false;
      body.case_ids = input.caseIds;
    } else {
      body.include_all = true;
    }

    const payload = await this.requestJson<TestRailRun>(endpoint, "POST", body);
    if (!payload || typeof payload.id !== "number") {
      throw new Error("Invalid add_run response from TestRail.");
    }
    return payload;
  }

  async addResultsForCases(
    runId: number,
    results: AddResultForCaseInput[]
  ): Promise<{ added: number }> {
    const endpoint = `add_results_for_cases/${runId}`;
    const body = {
      results: results.map((r) => {
        const entry: Record<string, unknown> = {
          case_id: r.caseId,
          status_id: r.statusId
        };
        if (r.comment) {
          entry.comment = r.comment;
        }
        if (r.elapsed) {
          entry.elapsed = r.elapsed;
        }
        if (r.defects) {
          entry.defects = r.defects;
        }
        return entry;
      })
    };

    const payload = await this.requestJson<unknown[] | Record<string, unknown>>(endpoint, "POST", body);
    const entries = Array.isArray(payload) ? payload : (payload as Record<string, unknown>).results;
    return { added: Array.isArray(entries) ? entries.length : 0 };
  }

  async getRuns(projectId: string, suiteId?: string): Promise<TestRailRun[]> {
    const params = new URLSearchParams();
    if (suiteId) params.set("suite_id", suiteId);
    const query = params.toString();
    const endpoint = query ? `get_runs/${projectId}&${query}` : `get_runs/${projectId}`;
    const payload = await this.requestJson<TestRailRun[] | { runs?: TestRailRun[] }>(endpoint);
    return Array.isArray(payload) ? payload : (payload.runs ?? []);
  }

  async getCasesByRefs(
    projectId: string,
    refs: string,
    suiteId?: string,
    sectionId?: string
  ): Promise<RawTestRailCase[]> {
    const params = new URLSearchParams({ refs_filter: refs });
    if (suiteId) params.set("suite_id", suiteId);
    if (sectionId) params.set("section_id", sectionId);
    const endpoint = `get_cases/${projectId}&${params.toString()}`;
    const payload = await this.requestJson<RawTestRailCase[] | { cases?: RawTestRailCase[] }>(endpoint);
    return Array.isArray(payload) ? payload : (payload.cases ?? []);
  }

  async addCase(sectionId: string, input: AddCaseInput): Promise<RawTestRailCase> {
    const body: Record<string, unknown> = { title: input.title };
    if (input.refs) body.refs = input.refs;
    if (input.preconditions) body.custom_preconds = input.preconditions;
    if (input.stepsSeparated && input.stepsSeparated.length > 0) {
      body.custom_steps_separated = input.stepsSeparated.map((s) => ({
        content: s.content,
        expected: s.expected ?? ""
      }));
      // plain-text fallback for "Test Case (Text)" template
      body.custom_steps = input.stepsSeparated
        .map((s, i) => `${i + 1}. ${s.content}${s.expected ? `\nEsperado: ${s.expected}` : ""}`)
        .join("\n");
    }
    const payload = await this.requestJson<RawTestRailCase>(`add_case/${sectionId}`, "POST", body);
    if (!payload || typeof payload.id !== "number") {
      throw new Error("Invalid add_case response from TestRail.");
    }
    return payload;
  }

  async updateCase(caseId: number, input: UpdateCaseInput): Promise<RawTestRailCase> {
    const body: Record<string, unknown> = {};
    if (input.title) body.title = input.title;
    if (input.refs !== undefined) body.refs = input.refs;
    if (input.preconditions !== undefined) body.custom_preconds = input.preconditions;
    if (input.stepsSeparated && input.stepsSeparated.length > 0) {
      body.custom_steps_separated = input.stepsSeparated.map((s) => ({
        content: s.content,
        expected: s.expected ?? ""
      }));
      // plain-text fallback for "Test Case (Text)" template
      body.custom_steps = input.stepsSeparated
        .map((s, i) => `${i + 1}. ${s.content}${s.expected ? `\nEsperado: ${s.expected}` : ""}`)
        .join("\n");
    }
    const payload = await this.requestJson<RawTestRailCase>(`update_case/${caseId}`, "POST", body);
    if (!payload || typeof payload.id !== "number") {
      throw new Error("Invalid update_case response from TestRail.");
    }
    return payload;
  }

  private buildCasesEndpoint(projectId: string, suiteId?: string, sectionId?: string): string {
    const params = new URLSearchParams();
    if (suiteId) {
      params.set("suite_id", suiteId);
    }
    if (sectionId) {
      params.set("section_id", sectionId);
    }

    const query = params.toString();
    return query ? `get_cases/${projectId}&${query}` : `get_cases/${projectId}`;
  }

  private async requestJson<T>(
    endpoint: string,
    method: "GET" | "POST" = "GET",
    body?: Record<string, unknown> | unknown[]
  ): Promise<T> {
    const sanitizedEndpoint = endpoint.replace(/^\/+/, "");
    const url = `${this.baseApiUrl}/${sanitizedEndpoint}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`TestRail request failed: ${message}`);
    }

    const rawText = await response.text();

    let payload: unknown = {};
    if (rawText.trim()) {
      try {
        payload = JSON.parse(rawText);
      } catch {
        throw new Error(`Invalid JSON response from TestRail (HTTP ${response.status}).`);
      }
    }

    if (!response.ok) {
      const errorPayload = payload as ApiErrorPayload;
      const apiMessage = errorPayload.error || errorPayload.message || "Unknown TestRail API error";
      throw new Error(`TestRail API error (HTTP ${response.status}): ${apiMessage}`);
    }

    return payload as T;
  }
}
