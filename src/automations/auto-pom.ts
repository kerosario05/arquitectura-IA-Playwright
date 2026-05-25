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
  return undefined;
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
    const threshold = policy.autoApproveConfidenceThreshold ?? 0.50;
    const blockSensitive = policy.blockSensitiveAutoApproval !== false;
    let approvedMethodCount = 0;

    for (const po of registry.pageObjects) {
      if (po.status !== "active") continue;
      let poApprovedMethods = 0;
      for (const method of po.methods) {
        if (method.status === "active" && method.available) continue;
        const check = isMethodAutoApprovable(method, { confidenceThreshold: threshold, blockSensitive });
        if (!check.approvable) {
          diagnostics.blockedAutoApprovals.push(`${po.className}.${method.name}(): ${check.reason}`);
          continue;
        }
        method.status = "active";
        method.available = true;
        diagnostics.autoApprovedMethods.push(`${po.className}.${method.name}()`);
        approvedMethodCount += 1;
        poApprovedMethods += 1;
      }

      if (poApprovedMethods > 0) {
        const baseName = po.className.replace(/Page$/, "").toLowerCase().replace(/-/g, "");
        const candidatePath = path.join(input.appPaths.pagesDir, `${baseName}.page.candidate.ts`);
        const activePath = path.join(input.appPaths.pagesDir, `${baseName}.page.ts`);
        try {
          await fs.access(candidatePath);
          await fs.copyFile(candidatePath, activePath);
          po.filePath = activePath.replace(/\\/g, "/");
        } catch {
          // Candidate file may not exist. Inject known safe stubs into active file when missing.
          try {
            let source = await fs.readFile(activePath, "utf-8");
            let changed = false;
            for (const method of po.methods) {
              if (!(method.status === "active" && method.available)) continue;
              const methodRegex = new RegExp(`\\b${method.name}\\s*\\(`);
              if (methodRegex.test(source)) continue;
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
            // Keep registry activation only if file injection fails.
          }
        }
      }
    }

    if (approvedMethodCount > 0) {
      await savePageObjectRegistry(registry, input.appProfile, input.outputRoot);
      console.log(`[auto-pom] Auto-approved ${approvedMethodCount} safe method(s) in active Page Objects.`);
    }
  }

  // Step 3: Regenerate spec with updated registry
  console.log(`[auto-pom] Regenerating POM spec...`);
  const registry = await loadPageObjectRegistry(input.appProfile, input.outputRoot);

  const hasAuthConsumedSteps = input.plan.steps.some(s => {
    const desc = (s.description ?? "").toLowerCase();
    return desc.startsWith("authflow handled") || desc.includes("step consumed by authflow");
  });
  const authFlowOptions = hasAuthConsumedSteps ? {
    alias: "defaultClient",
    landing: "transactions_menu"
  } : undefined;

  const specResult = await generateSpecFromPlanWithPolicy({
    plan: input.plan,
    automationId: input.automationId,
    appProfile: input.appProfile,
    appPaths: input.appPaths,
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
        pomStatus: "needs_page_method",
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
    pomStatus: specResult.pomStatus,
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
      importPath.includes("/src/automations/app-profile");

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
