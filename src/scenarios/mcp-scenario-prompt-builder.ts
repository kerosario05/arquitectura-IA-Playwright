import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { JiraIssueSource, McpRouteProfile } from "./scenario-types";

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

function formatRouteProfile(rp: McpRouteProfile | null): string {
  if (!rp || !rp.name) return "";

  const parts: string[] = [];

  if (rp.entry && rp.entry.length > 0) {
    const entryLabels = rp.entry.map((e) => e.visibleLabel).join(" → ");
    parts.push(`- Entry path: ${entryLabels}`);
  }

  if (rp.aliases && Object.keys(rp.aliases).length > 0) {
    parts.push(`- Aliases: ${JSON.stringify(rp.aliases)}`);
  }

  if (rp.domainTerms && Object.keys(rp.domainTerms).length > 0) {
    parts.push(`- Domain terms: ${JSON.stringify(rp.domainTerms)}`);
  }

  if (rp.visibleControls && rp.visibleControls.length > 0) {
    parts.push(`- Visible controls: ${rp.visibleControls.join(", ")}`);
  }

  if (rp.representativeFixture && Object.keys(rp.representativeFixture).length > 0) {
    parts.push(`- Fixtures: ${JSON.stringify(rp.representativeFixture)}`);
  }

  if (rp.notes && rp.notes.length > 0) {
    parts.push(`- Notes: ${rp.notes.join("; ")}`);
  }

  return parts.join("\n");
}

function buildEntryPathBlock(rp: McpRouteProfile | null): string {
  if (!rp || !rp.entry || rp.entry.length === 0) return "";

  const steps = rp.entry
    .map((e, i) => `${i + 1}. Clic en "${e.visibleLabel}".`)
    .join("\n");

  return `
REQUIRED ENTRY PATH:
Every generated scenario must start with these steps, exactly in this order:
${steps}

If a routeProfile.entry is provided, do not omit these entry steps.
Do not start directly inside the module.
Do not assume prior navigation state.
Do not generate manual login, cédula, OTP, PIN, or password steps.
AuthGate/AuthFlow will resolve authentication when the flow enters through the authenticated route.
`;
}

function buildSystemPrompt(
  skillMd: string | null,
  appSlug: string,
  testrailMeta?: { projectId: number; suiteId: number; sectionId?: number; sectionName?: string },
  targetAppSlug?: string,
  targetAppName?: string,
  routeProfile?: McpRouteProfile | null,
): string {
  const testrailSection = testrailMeta
    ? `\n\n## TestRail Target\n- Project ID: ${testrailMeta.projectId}\n- Suite ID: ${testrailMeta.suiteId}${testrailMeta.sectionId ? `\n- Section ID: ${testrailMeta.sectionId}` : ""}${testrailMeta.sectionName ? `\n- Section Name: ${testrailMeta.sectionName}` : ""}`
    : "";

  const targetAppInfo = targetAppSlug
    ? `\n\n## Target Functional App\n- targetAppSlug: ${targetAppSlug}\n- targetAppName: ${targetAppName ?? targetAppSlug}`
    : "";

  const routeProfileBlock = routeProfile ? `\n\n## App Configuration / RouteProfile\n- appSlug: ${appSlug} (technical profile)\n- targetAppSlug: ${targetAppSlug ?? appSlug} (functional app)\n- targetAppName: ${targetAppName ?? appSlug}\n- routeProfile: ${routeProfile.name}\n${formatRouteProfile(routeProfile)}` : "";

  const entryPathBlock = buildEntryPathBlock(routeProfile ?? null);

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
): Promise<Array<{ role: "system" | "user"; content: string }>> {
  const skillMd = await loadSkillMarkdown();

  const systemContent = buildSystemPrompt(skillMd, appSlug, testrailMeta, targetAppSlug, targetAppName, routeProfile);
  const userContent = `Generate MCP-ready TestRail scenarios from the following Jira issues:\n\n${formatIssues(issues)}`;

  console.log(`[scenarios:prompt] prompt built chars=${systemContent.length + userContent.length} issues=${issues.length}`);

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent },
  ];
}
