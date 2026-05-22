import path from "node:path";
import type { ExecutionPlan, ExecutionPlanStep, PlanTarget } from "../types/execution-plan.types";
import type { AppAutomationPaths, AppProfile } from "./app-profile";
import type { PromotionPolicy, POMPromotionStatus } from "../types/automation-promotion.types";
import type { PageObjectEntry, PageObjectMethod, PageObjectRegistry } from "../types/page-object.types";
import { findReusableMethod, findMethodBySemanticIntent } from "./page-object-registry";
import { deriveMethodIntentFromStep, deriveExpectedOwnerForStep } from "./pom-classification";
import type { SemanticMethodIntent } from "../types/pom-ownership";
import { isLikelyAuthGate, buildAuthFlowSpecImport, buildAuthFlowInstantiation, buildAuthFlowCall } from "../discovery/auth-flow-helpers";

export type POMSpecResult = {
  specContent: string;
  pomStatus: POMPromotionStatus;
  usedPageObjects: string[];
  missingPageObjects: string[];
  missingMethods: string[];
  generatedCandidates: number;
  usedAuthFlow: boolean;
};

function getTarget(t: PlanTarget | "APP_BASE_URL" | undefined): PlanTarget | undefined {
  if (!t || t === "APP_BASE_URL") return undefined;
  return t;
}

function getTargetValue(t: PlanTarget | "APP_BASE_URL" | undefined): string {
  if (!t) return "";
  if (t === "APP_BASE_URL") return "APP_BASE_URL";
  return t.name ?? t.value ?? t.role ?? "";
}

function escapeSpecString(value: string): string {
  return value.replace(/'/g, "''");
}

function buildPageObjectImport(className: string, filePath: string, specPath: string): string {
  const importPath = path.relative(path.dirname(specPath), filePath).replace(/\\/g, "/").replace(/\.ts$/, "");
  return `import { ${className} } from '${importPath}';`;
}

export function generatePOMSpecFromPlan(
  plan: ExecutionPlan,
  automationId: string,
  appProfile: AppProfile,
  appPaths: AppAutomationPaths,
  pageObjectRegistry: PageObjectRegistry | undefined,
  policy: PromotionPolicy,
  inlineDebugMode: boolean,
  authFlowOptions?: { alias?: string; landing?: string; testDataJson?: string }
): POMSpecResult {
  const escapedTitle = escapeSpecString(plan.scenario.title);

  const usedPageObjects: string[] = [];
  const missingPageObjects: string[] = [];
  const missingMethods: string[] = [];
  let generatedCandidates = 0;
  let usedAuthFlow = false;

  const importLines: string[] = [];
  const instantiationLines: string[] = [];
  const actionLines: string[] = [];
  const preambleLines: string[] = [];

  const importedClasses = new Set<string>();
  const instantiatedVars = new Map<string, string>();

  function ensurePageObject(className: string, filePath: string): string {
    const key = className;
    if (!importedClasses.has(key)) {
      importedClasses.add(key);
      importLines.push(buildPageObjectImport(className, filePath, appPaths.specPath ?? ""));
      const varName = className.charAt(0).toLowerCase() + className.slice(1);
      instantiatedVars.set(key, varName);
      instantiationLines.push(`const ${varName} = new ${className}(page);`);
      usedPageObjects.push(className);
    }
    return instantiatedVars.get(key)!;
  }

  function makeDescription(step: ExecutionPlanStep): string {
    const target = getTargetValue(step.target);
    return `${step.action} ${target}`.trim();
  }

  let authGateDetected = false;
  let authGateStepIndex = -1;

  for (const step of plan.steps) {
    const description = makeDescription(step);

    if (step.action === "navigate" || step.action === "login") {
      continue;
    }

    const targetValue = getTargetValue(step.target);
    const stepIsAuthGate = isLikelyAuthGate(targetValue) || isLikelyAuthGate(description);

    if (stepIsAuthGate && authFlowOptions && !authGateDetected) {
      authGateDetected = true;
      authGateStepIndex = plan.steps.indexOf(step);
      usedAuthFlow = true;

      const authImport = buildAuthFlowSpecImport(appProfile.appSlug);
      if (!importLines.includes(authImport)) {
        importLines.push(authImport);
      }

      const authInstantiation = buildAuthFlowInstantiation();
      if (!instantiationLines.includes(authInstantiation)) {
        instantiationLines.push(authInstantiation);
      }

      const authCall = buildAuthFlowCall({
        alias: authFlowOptions.alias || 'defaultClient',
        landing: authFlowOptions.landing || 'transactions_menu'
      });
      preambleLines.push(authCall);
      continue;
    }

    if (authGateDetected && authGateStepIndex >= 0 && plan.steps.indexOf(step) <= authGateStepIndex + 3) {
      const isNavToAuth = targetValue.includes("transacciones") || targetValue.includes("iniciar");
      if (isNavToAuth) {
        continue;
      }
    }

    const semanticIntent = deriveMethodIntentFromStep(step);

    const resolved = pageObjectRegistry
      ? findMethodBySemanticIntent(pageObjectRegistry, semanticIntent, step)
      : undefined;

    if (resolved) {
      const varName = ensurePageObject(resolved.pageObject.className, resolved.pageObject.filePath);
      const method = resolved.method;
      if (method.parameters.length > 0) {
        const targetValue = getTargetValue(step.target);
        const args = method.parameters.map((p) => {
          return `'${escapeSpecString(targetValue || p)}'`;
        }).join(", ");
        actionLines.push(`await ${varName}.${method.name}(${args});`);
      } else {
        actionLines.push(`await ${varName}.${method.name}();`);
      }
      if (method.sensitive) {
        actionLines.push(`// [sensitive] ${description}`);
      }
      continue;
    }

    if (policy.allowCandidateGeneration && pageObjectRegistry) {
      const candidateResult = findCandidateMethod(pageObjectRegistry, semanticIntent, description);
      if (candidateResult) {
        const varName = ensurePageObject(candidateResult.pageObject.className, candidateResult.pageObject.filePath);
        const method = candidateResult.method;
        if (method.parameters.length > 0) {
          const targetValue = getTargetValue(step.target);
          const args = method.parameters.map((p) => {
            return `'${escapeSpecString(targetValue || p)}'`;
          }).join(", ");
          actionLines.push(`await ${varName}.${method.name}(${args}); // candidate method`);
        } else {
          actionLines.push(`await ${varName}.${method.name}(); // candidate method`);
        }
        actionLines.push(`// [candidate] ${description}`);
        generatedCandidates += 1;
        continue;
      }
    }

    if (policy.allowInlineFallback && !policy.requirePageObjects) {
      const locator = buildInlineLocator(step);
      actionLines.push(buildInlineAction(step, locator));
      actionLines.push(`// [inline] ${description}`);
      continue;
    }

    if (resolved === undefined) {
      const expectedOwner = deriveExpectedOwnerForStep(step);
      const ownerPO = pageObjectRegistry?.pageObjects.find((po) => po.className === expectedOwner);
      const availableMethods = ownerPO
        ? ownerPO.methods.filter((m) => m.status === "active" && m.available).map((m) => m.name)
        : [];
      missingMethods.push(
        `step=${plan.steps.indexOf(step)} target="${getTargetValue(step.target)}" ` +
        `derivedIntent="${semanticIntent}" expectedOwner="${expectedOwner}" ` +
        `availableMethods=[${availableMethods.join(", ")}]`
      );
    }
  }

  const lines: string[] = [];

  lines.push("import { test } from '@playwright/test';");

  if (importLines.length > 0) {
    lines.push("");
    lines.push(...importLines);
  }

  lines.push("");
  const testName = inlineDebugMode
    ? `test('[INLINE DEBUG] ${escapedTitle}', async ({ page }) => {`
    : `test('${escapedTitle}', async ({ page }) => {`;
  lines.push(testName);

  if (instantiationLines.length > 0) {
    lines.push("");
    lines.push(...instantiationLines.map((l) => `  ${l}`));
  }

  if (preambleLines.length > 0) {
    lines.push("");
    lines.push(...preambleLines.map((l) => `  ${l}`));
  }

  if (missingMethods.length > 0 && policy.requirePageObjects) {
    lines.push(`  // WARNING: Missing page object methods:`);
    for (const mm of missingMethods) {
      lines.push(`  // - ${mm}`);
    }
    lines.push("");
  }

  lines.push("");
  if (actionLines.length > 0) {
    lines.push(...actionLines.map((l) => `  ${l}`));
  } else {
    lines.push("  // No POM-compatible actions mapped");
  }

  if (missingMethods.length > 0) {
    lines.push("  // Fallthrough: execute remaining plan steps via executor");
  }

  let pomStatus: POMPromotionStatus;
  if (inlineDebugMode) {
    pomStatus = "inline_debug_only";
  } else if (!pageObjectRegistry || pageObjectRegistry.pageObjects.length === 0) {
    pomStatus = "needs_page_object";
  } else if (missingMethods.length > 0 && policy.requirePageObjects) {
    pomStatus = "needs_page_method";
  } else if (generatedCandidates > 0) {
    pomStatus = "page_object_candidate_created";
  } else if (usedPageObjects.length > 0) {
    pomStatus = "promoted";
  } else {
    pomStatus = "needs_page_object";
  }

  lines.push("});");

  return {
    specContent: lines.join("\n"),
    pomStatus,
    usedPageObjects,
    missingPageObjects,
    missingMethods,
    generatedCandidates,
    usedAuthFlow
  };
}

function findCandidateMethod(
  registry: PageObjectRegistry,
  intent: SemanticMethodIntent,
  _description: string
): { pageObject: PageObjectEntry; method: PageObjectMethod } | undefined {
  for (const po of registry.pageObjects) {
    const candidateMethod = po.methods.find(
      (m) => m.intent === intent && m.available === false && m.status === "candidate"
    );
    if (candidateMethod) {
      return { pageObject: po, method: candidateMethod };
    }
  }
  return undefined;
}

function buildInlineLocator(step: ExecutionPlanStep): string {
  const t = getTarget(step.target);
  if (!t) return "page.locator('unknown')";
  const value = escapeSpecString(t.value ?? "");
  const name = escapeSpecString(t.name ?? "");
  if (t.strategy === "role") return `page.getByRole('${value}', { name: '${name}' })`;
  if (t.strategy === "text") return `page.getByText('${value}')`;
  if (t.strategy === "label") return `page.getByLabel('${value}')`;
  if (t.strategy === "placeholder") return `page.getByPlaceholder('${value}')`;
  if (t.strategy === "testId") return `page.getByTestId('${value}')`;
  return `page.locator('${value}')`;
}

function buildInlineAction(step: ExecutionPlanStep, locator: string): string {
  const value = escapeSpecString(step.value ?? "");
  if (step.action === "click") return `await ${locator}.click();`;
  if (step.action === "fill") return `await ${locator}.fill('${value}');`;
  if (step.action === "check") return `await ${locator}.check();`;
  if (step.action === "select") return `await ${locator}.selectOption('${value}');`;
  if (step.action.startsWith("assert")) return `await expect(${locator}).toBeVisible();`;
  return `await ${locator}.click();`;
}
