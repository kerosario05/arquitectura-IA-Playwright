import type { RequiredTestRailRuntimeConfig } from "../types/env.types";
import type {
  AddCaseInput,
  AddResultForCaseInput,
  CreateRunInput,
  RawTestRailCase,
  TestRailProject,
  TestRailRun,
  TestRailSection,
  TestRailSuite,
  UpdateCaseInput
} from "../types/testrail.types";

/**
 * Fields that are set explicitly by addCase/updateCase and must never be overwritten
 * by a caller-supplied `customFields` bag.
 */
const TESTRAIL_SEND_CUSTOM_REFS = process.env.TESTRAIL_SEND_CUSTOM_REFS?.toLowerCase() !== "false";
const TESTRAIL_SEND_CUSTOM_STEPS_SEPARATED = process.env.TESTRAIL_SEND_CUSTOM_STEPS_SEPARATED?.toLowerCase() !== "false";
const TESTRAIL_SEND_CUSTOM_STEPS_TEXT = process.env.TESTRAIL_SEND_CUSTOM_STEPS_TEXT?.toLowerCase() !== "false";
const TESTRAIL_SEND_CUSTOM_EXPECTED = process.env.TESTRAIL_SEND_CUSTOM_EXPECTED?.toLowerCase() !== "false";
const TESTRAIL_SEND_CUSTOM_CASE_ORACLE = process.env.TESTRAIL_SEND_CUSTOM_CASE_ORACLE?.toLowerCase() !== "false";
// Compatibility mode flags for minimal fallback payload
const TESTRAIL_COMPAT_SEND_PRECONDS = process.env.TESTRAIL_COMPAT_SEND_PRECONDS?.toLowerCase() === "true";
const TESTRAIL_COMPAT_SEND_EXPECTED = process.env.TESTRAIL_COMPAT_SEND_EXPECTED?.toLowerCase() === "true";
const TESTRAIL_COMPAT_SEND_STEPS_TEXT = process.env.TESTRAIL_COMPAT_SEND_STEPS_TEXT?.toLowerCase() === "true";
const TESTRAIL_COMPAT_SEND_CASE_ORACLE = process.env.TESTRAIL_COMPAT_SEND_CASE_ORACLE?.toLowerCase() === "true";

const RESERVED_TESTRAIL_FIELDS = new Set([
  "title",
  "refs",
  "custom_refs",
  "custom_preconds",
  "custom_expected",
  "custom_case_oracle",
  "custom_steps",
  "custom_steps_separated",
]);

const DEFAULT_CUSTOM_PRECONDS =
  "Precondiciones:\n- App disponible.\n- Usuario o ambiente de prueba configurado.\n- Datos de prueba disponibles según el escenario.";

function buildCustomPreconds(value: string | undefined | null): string {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  return DEFAULT_CUSTOM_PRECONDS;
}

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

export type TestRailCaseFieldMetadata = {
  id: number;
  name: string;
  label: string;
  type: string;
  configs: unknown;
  is_active: boolean;
};

export class TestRailClient {
  private readonly baseApiUrl: string;

  private readonly authHeader: string;

  constructor(private readonly config: RequiredTestRailRuntimeConfig) {
    this.baseApiUrl = `${config.url}/index.php?/api/v2`;
    this.authHeader = `Basic ${Buffer.from(`${config.email}:${config.apiKey}`).toString("base64")}`;

    // Log refs configuration at startup
    const refsField = process.env.TESTRAIL_REFS_FIELD || "both";
    const sendCustomRefs = process.env.TESTRAIL_SEND_CUSTOM_REFS?.toLowerCase() !== "false";
    console.log(`[testrail-config] url=${config.url} refsField=${refsField} sendCustomRefs=${sendCustomRefs}`);
  }

  async getCase(caseId: number): Promise<RawTestRailCase> {
    const payload = await this.requestJson<RawTestRailCase>(`get_case/${caseId}`);
    if (!payload || typeof payload.id !== "number" || typeof payload.title !== "string") {
      throw new Error(`Invalid get_case response for case ${caseId}.`);
    }
    return payload;
  }

  async getCaseFields(): Promise<TestRailCaseFieldMetadata[]> {
    const payload = await this.requestJson<unknown>("get_case_fields");
    const rawFields = Array.isArray(payload)
      ? payload
      : payload && typeof payload === "object" && Array.isArray((payload as { fields?: unknown[] }).fields)
        ? (payload as { fields: unknown[] }).fields
        : [];

    return rawFields
      .filter((field): field is Record<string, unknown> => Boolean(field) && typeof field === "object")
      .map((field) => ({
        id: Number(field.id),
        name: String(field.name ?? ""),
        label: String(field.label ?? ""),
        type: String(field.type ?? ""),
        configs: field.configs,
        is_active: Boolean(field.is_active),
      }));
  }

  async getSection(sectionId: number): Promise<{ id: number; name: string; project_id?: number; suite_id?: number } | null> {
    try {
      const payload = await this.requestJson<{ id: number; name: string; project_id?: number; suite_id?: number }>(`get_section/${sectionId}`);
      if (!payload || typeof payload.id !== "number" || typeof payload.name !== "string") {
        return null;
      }
      return payload;
    } catch {
      return null;
    }
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
        endpoint = payload._links.next.replace(/^\//, "").replace(/^api\/v2\//, "");
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

    const hasRefs = Boolean(input.refs);
    const refsFieldForRun = process.env.TESTRAIL_REFS_FIELD || "both";
    if (hasRefs && refsFieldForRun !== "none") {
      body.refs = input.refs;
    }

    const bodyKeys = Object.keys(body).join(",");
    const refsPreview = (input.refs ?? "").slice(0, 64);
    console.log(`[testrail-client] add_run/${input.projectId} keys=${bodyKeys} hasRefs=${hasRefs} refsPreview=${refsPreview}`);
    console.log(`[testrail-client] add_run body=${JSON.stringify(body)}`);

    const payload = await this.requestJson<TestRailRun>(endpoint, "POST", body);
    if (!payload || typeof payload.id !== "number") {
      throw new Error("Invalid add_run response from TestRail.");
    }
    return payload;
  }

  async updateRun(runId: number, input: { name?: string; description?: string; refs?: string }): Promise<TestRailRun> {
    const endpoint = `update_run/${runId}`;
    const body: Record<string, unknown> = {};
    if (input.name) body.name = input.name;
    if (input.description) body.description = input.description;
    const refsFieldForUpdateRun = process.env.TESTRAIL_REFS_FIELD || "both";
    if (input.refs && refsFieldForUpdateRun !== "none") body.refs = input.refs;
    console.log(`[testrail-client] update_run/${runId} keys=${Object.keys(body).join(",")} refs=${input.refs ?? "(none)"} refsField=${refsFieldForUpdateRun}`);
    const payload = await this.requestJson<TestRailRun>(endpoint, "POST", body);
    if (!payload || typeof payload.id !== "number") {
      throw new Error("Invalid update_run response from TestRail.");
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

  async getProjects(): Promise<TestRailProject[]> {
    const payload = await this.requestJson<TestRailProject[] | { projects?: TestRailProject[] }>("get_projects");
    return Array.isArray(payload) ? payload : (payload.projects ?? []);
  }

  async getSuites(projectId: string): Promise<TestRailSuite[]> {
    const payload = await this.requestJson<TestRailSuite[] | { suites?: TestRailSuite[] }>(`get_suites/${projectId}`);
    return Array.isArray(payload) ? payload : (payload.suites ?? []);
  }

  async getCaseCount(projectId: string, suiteId?: string): Promise<{ count: number; hasMore: boolean }> {
    const params = new URLSearchParams({ limit: "250" });
    if (suiteId) params.set("suite_id", suiteId);
    try {
      const payload = await this.requestJson<RawTestRailCase[] | CasesPagePayload>(`get_cases/${projectId}&${params.toString()}`);
      if (Array.isArray(payload)) return { count: payload.length, hasMore: false };
      return { count: (payload.cases ?? []).length, hasMore: !!(payload._links?.next) };
    } catch {
      return { count: 0, hasMore: false };
    }
  }

  async getSections(projectId: string, suiteId?: string): Promise<TestRailSection[]> {
    const params = suiteId ? `&suite_id=${suiteId}` : "";
    const payload = await this.requestJson<TestRailSection[] | { sections?: TestRailSection[] }>(`get_sections/${projectId}${params}`);
    return Array.isArray(payload) ? payload : (payload.sections ?? []);
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

  async addCase(sectionId: string, input: AddCaseInput, options?: { compatibilityMode?: boolean; preservePayload?: boolean }): Promise<RawTestRailCase> {
    const isCompat = options?.compatibilityMode === true;
    const isPreserve = options?.preservePayload === true;
    console.log(`[testrail-debug] addCase invoked sectionId=${sectionId} title="${input.title?.substring(0, 50)}..." compatibilityMode=${isCompat} preservePayload=${isPreserve}`);

    const body: Record<string, unknown> = { title: input.title };
    const refsField = process.env.TESTRAIL_REFS_FIELD || "both";
    const refsDisabled = refsField === "none";

    if (isPreserve) {
      // Preserve mode: send exactly what's in the input (smoke/diagnostics)
      // Only add root refs if present in input, do not inject any custom fields.
      if (input.refs) body.refs = input.refs;
      if (input.preconditions) body.custom_preconds = input.preconditions;
      if (input.customExpected) body.custom_expected = input.customExpected;
      if (input.customCaseOracle) body.custom_case_oracle = input.customCaseOracle;
      if (input.stepsSeparated?.length) {
        body.custom_steps_separated = input.stepsSeparated.map((s) => ({ content: s.content, expected: s.expected ?? "" }));
        body.custom_steps = input.stepsSeparated.map((s, i) => `${i + 1}. ${s.content}`).join("\n");
      }
      // Also copy over any raw string fields that were passed (e.g. custom_steps from smoke)
      for (const [k, v] of Object.entries(input as any)) {
        if (k.startsWith("custom_") && !body.hasOwnProperty(k) && typeof v === "string" && v.length > 0) {
          body[k] = v;
        }
      }
    } else if (isCompat) {
      // Compatibility mode: send refs according to TESTRAIL_REFS_FIELD
      if (!refsDisabled) {
        if (refsField === "both" || refsField === "refs") {
          body.refs = input.refs || "";
        }
        if (TESTRAIL_SEND_CUSTOM_REFS && (refsField === "both" || refsField === "custom_refs")) {
          body.custom_refs = input.refs || "";
        }
      }
      // Only send title + refs + explicitly allowed compat fields
      if (TESTRAIL_COMPAT_SEND_PRECONDS && input.preconditions) {
        body.custom_preconds = buildCustomPreconds(input.preconditions);
      }
      if (TESTRAIL_COMPAT_SEND_EXPECTED && input.customExpected) {
        body.custom_expected = input.customExpected;
      }
      if (TESTRAIL_COMPAT_SEND_CASE_ORACLE && input.customCaseOracle) {
        body.custom_case_oracle = input.customCaseOracle;
      }
      if (TESTRAIL_COMPAT_SEND_STEPS_TEXT && input.stepsSeparated?.length) {
        body.custom_steps = input.stepsSeparated.map((s, i) => `${i + 1}. ${s.content}`).join("\n");
      }
    } else {
      // Normal mode: send refs according to TESTRAIL_REFS_FIELD configuration
      const refsValue = input.refs || "";
      const hasRefs = typeof refsValue === "string" && refsValue.trim().length > 0;
      console.log(`[testrail-debug] addCase refs handling: refsField="${refsField}" sendCustomRefs=${TESTRAIL_SEND_CUSTOM_REFS} hasRefs=${hasRefs}`);

      if (!refsDisabled) {
        // Send root refs only if configured to do so
        if (refsField === "both" || refsField === "refs") {
          body.refs = refsValue;
        }
        // Send custom_refs only if configured to do so
        if (TESTRAIL_SEND_CUSTOM_REFS && (refsField === "both" || refsField === "custom_refs")) {
          body.custom_refs = refsValue;
        }
      } else {
        console.log(`[testrail-debug] addCase refs handling: refsField="none" sendCustomRefs=${TESTRAIL_SEND_CUSTOM_REFS} hasRootRefs=false hasCustomRefs=false`);
      }

      body.custom_preconds = buildCustomPreconds(input.preconditions);
      if (TESTRAIL_SEND_CUSTOM_EXPECTED && input.customExpected) body.custom_expected = input.customExpected;
      if (TESTRAIL_SEND_CUSTOM_CASE_ORACLE && input.customCaseOracle) body.custom_case_oracle = input.customCaseOracle;

      const customFields = (input as AddCaseInput & { customFields?: Record<string, unknown> }).customFields;
    if (customFields && typeof customFields === "object") {
      for (const [key, value] of Object.entries(customFields)) {
        // Never let caller-supplied customFields overwrite reserved core fields
        if (RESERVED_TESTRAIL_FIELDS.has(key)) {
          console.log(`[testrail-debug] addCase: skipping reserved field "${key}" from customFields (value=${JSON.stringify(value)})`);
          continue;
        }
        if (value !== undefined) {
          body[key] = value;
        }
      }
    }
    if (input.stepsSeparated && input.stepsSeparated.length > 0) {
      if (TESTRAIL_SEND_CUSTOM_STEPS_SEPARATED) {
        body.custom_steps_separated = input.stepsSeparated.map((s) => ({
          content: s.content,
          expected: s.expected ?? ""
        }));
      }
      // plain-text fallback for "Test Case (Text)" template
      if (TESTRAIL_SEND_CUSTOM_STEPS_TEXT) {
        body.custom_steps = input.stepsSeparated
          .map((s, i) => `${i + 1}. ${s.content}${s.expected ? `\nEsperado: ${s.expected}` : ""}`)
          .join("\n");
      }
    }
    }

    const rawRefs = (body as Record<string, unknown>).refs as string | undefined;
    const hasCustomRefs = body.hasOwnProperty("custom_refs");
    const previewRaw = typeof rawRefs === "string" ? rawRefs.replace(/[|,]/g, "").slice(0, 64) : "";
    const hasRootRefs = typeof rawRefs === "string";
    console.log(`[testrail-client] preservePayload=${isPreserve} hasRootRefs=${hasRootRefs} keys=${Object.keys(body).join(",")}`);
    console.log(`[testrail-debug] addCase payloadKeys=${Object.keys(body).join(",")} hasRootRefs=${hasRootRefs} hasCustomRefs=${hasCustomRefs} refsPreview="${previewRaw}"`);
    console.log(`[testrail-debug] final add_case body=${JSON.stringify(body)}`);

    const isRefsString = typeof body.refs === "string";
    const isRefsEmpty = typeof body.refs === "string" && body.refs === "";
    const refsIsNonEmpty = isRefsString && !isRefsEmpty;
    const customRefsIsNonEmpty = typeof body.custom_refs === "string" && (body.custom_refs as string).trim().length > 0;
    console.log(`[testrail-debug] addCase pre-send validation: refs=${JSON.stringify(body.refs)} custom_refs=${JSON.stringify(body.custom_refs)} refsIsNonEmpty=${refsIsNonEmpty} customRefsIsNonEmpty=${customRefsIsNonEmpty}`);

    // Final safeguard: ensure root refs is set if configured (skip if refsDisabled or preservePayload)
    const refsFieldForGuard = process.env.TESTRAIL_REFS_FIELD || "both";
    const shouldHaveRootRefs = !refsDisabled && (refsFieldForGuard === "both" || refsFieldForGuard === "refs");
    if (!isPreserve && shouldHaveRootRefs && typeof body.refs !== "string") {
      console.warn(`[testrail-client] addCase refs was missing before send; setting to empty string (refsField=${refsFieldForGuard})`);
      body.refs = "";
    }

    const payload = await this.requestJson<RawTestRailCase>(`add_case/${sectionId}`, "POST", body);
    if (!payload || typeof payload.id !== "number") {
      throw new Error("Invalid add_case response from TestRail.");
    }
    return payload;
  }

  async updateCase(caseId: number, input: UpdateCaseInput): Promise<RawTestRailCase> {
    if (input.custom_preconds !== undefined) {
      const payload = await this.requestJson<RawTestRailCase>(`update_case/${caseId}`, "POST", {
        custom_preconds: input.custom_preconds,
      });
      if (!payload || typeof payload.id !== "number") {
        throw new Error("Invalid update_case response from TestRail.");
      }
      return payload;
    }
    console.log(`[testrail-debug] updateCase invoked caseId=${caseId} title="${input.title?.substring(0, 50) ?? "no-title"}..."`);
    
    const body: Record<string, unknown> = {};
    if (input.title) body.title = input.title;

    // Handle refs field with configurable fallback to custom_refs
    const refsField = process.env.TESTRAIL_REFS_FIELD || "both";
    const refsValue = input.refs || "";
    const hasRefs = typeof refsValue === "string" && refsValue.trim().length > 0;
    const refsDisabled = refsField === "none";
    console.log(`[testrail-debug] updateCase refs handling: refsField="${refsField}" sendCustomRefs=${TESTRAIL_SEND_CUSTOM_REFS} hasRefs=${hasRefs}`);

    if (!refsDisabled) {
      // Send root refs only if configured to do so
      if (refsField === "both" || refsField === "refs") {
        body.refs = refsValue || "";
      }
      // Send custom_refs only if configured to do so
      if (TESTRAIL_SEND_CUSTOM_REFS && (refsField === "both" || refsField === "custom_refs")) {
        body.custom_refs = refsValue;
      }
    } else {
      console.log(`[testrail-debug] updateCase refs handling: refsField="none" sendCustomRefs=${TESTRAIL_SEND_CUSTOM_REFS} hasRootRefs=false hasCustomRefs=false`);
    }

    body.custom_preconds = buildCustomPreconds(input.preconditions);
    if (TESTRAIL_SEND_CUSTOM_EXPECTED && input.customExpected !== undefined) body.custom_expected = input.customExpected;
    if (TESTRAIL_SEND_CUSTOM_CASE_ORACLE && input.customCaseOracle !== undefined) body.custom_case_oracle = input.customCaseOracle;
    const customFields = (input as UpdateCaseInput & { customFields?: Record<string, unknown> }).customFields;
    if (customFields && typeof customFields === "object") {
      for (const [key, value] of Object.entries(customFields)) {
        // Never let caller-supplied customFields overwrite reserved core fields
        if (RESERVED_TESTRAIL_FIELDS.has(key)) {
          console.log(`[testrail-debug] updateCase: skipping reserved field "${key}" from customFields (value=${JSON.stringify(value)})`);
          continue;
        }
        if (value !== undefined) {
          body[key] = value;
        }
      }
    }
    if (input.stepsSeparated && input.stepsSeparated.length > 0) {
      if (TESTRAIL_SEND_CUSTOM_STEPS_SEPARATED) {
        body.custom_steps_separated = input.stepsSeparated.map((s) => ({
          content: s.content,
          expected: s.expected ?? ""
        }));
      }
      if (TESTRAIL_SEND_CUSTOM_STEPS_TEXT) {
        body.custom_steps = input.stepsSeparated
          .map((s, i) => `${i + 1}. ${s.content}${s.expected ? `\nEsperado: ${s.expected}` : ""}`)
          .join("\n");
      }
    }

    const hasCustomRefs = body.hasOwnProperty("custom_refs");
    const refsPreview = hasRefs ? refsValue.replace(/[|,]/g, "").slice(0, 64) : "";
    console.log(`[testrail-debug] updateCase payloadKeys=${Object.keys(body).join(",")} hasRefs=${hasRefs} hasCustomRefs=${hasCustomRefs} refsPreview="${refsPreview}"`);
    console.log(`[testrail-debug] final update_case body=${JSON.stringify(body)}`);

    const isRefsString = typeof body.refs === "string";
    const isRefsEmpty = typeof body.refs === "string" && body.refs === "";
    const refsIsNonEmpty = isRefsString && !isRefsEmpty;
    const customRefsIsNonEmpty = typeof body.custom_refs === "string" && (body.custom_refs as string).trim().length > 0;
    console.log(`[testrail-debug] updateCase pre-send validation: refs=${JSON.stringify(body.refs)} custom_refs=${JSON.stringify(body.custom_refs)} refsIsNonEmpty=${refsIsNonEmpty} customRefsIsNonEmpty=${customRefsIsNonEmpty}`);

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
    const queryString = sanitizedEndpoint.includes("&") ? sanitizedEndpoint.split("&").slice(1).join("&") : "";
    const queryKeys = queryString ? Array.from(new URLSearchParams(queryString).keys()).join(",") : "none";
    const payloadKeys = body && !Array.isArray(body) && typeof body === "object" ? Object.keys(body).join(",") : "none";
    const refsValue = body && !Array.isArray(body) && typeof body === "object" ? (body as Record<string, unknown>).refs : undefined;
    const refsPreview = typeof refsValue === "string" ? refsValue.replace(/[|,]/g, "") : "";
    const refsType = typeof refsValue;
    const refsLength = typeof refsValue === "string" ? refsValue.length : 0;
    const hasRefs = typeof refsValue === "string" && refsValue.trim().length > 0;
    const endpointName = sanitizedEndpoint.split("&")[0];
    const debugEnabled = process.env.TESTRAIL_DEBUG_PAYLOADS === "true";
    if (debugEnabled) {
      console.log(
        `[testrail-debug] endpoint=${endpointName} method=${method} payloadKeys=${payloadKeys} queryKeys=${queryKeys} hasRefs=${hasRefs} refsType=${refsType} refsLength=${refsLength} refsPreview="${refsPreview}"`
      );
    }

    // Final validation before HTTP send
    const hasRootRefs = typeof (body as any)?.refs === "string";
    const hasCustomRefs = typeof (body as any)?.custom_refs === "string";
    const refsVal = (body as any)?.refs;
    const refsLen = typeof refsVal === "string" ? refsVal.length : -1;
    console.log(`[testrail-client] ${endpointName} final body section=... keys=${payloadKeys} hasRootRefs=${hasRootRefs} refsValueLength=${refsLen} hasCustomRefs=${hasCustomRefs}`);

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
      console.error(`[testrail-debug] HTTP error response:
- status: ${response.status}
- body: ${rawText}
- endpoint: ${endpointName}`);
      const errorPayload = payload as ApiErrorPayload;
      const apiMessage = errorPayload.error || errorPayload.message || "Unknown TestRail API error";
      throw new Error(`TestRail API error (HTTP ${response.status}) at ${endpointName}: ${apiMessage}`);
    }

    return payload as T;
  }
}
