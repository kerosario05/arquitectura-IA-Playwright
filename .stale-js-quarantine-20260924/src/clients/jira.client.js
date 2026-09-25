"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.JiraClient = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const DEFAULT_FIELDS = ["summary", "description", "status", "issuetype", "priority"];
class JiraClient {
    config;
    baseApiUrl;
    agileApiUrl;
    authHeader;
    constructor(config) {
        this.config = config;
        const base = config.baseUrl.replace(/\/+$/, "");
        this.baseApiUrl = `${base}/rest/api/3`;
        this.agileApiUrl = `${base}/rest/agile/1.0`;
        this.authHeader = `Basic ${Buffer.from(`${config.email}:${config.apiToken}`).toString("base64")}`;
    }
    async getIssue(issueKey, fields) {
        const fieldList = fields ?? [...DEFAULT_FIELDS];
        if (this.config.acceptanceCriteriaField && !fieldList.includes(this.config.acceptanceCriteriaField)) {
            fieldList.push(this.config.acceptanceCriteriaField);
        }
        const params = new URLSearchParams({ fields: fieldList.join(",") });
        const payload = await this.requestJson(`issue/${encodeURIComponent(issueKey)}?${params}`);
        if (!payload || typeof payload.key !== "string") {
            throw new Error(`Invalid response for issue ${issueKey}.`);
        }
        return payload;
    }
    async searchIssues(jql, fields, maxResults = 50) {
        const fieldList = fields ?? [...DEFAULT_FIELDS];
        if (this.config.acceptanceCriteriaField && !fieldList.includes(this.config.acceptanceCriteriaField)) {
            fieldList.push(this.config.acceptanceCriteriaField);
        }
        const allIssues = [];
        let nextPageToken;
        while (allIssues.length < maxResults) {
            const batchSize = Math.min(maxResults - allIssues.length, 100);
            const body = { jql, maxResults: batchSize, fields: fieldList };
            if (nextPageToken)
                body.nextPageToken = nextPageToken;
            const payload = await this.requestJson("search/jql", "POST", body);
            const batch = payload.issues ?? [];
            allIssues.push(...batch);
            if (!payload.nextPageToken || batch.length === 0)
                break;
            nextPageToken = payload.nextPageToken;
        }
        return allIssues;
    }
    async getProjects() {
        const projects = [];
        let startAt = 0;
        while (true) {
            const params = new URLSearchParams({ startAt: String(startAt), maxResults: "50" });
            const payload = await this.requestJson(`project/search?${params}`);
            const page = Array.isArray(payload) ? payload : (payload.values ?? []);
            projects.push(...page);
            if (Array.isArray(payload) || payload.isLast || page.length === 0)
                break;
            startAt += page.length;
        }
        return projects;
    }
    async getBoards(projectKeyOrId) {
        const boards = [];
        let startAt = 0;
        while (true) {
            const params = new URLSearchParams({
                projectKeyOrId,
                startAt: String(startAt),
                maxResults: "50"
            });
            const payload = await this.requestAgileJson(`board?${params}`);
            const page = payload.values ?? [];
            boards.push(...page);
            if (payload.isLast || page.length === 0)
                break;
            startAt += page.length;
        }
        return boards;
    }
    async getSprints(boardId, states = ["active", "future", "closed"]) {
        const sprints = [];
        let startAt = 0;
        while (true) {
            const params = new URLSearchParams({
                state: states.join(","),
                startAt: String(startAt),
                maxResults: "50"
            });
            const payload = await this.requestAgileJson(`board/${boardId}/sprint?${params}`);
            const page = payload.values ?? [];
            sprints.push(...page);
            if (payload.isLast || page.length === 0)
                break;
            startAt += page.length;
        }
        return sprints;
    }
    async getActiveSprint(projectKey) {
        const boards = await this.getBoards(projectKey);
        const scrumBoard = boards.find((b) => b.type === "scrum") ?? boards[0];
        if (!scrumBoard)
            return undefined;
        const sprints = await this.getSprints(scrumBoard.id, ["active"]);
        return sprints.find((s) => s.state === "active");
    }
    async createIssue(params) {
        try {
            const fields = {
                project: { key: params.projectKey },
                summary: params.summary,
                description: {
                    type: "doc",
                    version: 1,
                    content: [
                        {
                            type: "paragraph",
                            content: [{ type: "text", text: params.description }],
                        },
                    ],
                },
                issuetype: { name: params.issueType || "Bug" },
            };
            if (params.assigneeAccountId) {
                fields.assignee = { accountId: params.assigneeAccountId };
            }
            const body = { fields };
            const response = await this.requestJson("issue", "POST", body);
            const base = this.config.baseUrl.replace(/\/+$/, "");
            return {
                ok: true,
                issueKey: response.key,
                issueUrl: `${base}/browse/${response.key}`,
            };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { ok: false, error: message };
        }
    }
    async testConnection() {
        const payload = await this.requestJson("myself");
        return { ok: true, displayName: payload.displayName, email: payload.emailAddress };
    }
    async attachFileToIssue(issueKey, filePath, attachmentName) {
        try {
            const resolved = path.resolve(filePath);
            if (!fs.existsSync(resolved)) {
                return { ok: false, error: `File not found: ${resolved}` };
            }
            const stat = fs.statSync(resolved);
            if (!stat.isFile() || stat.size === 0) {
                return { ok: false, error: `Invalid file: ${resolved}` };
            }
            const ext = path.extname(resolved).toLowerCase();
            if (ext !== ".docx") {
                return { ok: false, error: `Unsupported file type: ${ext}` };
            }
            const name = attachmentName || path.basename(resolved);
            const buffer = fs.readFileSync(resolved);
            const formData = new FormData();
            formData.append("file", new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), name);
            const url = `${this.baseApiUrl}/issue/${encodeURIComponent(issueKey)}/attachments`;
            const response = await globalThis.fetch(url, {
                method: "POST",
                headers: {
                    Authorization: this.authHeader,
                    "X-Atlassian-Token": "no-check",
                },
                body: formData,
            });
            if (!response.ok) {
                const text = await response.text().catch(() => "");
                return { ok: false, error: `Jira attachment failed (HTTP ${response.status}): ${text.slice(0, 200)}` };
            }
            const result = await response.json();
            const attachmentId = result?.[0]?.id;
            return { ok: true, attachmentId };
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { ok: false, error: message };
        }
    }
    async requestJson(endpoint, method = "GET", body) {
        return this.fetch(this.baseApiUrl, endpoint, method, body);
    }
    async requestAgileJson(endpoint, method = "GET", body) {
        return this.fetch(this.agileApiUrl, endpoint, method, body);
    }
    async fetch(baseUrl, endpoint, method = "GET", body) {
        const url = `${baseUrl}/${endpoint.replace(/^\/+/, "")}`;
        let response;
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
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Jira request failed: ${message}`);
        }
        const rawText = await response.text();
        let payload = {};
        if (rawText.trim()) {
            try {
                payload = JSON.parse(rawText);
            }
            catch {
                throw new Error(`Invalid JSON response from Jira (HTTP ${response.status}).`);
            }
        }
        if (!response.ok) {
            const err = payload;
            const messages = err.errorMessages?.join("; ") ||
                Object.values(err.errors ?? {}).join("; ") ||
                err.message ||
                "Unknown Jira API error";
            throw new Error(`Jira API error (HTTP ${response.status}): ${messages}`);
        }
        return payload;
    }
}
exports.JiraClient = JiraClient;
