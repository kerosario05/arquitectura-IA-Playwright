import fs from "node:fs/promises";
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

  // Step 3: Regenerate spec with updated registry
  console.log(`[auto-pom] Regenerating POM spec...`);
  const registry = await loadPageObjectRegistry(input.appProfile, input.outputRoot);
  const specResult = await generateSpecFromPlanWithPolicy({
    plan: input.plan,
    automationId: input.automationId,
    appProfile: input.appProfile,
    appPaths: input.appPaths,
    promotionPolicy: policy,
    inlineDebugMode: input.inlineDebugMode,
    pageObjectRegistry: registry
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
      errors.push(`Import '${className}' points to candidate file: ${importPath}`);
    }

    if (!importPath.endsWith(".page") && !importPath.endsWith(".page.ts")) {
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
