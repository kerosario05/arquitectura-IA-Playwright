import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { chromium } from "@playwright/test";
import { JiraWorkflowSession } from "./jira-workflow-runtime";
import { saveTestFile } from "../test-files/test-file-store";
import { bindJiraWorkflowPort } from "./jira-workflow-port";
import { createJiraPlaywrightPort } from "./jira-semantic-executor";

test("multi-application execution captures a fresh ID, scopes approval to its row and restores the primary page", async () => {
  const requestId = `REQ-${Date.now()}`;
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(req.url === "/approval" ? `<label>Número de solicitud<input></label><table aria-label="Solicitudes"><tr><td>OTHER</td><td><button>Aprobar</button></td></tr><tr><td>${requestId}</td><td><button onclick="this.textContent='Aprobada'">Aprobar</button></td></tr></table>`
      : `<div><span>Número de solicitud</span><strong>${requestId}</strong></div><label>Borrador<input value="conservado"></label>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${address.port}/`;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(); const page = await context.newPage(); await page.goto(baseUrl);
    await context.addCookies([{ name: "login", value: "primary", url: baseUrl }]);
    const workflow = new JiraWorkflowSession(page, { baseUrl, jiraApplications: { Aprobaciones: { baseUrl: `${baseUrl}approval` } } }, "profile-a");
    const port = bindJiraWorkflowPort(workflow, createJiraPlaywrightPort(page, baseUrl), (other, url) => createJiraPlaywrightPort(other, url));
    await workflow.execute({ kind: "capture", field: "Número de solicitud", variable: "solicitudId" });
    await port.executeWorkflow!({ kind: "application", alias: "Aprobaciones" });
    assert.notEqual(workflow.page, page);
    assert.equal((await workflow.page.context().cookies()).some(cookie => cookie.name === "login"), false);
    assert.equal(port.baseUrl, `${baseUrl}approval`);
    await workflow.execute({ kind: "fillCaptured", field: "Número de solicitud", variable: "solicitudId" });
    assert.equal(await workflow.page.getByLabel("Número de solicitud").inputValue(), requestId);
    await workflow.execute({ kind: "clickCapturedRow", container: "Solicitudes", variable: "solicitudId", action: "Aprobar" });
    assert.equal(await workflow.page.getByRole("button", { name: "Aprobada", exact: true }).count(), 1);
    const secondary = workflow.page;
    await workflow.execute({ kind: "application", alias: "principal" });
    assert.equal(workflow.page, page);
    assert.equal(await workflow.page.getByLabel("Borrador").inputValue(), "conservado");
    await assert.rejects(workflow.execute({ kind: "application", alias: "Inventada" }), /NOT_CONFIGURED/);
    await workflow.close(); assert.equal(secondary.isClosed(), true);
    const fresh = new JiraWorkflowSession(page, { baseUrl }, "profile-a");
    await assert.rejects(fresh.execute({ kind: "fillCaptured", field: "Borrador", variable: "solicitudId" }), /CAPTURE_MISSING/);
    await assert.rejects(fresh.execute({ kind: "capture", field: "Contraseña", variable: "secret" }), /SENSITIVE_FIELD/);
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("one document step handles 1, 2 and 5 visible labelled fields across two project fixtures", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jira-workflow-files-"));
  const previous = process.env.TEST_FILE_STORAGE_DIR; process.env.TEST_FILE_STORAGE_DIR = root;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const projectSlug of ["profile-a", "profile-b"]) {
      const context = await browser.newContext(); const page = await context.newPage();
      const asset = await saveTestFile({ projectSlug, filename: "fixture.pdf", contentType: "application/pdf", bytes: Buffer.from("synthetic file") });
      const workflow = new JiraWorkflowSession(page, { baseUrl: "https://fixture.test" }, projectSlug);
      for (const count of [1, 2, 5]) {
        await page.setContent(`<section role="dialog" aria-label="Documentación">${Array.from({ length: count }, (_, index) => `<label>Documento ${index + 1}<input type="file"></label>`).join("")}</section>`);
        const values = Object.fromEntries(Array.from({ length: count }, (_, index) => [`Documento ${index + 1}`, asset.fileRef]));
        await workflow.execute({ kind: "documents", container: "Documentación", optional: false }, JSON.stringify(values));
        assert.deepEqual(await page.locator('input[type="file"]').evaluateAll(elements => elements.map(element => (element as HTMLInputElement).files?.[0]?.name)), Array(count).fill("fixture.pdf"));
      }
      await page.setContent('<section role="dialog" aria-label="Documentación"><label>Conocido<input type="file"></label><label>Faltante<input type="file"></label></section>');
      await assert.rejects(workflow.execute({ kind: "documents", container: "Documentación", optional: false }, JSON.stringify({ Conocido: asset.fileRef })), /FILE_MISSING:Faltante/);
      assert.equal(await page.getByLabel("Conocido").evaluate(element => (element as HTMLInputElement).files?.length), 0);
      await page.setContent('<section role="dialog" aria-label="Documentación"><input type="file"><input type="file"></section>');
      await assert.rejects(workflow.execute({ kind: "documents", container: "Documentación", optional: false }, JSON.stringify({ Conocido: asset.fileRef })), /FIELD_AMBIGUOUS/);
      await page.setContent('<p>Sin diálogo</p>');
      await workflow.execute({ kind: "documents", container: "Documentación", optional: true });
      await context.close();
    }
  } finally {
    await browser.close(); if (previous === undefined) delete process.env.TEST_FILE_STORAGE_DIR; else process.env.TEST_FILE_STORAGE_DIR = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});
