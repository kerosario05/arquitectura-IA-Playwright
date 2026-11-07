import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { settleJiraAction } from "./jira-action-settlement";
import { jiraWorkflowApplications, parseJiraDocumentSet, type JiraApplication, type JiraWorkflowOperation } from "./jira-workflow";
import { resolveTestFile } from "../test-files/test-file-store";
import fs from "node:fs/promises";
import { loadAppConfig } from "../automations/app-auto-resolver";

export async function createJiraWorkflowSession(page: Page, appSlug: string): Promise<JiraWorkflowSession> {
  const profile = await loadAppConfig(appSlug);
  if (!profile?.baseUrl) throw new Error("JIRA_APP_PROFILE_MISSING");
  return new JiraWorkflowSession(page, profile, appSlug);
}

async function uniqueVisible(locator: Locator, reason: string): Promise<Locator> {
  const visible: Locator[] = [];
  for (const item of await locator.all()) if (await item.isVisible()) visible.push(item);
  if (visible.length !== 1) throw new Error(`${reason}:${visible.length}`);
  return visible[0];
}

function namedContainer(page: Page, name: string): Locator {
  return page.getByRole("dialog", { name, exact: true }).or(page.getByRole("region", { name, exact: true }))
    .or(page.getByRole("group", { name, exact: true })).or(page.getByRole("table", { name, exact: true }))
    .or(page.getByRole("grid", { name, exact: true })).or(page.getByRole("list", { name, exact: true }));
}

/** Each workflow owns fresh variables and pages; business IDs never enter a reusable plan. */
export class JiraWorkflowSession {
  private active: Page;
  private alias = "principal";
  private readonly pages = new Map<string, Page>();
  private readonly variables = new Map<string, string>();
  private readonly ownedContexts: BrowserContext[] = [];
  private readonly ignoreHTTPSErrors: boolean;
  readonly applications: Record<string, JiraApplication>;
  constructor(private readonly initialPage: Page, profile: Record<string, unknown>, private readonly projectSlug: string) {
    this.active = initialPage;
    this.pages.set("principal", initialPage);
    this.applications = { ...jiraWorkflowApplications(profile), principal: { baseUrl: String(profile.baseUrl) } };
    this.ignoreHTTPSErrors = profile.ignoreHTTPSErrors === true;
  }
  get page(): Page { return this.active; }
  get application(): string { return this.alias; }
  get baseUrl(): string { return this.applications[this.alias].baseUrl; }
  async close(): Promise<void> {
    await Promise.all(this.ownedContexts.splice(0).map(context => context.close().catch(() => {})));
    this.variables.clear();
  }
  private captured(key: string): string {
    const value = this.variables.get(key);
    if (!value) throw new Error(`JIRA_WORKFLOW_CAPTURE_MISSING:${key}`);
    return value;
  }
  async execute(operation: JiraWorkflowOperation, documentSet?: string): Promise<void> {
    if (operation.kind === "application") {
      const application = this.applications[operation.alias];
      if (!application) throw new Error(`JIRA_WORKFLOW_APPLICATION_NOT_CONFIGURED:${operation.alias}`);
      let page = this.pages.get(operation.alias);
      if (!page) {
        const browser = this.initialPage.context().browser();
        if (!browser) throw new Error("JIRA_WORKFLOW_ISOLATED_SESSION_UNAVAILABLE");
        const context = await browser.newContext({ ignoreHTTPSErrors: this.ignoreHTTPSErrors, serviceWorkers: "block", viewport: this.initialPage.viewportSize() });
        this.ownedContexts.push(context);
        page = await context.newPage();
        page.setDefaultTimeout(30000);
        this.pages.set(operation.alias, page);
        await settleJiraAction(page, () => page!.goto(application.baseUrl, { waitUntil: "domcontentloaded" }), application.baseUrl);
      }
      if (page.isClosed()) throw new Error("JIRA_WORKFLOW_PAGE_CLOSED");
      this.active = page; this.alias = operation.alias;
      await page.bringToFront();
      return;
    }
    if (operation.kind === "capture") {
      if (/contrase[nñ]a|password|secret|token|\botp\b|\bpin\b/i.test(operation.field)) throw new Error("JIRA_WORKFLOW_CAPTURE_SENSITIVE_FIELD");
      const labelled = this.page.getByLabel(operation.field, { exact: true });
      const terms = this.page.getByRole("term").filter({ hasText: new RegExp(`^${operation.field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) });
      const definitions = terms.locator("xpath=following-sibling::dd[1]");
      // Many applications show generated IDs as adjacent label/value text rather
      // than a form control or a semantic definition list. Accept only the value
      // immediately following the exact observed label; ambiguity still fails closed.
      const exactLabels = this.page.getByText(operation.field, { exact: true });
      const adjacentValues = exactLabels.locator("xpath=following-sibling::*[1]");
      const owners = labelled.or(definitions).or(adjacentValues);
      await owners.first().waitFor({ state: "visible", timeout: 15000 });
      const owner = await uniqueVisible(owners, "JIRA_WORKFLOW_CAPTURE_AMBIGUOUS_OR_MISSING");
      const value = await owner.evaluate(element => {
        const control = element as HTMLInputElement;
        return ("value" in control ? String(control.value) : element.textContent ?? "").trim();
      });
      if (!value || value.length > 500 || await owner.getAttribute("type") === "password") throw new Error("JIRA_WORKFLOW_CAPTURE_INVALID");
      if (this.variables.has(operation.variable)) throw new Error("JIRA_WORKFLOW_CAPTURE_DUPLICATE");
      this.variables.set(operation.variable, value);
      return;
    }
    if (operation.kind === "fillCaptured") {
      const field = await uniqueVisible(this.page.getByLabel(operation.field, { exact: true }), "JIRA_WORKFLOW_FIELD_AMBIGUOUS_OR_MISSING");
      const value = this.captured(operation.variable);
      await settleJiraAction(this.page, () => field.fill(value));
      await expect(field).toHaveValue(value);
      return;
    }
    if (operation.kind === "clickCapturedRow") {
      const root = await uniqueVisible(namedContainer(this.page, operation.container), "JIRA_WORKFLOW_CONTAINER_AMBIGUOUS_OR_MISSING");
      const row = await uniqueVisible(root.getByRole("row").or(root.getByRole("listitem"))
        .filter({ has: this.page.getByText(this.captured(operation.variable), { exact: true }) }), "JIRA_WORKFLOW_ROW_AMBIGUOUS_OR_MISSING");
      const control = await uniqueVisible(row.getByRole("button", { name: operation.action, exact: true })
        .or(row.getByRole("link", { name: operation.action, exact: true })), "JIRA_WORKFLOW_ROW_ACTION_AMBIGUOUS_OR_MISSING");
      await settleJiraAction(this.page, () => control.click());
      return;
    }
    const containers = namedContainer(this.page, operation.container);
    try { await containers.first().waitFor({ state: "visible", timeout: operation.optional ? 5000 : 15000 }); }
    catch (error) {
      if (operation.optional && error instanceof Error && error.name === "TimeoutError" && !(await Promise.all((await containers.all()).map(item => item.isVisible()))).some(Boolean)) return;
      throw error;
    }
    const root = await uniqueVisible(containers, "JIRA_DOCUMENT_CONTAINER_AMBIGUOUS_OR_MISSING");
    const files = parseJiraDocumentSet(documentSet ?? "");
    const inputs = root.locator('input[type="file"]');
    const observed = await inputs.evaluateAll(elements => elements.flatMap((element, index) => {
      const input = element as HTMLInputElement;
      if (input.disabled) return [];
      const label = input.getAttribute("aria-label")?.trim()
        || (input.getAttribute("aria-labelledby") ?? "").split(/\s+/).map(id => document.getElementById(id)?.textContent?.trim()).filter(Boolean).join(" ")
        || Array.from(input.labels ?? []).map(item => item.textContent?.trim()).filter(Boolean).join(" ");
      const visible = input.getClientRects().length > 0 || Array.from(input.labels ?? []).some(item => item.getClientRects().length > 0);
      return visible ? [{ index, label: label ?? "" }] : [];
    }));
    if (!observed.length) throw new Error("JIRA_DOCUMENT_FIELDS_NOT_OBSERVED");
    const labels = new Set<string>();
    // Resolve the entire set before changing the form, so missing data cannot leave a partial upload.
    const pending = [];
    for (const slot of observed) {
      if (!slot.label || labels.has(slot.label)) throw new Error("JIRA_DOCUMENT_FIELD_AMBIGUOUS");
      labels.add(slot.label);
      if (!Object.hasOwn(files, slot.label)) throw new Error(`JIRA_DOCUMENT_FILE_MISSING:${slot.label}`);
      pending.push({ ...slot, file: await resolveTestFile(this.projectSlug, files[slot.label]) });
    }
    for (const slot of pending) {
      // Resolve again by observed exact label; indexes are not persisted as replay targets.
      const target = root.getByLabel(slot.label, { exact: true }).and(root.locator('input[type="file"]'));
      if (await target.count() !== 1) throw new Error("JIRA_DOCUMENT_FIELD_CHANGED");
      await target.setInputFiles({ name: slot.file.filename, mimeType: slot.file.contentType, buffer: await fs.readFile(slot.file.path) });
      await expect.poll(() => target.evaluate(element => Array.from((element as HTMLInputElement).files ?? []).map(file => file.name)), { timeout: 10000 }).toEqual([slot.file.filename]);
    }
  }
}
