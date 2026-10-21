import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { loadAppConfig } from "../automations/app-auto-resolver";
import { createJiraPlaywrightPort, discoverJiraScenario, type JiraScenarioInput } from "./jira-semantic-executor";

async function main() {
const source = JSON.parse(await fs.readFile(path.resolve(".artifacts/scenario-preview-runs/f5d6df54-6280-496f-a341-d0073a2083f9/jira-scenarios.json"), "utf8"))[0] as JiraScenarioInput;
const scenario = { ...source, steps: source.steps.slice(0, 13), inputRequirements: source.inputRequirements?.filter(field => field.stepIndex <= 13), unresolvedUiRequirements: source.unresolvedUiRequirements?.filter(field => field.stepIndex <= 13), conditionRequirements: [], expectedResult: "" };
const profile = await loadAppConfig("fenix");
if (!profile?.baseUrl) throw new Error("PROFILE_BASE_URL_MISSING");
const values = { rnc: process.env.JIRA_DEBUG_RNC!, usuario: process.env.JIRA_DEBUG_USER!, contrasena: process.env.JIRA_DEBUG_PASSWORD!, codigo_acceso_sms: process.env.JIRA_DEBUG_OTP! };
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: profile.ignoreHTTPSErrors === true });
  try {
    const page = await context.newPage();
    const port = createJiraPlaywrightPort(page, profile.baseUrl);
    const originalAct = port.act.bind(port);
    port.act = async (step, target, value) => {
      const resolved = await originalAct(step, target, value);
      if (step.action === "click") {
        const headings = await page.locator("h1,h2,[role=heading]").allTextContents().catch(() => [] as string[]);
        const locator = resolved.strategy === "css" ? page.locator(resolved.value ?? "")
          : resolved.strategy === "text" ? page.getByText(resolved.value ?? "", { exact: resolved.exact ?? true })
          : resolved.strategy === "role" && resolved.role ? page.getByRole(resolved.role as any, { name: resolved.name, exact: resolved.exact ?? true }) : undefined;
        const actual = locator ? await locator.evaluate(element => ({ tag: element.tagName.toLowerCase(), id: element.id, text: (element as HTMLElement).innerText?.trim(), ariaLabel: element.getAttribute("aria-label"), role: element.getAttribute("role"), parentText: (element.parentElement as HTMLElement | null)?.innerText?.trim() })).catch(() => undefined) : undefined;
        console.log(JSON.stringify({ step: step.index, target, resolved, actual, headings: headings.map(text => text.trim()).filter(Boolean).slice(0, 5) }));
      }
      return resolved;
    };
    await discoverJiraScenario(scenario, port, values);
  } finally { await context.close(); }
} catch (error) {
  const message = error instanceof Error ? error.message.replace(/JIRA_REQUIRED_DATA_MISSING:[^ ]+/g, "JIRA_REQUIRED_DATA_MISSING") : "DEBUG_FAILED";
  console.log(JSON.stringify({ diagnostic: "discovery stopped", error: message }));
} finally { await browser.close(); }
}
void main();
