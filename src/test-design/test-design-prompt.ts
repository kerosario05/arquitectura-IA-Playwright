import type { AiMessage } from "../ai/ai-provider.types";
import type { JiraIssueSource } from "../scenarios/scenario-types";

/**
 * Prompt for manual test case design from one Jira story.
 *
 * Unlike the automation prompts (mcp-scenario-prompt-builder.ts) there are no
 * routes, selectors or executability rules here: the reader is a QA analyst who
 * will run or review the case by hand, so every step needs an observable
 * expected result.
 */

const MAX_SOURCE_CHARS = 12_000;

export type TestDesignPromptOptions = {
  /** Free-text guidance from the user (draft-level or per regeneration). */
  instructions?: string | null;
  /** Titles already kept in the story; the model must not repeat them. */
  existingTitles?: string[];
  /** Condensed project knowledge (project-knowledge-context.ts): screens, texts, validated flows. */
  projectContext?: string | null;
};

export const TEST_DESIGN_OUTPUT_EXAMPLE = {
  scenarios: [
    {
      title: "Registrar un pago con tarjeta válida",
      type: "functional",
      priority: "high",
      preconditions: "El usuario {{usuario}} tiene sesión iniciada y un pedido pendiente de pago.",
      steps: [
        { action: "Abrir el pedido pendiente y pulsar \"Pagar\".", expected: "Se muestra el formulario de pago." },
        {
          action: "Ingresar el número de tarjeta {{numero_tarjeta}} y el CVV {{cvv}} y pulsar \"Confirmar\".",
          expected: "El sistema procesa el pago sin errores.",
        },
      ],
      expectedResult: "El pedido queda en estado \"Pagado\" y se muestra el comprobante.",
      data: [
        { key: "usuario", label: "Usuario", description: "Usuario registrado con un pedido pendiente", sensitive: false },
        { key: "numero_tarjeta", label: "Número de tarjeta", description: "Tarjeta vigente con fondos", sensitive: true },
        { key: "cvv", label: "CVV", description: "Código de seguridad de la tarjeta", sensitive: true },
      ],
    },
  ],
};

function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_SOURCE_CHARS ? `${trimmed.slice(0, MAX_SOURCE_CHARS)}\n[...texto recortado...]` : trimmed;
}

const SYSTEM_PROMPT = `Eres un analista QA senior. Diseñas casos de prueba manuales a partir de historias de usuario de Jira.

Reglas:
- Escribe en español, claro y sin ambigüedad.
- Cubre cada criterio de aceptación con al menos un caso. Incluye el camino feliz, casos negativos (datos inválidos, permisos, errores) y casos borde (límites, vacíos, duplicados) cuando la historia los justifique.
- Cada caso prueba una sola cosa. El título es breve (máximo 120 caracteres), empieza con un verbo y describe el comportamiento verificado.
- Las precondiciones describen el estado necesario antes del primer paso (usuario, datos, configuración).
- Cada paso es una acción concreta y atómica, con su resultado esperado observable por quien ejecuta la prueba.
- expectedResult resume el resultado final del caso.
- No inventes reglas de negocio, valores ni pantallas que la historia no mencione.
- Datos de prueba: cuando un paso o precondición requiera un valor que quien prueba debe ingresar o tener (usuario, contraseña, cédula, correo, teléfono, monto, OTP, número de cuenta o tarjeta...), NO inventes el valor: escribe un marcador {{clave}} (minúsculas y guiones bajos) y decláralo en "data" con key, label (como se ve en pantalla), description (qué características debe tener, p. ej. "cliente con cuenta bloqueada") y sensitive (true para contraseñas, PIN, OTP, tokens, CVV y datos de tarjeta). Usa la misma clave en todos los casos que necesiten el mismo dato; si un caso necesita un valor distinto (p. ej. una contraseña incorrecta), usa otra clave. No incluyas "value": lo completa el analista.
- Genera entre 3 y 12 casos según la complejidad de la historia. No repitas casos.
- type es uno de: functional, negative, edge, regression.
- priority es uno de: low, medium, high, critical.

Responde SOLO con un objeto JSON con esta forma, sin texto adicional ni bloques de código:
${JSON.stringify(TEST_DESIGN_OUTPUT_EXAMPLE, null, 2)}`;

function acceptanceCriteriaText(issue: JiraIssueSource): string {
  const criteria = issue.acceptanceCriteria?.trim();
  if (!criteria) return "(no hay un campo de criterios; dedúcelos de la descripción)";
  // Some projects point the criteria field at the description itself; sending it twice only costs tokens.
  if (criteria === issue.description.trim()) return "(incluidos en la descripción)";
  return clip(criteria);
}

export function buildTestDesignMessages(
  issue: JiraIssueSource,
  options: TestDesignPromptOptions = {},
): AiMessage[] {
  const context = options.projectContext?.trim();
  const parts = [
    ...(context
      ? [
          "Conocimiento del proyecto (úsalo para nombrar pantallas, campos, botones y mensajes tal como aparecen en la aplicación; no inventes otros. Si la historia contradice este conocimiento, manda la historia):",
          context,
          "",
        ]
      : []),
    `Historia: ${issue.key} — ${issue.summary}`,
    issue.issueType ? `Tipo: ${issue.issueType}` : "",
    issue.components.length > 0 ? `Componentes: ${issue.components.join(", ")}` : "",
    issue.labels.length > 0 ? `Etiquetas: ${issue.labels.join(", ")}` : "",
    "",
    "Descripción:",
    issue.description.trim() ? clip(issue.description) : "(sin descripción)",
    "",
    "Criterios de aceptación:",
    acceptanceCriteriaText(issue),
  ];

  const instructions = options.instructions?.trim();
  if (instructions) {
    parts.push("", "Indicaciones adicionales del analista (tienen prioridad sobre la cantidad o el enfoque):", clip(instructions));
  }

  const existing = (options.existingTitles ?? []).filter((t) => t.trim());
  if (existing.length > 0) {
    parts.push(
      "",
      "Estos casos ya existen y se conservan; no los repitas ni generes variantes equivalentes:",
      ...existing.map((title) => `- ${title}`),
    );
  }

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: parts.filter((line, i, all) => line !== "" || all[i - 1] !== "").join("\n") },
  ];
}
