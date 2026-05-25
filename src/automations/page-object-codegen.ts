import fs from "node:fs/promises";
import path from "node:path";
import { loadPageObjectRegistry, savePageObjectRegistry } from "./page-object-registry";
import type { PageObjectEntry, PageObjectMethod } from "../types/page-object.types";
import type { AppProfile } from "./app-profile";
import { buildAppAutomationPaths } from "./app-profile";
import {
  INTENT_CLASS_OWNERSHIP,
  CLASS_SPECIFIC_METHODS,
  getMisplacedMethodWarning as getOwnershipWarning,
  getPreferredOwnerForIntent
} from "../types/pom-ownership";

export type PageObjectCodegenOptions = {
  appSlug: string;
  outputRoot?: string;
  dryRun?: boolean;
  onlyClassName?: string;
  overwriteCandidates?: boolean;
};

export type PageObjectCodegenResult = {
  generated: number;
  skipped: number;
  errors: string[];
  warnings: string[];
  files: Array<{ className: string; filePath: string; status: "generated" | "skipped" | "error" }>;
};

const INTENT_LOCATOR_TEMPLATES: Record<string, string> = {
  start_session: [
    "await this.page.goto('/');",
    "await this.page.waitForLoadState('networkidle');",
    "await this.page.waitForTimeout(1000);",
    "const button = this.page.getByRole('button', { name: /iniciar sesión|iniciar|start|comenzar/i });",
    "await button.waitFor({ state: 'visible', timeout: 10000 });",
    "await button.click({ force: true });",
    "await this.page.waitForLoadState('networkidle');",
    "await this.page.waitForTimeout(3000);"
  ].join("\n"),
  open_home: "await this.page.goto('/');",
  open_login_modal: [
    "const openLoginButton = this.page.getByRole('link', { name: /log in|iniciar sesion/i })",
    "  .or(this.page.getByRole('button', { name: /log in|iniciar sesion/i }));",
    "await openLoginButton.first().waitFor({ state: 'visible', timeout: 10000 });",
    "await openLoginButton.first().click();"
  ].join("\n"),
  expect_login_form: [
    "const loginModal = this.page.locator('#logInModal');",
    "await expect(loginModal).toBeVisible({ timeout: 10000 });",
    "await expect(loginModal.locator('#loginusername')).toBeVisible();",
    "await expect(loginModal.locator('#loginpassword')).toBeVisible();"
  ].join("\n"),
  fill_username: [
    "const usernameInput = this.page.locator('#logInModal').locator('#loginusername');",
    "await usernameInput.waitFor({ state: 'visible', timeout: 10000 });",
    "await usernameInput.fill(value);"
  ].join("\n"),
  fill_password: [
    "const passwordInput = this.page.locator('#logInModal').locator('#loginpassword');",
    "await passwordInput.waitFor({ state: 'visible', timeout: 10000 });",
    "await passwordInput.fill(value);"
  ].join("\n"),
  submit_login: [
    "const submitButton = this.page.locator('#logInModal').getByRole('button', { name: /log in|iniciar sesion/i });",
    "await submitButton.first().waitFor({ state: 'visible', timeout: 10000 });",
    "await submitButton.first().click();"
  ].join("\n"),
  expect_logged_in: [
    "const loggedInIndicator = this.page.getByText(/welcome|logout|log out|cerrar sesion/i).first();",
    "await expect(loggedInIndicator).toBeVisible({ timeout: 10000 });"
  ].join("\n"),
  open_product_information: [
    "const previousUrl = this.page.url();",
    "await this.page.getByRole('button', { name: /información de productos|product information/i }).click();",
    "await waitForPromotedSpecStepReady(this.page, { previousUrl, expectEntityList: false });"
  ].join("\n"),
  select_category: [
    "const previousUrl = this.page.url();",
    "await this.page.getByRole('button', { name: categoryName }).or(this.page.getByRole('link', { name: categoryName })).click();",
    "await waitForPromotedSpecStepReady(this.page, { previousUrl, expectEntityList: true });"
  ].join("\n"),
  select_product: [
    "await waitForListReadiness(this.page, { timeoutMs: 10000, pollMs: 500, minCards: 1 });",
    "const normalize = (s: string) => s.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().trim();",
    "const target = normalize(productName);",
    "const allTokens = target.split(/\\s+/).filter(t => t.length > 2);",
    "const stopWords = new Set(['de','del','la','el','los','las','un','una','con','sin','por','para','the','a','an','in','on','at','to','for']);",
    "const strongTokens = allTokens.filter(t => !stopWords.has(t));",
    "const tokensToMatch = strongTokens.length > 0 ? strongTokens : allTokens;",
    "if (tokensToMatch.length === 0) throw new Error('Product target \"' + productName + '\" has no meaningful tokens.');",
    "const checkboxRegex = new RegExp(tokensToMatch.map(t => t.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')).join('.*'), 'i');",
    "const checkbox = this.page.getByRole('checkbox', { name: checkboxRegex, exact: false });",
    "if (await checkbox.count() > 0) {",
    "  const isChecked = await checkbox.first().isChecked().catch(() => false);",
    "  if (!isChecked) { await checkbox.first().click({ timeout: 10000 }); }",
    "  return;",
    "}",
    "const roleRegex = new RegExp(tokensToMatch.map(t => t.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')).join('.*'), 'i');",
    "const rolesToTry = ['button', 'link', 'option', 'radio', 'menuitem'];",
    "for (const role of rolesToTry) {",
    "  const locator = this.page.getByRole(role as any, { name: roleRegex, exact: false });",
    "  if (await locator.count() > 0) { await locator.first().click({ timeout: 10000 }); return; }",
    "}",
    "const headingRegex = new RegExp(tokensToMatch.map(t => t.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')).join('.*'), 'i');",
    "const headingLocator = this.page.locator('h1, h2, h3, h4, h5, h6').filter({ hasText: headingRegex }).first();",
    "try {",
    "  if (await headingLocator.count() > 0) {",
    "    const headingHandle = await headingLocator.elementHandle({ timeout: 5000 });",
    "    if (headingHandle) {",
    "      const ancestor = await headingHandle.evaluateHandle((el) => {",
    "        let current = el as HTMLElement; let depth = 0;",
    "        const clickableTags = ['button', 'a', 'input', 'label'];",
    "        const clickableRoles = ['button', 'link', 'option', 'radio', 'checkbox', 'tab', 'menuitem'];",
    "        const clickableClassPatterns = ['card', 'cursor-pointer', 'clickable', 'btn', 'interactive', 'selectable'];",
    "        while (current && depth < 5) {",
    "          const tagName = current.tagName.toLowerCase();",
    "          const role = current.getAttribute('role');",
    "          const hasOnClick = !!(current as any).onclick || current.getAttribute('onclick');",
    "          const hasClickableClass = clickableClassPatterns.some(p => typeof current.className === 'string' && current.className.includes(p));",
    "          if (clickableTags.includes(tagName) || clickableRoles.includes(role || '') || hasOnClick || hasClickableClass) return current;",
    "          current = current.parentElement; depth++;",
    "        }",
    "        return null;",
    "      });",
    "      const ancestorElement = ancestor.asElement();",
    "      if (ancestorElement) { await ancestorElement.click({ timeout: 10000 }); return; }",
    "      await headingLocator.click({ timeout: 10000 }); return;",
    "    }",
    "  }",
    "} catch { /* continue */ }",
    "const fallbackLocator = this.page.locator(':has-text(\"' + productName.replace(/\"/g, '\\\\\"') + '\")').first();",
    "if (await fallbackLocator.count() > 0) { await fallbackLocator.click({ timeout: 10000 }); return; }",
    "throw new Error('Could not find product matching \"' + productName + '\". Strategies tried: checkbox, role, text, heading, semantic_tokens, product_condition');"
  ].join("\n"),
  select_first_visible_item: [
    "await waitForListReadiness(this.page, { timeoutMs: 10000, pollMs: 500, minCards: 1 });",
    "const candidate = this.page.locator(':visible').filter({ has: this.page.locator('h1, h2, h3, h4, h5, h6, p, span') }).first();",
    "if (await candidate.count() === 0) throw new Error('No visible list item found to select.');",
    "await candidate.click({ timeout: 10000 });"
  ].join("\n"),
  select_first_visible_product: [
    "await waitForListReadiness(this.page, { timeoutMs: 10000, pollMs: 500, minCards: 1 });",
    "const productCard = this.page.locator('article:visible, [data-testid*=\"product\"]:visible, [class*=\"product\"]:visible, [class*=\"card\"]:visible').first();",
    "if (await productCard.count() === 0) throw new Error('No visible product card found to select.');",
    "const actionable = productCard.locator('a:visible, button:visible, [role=\"button\"]:visible').first();",
    "if (await actionable.count() > 0) { await actionable.click({ timeout: 10000 }); return; }",
    "await productCard.click({ timeout: 10000 });"
  ].join("\n"),
  select_first_visible_card: [
    "await waitForListReadiness(this.page, { timeoutMs: 10000, pollMs: 500, minCards: 1 });",
    "const productLink = this.page.locator('a[href*=\"prod.html\"]:visible, a.hrefch:visible').first();",
    "if (await productLink.count() > 0) { await productLink.click({ timeout: 10000 }); return; }",
    "const card = this.page.locator('[class*=\"card\"]:visible, article:visible, [class*=\"item\"]:visible').first();",
    "if (await card.count() === 0) throw new Error('No visible card found to select.');",
    "const actionable = card.locator('a:visible, button:visible, [role=\"button\"]:visible').first();",
    "if (await actionable.count() > 0) { await actionable.click({ timeout: 10000 }); return; }",
    "await card.click({ timeout: 10000 });"
  ].join("\n"),
  select_first_visible_row: [
    "await waitForListReadiness(this.page, { timeoutMs: 10000, pollMs: 500, minCards: 1 });",
    "const row = this.page.locator('tr:visible, [role=\"row\"]:visible').first();",
    "if (await row.count() === 0) throw new Error('No visible row found to select.');",
    "await row.click({ timeout: 10000 });"
  ].join("\n"),
  click_primary_action: [
    "const button = this.page.getByRole('button', { name: new RegExp(actionName, 'i') });",
    "const link = this.page.getByRole('link', { name: new RegExp(actionName, 'i') });",
    "const buttonOrLink = button.or(link).first();",
    "await buttonOrLink.waitFor({ state: 'visible', timeout: 10000 });",
    "const isEnabled = await buttonOrLink.isEnabled({ timeout: 15000 }).catch(() => true);",
    "if (!isEnabled) {",
    "  const buttonText = await buttonOrLink.textContent().catch(() => '(unknown)');",
    "  throw new Error('Cannot click primary action \"' + actionName + '\": button is not enabled. Text: \"' + buttonText + '\". This usually means required selections or form fields have not been completed.');",
    "}",
    "await buttonOrLink.click({ timeout: 10000 });",
    "await this.page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});",
    "await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});",
    "await this.page.waitForTimeout(1000);"
  ].join("\n"),
  expect_loaded: "await expect(this.page.locator('body')).toBeVisible();",
  fill_form_field: "await this.page.getByLabel(fieldName).or(this.page.getByPlaceholder(fieldName)).fill(value);",
  submit_form: "await this.page.getByRole('button', { name: /submit|enviar|confirmar/i }).click();",
  confirm_action: "await this.page.getByRole('button', { name: /confirm|confirmar|accept|aceptar/i }).click();"
};

const INTENT_DEFAULT_PARAMS: Record<string, string[]> = {
  start_session: [],
  open_home: [],
  open_login_modal: [],
  expect_login_form: [],
  fill_username: ["value"],
  fill_password: ["value"],
  submit_login: [],
  expect_logged_in: [],
  open_product_information: [],
  select_category: ["categoryName"],
  select_product: ["productName"],
  select_first_visible_item: [],
  select_first_visible_product: [],
  select_first_visible_card: [],
  select_first_visible_row: [],
  click_primary_action: ["actionName"],
  expect_loaded: [],
  fill_form_field: ["fieldName", "value"],
  submit_form: [],
  confirm_action: [],
  expect_product_detail: ["productName"]
};

function getMethodParameters(method: PageObjectMethod): string[] {
  if (method.parameters.length > 0) return method.parameters;
  return INTENT_DEFAULT_PARAMS[method.intent] ?? [];
}

export function sanitizeClassName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, "");
  if (!cleaned) return "GenericPage";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function sanitizeMethodName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9]/g, "");
  if (!cleaned) return "executeAction";
  return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
}

function buildMethodSignature(method: PageObjectMethod): string {
  const sanitized = sanitizeMethodName(method.name);
  const params = getMethodParameters(method);
  if (params.length > 0) {
    const paramStr = params.map((p) => `${p}: string`).join(", ");
    return `async ${sanitized}(${paramStr}): Promise<void>`;
  }
  return `async ${sanitized}(): Promise<void>`;
}

function buildLocatorStub(method: PageObjectMethod): string {
  const template = INTENT_LOCATOR_TEMPLATES[method.intent];
  if (template) {
    return `    ${template}`;
  }

  const sanitized = sanitizeMethodName(method.name);
  const params = getMethodParameters(method);
  const lines: string[] = [];
  lines.push(`    // TODO: Implement ${sanitized} with appropriate locators`);
  lines.push(`    // intent: ${method.intent}`);
  lines.push(`    // parameters: ${params.join(", ") || "none"}`);
  lines.push(`    throw new Error('Not implemented: ${sanitized}');`);
  return lines.join("\n");
}

function buildMethodStub(method: PageObjectMethod): string {
  const signature = buildMethodSignature(method);
  let body = buildLocatorStub(method);
  if (sanitizeMethodName(method.name) === "loginWithCredentials") {
    body = [
      "    await this.expectLoginFormVisible();",
      "    await this.fillUsername(username);",
      "    await this.fillPassword(password);",
      "    await this.submitLogin();"
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push(`  ${signature} {`);
  lines.push(body);
  lines.push(`  }`);
  return lines.join("\n");
}

export function buildPageObjectClassSource(candidate: PageObjectEntry): { source: string; warnings: string[] } {
  const className = sanitizeClassName(candidate.className);
  const warnings: string[] = [];

  const filteredMethods = candidate.methods.filter((m) => {
    if (m.status === "active" && m.available) return false;

    const warning = getOwnershipWarning(className, m.name, m.intent);
    if (warning) {
      warnings.push(warning);
      return false;
    }
    return true;
  });

  const needsPromotedSpecHelpers = filteredMethods.some((m) =>
    ["open_product_information", "select_category", "select_operation", "start_session"].includes(m.intent) ||
    ["select_product"].includes(m.intent)
  );

  const lines: string[] = [];
  lines.push("import { Page, expect } from '@playwright/test';");
  if (needsPromotedSpecHelpers) {
    lines.push("import { waitForPromotedSpecStepReady, waitForListReadiness } from '../../../browser/promoted-spec-helpers';");
  }
  lines.push("");
  lines.push(`// Page Object candidate: ${className}`);
  lines.push(`// Generated by page-object-codegen`);
  lines.push(`// Screen signature: ${candidate.screenSignature}`);
  lines.push(`// Status: ${candidate.status}`);
  lines.push(`// Confidence: ${candidate.confidence}`);
  lines.push("//");
  lines.push("// REVIEW REQUIRED: This is a candidate Page Object.");
  lines.push("// - Verify locators are correct for your application.");
  lines.push("// - Rename methods if needed.");
  lines.push("// - Do not activate until reviewed.");
  lines.push("//");
  lines.push(`// Source plans: ${candidate.sourcePlanIds.join(", ")}`);
  lines.push("");
  lines.push(`export class ${className} {`);
  lines.push("  constructor(private readonly page: Page) {}");
  lines.push("");

  const classSpecific = CLASS_SPECIFIC_METHODS[className];
  const methodsToGenerate = filteredMethods.length > 0
    ? filteredMethods
    : (classSpecific?.map((m) => ({
        name: m.name,
        intent: m.intent,
        parameters: m.parameters,
        available: false,
        source: "codegen-default",
        sensitive: false,
        confidence: 0.5,
        status: "candidate" as const
      })) ?? []);

  if (methodsToGenerate.length > 0) {
    const methodSources = methodsToGenerate.map((m) => buildMethodStub(m));
    lines.push(methodSources.join("\n\n"));
  } else {
    lines.push("  // No methods defined yet. Add methods based on plan analysis.");
  }

  lines.push("}");
  lines.push("");

  return { source: lines.join("\n"), warnings };
}

function deriveCandidateFileName(className: string): string {
  const sanitized = sanitizeClassName(className);
  const baseName = sanitized.replace(/Page$/, "").toLowerCase().replace(/-/g, "");
  return `${baseName}.page.candidate.ts`;
}

export async function generatePageObjectCandidateFiles(
  options: PageObjectCodegenOptions
): Promise<PageObjectCodegenResult> {
  const appProfile: AppProfile = {
    appSlug: options.appSlug,
    source: "default",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const registry = await loadPageObjectRegistry(appProfile, options.outputRoot);
  const appPaths = buildAppAutomationPaths(appProfile, undefined, options.outputRoot);
  const pagesDir = appPaths.pagesDir;

  await fs.mkdir(pagesDir, { recursive: true });

  const result: PageObjectCodegenResult = {
    generated: 0,
    skipped: 0,
    errors: [],
    warnings: [],
    files: []
  };

  const candidates = registry.pageObjects.filter((po) => po.status === "candidate");
  const filtered = options.onlyClassName
    ? candidates.filter((po) => po.className === options.onlyClassName || sanitizeClassName(po.className) === options.onlyClassName)
    : candidates;

  const existingClassNames = new Set(candidates.map((po) => sanitizeClassName(po.className)));

  for (const candidate of filtered) {
    const fileName = deriveCandidateFileName(candidate.className);
    const candidateFilePath = path.join(pagesDir, fileName);

    try {
      if (!options.overwriteCandidates) {
        try {
          await fs.access(candidateFilePath);
          result.skipped += 1;
          result.files.push({ className: candidate.className, filePath: candidateFilePath, status: "skipped" });
          continue;
        } catch {
          // File does not exist, proceed
        }
      }

      const activeFilePath = candidate.filePath.replace(/\.candidate\.ts$/, ".ts");
      if (activeFilePath !== candidate.filePath) {
        try {
          await fs.access(activeFilePath);
          result.skipped += 1;
          result.files.push({ className: candidate.className, filePath: activeFilePath, status: "skipped" });
          result.errors.push(`Active Page Object exists for ${candidate.className}: ${activeFilePath}. Skipping.`);
          continue;
        } catch {
          // No active file, proceed
        }
      }

      if (options.dryRun) {
        result.skipped += 1;
        result.files.push({ className: candidate.className, filePath: candidateFilePath, status: "skipped" });
        continue;
      }

      const misplacedMethods = candidate.methods.filter((m) => {
        if (m.status === "active" && m.available) return false;
        return getOwnershipWarning(candidate.className, m.name, m.intent) !== null;
      });

      for (const m of misplacedMethods) {
        const preferredOwner = getPreferredOwnerForIntent(m.intent);
        if (!existingClassNames.has(preferredOwner)) {
          result.warnings.push(
            `Method '${m.name}' (intent: ${m.intent}) filtered from ${candidate.className} and no owner candidate '${preferredOwner}' exists. ` +
            `Method will be lost unless ${preferredOwner} is created.`
          );
        }
      }

      const { source, warnings: methodWarnings } = buildPageObjectClassSource(candidate);
      result.warnings.push(...methodWarnings);
      await fs.writeFile(candidateFilePath, source, "utf-8");

      candidate.filePath = candidateFilePath.replace(/\\/g, "/");

      const now = new Date().toISOString();
      (candidate as any).codegenMetadata = {
        generatedAt: now,
        generatedBy: "page-object-codegen",
        candidateFilePath: candidateFilePath.replace(/\\/g, "/")
      };

      result.generated += 1;
      result.files.push({ className: candidate.className, filePath: candidateFilePath, status: "generated" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`Failed to generate ${candidate.className}: ${message}`);
      result.files.push({ className: candidate.className, filePath: candidateFilePath, status: "error" });
    }
  }

  if (!options.dryRun && (result.generated > 0 || result.errors.length > 0)) {
    await savePageObjectRegistry(registry, appProfile, options.outputRoot);
  }

  return result;
}
