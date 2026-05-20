import type { Page } from "@playwright/test";

export type CreateTestRailRunInput = {
  projectId: number;
  suiteId?: number;
  sectionId: number;
  jiraIssueKey: string;
  runName: string;
  comentario: string;
};

export type GenerateEvidenceDocInput = {
  templatePath: string;
  outputPath: string;
  data: {
    requerimiento: string;
    analista: string;
    casoPrueba: string;
    fecha: string;
    estado: string;
    escenarios: unknown[];
  };
};

export type AttachToJiraInput = {
  issueKey: string;
  filePath: string;
};

export async function crearRunTestRailDesdeSeccionYMarcarExitoso(
  input: CreateTestRailRunInput
): Promise<{ runId: number }> {
  const { requireTestRailConfig } = await import("../config/env");
  const { config } = await import("../config/env");
  const { TestRailClient } = await import("../clients/testrail.client");

  const testRailConfig = requireTestRailConfig(config);
  const client = new TestRailClient(testRailConfig);

  const rawCases = await client.getCases(
    String(input.projectId),
    input.suiteId ? String(input.suiteId) : undefined,
    String(input.sectionId)
  );

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

export async function generarDocumentoEvidencias(
  input: GenerateEvidenceDocInput
): Promise<void> {
  const { readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
  const { dirname } = await import("node:path");

  let docxtemplater: any;
  let PizZip: any;

  try {
    docxtemplater = await import("docxtemplater" as string);
    PizZip = await import("pizzip" as string);
  } catch {
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

export async function adjuntarDocxAJira(input: AttachToJiraInput): Promise<void> {
  const { config } = await import("../config/env");
  const jiraConfig = config.integrations.jira;

  if (!jiraConfig?.baseUrl || !jiraConfig?.email || !jiraConfig?.apiToken) {
    throw new Error("Jira credentials not configured. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN.");
  }

  const { readFileSync } = await import("node:fs");
  const auth = Buffer.from(`${jiraConfig.email}:${jiraConfig.apiToken}`).toString("base64");
  const fileBuffer = readFileSync(input.filePath);

  const response = await fetch(
    `${jiraConfig.baseUrl}/rest/api/3/issue/${input.issueKey}/attachments`,
    {
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
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Jira attachment failed (HTTP ${response.status}): ${text}`);
  }
}

export async function runPostExecutionReporting(input: {
  page: Page;
  caseId: number;
  projectId: number;
  suiteId?: number;
  sectionId: number;
  jiraIssueKey: string;
  runName: string;
  evidenceDocPath: string;
  escenarios: unknown[];
}): Promise<{ testRailRunId?: number; jiraAttached: boolean }> {
  let testRailRunId: number | undefined;
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
  } catch (error) {
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[cases:start][Jira] Attachment failed (non-blocking): ${message}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[cases:start][Evidence] Document generation failed (non-blocking): ${message}`);
  }

  return { testRailRunId, jiraAttached };
}
