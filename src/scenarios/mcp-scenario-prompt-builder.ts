import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { JiraIssueSource, McpRouteProfile } from "./scenario-types";
import {
  buildAppProfilePromptContext,
  formatAppProfileContext,
  buildEntryPathBlockFromContext,
  logAppProfileContext,
  sanitizeForPrompt,
  type AppProfilePromptContext,
} from "./scenario-prompt-context";

const SKILL_DIR = path.join(process.cwd(), "src", "agent", "skills", "mcp-testrail-case-generator-v2");

async function loadSkillMarkdown(): Promise<string | null> {
  const skillPath = path.join(SKILL_DIR, "SKILL.md");
  try {
    const content = await fs.readFile(skillPath, "utf-8");
    console.log(`[scenarios:prompt] full skill loaded path=${skillPath} chars=${content.length}`);
    return content;
  } catch {
    console.error(`[scenarios:prompt] skill not found at ${skillPath}`);
    return null;
  }
}

function formatIssues(issues: JiraIssueSource[]): string {
  if (issues.length === 0) return "No issues found.";

  return issues
    .map((issue) => {
      const parts = [
        `## ${issue.key}: ${issue.summary}`,
        `**Type:** ${issue.issueType}`,
        `**Status:** ${issue.status}`,
      ];

      if (issue.labels.length > 0) {
        parts.push(`**Labels:** ${issue.labels.join(", ")}`);
      }
      if (issue.components.length > 0) {
        parts.push(`**Components:** ${issue.components.join(", ")}`);
      }

      if (issue.acceptanceCriteria) {
        parts.push(`\n### Acceptance Criteria\n${issue.acceptanceCriteria}`);
      } else if (issue.description) {
        parts.push(`\n### Description\n${issue.description}`);
      }

      return parts.join("\n");
    })
    .join("\n\n---\n\n");
}

function buildSystemPrompt(
  skillMd: string | null,
  appSlug: string,
  testrailMeta?: { projectId: number; suiteId: number; sectionId?: number; sectionName?: string },
  targetAppSlug?: string,
  targetAppName?: string,
  profileCtx?: AppProfilePromptContext,
): string {
  const testrailSection = testrailMeta
    ? `\n\n## TestRail Target\n- Project ID: ${testrailMeta.projectId}\n- Suite ID: ${testrailMeta.suiteId}${testrailMeta.sectionId ? `\n- Section ID: ${testrailMeta.sectionId}` : ""}${testrailMeta.sectionName ? `\n- Section Name: ${testrailMeta.sectionName}` : ""}`
    : "";

  const targetAppInfo = targetAppSlug
    ? `\n\n## Target Functional App\n- targetAppSlug: ${targetAppSlug}\n- targetAppName: ${targetAppName ?? targetAppSlug}`
    : "";

  const routeProfileBlock = profileCtx?.present
    ? `\n\n## App Configuration / RouteProfile\n${formatAppProfileContext(profileCtx)}`
    : "";

  const entryPathBlock = buildEntryPathBlockFromContext(profileCtx ?? { appSlug, entrySteps: [], navigationHints: {}, aliases: {}, domainTerms: {}, visibleControls: [], present: false });

  const skillRules = skillMd
    ? `## Skill Rules (from mcp-testrail-case-generator-v2)\n\n${skillMd}\n\n`
    : "";

  return `You are an expert QA automation engineer. Your task is to generate MCP-ready TestRail scenarios from Jira user stories.

${skillRules}
## Critical Output Rules
1. Return ONLY valid JSON. No markdown fences, no explanations.
2. Every scenario must have mcpExecutable: true.
3. Do NOT generate backend-only, manual, OTP, login, PIN, password, cédula, token, database, Core Banking, API, log, or auditoría scenarios.
4. Steps must use MCP patterns only:
   - Clic en "X".
   - Validar que se muestre "X".
   - Validar que el botón "X" esté visible/habilitado/deshabilitado.
   - Validar que la opción "X" esté disponible.
   - Esperar que se muestre "X".
   - Seleccionar el primer/último <domainTerm> visible del listado.
   - Ingresar <campo> usando <dataKey>.
5. Use AuthGate in preconditions for authenticated flows.
6. expectedResult must be a short contextual phrase, not new validation targets.
7. If an issue is not UI-automatable, add it to "rejected" array with reason.
8. Forbidden step phrases: "El sistema permite", "El cliente accede", "Validar correctamente", "Verificar que funcione", "Se procesa exitosamente", "Validar backend", "Validar Core Banking", "Validar base de datos", "Validar cálculo exacto", "Validar auditoría".

## Entry Steps Rules
- If entrySteps are provided in the App Configuration section, EVERY scenario MUST start with them.
- Do NOT omit, reorder, or modify entry steps.
- entrySteps are mandatory navigation steps (e.g., clicking "Iniciar") needed before the first functional step.
- If entrySteps are NOT provided, do NOT invent them. Generate steps based ONLY on the Jira story.
- MCP will insert missing entrySteps automatically at runtime if the routeProfile defines them.
- Do NOT duplicate entry steps. Each entry step must appear exactly once per scenario.

## Sensitive Actions
Sensitive actions include: Solicitar, Confirmar, Enviar, Pagar, Transferir, Firmar, Aceptar contrato, Aprobar, Debitar, Eliminar, Cancelar producto.
- Do NOT generate "Clic en" for sensitive actions by default.
- DO allow "Validar que el botón 'X' esté visible/deshabilitado" for sensitive actions.
- DO allow "Validar que se muestre 'X'" for sensitive action labels.

${entryPathBlock}
## COVERAGE EXPECTATIONS
- If the Jira story describes a module with multiple visible categories/subcategories, generate separate scenarios by functional route.
- Do not collapse all paths into one scenario.
- Generate scenarios for:
  - visualización de categorías principales
  - navegación a subcategorías
  - selección de primer producto visible
  - detalle de producto
  - controles visibles no sensibles
  - regresar desde detalle
  - finalizar sesión si es visible y seguro
  - estados vacíos/no disponible solo si son visibles por UI y tienen fixture clara
- Prefer 6 to 12 scenarios when the story contains enough UI material.
- Reject backend/manual/integration/log/audit/external website checks.
- Do not reject valid UI routes only because they require controlled data.
- Prefer \`ui_with_controlled_data\` when a realistic fixture is needed.

## Valid Action Targets
- Only generate "Clic en" steps for targets that are visible controls, entry steps, aliases, or domain terms from the App Configuration section.
- Do NOT convert expected result values, category names, subcategory names, currency names (e.g., "Pesos", "Dólares", "Euros"), or data values into click targets unless they appear in visibleControls.
- If the expected result or user story mentions a value that is not a confirmed clickable control, use a validation step instead: "Validar que se muestre \"<value>\"."
- Generic ordinal selections like "Seleccionar el primer producto visible del listado" are allowed only when the story lists visible items and the profile provides domain terms.
- When in doubt, prefer "Validar que se muestre" over "Clic en" for values that appear to be data content rather than controls.

## Detail Scenario Pattern
- When a scenario reaches a listing/category page and then validates detail fields (nombre, descripción, beneficios, condiciones, estado, etc.), it MUST include a selection step before the detail assertions.
- Use: "Seleccionar el primer elemento visible del listado." (or use domainTerm if available: "Seleccionar el primer <domainTerm> visible del listado.")
- Do NOT validate detail fields without first selecting an item from the list.
- Do NOT invent specific product/item names. Use generic "primer elemento visible del listado".
- This selection step goes between the navigation/list step and the detail validation steps.

## CRITICAL OUTPUT CONTRACT
- Return exactly one JSON object.
- Do not use markdown.
- Do not use \`\`\` fences.
- Do not include explanations.
- Do not include comments.
- Do not include trailing commas.
- Do not write CSV.
- The first non-whitespace character of your response must be '{'.
- The last non-whitespace character of your response must be '}'.
- If no scenarios can be generated, return:
{
  "appSlug": "${appSlug}",
  "targetAppSlug": "${targetAppSlug ?? appSlug}",
  "targetAppName": "${targetAppName ?? appSlug}",
  "confidence": "low",
  "reason": "No MCP-executable scenarios could be generated from the provided Jira issues.",
  "functionalRoute": "",
  "routeProfile": {
    "name": "",
    "entry": [],
    "aliases": {},
    "intermediates": {},
    "domainTerms": {},
    "visibleControls": [],
    "representativeFixture": {},
    "notes": []
  },
  "scenarios": [],
  "warnings": ["No executable scenarios generated."],
  "rejected": []
}

## App Configuration
- appSlug: ${appSlug} (technical profile)
- targetAppSlug: ${targetAppSlug ?? appSlug} (functional app)
- targetAppName: ${targetAppName ?? appSlug}${testrailSection}${targetAppInfo}${routeProfileBlock}

## Required JSON Output Format
Return a JSON object with this exact structure:
{
  "appSlug": "${appSlug}",
  "targetAppSlug": "${targetAppSlug ?? appSlug}",
  "targetAppName": "${targetAppName ?? appSlug}",
  "confidence": "high|medium|low",
  "reason": "Brief explanation",
  "functionalRoute": "Expected functional route description",
  "routeProfile": {
    "name": "generated_profile_name",
    "entry": [],
    "aliases": {},
    "intermediates": {},
    "domainTerms": {},
    "visibleControls": [],
    "representativeFixture": {},
    "notes": []
  },
  "scenarios": [
    {
      "sourceIssueKey": "AA-123",
      "title": "Scenario title",
      "steps": ["1. Clic en \"X\".", "2. Validar que se muestre \"Y\"."],
      "preconditions": ["1. BASE_URL configurado.", "2. App available.", "3. APP_LOGIN_MODE=password.", "4. AuthGate/AuthFlow enabled.", "5. Test client meets dataRequirements.", "6. App Slug: ${appSlug}."],
      "expectedResult": "Short contextual phrase.",
      "type": "Functional",
      "database": "QA",
      "isConverted": 0,
      "automationType": "ui_with_auth_gate",
      "setupStrategy": "auth_gate",
      "appSlug": "${targetAppSlug ?? appSlug}",
      "targetAppSlug": "${targetAppSlug ?? appSlug}",
      "targetAppName": "${targetAppName ?? appSlug}",
      "routeProfile": "generated_profile_name",
      "dataRequirements": "cliente_fixture_requerido",
      "nonExecutableCriteria": "",
      "mcpExecutable": true
    }
  ],
  "warnings": [],
  "rejected": [
    {
      "sourceIssueKey": "AA-999",
      "reason": "backend_only_or_not_ui_automatable"
    }
  ]
}`;
}

export async function buildMcpScenarioMessages(
  issues: JiraIssueSource[],
  appSlug: string,
  testrailMeta?: { projectId: number; suiteId: number; sectionId?: number; sectionName?: string },
  targetAppSlug?: string,
  targetAppName?: string,
  routeProfile?: McpRouteProfile | null,
  entrySteps?: Array<{ action: string; target: string; when?: string }>,
  loginMode?: string,
): Promise<Array<{ role: "system" | "user"; content: string }>> {
  const skillMd = await loadSkillMarkdown();

  const profileCtx = buildAppProfilePromptContext(appSlug, {
    targetAppSlug,
    targetAppName,
    routeProfile,
    entrySteps,
    loginMode,
  });

  logAppProfileContext(profileCtx);

  const issueKeys = issues.map((i) => i.key).join(", ");
  console.log(`[scenarios:prompt] jira issues included keys=${issueKeys}`);

  const systemContent = buildSystemPrompt(skillMd, appSlug, testrailMeta, targetAppSlug, targetAppName, profileCtx);
  const safeUserContent = sanitizeForPrompt(formatIssues(issues));
  const userContent = `Generate MCP-ready TestRail scenarios from the following Jira issues:\n\n${safeUserContent}`;

  console.log(`[scenarios:prompt] prompt built chars=${systemContent.length + userContent.length} issues=${issues.length} expectedResultAsContext=true`);

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];
}
