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
exports.crearRunTestRailDesdeSeccionYMarcarExitoso = crearRunTestRailDesdeSeccionYMarcarExitoso;
exports.generarDocumentoEvidencias = generarDocumentoEvidencias;
exports.adjuntarDocxAJira = adjuntarDocxAJira;
exports.runPostExecutionReporting = runPostExecutionReporting;
async function crearRunTestRailDesdeSeccionYMarcarExitoso(input) {
    const { requireTestRailConfig } = await Promise.resolve().then(() => __importStar(require("../config/env")));
    const { config } = await Promise.resolve().then(() => __importStar(require("../config/env")));
    const { TestRailClient } = await Promise.resolve().then(() => __importStar(require("../clients/testrail.client")));
    const testRailConfig = requireTestRailConfig(config);
    const client = new TestRailClient(testRailConfig);
    const rawCases = await client.getCases(String(input.projectId), input.suiteId ? String(input.suiteId) : undefined, String(input.sectionId));
    const caseIds = rawCases.map((c) => c.id);
    const run = await client.addRun({
        projectId: String(input.projectId),
        suiteId: input.suiteId ? String(input.suiteId) : undefined,
        name: input.runName,
        description: input.comentario,
        caseIds
    });
    const results = caseIds.map((caseId) => ({
        runId: run.id,
        caseId,
        statusId: 1,
        comment: input.comentario
    }));
    await client.addResultsForCases(run.id, results);
    return { runId: run.id };
}
async function generarDocumentoEvidencias(input) {
    const { readFileSync, writeFileSync, mkdirSync } = await Promise.resolve().then(() => __importStar(require("node:fs")));
    const { dirname } = await Promise.resolve().then(() => __importStar(require("node:path")));
    let docxtemplater;
    let PizZip;
    try {
        docxtemplater = await Promise.resolve(`${"docxtemplater"}`).then(s => __importStar(require(s)));
        PizZip = await Promise.resolve(`${"pizzip"}`).then(s => __importStar(require(s)));
    }
    catch {
        throw new Error("docxtemplater and pizzip are required for evidence generation. Install with: npm install docxtemplater pizzip");
    }
    const template = readFileSync(input.templatePath, "binary");
    const zip = new PizZip.default(template);
    const doc = docxtemplater.createReport(zip);
    const result = doc.render(input.data);
    const buffer = result.getZip().generate({ type: "nodebuffer" });
    mkdirSync(dirname(input.outputPath), { recursive: true });
    writeFileSync(input.outputPath, buffer);
}
async function adjuntarDocxAJira(input) {
    const { config } = await Promise.resolve().then(() => __importStar(require("../config/env")));
    const jiraConfig = config.integrations.jira;
    if (!jiraConfig?.baseUrl || !jiraConfig?.email || !jiraConfig?.apiToken) {
        throw new Error("Jira credentials not configured. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN.");
    }
    const { readFileSync } = await Promise.resolve().then(() => __importStar(require("node:fs")));
    const auth = Buffer.from(`${jiraConfig.email}:${jiraConfig.apiToken}`).toString("base64");
    const fileBuffer = readFileSync(input.filePath);
    const response = await fetch(`${jiraConfig.baseUrl}/rest/api/3/issue/${input.issueKey}/attachments`, {
        method: "POST",
        headers: {
            Authorization: `Basic ${auth}`,
            Accept: "application/json",
            "X-Atlassian-Token": "no-check"
        },
        body: (() => {
            const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
            const parts = [
                `--${boundary}`,
                `Content-Disposition: form-data; name="file"; filename="${input.filePath.split("/").pop()}"`,
                `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
                "",
                fileBuffer.toString("binary"),
                `--${boundary}--`
            ];
            return new Blob([parts.join("\r\n")], {
                type: `multipart/form-data; boundary=${boundary}`
            });
        })()
    });
    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Jira attachment failed (HTTP ${response.status}): ${text}`);
    }
}
async function runPostExecutionReporting(input) {
    let testRailRunId;
    let jiraAttached = false;
    try {
        const trResult = await crearRunTestRailDesdeSeccionYMarcarExitoso({
            projectId: input.projectId,
            suiteId: input.suiteId,
            sectionId: input.sectionId,
            jiraIssueKey: input.jiraIssueKey,
            runName: input.runName,
            comentario: `Ejecutado automáticamente desde Playwright KiosKo. Evidencia adjunta en Jira ${input.jiraIssueKey}.`
        });
        testRailRunId = trResult.runId;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[cases:start][TestRail] Run creation failed (non-blocking): ${message}`);
    }
    try {
        await generarDocumentoEvidencias({
            templatePath: "data/templates/Formato Evidencias.docx",
            outputPath: input.evidenceDocPath,
            data: {
                requerimiento: "REGRESION - KIOSKO",
                analista: "Automatizado",
                casoPrueba: `Caso ${input.caseId}`,
                fecha: new Date().toLocaleDateString("es-DO"),
                estado: "Exitoso",
                escenarios: input.escenarios
            }
        });
        await input.page.waitForTimeout(5000);
        console.log(`[cases:start] Evidence document generated: ${input.evidenceDocPath}`);
        try {
            await adjuntarDocxAJira({
                issueKey: input.jiraIssueKey,
                filePath: input.evidenceDocPath
            });
            jiraAttached = true;
            console.log(`[cases:start][Jira] Document attached to ${input.jiraIssueKey}`);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.log(`[cases:start][Jira] Attachment failed (non-blocking): ${message}`);
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[cases:start][Evidence] Document generation failed (non-blocking): ${message}`);
    }
    return { testRailRunId, jiraAttached };
}
