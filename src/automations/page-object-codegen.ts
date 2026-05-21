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
  start_session: "await this.page.goto('/'); await this.page.getByRole('button', { name: /iniciar sesión|iniciar|start|comenzar/i }).click();",
  open_home: "await this.page.goto('/');",
  open_product_information: "await this.page.getByRole('button', { name: /información de productos|product information/i }).click();",
  select_category: "await this.page.getByRole('button', { name: categoryName }).or(this.page.getByRole('link', { name: categoryName })).click();",
  select_product: `const normalize = (s: string) => s.normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();
    const keywords = normalize(productName).split(/\\s+/).filter(k => k.length > 2);
    const headings = this.page.locator('h1, h2, h3, h4, h5, h6');
    const count = await headings.count();
    for (let i = 0; i < count; i++) {
      const heading = headings.nth(i);
      const text = await heading.textContent();
      if (text) {
        const normalizedText = normalize(text);
        const matchCount = keywords.filter(k => normalizedText.includes(k)).length;
        if (matchCount >= Math.min(keywords.length - 1, 2)) {
          const card = heading.locator('xpath=ancestor::button|ancestor::a|ancestor::*[contains(@class, "card")][1]');
          await card.click();
          return;
        }
      }
    }
    await this.page.getByText(new RegExp(productName.split(/\\s+/).join('|'), 'i')).first().click();`,
  click_primary_action: "await this.page.getByRole('button', { name: actionName }).click();",
  expect_loaded: "await expect(this.page.locator('body')).toBeVisible();",
  fill_form_field: "await this.page.getByLabel(fieldName).or(this.page.getByPlaceholder(fieldName)).fill(value);",
  submit_form: "await this.page.getByRole('button', { name: /submit|enviar|confirmar/i }).click();",
  confirm_action: "await this.page.getByRole('button', { name: /confirm|confirmar|accept|aceptar/i }).click();"
};

const INTENT_DEFAULT_PARAMS: Record<string, string[]> = {
  start_session: [],
  open_home: [],
  open_product_information: [],
  select_category: ["categoryName"],
  select_product: ["productName"],
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
  const body = buildLocatorStub(method);

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

  const lines: string[] = [];
  lines.push("import { Page, expect } from '@playwright/test';");
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
