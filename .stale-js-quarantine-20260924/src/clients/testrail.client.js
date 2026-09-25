"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TestRailClient = exports.TestRailApiError = void 0;
const testrail_recording_payload_1 = require("../recording/testrail-recording-payload");
const testrail_step_serializer_1 = require("../testrail/testrail-step-serializer");
/**
 * Fields that are set explicitly by addCase/updateCase and must never be overwritten
 * by a caller-supplied `customFields` bag.
 */
const TESTRAIL_SEND_CUSTOM_REFS = process.env.TESTRAIL_SEND_CUSTOM_REFS?.toLowerCase() !== "false";
// The configured destination exposes the legacy text field (`custom_steps`).
// Structured steps are opt-in because sending an unavailable custom field can make
// TestRail commit the case and still return a 500 from its post-processing hook.
const TESTRAIL_SEND_CUSTOM_STEPS_SEPARATED = process.env.TESTRAIL_SEND_CUSTOM_STEPS_SEPARATED?.toLowerCase() === "true";
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
const DEFAULT_CUSTOM_PRECONDS = "Precondiciones:\n- App disponible.\n- Usuario o ambiente de prueba configurado.\n- Datos de prueba disponibles según el escenario.";
function buildCustomPreconds(value) {
    if (typeof value === "string" && value.trim().length > 0)
        return value.trim();
    return DEFAULT_CUSTOM_PRECONDS;
}
class TestRailApiError extends Error {
    status;
    errorId;
    constructor(message, status, errorId) {
        super(message);
        this.status = status;
        this.errorId = errorId;
        this.name = "TestRailApiError";
    }
}
exports.TestRailApiError = TestRailApiError;
class TestRailClient {
    config;
    baseApiUrl;
    authHeader;
    constructor(config) {
        this.config = config;
        this.baseApiUrl = `${config.url}/index.php?/api/v2`;
        this.authHeader = `Basic ${Buffer.from(`${config.email}:${config.apiKey}`).toString("base64")}`;
        // Log refs configuration at startup
        const refsField = process.env.TESTRAIL_REFS_FIELD || "both";
        const sendCustomRefs = process.env.TESTRAIL_SEND_CUSTOM_REFS?.toLowerCase() !== "false";
        console.log(`[testrail-config] url=${config.url} refsField=${refsField} sendCustomRefs=${sendCustomRefs}`);
    }
    async getCase(caseId) {
        const payload = await this.requestJson(`get_case/${caseId}`);
        if (!payload || typeof payload.id !== "number" || typeof payload.title !== "string") {
            throw new Error(`Invalid get_case response for case ${caseId}.`);
        }
        return payload;
    }
    async getCaseFields() {
        const payload = await this.requestJson("get_case_fields");
        const rawFields = Array.isArray(payload)
            ? payload
            : payload && typeof payload === "object" && Array.isArray(payload.fields)
                ? payload.fields
                : [];
        return rawFields
            .filter((field) => Boolean(field) && typeof field === "object")
            .map((field) => ({
            id: Number(field.id),
            name: String(field.name ?? ""),
            label: String(field.label ?? ""),
            type: String(field.type ?? ""),
            configs: field.configs,
            is_active: Boolean(field.is_active),
        }));
    }
    async getSection(sectionId) {
        try {
            const payload = await this.requestJson(`get_section/${sectionId}`);
            if (!payload || typeof payload.id !== "number" || typeof payload.name !== "string") {
                return null;
            }
            return payload;
        }
        catch {
            return null;
        }
    }
    async getCasesByIds(caseIds) {
        const uniqueIds = Array.from(new Set(caseIds));
        const cases = [];
        for (const caseId of uniqueIds) {
            try {
                const testCase = await this.getCase(caseId);
                cases.push(testCase);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                throw new Error(`Failed to fetch TestRail case ${caseId}: ${message}`);
            }
        }
        return cases;
    }
    async getCases(projectId, suiteId, sectionId) {
        const cases = [];
        let endpoint = this.buildCasesEndpoint(projectId, suiteId, sectionId);
        while (endpoint) {
            const payload = await this.requestJson(endpoint);
            if (Array.isArray(payload)) {
                cases.push(...payload);
                break;
            }
            const pageCases = payload.cases ?? [];
            cases.push(...pageCases);
            if (payload._links?.next && payload._links.next.trim()) {
                endpoint = payload._links.next.replace(/^\//, "").replace(/^api\/v2\//, "");
            }
            else {
                endpoint = "";
            }
        }
        return cases;
    }
    async testConnection() {
        try {
            const endpoint = `get_user_by_email&email=${encodeURIComponent(this.config.email)}`;
            const payload = await this.requestJson(endpoint);
            return { ok: true, userEmail: payload.email ?? this.config.email };
        }
        catch {
            await this.requestJson("get_statuses");
            return { ok: true, userEmail: this.config.email };
        }
    }
    async addRun(input) {
        const endpoint = `add_run/${input.projectId}`;
        const body = {
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
        }
        else {
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
        const payload = await this.requestJson(endpoint, "POST", body);
        if (!payload || typeof payload.id !== "number") {
            throw new Error("Invalid add_run response from TestRail.");
        }
        return payload;
    }
    async updateRun(runId, input) {
        const endpoint = `update_run/${runId}`;
        const body = {};
        if (input.name)
            body.name = input.name;
        if (input.description)
            body.description = input.description;
        const refsFieldForUpdateRun = process.env.TESTRAIL_REFS_FIELD || "both";
        if (input.refs && refsFieldForUpdateRun !== "none")
            body.refs = input.refs;
        console.log(`[testrail-client] update_run/${runId} keys=${Object.keys(body).join(",")} refs=${input.refs ?? "(none)"} refsField=${refsFieldForUpdateRun}`);
        const payload = await this.requestJson(endpoint, "POST", body);
        if (!payload || typeof payload.id !== "number") {
            throw new Error("Invalid update_run response from TestRail.");
        }
        return payload;
    }
    async addResultsForCases(runId, results) {
        const endpoint = `add_results_for_cases/${runId}`;
        const body = {
            results: results.map((r) => {
                const entry = {
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
        const payload = await this.requestJson(endpoint, "POST", body);
        const entries = Array.isArray(payload) ? payload : payload.results;
        return { added: Array.isArray(entries) ? entries.length : 0 };
    }
    async getProjects() {
        const payload = await this.requestJson("get_projects");
        return Array.isArray(payload) ? payload : (payload.projects ?? []);
    }
    async getSuites(projectId) {
        const payload = await this.requestJson(`get_suites/${projectId}`);
        return Array.isArray(payload) ? payload : (payload.suites ?? []);
    }
    async getCaseCount(projectId, suiteId) {
        const params = new URLSearchParams({ limit: "250" });
        if (suiteId)
            params.set("suite_id", suiteId);
        try {
            const payload = await this.requestJson(`get_cases/${projectId}&${params.toString()}`);
            if (Array.isArray(payload))
                return { count: payload.length, hasMore: false };
            return { count: (payload.cases ?? []).length, hasMore: !!(payload._links?.next) };
        }
        catch {
            return { count: 0, hasMore: false };
        }
    }
    async getSections(projectId, suiteId) {
        const params = suiteId ? `&suite_id=${suiteId}` : "";
        const payload = await this.requestJson(`get_sections/${projectId}${params}`);
        return Array.isArray(payload) ? payload : (payload.sections ?? []);
    }
    async getRuns(projectId, suiteId) {
        const params = new URLSearchParams();
        if (suiteId)
            params.set("suite_id", suiteId);
        const query = params.toString();
        const endpoint = query ? `get_runs/${projectId}&${query}` : `get_runs/${projectId}`;
        const payload = await this.requestJson(endpoint);
        return Array.isArray(payload) ? payload : (payload.runs ?? []);
    }
    async getCasesByRefs(projectId, refs, suiteId, sectionId) {
        const params = new URLSearchParams({ refs_filter: refs });
        if (suiteId)
            params.set("suite_id", suiteId);
        if (sectionId)
            params.set("section_id", sectionId);
        const endpoint = `get_cases/${projectId}&${params.toString()}`;
        const payload = await this.requestJson(endpoint);
        return Array.isArray(payload) ? payload : (payload.cases ?? []);
    }
    async addCase(sectionId, input, options) {
        const isCompat = options?.compatibilityMode === true;
        const isPreserve = options?.preservePayload === true;
        console.log(`[testrail-debug] addCase invoked sectionId=${sectionId} title="${input.title?.substring(0, 50)}..." compatibilityMode=${isCompat} preservePayload=${isPreserve}`);
        const body = { title: input.title };
        if (input.templateId !== undefined)
            body.template_id = input.templateId;
        if (input.typeId !== undefined)
            body.type_id = input.typeId;
        if (input.priorityId !== undefined)
            body.priority_id = input.priorityId;
        const refsField = process.env.TESTRAIL_REFS_FIELD || "both";
        const refsDisabled = refsField === "none";
        if (isPreserve) {
            // Preserve mode: send exactly what's in the input (smoke/diagnostics)
            // Only add root refs if present in input, do not inject any custom fields.
            if (input.refs)
                body.refs = input.refs;
            if (input.preconditions)
                body.custom_preconds = input.preconditions;
            if (input.customExpected)
                body.custom_expected = input.customExpected;
            if (input.customCaseOracle)
                body.custom_case_oracle = input.customCaseOracle;
            if (input.stepsSeparated?.length) {
                if (TESTRAIL_SEND_CUSTOM_STEPS_TEXT) {
                    body.custom_steps = (0, testrail_step_serializer_1.serializeTestRailSteps)(input.stepsSeparated);
                }
                if (TESTRAIL_SEND_CUSTOM_STEPS_SEPARATED) {
                    body.custom_steps_separated = input.stepsSeparated.map((s) => ({ content: s.content, expected: s.expected ?? "" }));
                }
            }
            // Also copy over any raw string fields that were passed (e.g. custom_steps from smoke)
            for (const [k, v] of Object.entries(input)) {
                if (k.startsWith("custom_") && !body.hasOwnProperty(k) && typeof v === "string" && v.length > 0) {
                    body[k] = v;
                }
            }
        }
        else if (isCompat) {
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
                body.custom_steps = (0, testrail_step_serializer_1.serializeTestRailSteps)(input.stepsSeparated);
            }
        }
        else {
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
            }
            else {
                console.log(`[testrail-debug] addCase refs handling: refsField="none" sendCustomRefs=${TESTRAIL_SEND_CUSTOM_REFS} hasRootRefs=false hasCustomRefs=false`);
            }
            body.custom_preconds = buildCustomPreconds(input.preconditions);
            if (TESTRAIL_SEND_CUSTOM_EXPECTED && input.customExpected)
                body.custom_expected = input.customExpected;
            if (TESTRAIL_SEND_CUSTOM_CASE_ORACLE && input.customCaseOracle)
                body.custom_case_oracle = input.customCaseOracle;
            const customFields = input.customFields;
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
                if (TESTRAIL_SEND_CUSTOM_STEPS_TEXT) {
                    body.custom_steps = (0, testrail_step_serializer_1.serializeTestRailSteps)(input.stepsSeparated);
                }
            }
        }
        const rawRefs = body.refs;
        const hasCustomRefs = body.hasOwnProperty("custom_refs");
        const previewRaw = typeof rawRefs === "string" ? rawRefs.replace(/[|,]/g, "").slice(0, 64) : "";
        const hasRootRefs = typeof rawRefs === "string";
        console.log(`[testrail-client] preservePayload=${isPreserve} hasRootRefs=${hasRootRefs} keys=${Object.keys(body).join(",")}`);
        console.log(`[testrail-debug] addCase payloadKeys=${Object.keys(body).join(",")} hasRootRefs=${hasRootRefs} hasCustomRefs=${hasCustomRefs} refsPreview="${previewRaw}"`);
        const payloadErrors = (0, testrail_recording_payload_1.validateTestRailRecordingPayload)(body);
        if (payloadErrors.length > 0) {
            throw new Error(`testrail_recording_payload_invalid: ${payloadErrors.join("; ")}`);
        }
        console.log(`[testrail-debug] add_case payload=${JSON.stringify((0, testrail_recording_payload_1.describeTestRailRecordingPayload)(body))}`);
        const isRefsString = typeof body.refs === "string";
        const isRefsEmpty = typeof body.refs === "string" && body.refs === "";
        const refsIsNonEmpty = isRefsString && !isRefsEmpty;
        const customRefsIsNonEmpty = typeof body.custom_refs === "string" && body.custom_refs.trim().length > 0;
        console.log(`[testrail-debug] addCase pre-send validation: refs=${JSON.stringify(body.refs)} custom_refs=${JSON.stringify(body.custom_refs)} refsIsNonEmpty=${refsIsNonEmpty} customRefsIsNonEmpty=${customRefsIsNonEmpty}`);
        // Final safeguard: ensure root refs is set if configured (skip if refsDisabled or preservePayload)
        const refsFieldForGuard = process.env.TESTRAIL_REFS_FIELD || "both";
        const shouldHaveRootRefs = !refsDisabled && (refsFieldForGuard === "both" || refsFieldForGuard === "refs");
        if (!isPreserve && shouldHaveRootRefs && typeof body.refs !== "string") {
            console.warn(`[testrail-client] addCase refs was missing before send; setting to empty string (refsField=${refsFieldForGuard})`);
            body.refs = "";
        }
        const payload = await this.requestJson(`add_case/${sectionId}`, "POST", body);
        if (!payload || typeof payload.id !== "number") {
            throw new Error("Invalid add_case response from TestRail.");
        }
        return payload;
    }
    async updateCase(caseId, input) {
        if (input.custom_preconds !== undefined) {
            const payload = await this.requestJson(`update_case/${caseId}`, "POST", {
                custom_preconds: input.custom_preconds,
            });
            if (!payload || typeof payload.id !== "number") {
                throw new Error("Invalid update_case response from TestRail.");
            }
            return payload;
        }
        console.log(`[testrail-debug] updateCase invoked caseId=${caseId} title="${input.title?.substring(0, 50) ?? "no-title"}..."`);
        const body = {};
        if (input.title)
            body.title = input.title;
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
        }
        else {
            console.log(`[testrail-debug] updateCase refs handling: refsField="none" sendCustomRefs=${TESTRAIL_SEND_CUSTOM_REFS} hasRootRefs=false hasCustomRefs=false`);
        }
        body.custom_preconds = buildCustomPreconds(input.preconditions);
        if (TESTRAIL_SEND_CUSTOM_EXPECTED && input.customExpected !== undefined)
            body.custom_expected = input.customExpected;
        if (TESTRAIL_SEND_CUSTOM_CASE_ORACLE && input.customCaseOracle !== undefined)
            body.custom_case_oracle = input.customCaseOracle;
        const customFields = input.customFields;
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
                body.custom_steps = (0, testrail_step_serializer_1.serializeTestRailSteps)(input.stepsSeparated);
            }
        }
        const hasCustomRefs = body.hasOwnProperty("custom_refs");
        const refsPreview = hasRefs ? refsValue.replace(/[|,]/g, "").slice(0, 64) : "";
        console.log(`[testrail-debug] updateCase payloadKeys=${Object.keys(body).join(",")} hasRefs=${hasRefs} hasCustomRefs=${hasCustomRefs} refsPreview="${refsPreview}"`);
        console.log(`[testrail-debug] update_case payloadKeys=${Object.keys(body).join(",")}`);
        const isRefsString = typeof body.refs === "string";
        const isRefsEmpty = typeof body.refs === "string" && body.refs === "";
        const refsIsNonEmpty = isRefsString && !isRefsEmpty;
        const customRefsIsNonEmpty = typeof body.custom_refs === "string" && body.custom_refs.trim().length > 0;
        console.log(`[testrail-debug] updateCase pre-send validation: refs=${JSON.stringify(body.refs)} custom_refs=${JSON.stringify(body.custom_refs)} refsIsNonEmpty=${refsIsNonEmpty} customRefsIsNonEmpty=${customRefsIsNonEmpty}`);
        const payload = await this.requestJson(`update_case/${caseId}`, "POST", body);
        if (!payload || typeof payload.id !== "number") {
            throw new Error("Invalid update_case response from TestRail.");
        }
        return payload;
    }
    buildCasesEndpoint(projectId, suiteId, sectionId) {
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
    async requestJson(endpoint, method = "GET", body) {
        const sanitizedEndpoint = endpoint.replace(/^\/+/, "");
        const url = `${this.baseApiUrl}/${sanitizedEndpoint}`;
        const queryString = sanitizedEndpoint.includes("&") ? sanitizedEndpoint.split("&").slice(1).join("&") : "";
        const queryKeys = queryString ? Array.from(new URLSearchParams(queryString).keys()).join(",") : "none";
        const payloadKeys = body && !Array.isArray(body) && typeof body === "object" ? Object.keys(body).join(",") : "none";
        const refsValue = body && !Array.isArray(body) && typeof body === "object" ? body.refs : undefined;
        const refsPreview = typeof refsValue === "string" ? refsValue.replace(/[|,]/g, "") : "";
        const refsType = typeof refsValue;
        const refsLength = typeof refsValue === "string" ? refsValue.length : 0;
        const hasRefs = typeof refsValue === "string" && refsValue.trim().length > 0;
        const endpointName = sanitizedEndpoint.split("&")[0];
        const debugEnabled = process.env.TESTRAIL_DEBUG_PAYLOADS === "true";
        if (debugEnabled) {
            console.log(`[testrail-debug] endpoint=${endpointName} method=${method} payloadKeys=${payloadKeys} queryKeys=${queryKeys} hasRefs=${hasRefs} refsType=${refsType} refsLength=${refsLength} refsPreview="${refsPreview}"`);
        }
        // Final validation before HTTP send
        const hasRootRefs = typeof body?.refs === "string";
        const hasCustomRefs = typeof body?.custom_refs === "string";
        const refsVal = body?.refs;
        const refsLen = typeof refsVal === "string" ? refsVal.length : -1;
        console.log(`[testrail-client] ${endpointName} final body section=... keys=${payloadKeys} hasRootRefs=${hasRootRefs} refsValueLength=${refsLen} hasCustomRefs=${hasCustomRefs}`);
        let response;
        try {
            response = await fetch(url, {
                method,
                headers: {
                    Authorization: this.authHeader,
                    "Content-Type": "application/json"
                },
                body: body ? JSON.stringify(body) : undefined
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`TestRail request failed: ${message}`);
        }
        const rawText = await response.text();
        let payload = {};
        if (rawText.trim()) {
            try {
                payload = JSON.parse(rawText);
            }
            catch {
                throw new Error(`Invalid JSON response from TestRail (HTTP ${response.status}).`);
            }
        }
        if (!response.ok) {
            console.error(`[testrail-debug] HTTP error response:
- status: ${response.status}
- body: ${rawText}
- endpoint: ${endpointName}`);
            const errorPayload = payload;
            const apiMessage = errorPayload.error || errorPayload.message || "Unknown TestRail API error";
            const errorId = errorPayload.errorId ?? errorPayload.error_id ?? errorPayload.id;
            throw new TestRailApiError(`TestRail API error (HTTP ${response.status}) at ${endpointName}: ${apiMessage}`, response.status, errorId);
        }
        return payload;
    }
}
exports.TestRailClient = TestRailClient;
