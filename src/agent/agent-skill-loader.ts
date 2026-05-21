import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { AgentSkillDefinition, SkillId } from "../types/agent-skill.types";

const SKILLS_DIR = path.resolve(__dirname, "skills");

const BUILTIN_SKILL_DEFINITIONS: Record<SkillId, AgentSkillDefinition> = {
  "target-disambiguation": {
    id: "target-disambiguation",
    purpose: "Resolver cuál candidato visible/actionable del snapshot corresponde al step fallido por ambigüedad.",
    allowedFailureReasons: ["ambiguous_target", "locator_resolution_failed"],
    inputContract: ["snapshotCandidates del context-pack.json", "failedTarget del context-pack.json", "Ambiguity diagnostics (semanticRole, relationContext, candidateTexts)"],
    outputContract: [
      "agent-response.json con skillId=\"target-disambiguation\"",
      "proposedAction.type = \"click_candidate\"",
      "proposedAction.candidateId: ID del candidato seleccionado del snapshot",
      "diagnosis: justificación usando visible text, semanticRole, relationContext, nearbyText",
      "confidence: 0.0–1.0",
      "shouldRetryExecution: true",
      "requiresHumanApproval: false (o true si confidence < 0.7)",
      "evidenceUsed: textos visibles del snapshot que respaldan la elección",
      "risks: array de riesgos identificados"
    ],
    forbiddenActions: [
      "Inventar selector CSS/XPath libre (solo usar candidateId existente del context-pack)",
      "Modificar registry estable",
      "Modificar archivos del framework",
      "Proponer candidateId que no existe en snapshotCandidates del context-pack",
      "Proponer URLs o rutas de navegación",
      "Generar código Playwright"
    ],
    validationRules: [
      "candidateId debe existir en snapshotCandidates del context-pack",
      "No puede proponer selector libre",
      "Debe justificar con evidencia del snapshot (visible text, semanticRole, relationContext)",
      "Si confidence < 0.6, status debe ser \"needs_agent_review\"",
      "No puede modificar archivos fuera del directorio handoff",
      "Si no hay candidato confiable, status debe ser \"no_safe_action\""
    ],
    examples: [
      {
        scenario: "Múltiples botones con texto similar",
        input: "failedTarget=\"Información de productos\", candidates=[{id:\"el1\",text:\"Información de productos\",role:\"link\"},{id:\"el2\",text:\"Información de tarjetas\",role:\"link\"}], relationContext=\"main navigation\"",
        output: "{\"candidateId\":\"el1\",\"reason\":\"El texto 'Información de productos' coincide exactamente con el target, y el elemento está en el menú de navegación principal (relationContext).\",\"confidence\":0.92}",
        reasoning: "El candidateId seleccionado tiene coincidencia exacta de texto y el context de navegación principal respalda que es el destino correcto."
      },
      {
        scenario: "Sin candidato confiable",
        input: "failedTarget=\"Tarjeta de Crédito\", candidates=[], snapshotCandidates=[{id:\"el1\",text:\"Bienvenido\",role:\"heading\"}]",
        output: "{\"status\":\"needs_agent_review\",\"reason\":\"No hay candidatos visibles en el snapshot que correspondan al target.\",\"confidence\":0.0,\"shouldRetryExecution\":false}",
        reasoning: "Sin elementos visibles relacionados, no se puede proponer una acción segura."
      }
    ]
  },
  "navigation-recovery": {
    id: "navigation-recovery",
    purpose: "Proponer la siguiente acción segura cuando no se encuentra el target del step actual.",
    allowedFailureReasons: ["target_not_found", "locator_resolution_failed", "click_no_transition"],
    inputContract: [
      "snapshotCandidates del context-pack.json (elementos visibles actuales)",
      "failedTarget: target que no se encontró",
      "failedAtStep: índice del paso donde falló",
      "candidatePlan: plan con steps restantes",
      "failedReason: razón exacta del fallo",
      "knownRoutes del context-pack (rutas conocidas de otros planes)"
    ],
    outputContract: [
      "agent-response.json con skillId=\"navigation-recovery\"",
      "proposedAction.type: \"click_candidate\" | \"update_plan\"",
      "proposedAction.candidateId: ID del candidato visible a clickear (si existe)",
      "diagnosis: explicación de por qué ese candidato es la siguiente acción segura",
      "confidence: 0.0–1.0",
      "shouldRetryExecution: true si hay candidato clickeable",
      "evidenceUsed: elementos del snapshot que respaldan la decisión",
      "risks: riesgos como \"clic sin cambio de DOM esperado\""
    ],
    forbiddenActions: [
      "Inventar rutas o URLs de navegación",
      "Proponer candidateId que no existe en snapshotCandidates",
      "Inventar selectores CSS/XPath",
      "Modificar registry estable",
      "Generar código Playwright",
      "Asumir estado de la aplicación no verificado"
    ],
    validationRules: [
      "Solo puede elegir entre candidatos visibles del snapshot actual",
      "Si no hay candidato clickeable con confidence >= 0.5, status debe ser \"no_safe_action\"",
      "Si confidence < 0.6, marcar como \"needs_agent_review\"",
      "No puede ejecutar navegación (Playwright)",
      "No puede proponer acciones no presentes en supportedActions",
      "No puede modificar archivos fuera del directorio handoff"
    ],
    examples: [
      {
        scenario: "Target no encontrado, candidato alternativo visible",
        input: "failedTarget=\"Tarjeta de Crédito\" no encontrado, candidates=[{id:\"el5\",text:\"Ver tarjetas\",role:\"link\",tagName:\"a\"}]",
        output: "{\"candidateId\":\"el5\",\"reason\":\"El target original 'Tarjeta de Crédito' no está visible. 'Ver tarjetas' es un enlace visible con la misma intención semántica.\",\"confidence\":0.72,\"risks\":[\"El texto no coincide exactamente con el target original\"]}",
        reasoning: "Aunque no es el target exacto, el candidato tiene relación semántica y es clickeable."
      },
      {
        scenario: "Sin candidato clickeable",
        input: "failedTarget=\"Iniciar sesión\", candidates=[{id:\"el1\",text:\"Cargando...\",role:\"status\"}]",
        output: "{\"status\":\"no_safe_action\",\"reason\":\"No hay candidatos clickeables en el snapshot actual.\",\"confidence\":0.0,\"shouldRetryExecution\":false}",
        reasoning: "Sin elementos interactivos visibles, no se puede recuperar."
      }
    ]
  },
  "assertion-resolution": {
    id: "assertion-resolution",
    purpose: "Clasificar assertions pendientes. Diferenciar literales, descriptores semánticos, expected-only y weak signals.",
    allowedFailureReasons: ["assertion_not_found", "pendingAssertions", "needs_assertion_resolution"],
    inputContract: [
      "pendingAssertions del context-pack.json (texto completo de cada assertion pendiente)",
      "snapshotCandidates: elementos visibles actuales del snapshot",
      "failedAtStep: índice del paso donde falló",
      "candidatePlan: plan actual con steps ejecutados"
    ],
    outputContract: [
      "agent-response.json con skillId=\"assertion-resolution\"",
      "proposedAction.type: \"skip_assertion\" | \"retry_assertion\" | \"update_plan\"",
      "Para cada assertion pendiente: classification, status, matchedText, confidence",
      "shouldRetryExecution: true si alguna assertion se resolvió como \"retry\"",
      "evidenceUsed: textos del snapshot usados para resolver"
    ],
    forbiddenActions: [
      "Relajar literales explícitos (con quotes) a no bloqueantes",
      "Modificar registry estable",
      "Inventar datos que no están en el snapshot",
      "Generar código Playwright",
      "Modificar archivos del framework"
    ],
    validationRules: [
      "Una assertion literal con quotes explícitos no debe ser clasificada como semantic_descriptor",
      "Un descriptor sintético genérico desde expected source puede ser skipped_semantic_descriptor",
      "Un descriptor con señales concretas en el snapshot debe ser \"passed\"",
      "Si confidence < 0.5, marcar como needs_agent_review",
      "No puede modificar archivos fuera del directorio handoff"
    ],
    examples: [
      {
        scenario: "Descriptor semántico sin señales",
        input: "pendingAssertion=\"Datos principales visibles\", source=\"expected\", visibleTexts=[\"Bienvenido\"]",
        output: "{\"classification\":\"semantic_descriptor\",\"status\":\"skipped_semantic_descriptor\",\"reason\":\"Descriptor genérico sintético desde expected source sin evidencia concreta en el snapshot.\",\"confidence\":0.55}",
        reasoning: "Al ser expected y no tener señales en el snapshot, se trata como non-blocking."
      },
      {
        scenario: "Literal observable ausente",
        input: "pendingAssertion=\"'Total a pagar: $500'\", visibleTexts=[\"Bienvenido\"]",
        output: "{\"classification\":\"literal_observable\",\"status\":\"failed\",\"reason\":\"Texto literal no encontrado en el snapshot.\",\"confidence\":0.0}",
        reasoning: "El texto literal con quotes no está presente, por lo que es un blocker real."
      }
    ]
  },
  "form-fill": {
    id: "form-fill",
    purpose: "Resolver campos de formulario y datos requeridos para steps fill. Usar exclusivamente availableDataKeys.",
    allowedFailureReasons: ["missing_test_data", "field_not_found", "ambiguous_field", "fill_target_not_found", "fill_target_not_editable"],
    inputContract: [
      "snapshotCandidates del context-pack (elementos visibles incluyendo inputs fields)",
      "availableDataKeys del safeData del context-pack",
      "failedTarget: target del campo que falló",
      "candidatePlan: plan actual con steps",
      "failedAtStep: índice del paso donde falló"
    ],
    outputContract: [
      "agent-response.json con skillId=\"form-fill\"",
      "proposedAction.type: \"needs_data\" | \"update_plan\"",
      "diagnosis: qué campo no se pudo resolver y por qué",
      "Si falta dato: proposedAction.type = \"needs_data\", listar dataKey requerido",
      "Si campo ambiguo: proponer clarificación del target del campo",
      "confidence: 0.0–1.0",
      "shouldRetryExecution: false (si falta data) o true (si campo resuelto)",
      "evidenceUsed: campos visibles del snapshot"
    ],
    forbiddenActions: [
      "Inventar datos que no están en availableDataKeys",
      "Usar valores literales sensibles (passwords, tokens, bearer)",
      "Modificar registry estable",
      "Proponer dataKeys que no existen en availableDataKeys",
      "Generar código Playwright",
      "Asumir valores por defecto sin respaldo en availableDataKeys"
    ],
    validationRules: [
      "Solo puede usar dataKeys de availableDataKeys del context-pack",
      "Si se necesita un dato no disponible, status debe ser \"needs_data\"",
      "No puede hardcodear valores de prueba",
      "Para campos ambiguos, debe sugerir asociación con dataKey existente",
      "No puede modificar archivos fuera del directorio handoff"
    ],
    examples: [
      {
        scenario: "Campo encontrado, dato disponible",
        input: "failedTarget=\"Usuario\", availableDataKeys=[\"username\",\"password\"], field={id:\"el3\",type:\"input\",label:\"Usuario\"}",
        output: "{\"proposedAction\":{\"type\":\"update_plan\",\"reason\":\"Campo 'Usuario' (el3) coincide con dataKey 'username'.\",\"dataKey\":\"username\",\"fieldId\":\"el3\"},\"confidence\":0.95}",
        reasoning: "El campo visible y el dataKey disponible coinciden semánticamente."
      },
      {
        scenario: "Dato faltante",
        input: "failedTarget=\"Código de verificación\", availableDataKeys=[\"username\",\"password\"], field={id:\"el4\",type:\"input\",label:\"Código de verificación\"}",
        output: "{\"proposedAction\":{\"type\":\"needs_data\",\"reason\":\"Campo 'Código de verificación' visible pero no hay dataKey disponible.\",\"requiredKey\":\"verification_code\",\"fieldId\":\"el4\"},\"confidence\":0.85}",
        reasoning: "El campo existe pero el dato no está disponible. Se debe agregar a testData."
      }
    ]
  },
  "promotion-review": {
    id: "promotion-review",
    purpose: "Revisar la estabilidad y completitud del plan candidato antes de promoverlo. Detectar acciones débiles, assertions omitidas y riesgos.",
    allowedFailureReasons: ["promotion_gate_blocked"],
    inputContract: [
      "candidatePlan del context-pack.json (plan completo con steps)",
      "discovery result del context-pack (status, steps, failedReason)",
      "knownPlans del context-pack (planes similares ya promovidos para referencia)",
      "snapshotCandidates: elementos visibles usados durante discovery"
    ],
    outputContract: [
      "agent-response.json con skillId=\"promotion-review\"",
      "proposedAction.type: \"update_plan\" | \"case_quality_suggestion\"",
      "diagnosis: análisis de estabilidad del plan",
      "shouldRetryExecution: false (no se debe re-ejecutar, solo revisar)",
      "requiresHumanApproval: true si hay acciones sensibles",
      "confidence: 0.0–1.0",
      "evidenceUsed: detalles del plan y steps analizados",
      "risks: array de riesgos identificados"
    ],
    forbiddenActions: [
      "Modificar el plan directamente (solo proponer cambios vía update_plan action)",
      "Eliminar steps sensibles sin justificación",
      "Ignorar assertions obligatorias insatisfechas",
      "Modificar registry estable",
      "Generar código Playwright"
    ],
    validationRules: [
      "Si hay acciones sensibles (pagar, comprar, eliminar, confirmar), requiresHumanApproval debe ser true",
      "Si hay steps con confidence < 0.5, debe listarse como riesgo",
      "Si hay assertions skipped por weak signal, debe documentarse",
      "No puede bloquear por warnings menores (confidence >= 0.7 es aceptable)",
      "Si el plan no tiene steps, status debe ser \"no_safe_action\"",
      "No puede modificar archivos fuera del directorio handoff"
    ],
    examples: [
      {
        scenario: "Plan con acción sensible",
        input: "plan={steps:[{action:\"click\",target:\"Confirmar pago\",index:3}]}",
        output: "{\"diagnosis\":\"El plan contiene una acción sensible de pago.\",\"risks\":[\"Acción 'Confirmar pago' requiere verificación manual\"],\"requiresHumanApproval\":true}",
        reasoning: "Acciones de pago requieren aprobación humana incluso si el plan es correcto."
      },
      {
        scenario: "Plan estable para promoción",
        input: "plan={steps:[{action:\"click\",target:\"Iniciar\",index:1,confidence:0.95}]}",
        output: "{\"diagnosis\":\"Plan estable. No se detectan riesgos significativos.\",\"risks\":[],\"requiresHumanApproval\":false}",
        reasoning: "Steps con alta confianza y sin acciones sensibles permiten promoción automática."
      }
    ]
  },
  "case-quality": {
    id: "case-quality",
    purpose: "Revisar el texto del caso de prueba original en TestRail. Detectar pasos duplicados, targets repetidos, assertions vagas.",
    allowedFailureReasons: ["poor_case_quality", "repeated_targets", "vague_assertions"],
    inputContract: [
      "scenario (test case) del context-pack.json: custom_steps, expected, title",
      "discovery result: steps ejecutados con sus status",
      "repeated_targets detected during discovery (si aplica)",
      "vague_assertions detected during discovery (si aplica)"
    ],
    outputContract: [
      "agent-response.json con skillId=\"case-quality\"",
      "proposedAction.type: \"case_quality_suggestion\"",
      "diagnosis: descripción de los problemas encontrados",
      "proposedAction.reason: texto con sugerencias de mejora",
      "shouldRetryExecution: false (no se debe re-ejecutar por calidad de caso)",
      "confidence: 0.0–1.0",
      "evidenceUsed: pasos y assertions del caso original",
      "risks: riesgos de mantener el caso como está"
    ],
    forbiddenActions: [
      "Modificar TestRail automáticamente",
      "Modificar registry estable",
      "Cambiar el plan de ejecución",
      "Generar código Playwright",
      "Modificar archivos del framework"
    ],
    validationRules: [
      "No puede modificar TestRail (solo sugerir cambios vía output)",
      "Debe citar pasos específicos del caso original en la diagnosis",
      "Las sugerencias deben ser específicas y accionables",
      "No puede cambiar el propósito del caso",
      "No puede hardcodear nombres de productos, URLs o perfiles",
      "No puede modificar archivos fuera del directorio handoff"
    ],
    examples: [
      {
        scenario: "Pasos duplicados",
        input: "custom_steps=[\"1. Clic en 'Continuar'\",\"2. Clic en 'Continuar'\"]",
        output: "{\"diagnosis\":\"El paso 'Clic en 'Continuar'' aparece duplicado.\",\"risks\":[\"Duplicación puede causar fallos intermitentes\"],\"confidence\":0.85}",
        reasoning: "Pasos duplicados sin cambios de estado intermedios son redundantes y propensos a fallos."
      },
      {
        scenario: "Assertions vagas",
        input: "expected=[\"Resultado visible\",\"Validar que se muestre la información\"]",
        output: "{\"diagnosis\":\"La assertion 'Validar que se muestre la información' es muy genérica.\",\"risks\":[\"Assertions vagas pueden causar falsos positivos\"],\"confidence\":0.78}",
        reasoning: "Assertions sin target observable específico son difíciles de validar automáticamente."
      }
    ]
  }
};

export function loadSkillDefinition(skillId: SkillId): AgentSkillDefinition {
  const def = BUILTIN_SKILL_DEFINITIONS[skillId];
  if (!def) {
    throw new Error(`Unknown skill: ${skillId}`);
  }
  return JSON.parse(JSON.stringify(def)) as AgentSkillDefinition;
}

export function loadSkillMarkdown(skillId: SkillId): string {
  return [
    `# Skill: ${skillId}`,
    "",
    getSkillFrontMatter(skillId),
    "",
    `## allowedFailureReasons`,
    ...BUILTIN_SKILL_DEFINITIONS[skillId].allowedFailureReasons.map((r) => `- ${r}`),
  ].join("\n");
}

function getSkillFrontMatter(skillId: SkillId): string {
  const def = BUILTIN_SKILL_DEFINITIONS[skillId];
  return `## ${def.purpose}`;
}

export function getAllSkillIds(): SkillId[] {
  return Object.keys(BUILTIN_SKILL_DEFINITIONS) as SkillId[];
}

export async function writeSelectedSkillFiles(
  handoffDir: string,
  skillId: SkillId,
  definition: AgentSkillDefinition
): Promise<{ mdPath: string; jsonPath: string }> {
  const mdPath = path.join(handoffDir, "selected-skill.md");
  const jsonPath = path.join(handoffDir, "selected-skill.json");

  await mkdir(handoffDir, { recursive: true });

  const mdContent = [
    `# Selected Skill: ${skillId}`,
    "",
    `## Purpose`,
    definition.purpose,
    "",
    "## Allowed Failure Reasons",
    ...definition.allowedFailureReasons.map((r) => `- ${r}`),
    "",
    "## Input Contract",
    ...definition.inputContract.map((l) => `- ${l}`),
    "",
    "## Output Contract",
    ...definition.outputContract.map((l) => `- ${l}`),
    "",
    "## Forbidden Actions",
    ...definition.forbiddenActions.map((l) => `- ${l}`),
    "",
    "## Validation Rules",
    ...definition.validationRules.map((l) => `- ${l}`),
    "",
    "## Examples",
    ...definition.examples.flatMap((ex) => [
      `### ${ex.scenario}`,
      `- **Input:** ${ex.input}`,
      `- **Output:** ${ex.output}`,
      `- **Reasoning:** ${ex.reasoning}`,
      ""
    ])
  ].join("\n");

  await writeFile(mdPath, mdContent, "utf-8");
  await writeFile(jsonPath, JSON.stringify({ selectedSkill: skillId, definition }, null, 2), "utf-8");

  return { mdPath, jsonPath };
}
