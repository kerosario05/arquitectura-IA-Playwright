import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import type { ExecutionPlan } from "../types/execution-plan.types";
import type { AppProfile, AppAutomationPaths } from "./app-profile";
import type { PromotionPolicy, POMPromotionStatus } from "../types/automation-promotion.types";
import type { PageObjectRegistry } from "../types/page-object.types";
import { generatePageObjectCandidateFiles } from "./page-object-codegen";
import { autoApproveSafePageObjects, isMethodAutoApprovable, isPageObjectAutoApprovable } from "./page-object-approval";
import { loadPageObjectRegistry, savePageObjectRegistry } from "./page-object-registry";
import { generateSpecFromPlanWithPolicy } from "./spec-generator";
import { evaluatePromotionGate } from "./promotion-gate";

export type AutoPomInput = {
  plan: ExecutionPlan;
  automationId: string;
  appProfile: AppProfile;
  appPaths: AppAutomationPaths;
  sectionSlug?: string;
  scenarioId?: string;
  outputRoot: string | undefined;
  promotionPolicy: PromotionPolicy;
  inlineDebugMode: boolean;
  initialPomStatus: POMPromotionStatus | undefined;
  initialMissingMethods: string[];
};

export type AutoPomDiagnostics = {
  enabled: boolean;
  initialPomStatus: string;
  generatedCandidateFiles: string[];
  autoApprovedPageObjects: string[];
  autoApprovedMethods: string[];
  blockedAutoApprovals: string[];
  approvalThreshold: number;
  regeneratedSpec: boolean;
  validationStatus: "passed" | "failed" | "skipped";
  finalPomStatus: "promoted" | "blocked_missing_pom" | "needs_page_method" | "needs_manual_review";
};

export type AutoPomResult = {
  success: boolean;
  pomStatus: POMPromotionStatus | undefined;
  specContent: string;
  diagnostics: AutoPomDiagnostics;
};

export function resolveEffectiveAutoPomStatus(
  finalPomStatus: AutoPomDiagnostics["finalPomStatus"],
): POMPromotionStatus {
  return finalPomStatus;
}

function buildAutoPomMethodStub(methodName: string, intent: string): string | undefined {
  if (intent === "select_first_visible_card" || methodName === "selectFirstVisibleCard") {
    return [
      "  async selectFirstVisibleCard(): Promise<void> {",
      "    await waitForListReadiness(this.page, { timeoutMs: 10000, pollMs: 500, minCards: 1 });",
      "    const card = this.page.locator('[class*=\"card\"]:visible, article:visible').first();",
      "    if (await card.count() === 0) throw new Error('No visible card found to select.');",
      "    await card.click({ timeout: 10000 });",
      "  }"
    ].join("\n");
  }
  if (intent === "select_first_visible_product" || methodName === "selectFirstVisibleProduct") {
    return [
      "  async selectFirstVisibleProduct(): Promise<void> {",
      "    await waitForListReadiness(this.page, { timeoutMs: 10000, pollMs: 500, minCards: 1 });",
      "    const productCard = this.page.locator('article:visible, [class*=\"product\"]:visible, [class*=\"card\"]:visible').first();",
      "    if (await productCard.count() === 0) throw new Error('No visible product card found to select.');",
      "    await productCard.click({ timeout: 10000 });",
      "  }"
    ].join("\n");
  }
  if (intent === "select_first_visible_item" || methodName === "selectFirstVisibleItem") {
    return [
      "  async selectFirstVisibleItem(): Promise<void> {",
      "    await waitForListReadiness(this.page, { timeoutMs: 10000, pollMs: 500, minCards: 1 });",
      "    const item = this.page.locator('article:visible, [class*=\"item\"]:visible, [role=\"listitem\"]:visible').first();",
      "    if (await item.count() === 0) throw new Error('No visible item found to select.');",
      "    await item.click({ timeout: 10000 });",
      "  }"
    ].join("\n");
  }
  if (intent === "select_first_visible_row" || methodName === "selectFirstVisibleRow") {
    return [
      "  async selectFirstVisibleRow(): Promise<void> {",
      "    await waitForListReadiness(this.page, { timeoutMs: 10000, pollMs: 500, minCards: 1 });",
      "    const row = this.page.locator('tr:visible, [role=\"row\"]:visible').first();",
      "    if (await row.count() === 0) throw new Error('No visible row found to select.');",
      "    await row.click({ timeout: 10000 });",
      "  }"
    ].join("\n");
  }
  if (intent === "select_visible_item_by_ordinal" || methodName === "selectVisibleItemByOrdinal") {
    return [
      "  async selectVisibleItemByOrdinal(ordinal: 'first' | 'second' | 'third', domainTerm?: string): Promise<void> {",
      "    await waitForListReadiness(this.page, { timeoutMs: 10000, pollMs: 500, minCards: 1 });",
      "    const ordinalNum = ordinal === 'first' ? 0 : ordinal === 'second' ? 1 : ordinal === 'third' ? 2 : -1;",
      "    if (ordinalNum < 0) throw new Error('Unsupported ordinal: ' + ordinal);",
      "    let items = this.page.locator('article:visible, [role=\"listitem\"]:visible, [class*=\"product\"]:visible, [class*=\"card\"]:visible, [class*=\"item\"]:visible').filter({ hasNotText: /selecciona un producto|seleccione un producto|elige un producto|choose a product|select a product/i });",
      "    if (domainTerm) {",
      "      const escaped = domainTerm.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&');",
      "      items = items.filter({ hasText: new RegExp(escaped, 'i') });",
      "    }",
      "    const count = await items.count();",
      "    if (count === 0) throw new Error('No visible items found for ordinal selection.');",
      "    if (ordinalNum >= count) throw new Error(`Ordinal ${ordinal} (${ordinalNum + 1}) exceeds available items (${count}).`);",
      "    const item = items.nth(ordinalNum);",
      "    const actionable = item.locator('a:visible, button:visible, [role=\"button\"]:visible').first();",
      "    if (await actionable.count() > 0) { await actionable.click({ timeout: 10000 }); return; }",
      "    await item.click({ timeout: 10000 });",
      "  }"
    ].join("\n");
  }
  if (intent === "expect_primary_action_visible" || methodName === "expectPrimaryActionVisible") {
    return [
      "  async expectPrimaryActionVisible(actionName: string): Promise<void> {",
      "    const actionKeywords = new RegExp(actionName, 'i');",
      "    const button = this.page.getByRole('button', { name: actionKeywords }).first();",
      "    const link = this.page.getByRole('link', { name: actionKeywords }).first();",
      "    const locator = button.or(link);",
      "    await locator.waitFor({ state: 'visible', timeout: 10000 });",
      "    await expect(locator).toBeVisible();",
      "  }"
    ].join("\n");
  }
  if (intent === "expect_primary_action_enabled" || methodName === "expectPrimaryActionEnabled") {
    return [
      "  async expectPrimaryActionEnabled(actionName: string): Promise<void> {",
      "    const actionKeywords = new RegExp(actionName, 'i');",
      "    const button = this.page.getByRole('button', { name: actionKeywords }).first();",
      "    const link = this.page.getByRole('link', { name: actionKeywords }).first();",
      "    const locator = button.or(link);",
      "    await locator.waitFor({ state: 'visible', timeout: 10000 });",
      "    await expect(locator).toBeEnabled();",
      "  }"
    ].join("\n");
  }
  if (intent === "expect_primary_action_disabled" || methodName === "expectPrimaryActionDisabled") {
    return [
      "  async expectPrimaryActionDisabled(actionName: string): Promise<void> {",
      "    const actionKeywords = new RegExp(actionName, 'i');",
      "    const button = this.page.getByRole('button', { name: actionKeywords }).first();",
      "    const link = this.page.getByRole('link', { name: actionKeywords }).first();",
      "    const locator = button.or(link);",
      "    await locator.waitFor({ state: 'visible', timeout: 10000 });",
      "    await expect(locator).toBeDisabled();",
      "  }"
    ].join("\n");
  }
  return undefined;
}

/**
 * FIRST_LOSS fix (jobId cb26fb19-d676-4d19-b19d-70613cd9a009): a method was flagged
 * `status="active" available=true` by POLICY (confidence/sensitivity/intent) BEFORE any physical
 * verification that it exists in the real, active Page Object source. When the candidate file
 * was absent and stub injection had no known template for the method's intent
 * (`buildAutoPomMethodStub` returns undefined for anything outside its small allowlist), the
 * registry activation was kept anyway. The result: a structurally valid-looking, "active"/
 * "available" registry entry (ProductListPage.executeAction, intent=unknown) whose method never
 * existed at runtime, silently accepted as executable authority by spec generation.
 *
 * Fixed generically, for any app/POM/method/intent: policy approval only PROPOSES activation; a
 * method is only actually marked active/available AFTER re-reading the resulting file and
 * confirming its name is really present as a real function/method definition. A proposal that
 * fails verification is left at its pre-existing state (never invented as a new status) and
 * reported as blocked, exactly like a policy-level rejection.
 */
const methodNamePattern = (name: string) => new RegExp(`\\b(?:async\\s+)?${name}\\s*\\(`);

/**
 * Core reconciliation step, extracted so it can run standalone -- independent of whether new
 * method proposal/approval (Auto-POM) is needed at all. Re-verifies every method already marked
 * `status="active" available=true` against the real, active Page Object source file and demotes
 * (`available=false`) any that do not verify. `status` is left as-is (mirrors the original
 * FIRST_LOSS fix, jobId cb26fb19-d676-4d19-b19d-70613cd9a009): every consumer that selects
 * implementation authority (findMethodBySemanticIntent and friends) already filters on
 * `available`, so demoting it here is sufficient. Never proposes, generates, or approves new
 * methods -- callers that also need that must still go through autoApproveMethodsInActivePageObjects
 * or runAutoPomPipeline.
 */
export async function reconcileActivePageObjectMethods(
  registry: PageObjectRegistry,
  pagesDir: string,
): Promise<{ reconciledMethods: string[] }> {
  const reconciledMethods: string[] = [];
  for (const po of registry.pageObjects) {
    if (po.status !== "active") continue;
    const existingActiveMethods = po.methods.filter((m) => m.status === "active" && m.available);
    if (existingActiveMethods.length === 0) continue;
    const baseName = po.className.replace(/Page$/, "").toLowerCase().replace(/-/g, "");
    const activePath = path.join(pagesDir, `${baseName}.page.ts`);
    const currentSource = await fs.readFile(activePath, "utf-8").catch(() => undefined);
    for (const m of existingActiveMethods) {
      if (currentSource !== undefined && methodNamePattern(m.name).test(currentSource)) continue;
      m.available = false;
      reconciledMethods.push(`${po.className}.${m.name}()`);
    }
  }
  return { reconciledMethods };
}

export async function autoApproveMethodsInActivePageObjects(
  registry: PageObjectRegistry,
  pagesDir: string,
  options: { confidenceThreshold: number; blockSensitive: boolean },
): Promise<{ approvedMethodCount: number; autoApprovedMethods: string[]; blockedAutoApprovals: string[]; reconciledMethods: string[] }> {
  const autoApprovedMethods: string[] = [];
  const blockedAutoApprovals: string[] = [];
  let approvedMethodCount = 0;

  // FIRST_LOSS fix (jobId cb26fb19-d676-4d19-b19d-70613cd9a009, reconciliation pass): the
  // proposal-verification loop below only ever ran for methods NOT already
  // `status="active" available=true` -- an entry corrupted before this fix existed (or by any
  // future gap) skipped verification forever, remaining executable authority to every consumer.
  // Reused here as the shared core (see reconcileActivePageObjectMethods) so this flow and any
  // other caller apply the exact same verification, never a second parser/duplicate check.
  const { reconciledMethods } = await reconcileActivePageObjectMethods(registry, pagesDir);
  blockedAutoApprovals.push(
    ...reconciledMethods.map((label) => `${label}: method_not_present_in_source_reconciliation`)
  );

  for (const po of registry.pageObjects) {
    if (po.status !== "active") continue;

    const proposedMethods: typeof po.methods = [];
    for (const method of po.methods) {
      if (method.status === "active" && method.available) continue;
      const check = isMethodAutoApprovable(method, options);
      if (!check.approvable) {
        blockedAutoApprovals.push(`${po.className}.${method.name}(): ${check.reason}`);
        continue;
      }
      proposedMethods.push(method);
    }
    if (proposedMethods.length === 0) continue;

    const baseName = po.className.replace(/Page$/, "").toLowerCase().replace(/-/g, "");
    const candidatePath = path.join(pagesDir, `${baseName}.page.candidate.ts`);
    const activePath = path.join(pagesDir, `${baseName}.page.ts`);
    try {
      await fs.access(candidatePath);
      await fs.copyFile(candidatePath, activePath);
      po.filePath = activePath.replace(/\\/g, "/");
    } catch {
      // Candidate file may not exist. Inject known safe stubs into active file when missing.
      try {
        let source = await fs.readFile(activePath, "utf-8");
        let changed = false;
        for (const method of proposedMethods) {
          if (methodNamePattern(method.name).test(source)) continue;
          const stub = buildAutoPomMethodStub(method.name, method.intent);
          if (!stub) continue;
          const insertAt = source.lastIndexOf("}");
          if (insertAt <= 0) continue;
          source = `${source.slice(0, insertAt).trimEnd()}\n\n${stub}\n${source.slice(insertAt)}`;
          changed = true;
        }
        if (changed) {
          await fs.writeFile(activePath, source, "utf-8");
          po.filePath = activePath.replace(/\\/g, "/");
        }
      } catch {
        // File sync failed entirely -- fall through to per-method verification below, which
        // will correctly find none of the proposed methods present and block all of them.
      }
    }

    const finalSource = await fs.readFile(activePath, "utf-8").catch(() => "");
    for (const method of proposedMethods) {
      if (!methodNamePattern(method.name).test(finalSource)) {
        blockedAutoApprovals.push(`${po.className}.${method.name}(): method_not_present_in_source_after_sync`);
        continue;
      }
      method.status = "active";
      method.available = true;
      autoApprovedMethods.push(`${po.className}.${method.name}()`);
      approvedMethodCount += 1;
    }
  }

  return { approvedMethodCount, autoApprovedMethods, blockedAutoApprovals, reconciledMethods };
}

export function shouldRunAutoPom(
  pomStatus: POMPromotionStatus | undefined,
  policy: PromotionPolicy
): boolean {
  if (!policy.autoPom) return false;
  if (pomStatus === "promoted" || pomStatus === "inline_debug_only") return false;
  const autoPomTriggerStatuses: POMPromotionStatus[] = [
    "needs_page_object",
    "needs_page_method",
    "blocked_missing_pom",
    "page_object_candidate_created"
  ];
  return autoPomTriggerStatuses.includes(pomStatus as POMPromotionStatus);
}

export async function runAutoPomPipeline(input: AutoPomInput): Promise<AutoPomResult> {
  const policy = input.promotionPolicy;
  const diagnostics: AutoPomDiagnostics = {
    enabled: true,
    initialPomStatus: input.initialPomStatus ?? "unknown",
    generatedCandidateFiles: [],
    autoApprovedPageObjects: [],
    autoApprovedMethods: [],
    blockedAutoApprovals: [],
    approvalThreshold: policy.autoApproveConfidenceThreshold ?? 0.50,
    regeneratedSpec: false,
    validationStatus: "skipped",
    finalPomStatus: input.initialPomStatus as AutoPomDiagnostics["finalPomStatus"] ?? "needs_manual_review"
  };

  console.log(`[auto-pom] Using appSlug=${input.appProfile.appSlug}`);
  console.log(`[auto-pom] Enabled: true`);
  console.log(`[auto-pom] Auto-generate candidates: ${policy.autoGeneratePageObjectCandidates !== false}`);
  console.log(`[auto-pom] Auto-approve safe Page Objects: ${policy.autoApproveSafePageObjects !== false}`);
  console.log(`[auto-pom] Threshold: ${diagnostics.approvalThreshold}`);
  console.log(`[auto-pom] Running because promotion status is ${input.initialPomStatus}.`);

  // Step 1: Generate candidate files if needed
  if (policy.autoGeneratePageObjectCandidates !== false) {
    console.log(`[auto-pom] Generating candidate files...`);
    const codegenResult = await generatePageObjectCandidateFiles({
      appSlug: input.appProfile.appSlug,
      outputRoot: input.outputRoot,
      dryRun: false,
      overwriteCandidates: true
    });

    for (const file of codegenResult.files) {
      if (file.status === "generated") {
        diagnostics.generatedCandidateFiles.push(file.filePath);
        console.log(`[auto-pom] Generated candidate file: ${file.filePath}`);
      }
    }

    for (const err of codegenResult.errors) {
      console.log(`[auto-pom] Codegen error: ${err}`);
    }
  }

  // Step 2: Auto-approve safe candidates
  if (policy.autoApproveSafePageObjects !== false) {
    console.log(`[auto-pom] Auto-approving safe candidates...`);
    const approvalResult = await autoApproveSafePageObjects(input.appProfile.appSlug, input.outputRoot, {
      approveAll: true,
      overwriteActive: true,
      dryRun: false,
      confidenceThreshold: policy.autoApproveConfidenceThreshold ?? 0.50,
      blockSensitive: policy.blockSensitiveAutoApproval !== false
    });

    for (const file of approvalResult.files) {
      if (file.status === "approved") {
        diagnostics.autoApprovedPageObjects.push(file.className);
        console.log(`[auto-pom] Approved ${file.className}`);
      }
    }

    diagnostics.autoApprovedMethods.push(...approvalResult.autoApprovedMethods);
    for (const method of approvalResult.autoApprovedMethods) {
      console.log(`[auto-pom] Approved ${method}`);
    }

    diagnostics.blockedAutoApprovals.push(...approvalResult.blockedAutoApprovals);
    for (const blocked of approvalResult.blockedAutoApprovals) {
      console.log(`[auto-pom] Blocked ${blocked}`);
    }

    for (const err of approvalResult.errors) {
      console.log(`[auto-pom] Approval error: ${err}`);
    }
  }

  // Step 2.5: Auto-approve safe candidate methods inside already-active Page Objects.
  {
    const registry = await loadPageObjectRegistry(input.appProfile, input.outputRoot);
    const { approvedMethodCount, autoApprovedMethods, blockedAutoApprovals, reconciledMethods } = await autoApproveMethodsInActivePageObjects(
      registry,
      input.appPaths.pagesDir,
      {
        confidenceThreshold: policy.autoApproveConfidenceThreshold ?? 0.50,
        blockSensitive: policy.blockSensitiveAutoApproval !== false,
      },
    );
    diagnostics.autoApprovedMethods.push(...autoApprovedMethods);
    diagnostics.blockedAutoApprovals.push(...blockedAutoApprovals);

    if (reconciledMethods.length > 0) {
      console.log(`[auto-pom] Reconciled ${reconciledMethods.length} preexisting active/available method(s) not present in source: ${reconciledMethods.join(", ")}`);
    }
    if (approvedMethodCount > 0 || reconciledMethods.length > 0) {
      await savePageObjectRegistry(registry, input.appProfile, input.outputRoot);
      if (approvedMethodCount > 0) {
        console.log(`[auto-pom] Auto-approved ${approvedMethodCount} safe method(s) in active Page Objects.`);
      }
    }
  }

  // Step 3: Regenerate spec with updated registry
  console.log(`[auto-pom] Regenerating POM spec...`);
  const registry = await loadPageObjectRegistry(input.appProfile, input.outputRoot);

  const authFlowMetadata = input.plan.metadata?.authFlowRequired
    ? {
        alias: input.plan.metadata.authFlowAlias || "defaultClient",
        landing: input.plan.metadata.authFlowLanding || "transactions_menu",
        insertionAfterStepIndex: input.plan.metadata.authFlowInsertionAfterStepIndex
      }
    : undefined;
  const hasAuthConsumedSteps = !authFlowMetadata && input.plan.steps.some(s => {
    const desc = (s.description ?? "").toLowerCase();
    return desc.startsWith("authflow handled") || desc.includes("step consumed by authflow");
  });
  const authFlowOptions = authFlowMetadata ?? (hasAuthConsumedSteps ? {
    alias: "defaultClient",
    landing: "transactions_menu"
  } : undefined);

  const specResult = await generateSpecFromPlanWithPolicy({
    plan: input.plan,
    automationId: input.automationId,
    appProfile: input.appProfile,
    appPaths: input.appPaths,
    sectionSlug: input.sectionSlug,
    scenarioId: input.scenarioId,
    promotionPolicy: policy,
    inlineDebugMode: input.inlineDebugMode,
    pageObjectRegistry: registry,
    authFlowOptions
  });

  diagnostics.regeneratedSpec = true;

  // Step 4: Validate spec
  if (policy.autoRunPomValidation !== false) {
    console.log(`[auto-pom] Validating POM spec...`);
    const validation = validatePomSpec(specResult.specContent, registry, input.appPaths);
    diagnostics.validationStatus = validation.valid ? "passed" : "failed";

    if (!validation.valid) {
      console.log(`[auto-pom] POM validation failed: ${validation.errors.join("; ")}`);
      diagnostics.finalPomStatus = "needs_manual_review";
      return {
        success: false,
        pomStatus: resolveEffectiveAutoPomStatus(diagnostics.finalPomStatus),
        specContent: specResult.specContent,
        diagnostics
      };
    }
    console.log(`[auto-pom] POM validation passed.`);
  }

  // Step 5: Determine final status
  if (specResult.pomStatus === "promoted") {
    diagnostics.finalPomStatus = "promoted";
    console.log(`[auto-pom] Final POM status: promoted`);
  } else if (specResult.missingMethods.length > 0) {
    const hasBlockedSensitive = diagnostics.blockedAutoApprovals.length > 0;
    if (hasBlockedSensitive) {
      diagnostics.finalPomStatus = "needs_manual_review";
      console.log(`[auto-pom] Final POM status: needs_manual_review (sensitive methods blocked)`);
    } else {
      diagnostics.finalPomStatus = "needs_page_method";
      console.log(`[auto-pom] Final POM status: needs_page_method`);
    }
  } else {
    diagnostics.finalPomStatus = "promoted";
    console.log(`[auto-pom] Final POM status: promoted`);
  }

  return {
    success: diagnostics.finalPomStatus === "promoted",
    pomStatus: resolveEffectiveAutoPomStatus(diagnostics.finalPomStatus),
    specContent: specResult.specContent,
    diagnostics
  };
}

type PomSpecValidation = {
  valid: boolean;
  errors: string[];
};

export function validatePomSpec(
  specContent: string,
  registry: PageObjectRegistry | undefined,
  appPaths: AppAutomationPaths
): PomSpecValidation {
  const errors: string[] = [];

  const importRegex = /import\s*\{\s*(\w+)\s*\}\s*from\s*['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  const importedClasses: string[] = [];

  while ((match = importRegex.exec(specContent)) !== null) {
    const className = match[1];
    const importPath = match[2];
    
    if (importPath.startsWith('@') || !importPath.startsWith('.')) {
      continue;
    }
    
    importedClasses.push(className);

    if (importPath.includes(".candidate")) {
      const baseName = importPath.replace(/\.candidate(\.ts)?$/, "$1").replace(/\.ts$/, ".ts");
      const pagesDir = path.dirname(appPaths.specPath ?? "").replace(/cases\/[^/]+$/, "pages");
      const activeFileExists = fsSync.existsSync(path.join(pagesDir, baseName.replace(/^\.\.\//, "")));
      const candidateFileExists = fsSync.existsSync(path.join(pagesDir, importPath.replace(/^\.\.\//, "")));

      let registryStatus = "unknown";
      if (registry) {
        const po = registry.pageObjects.find((p) => p.className === className);
        if (po) {
          registryStatus = po.status;
        }
      }

      errors.push(
        `Invalid candidate import: className=${className} importPath=${importPath} ` +
        `activeFileExists=${activeFileExists} candidateFileExists=${candidateFileExists} ` +
        `registryStatus=${registryStatus} suggestedRepair=use ${baseName}`
      );
    }

    const isSupportImport =
      importPath.includes("/src/config/") ||
      importPath.includes("/src/data") ||
      importPath.includes("/src/automations/app-profile") ||
      importPath.includes("/src/automations/runtime/");

    if (!isSupportImport && !importPath.endsWith(".page") && !importPath.endsWith(".page.ts") && !importPath.includes(".flow")) {
      errors.push(`Import '${className}' does not point to a .page file: ${importPath}`);
    }
  }

  const methodCallRegex = /await\s+(\w+)\.(\w+)\s*\(/g;
  const calledMethods: Array<{ varName: string; methodName: string }> = [];
  while ((match = methodCallRegex.exec(specContent)) !== null) {
    calledMethods.push({ varName: match[1], methodName: match[2] });
  }

  if (registry) {
    for (const called of calledMethods) {
      const po = registry.pageObjects.find(
        (p) => p.className.charAt(0).toLowerCase() + p.className.slice(1) === called.varName
      );
      if (po) {
        const method = po.methods.find((m) => m.name === called.methodName);
        if (!method) {
          errors.push(`Method '${called.methodName}' not found in ${po.className}`);
        } else if (method.status !== "active" || !method.available) {
          errors.push(`Method '${po.className}.${called.methodName}' is not active/available (status: ${method.status}, available: ${method.available})`);
        }
      }
    }
  }

  const inlineLocatorPatterns = [
    /page\.getByRole\s*\(/,
    /page\.getByText\s*\(/,
    /page\.getByLabel\s*\(/,
    /page\.getByPlaceholder\s*\(/,
    /page\.getByTestId\s*\(/,
    /page\.locator\s*\(/
  ];

  const specLines = specContent.split("\n");
  for (const line of specLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("import")) continue;
    for (const pattern of inlineLocatorPatterns) {
      if (pattern.test(trimmed) && !trimmed.includes("// [inline]")) {
        errors.push(`Inline locator found in spec: ${trimmed.substring(0, 80)}...`);
        break;
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
