import { createAiProviderFromEnv } from "../ai/ai-provider-factory";
import type { AiProvider } from "../ai/ai-provider.types";
import { preprocessJiraHu } from "./jira-hu-preprocessor";
import type { ProcessedJiraHu, StoryType } from "./jira-hu-preprocessor";

export type GeneratedStep = {
  content: string;
};

export type GeneratedScenario = {
  title: string;
  preconditions: string | null;
  steps: GeneratedStep[];
  expectedResult: string;
};

export type GeneratedScenariosResult = {
  jiraKey: string;
  storyTitle: string;
  storyType: StoryType;
  scenarios: GeneratedScenario[];
  generatedByAi: boolean;
};

// ─── Skill: scenario-generation ───────────────────────────────────────────────
// Construido a partir de src/agent/skills/scenario-generation.skill.md

const SKILL_PURPOSE = `Generar múltiples casos de prueba profesionales para TestRail a partir de una historia de usuario de Jira, cubriendo el flujo exitoso, errores esperados y casos borde relevantes al tipo de funcionalidad.`;

const SKILL_OUTPUT_CONTRACT = `
- Entre 2 y 5 escenarios según la complejidad de la historia
- title: nombre descriptivo y único — QUÉ se prueba y bajo QUÉ condición
- preconditions: lista con guiones de condiciones técnicas y de negocio previas al test
- steps[]: array de pasos ATÓMICOS — un paso = una sola acción del usuario usando los verbos del diccionario
- expectedResult: resultado final observable al completar todos los pasos
`.trim();

const STEP_TAXONOMY = `
## Diccionario de verbos obligatorio — usa ÚNICAMENTE estos patrones:

| Tipo de acción         | Patrón obligatorio                                     | Ejemplo correcto                                      |
|------------------------|--------------------------------------------------------|-------------------------------------------------------|
| Botón o enlace         | Clic en "[label exacto]"                               | Clic en "Iniciar"                                     |
| Campo de texto         | Ingresar [dato genérico] en el campo "[nombre]"        | Ingresar el número de cédula en el campo "Identificación" |
| Lista o dropdown       | Seleccionar "[opción]"                                 | Seleccionar "Cuenta de Ahorro"                        |
| Validar texto visible  | Validar que se muestre "[texto visible en pantalla]"   | Validar que se muestre "Solicitar"                    |
| Verificar estado UI    | Verificar que [condición observable]                   | Verificar que el botón "Continuar" está habilitado    |
| Esperar carga          | Esperar que se cargue [pantalla o sección]             | Esperar que se cargue la pantalla de confirmación     |

PROHIBIDO usar: "Navegar a", "Acceder a", "Ir a", "Revisar", "Comprobar", "Ver", "Abrir la sección"
`.trim();

const SKILL_FORBIDDEN = `
- Verbos genéricos: "Navegar a", "Acceder a", "Ir a", "Revisar", "Comprobar", "Ver" — usa el diccionario
- Pasos combinados: "Ingresar y confirmar" — separar en dos pasos atómicos
- expectedResult genérico: "funciona correctamente", "el sistema responde", "se procesa"
- Generar solo 1 escenario cuando hay múltiples criterios o flujos
- Hardcodear valores reales: cédulas, montos, cuentas, nombres de usuario
- Pasos de setup técnico (insertar en BD, crear usuario, configurar entorno)
- Agrupar validaciones con acciones — los "Validar que se muestre" van AL FINAL del escenario
- Precondiciones genéricas como "El usuario existe" o "La app está configurada"
`.trim();

const SKILL_RULES = `
## Reglas de construcción de pasos — CRÍTICO
- NAVEGACIÓN COMPLETA: los pasos SIEMPRE empiezan desde la pantalla inicial de la aplicación (BASE_URL). Nunca asumas que el usuario ya está en una pantalla intermedia. Si la app tiene una pantalla de bienvenida o un botón de inicio ("Iniciar", "Comenzar", "Entrar"), el primer paso debe ser ese clic.
- ATOMICIDAD: un paso = una sola acción. Navegación de 4 pantallas = 4 pasos de "Clic en"
- ORDEN: primero todos los pasos de acción (Clic, Ingresar, Seleccionar), luego las validaciones (Validar que se muestre)
- LABELS en comillas: cualquier texto visible de la UI va entre comillas dobles
- USA el diccionario de verbos — ningún otro verbo es válido

## Reglas de precondiciones
Incluir siempre como lista con guiones:
- Disponibilidad de la aplicación o módulo (accesible en BASE_URL)
- Estado de autenticación del usuario (autenticado / no autenticado / sesión iniciada)
- Estado de datos necesarios (tiene/no tiene cuentas, productos, historial)
- Condición específica del escenario (saldo suficiente/insuficiente, intentos restantes, etc.)

## Reglas de cobertura por tipo
- AUTH: happy path completo + credenciales inválidas + bloqueo por intentos
- TRANSFER: flujo exitoso + saldo insuficiente + límite excedido
- FORM: datos válidos completos + campos obligatorios vacíos + formato inválido
- QUERY: resultados disponibles + estado vacío (sin datos)
- El PRIMER escenario siempre es el happy path con navegación COMPLETA desde el inicio
`.trim();

const SKILL_EXAMPLES = `
### Ejemplo 1 — Autenticación con OTP (storyType: auth)
Historia: [AA-45] "Como usuario quiero iniciar sesión con mi cédula y código OTP"
Criterios: El usuario ingresa cédula válida; El sistema envía OTP al celular; El usuario ingresa OTP correcto; Se accede al dashboard

{
  "scenarios": [
    {
      "title": "Inicio de sesión exitoso con cédula válida y OTP correcto",
      "preconditions": "- La aplicación está disponible y accesible.\n- El usuario NO está autenticado (sesión cerrada).\n- El usuario tiene cuenta activa en el sistema.\n- El número de celular del usuario está registrado y activo.",
      "steps": [
        "Clic en \\"Iniciar sesión\\"",
        "Ingresar el número de cédula en el campo \\"Identificación\\"",
        "Clic en \\"Continuar\\"",
        "Ingresar el código OTP recibido en el campo \\"Código de verificación\\"",
        "Clic en \\"Confirmar\\"",
        "Validar que se muestre \\"Bienvenido\\"",
        "Validar que se muestre el menú principal de la aplicación"
      ],
      "expectedResult": "El usuario accede al dashboard principal con el menú de opciones disponibles y su nombre visible en la pantalla."
    },
    {
      "title": "Inicio de sesión fallido con cédula no registrada en el sistema",
      "preconditions": "- La aplicación está disponible y accesible.\n- El usuario NO está autenticado.",
      "steps": [
        "Clic en \\"Iniciar sesión\\"",
        "Ingresar una cédula que no existe en el sistema en el campo \\"Identificación\\"",
        "Clic en \\"Continuar\\"",
        "Validar que se muestre el mensaje de error de cédula no registrada",
        "Verificar que el usuario permanece en la pantalla de identificación"
      ],
      "expectedResult": "El sistema muestra el mensaje de error indicando que la cédula no está registrada y no permite continuar al paso de OTP."
    },
    {
      "title": "Bloqueo de cuenta por OTP incorrecto ingresado tres veces consecutivas",
      "preconditions": "- La aplicación está disponible y accesible.\n- El usuario ingresó su cédula válida.\n- El sistema envió el código OTP al celular registrado.",
      "steps": [
        "Ingresar un código OTP incorrecto en el campo \\"Código de verificación\\"",
        "Clic en \\"Confirmar\\"",
        "Validar que se muestre el mensaje de intento fallido con intentos restantes",
        "Ingresar un código OTP incorrecto por segunda vez",
        "Clic en \\"Confirmar\\"",
        "Ingresar un código OTP incorrecto por tercera vez",
        "Clic en \\"Confirmar\\"",
        "Validar que se muestre el mensaje de cuenta bloqueada",
        "Validar que se muestre la opción para desbloquear la cuenta"
      ],
      "expectedResult": "El sistema bloquea el acceso tras tres intentos fallidos, muestra el mensaje de cuenta bloqueada e indica el proceso de desbloqueo disponible para el usuario."
    }
  ]
}

### Ejemplo 2 — Consulta de saldo con filtro (storyType: query)
Historia: [AA-67] "Como usuario quiero ver el saldo de mis cuentas y filtrar por tipo"
Criterios: Lista de cuentas con saldo disponible; Filtrar por tipo; Actualización en tiempo real

{
  "scenarios": [
    {
      "title": "Consulta exitosa del saldo de todas las cuentas activas del usuario",
      "preconditions": "- La aplicación está disponible y accesible.\n- El usuario está autenticado en la aplicación.\n- El usuario tiene al menos una cuenta activa con saldo disponible.",
      "steps": [
        "Clic en \\"Mis Cuentas\\" en el menú principal",
        "Esperar que se cargue la pantalla de cuentas",
        "Validar que se muestre el listado de cuentas del usuario",
        "Validar que se muestre el saldo disponible en cada cuenta",
        "Validar que se muestre el tipo de cuenta en cada tarjeta"
      ],
      "expectedResult": "Se muestra el listado completo de cuentas del usuario con nombre, tipo y saldo disponible en formato monetario correcto para cada una."
    },
    {
      "title": "Filtrado por tipo de cuenta muestra únicamente las cuentas del tipo seleccionado",
      "preconditions": "- El usuario está autenticado y en la pantalla de Mis Cuentas.\n- El usuario tiene cuentas de al menos dos tipos distintos (Ahorros y Corriente).",
      "steps": [
        "Seleccionar \\"Ahorros\\" en el selector de tipo de cuenta",
        "Esperar que se cargue la pantalla con los resultados filtrados",
        "Validar que se muestre únicamente cuentas de tipo Ahorros",
        "Validar que se muestre el filtro \\"Ahorros\\" como activo",
        "Verificar que el contador de cuentas refleja solo las cuentas filtradas"
      ],
      "expectedResult": "La lista muestra únicamente las cuentas de tipo Ahorros, el filtro activo aparece resaltado y el contador de resultados es correcto."
    },
    {
      "title": "Pantalla de cuentas muestra estado vacío cuando el usuario no tiene cuentas activas",
      "preconditions": "- El usuario está autenticado en la aplicación.\n- El usuario no tiene ninguna cuenta activa en el sistema.",
      "steps": [
        "Clic en \\"Mis Cuentas\\" en el menú principal",
        "Esperar que se cargue la pantalla de cuentas",
        "Validar que se muestre el mensaje de estado vacío",
        "Validar que se muestre una opción de acción disponible para el usuario"
      ],
      "expectedResult": "Se muestra el estado vacío con un mensaje indicando que no hay cuentas activas disponibles y una opción visible para que el usuario pueda realizar una solicitud."
    }
  ]
}`.trim();

// ─── Story type contextual hints ──────────────────────────────────────────────

const STORY_TYPE_HINTS: Record<StoryType, string> = {
  auth: "Flujo de AUTENTICACIÓN — Incluir escenario de credenciales inválidas y bloqueo por intentos fallidos.",
  transfer: "Flujo de TRANSFERENCIA/PAGO — Incluir escenario de saldo insuficiente y límite de transacción excedido.",
  query: "Flujo de CONSULTA — Incluir estado vacío (sin resultados) y datos que requieren actualización.",
  form: "Flujo de FORMULARIO/REGISTRO — Incluir validación de campos obligatorios y datos con formato inválido.",
  navigation: "Flujo de NAVEGACIÓN — Incluir acceso no autorizado y rutas o secciones inexistentes.",
  report: "Flujo de REPORTES — Incluir generación sin datos disponibles y errores de descarga.",
  config: "Flujo de CONFIGURACIÓN — Incluir valores inválidos y confirmación de cambios guardados.",
  unknown: "Analiza la historia y genera escenarios apropiados cubriendo el flujo exitoso y al menos un caso de error."
};

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return [
    `Eres un QA Senior especializado en banca digital y aplicaciones financieras.`,
    `Tu única tarea es generar casos de prueba profesionales para TestRail.`,
    ``,
    `## Propósito`,
    SKILL_PURPOSE,
    ``,
    `## Formato de salida requerido`,
    SKILL_OUTPUT_CONTRACT,
    ``,
    STEP_TAXONOMY,
    ``,
    `## Reglas obligatorias`,
    SKILL_RULES,
    ``,
    `## Prohibiciones estrictas`,
    SKILL_FORBIDDEN,
    ``,
    `## Ejemplos de referencia — replica este nivel de granularidad y especificidad exactamente`,
    SKILL_EXAMPLES,
    ``,
    `Responde ÚNICAMENTE con un objeto JSON válido. Sin texto adicional antes ni después.`
  ].join("\n");
}

function buildUserPrompt(jiraKey: string, hu: ProcessedJiraHu): string {
  const lines: string[] = [];

  lines.push(`Historia: [${jiraKey}] ${hu.storyTitle}`);
  lines.push(`Tipo de flujo: ${hu.storyType.toUpperCase()} — ${STORY_TYPE_HINTS[hu.storyType]}`);

  if (hu.acceptanceCriteria) {
    lines.push(`\nCriterios de aceptación:`);
    lines.push(hu.acceptanceCriteria);
  } else {
    lines.push(`\n(Sin criterios explícitos — inferir escenarios desde el título y el tipo de flujo)`);
  }

  if (hu.additionalContext) {
    lines.push(`\nContexto adicional:`);
    lines.push(hu.additionalContext);
  }

  lines.push(`\nRecuerda:`);
  lines.push(`- IMPORTANTE: Los pasos SIEMPRE empiezan desde la pantalla inicial de la app (BASE_URL). Si hay pantalla de bienvenida con botón "Iniciar" o similar, ese es el PRIMER PASO.`);
  lines.push(`- Pasos ATÓMICOS usando solo: Clic en "X", Ingresar [dato] en el campo "X", Seleccionar "X", Validar que se muestre "X", Verificar que [condición], Esperar que se cargue [pantalla]`);
  lines.push(`- Primero acciones (Clic, Ingresar, Seleccionar), luego validaciones (Validar que se muestre) al final`);
  lines.push(`- Precondiciones como lista con guiones: disponibilidad app, estado auth, datos necesarios`);
  lines.push(`\nGenera los casos de prueba para TestRail.`);

  return lines.join("\n");
}

// ─── AI response parser ───────────────────────────────────────────────────────

function parseAiResponse(parsedJson: Record<string, unknown>): GeneratedScenario[] | null {
  const raw = parsedJson["scenarios"];
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const result: GeneratedScenario[] = [];

  for (const s of raw) {
    if (!s || typeof s !== "object") continue;

    const title = typeof s.title === "string" ? s.title.trim() : "";
    if (!title) continue;

    const preconditions =
      typeof s.preconditions === "string" && s.preconditions.trim()
        ? s.preconditions.trim()
        : null;

    const expectedResult =
      typeof s.expectedResult === "string" ? s.expectedResult.trim() : "";

    const steps: GeneratedStep[] = [];
    if (Array.isArray(s.steps)) {
      for (const step of s.steps) {
        // Soporta tanto string como objeto { content }
        const content =
          typeof step === "string"
            ? step.trim()
            : typeof step?.content === "string"
              ? step.content.trim()
              : "";
        if (content) steps.push({ content });
      }
    }

    if (steps.length > 0) result.push({ title, preconditions, steps, expectedResult });
  }

  return result.length > 0 ? result : null;
}

// ─── Smart fallback by story type ─────────────────────────────────────────────

type FallbackDef = {
  titles: [string, string];
  stepsA: GeneratedStep[];
  stepsB: GeneratedStep[];
};

const FALLBACK_BY_TYPE: Partial<Record<StoryType, FallbackDef>> = {
  auth: {
    titles: [
      "Autenticación exitosa con credenciales válidas",
      "Autenticación fallida con credenciales inválidas"
    ],
    stepsA: [
      { content: "Ingresar las credenciales válidas en el formulario de acceso" },
      { content: "Confirmar el inicio de sesión" }
    ],
    stepsB: [
      { content: "Ingresar credenciales incorrectas en el formulario de acceso" },
      { content: "Intentar confirmar el inicio de sesión" }
    ]
  },
  transfer: {
    titles: [
      "Transferencia exitosa entre cuentas con saldo suficiente",
      "Transferencia rechazada por saldo insuficiente"
    ],
    stepsA: [
      { content: "Seleccionar la opción de transferencia" },
      { content: "Ingresar los datos de la operación y confirmar" }
    ],
    stepsB: [
      { content: "Seleccionar la opción de transferencia" },
      { content: "Intentar transferir un monto superior al saldo disponible" }
    ]
  },
  query: {
    titles: [
      "Consulta exitosa con resultados disponibles",
      "Consulta muestra estado vacío cuando no hay resultados"
    ],
    stepsA: [
      { content: "Acceder a la sección de consulta correspondiente" },
      { content: "Verificar los resultados mostrados en pantalla" }
    ],
    stepsB: [
      { content: "Acceder a la sección de consulta sin datos disponibles" }
    ]
  },
  form: {
    titles: [
      "Registro exitoso con todos los datos válidos",
      "Validación de campos obligatorios al enviar el formulario vacío"
    ],
    stepsA: [
      { content: "Completar todos los campos del formulario con datos válidos" },
      { content: "Enviar el formulario" }
    ],
    stepsB: [
      { content: "Intentar enviar el formulario sin completar los campos obligatorios" }
    ]
  }
};

function buildFallbackScenarios(hu: ProcessedJiraHu, rawSteps: string[]): GeneratedScenario[] {
  const typed = FALLBACK_BY_TYPE[hu.storyType];
  if (typed) {
    return [
      {
        title: typed.titles[0],
        preconditions: null,
        steps: typed.stepsA,
        expectedResult: "La operación se completa exitosamente y el resultado es visible en pantalla."
      },
      {
        title: typed.titles[1],
        preconditions: null,
        steps: typed.stepsB,
        expectedResult: "El sistema muestra un mensaje de error apropiado y el usuario puede reintentar la operación."
      }
    ];
  }

  if (rawSteps.length > 0) {
    return [
      {
        title: `${hu.storyTitle} — flujo exitoso`,
        preconditions: null,
        steps: rawSteps.map((s) => ({ content: s })),
        expectedResult: "La funcionalidad se ejecuta correctamente y el resultado es visible en pantalla."
      },
      {
        title: `${hu.storyTitle} — flujo con error o validación`,
        preconditions: null,
        steps: [{ content: "Intentar ejecutar la acción con datos inválidos o incompletos" }],
        expectedResult: "El sistema muestra retroalimentación de error al usuario de forma clara."
      }
    ];
  }

  return [
    {
      title: `${hu.storyTitle} — flujo exitoso`,
      preconditions: null,
      steps: [{ content: hu.storyTitle }],
      expectedResult: "La funcionalidad se ejecuta y el resultado es visible en pantalla."
    },
    {
      title: `${hu.storyTitle} — flujo con condición de error`,
      preconditions: null,
      steps: [{ content: "Ejecutar la acción en condiciones no válidas o con datos incorrectos" }],
      expectedResult: "El sistema muestra un mensaje de error o indicador de validación al usuario."
    }
  ];
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function generateScenariosForStory(
  jiraKey: string,
  storyTitle: string,
  rawDescription: string,
  fallbackSteps: string[],
  aiProvider?: AiProvider | null
): Promise<GeneratedScenariosResult> {
  const hu = preprocessJiraHu(storyTitle, rawDescription);

  console.log(`[scenario-generator] [${jiraKey}] storyType=${hu.storyType} hasCriteria=${hu.hasCriteria} criteriaLength=${hu.acceptanceCriteria.length}`);

  const provider = aiProvider ?? await createAiProviderFromEnv();

  if (!provider) {
    console.warn(`[scenario-generator] [${jiraKey}] Sin proveedor de IA (AI_ENABLED=false o no configurado) — usando fallback`);
    return {
      jiraKey,
      storyTitle,
      storyType: hu.storyType,
      scenarios: buildFallbackScenarios(hu, fallbackSteps),
      generatedByAi: false
    };
  }

  console.log(`[scenario-generator] [${jiraKey}] Invocando IA (provider=${provider.providerName} model=${provider.model})...`);

  try {
    const response = await provider.completeJson({
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(jiraKey, hu) }
      ],
      temperature: 0.4,
      requireJson: true
    });

    console.log(`[scenario-generator] [${jiraKey}] IA respondió en ${response.durationMs}ms — parsedJson=${!!response.parsedJson}`);

    if (!response.parsedJson) {
      console.warn(`[scenario-generator] [${jiraKey}] IA no retornó JSON parseable — rawText: ${response.rawText?.slice(0, 200)}`);
      return {
        jiraKey, storyTitle, storyType: hu.storyType,
        scenarios: buildFallbackScenarios(hu, fallbackSteps),
        generatedByAi: false
      };
    }

    const parsed = parseAiResponse(response.parsedJson);
    if (!parsed) {
      console.warn(`[scenario-generator] [${jiraKey}] JSON de IA no tiene el esquema esperado — keys: ${Object.keys(response.parsedJson).join(", ")}`);
      return {
        jiraKey, storyTitle, storyType: hu.storyType,
        scenarios: buildFallbackScenarios(hu, fallbackSteps),
        generatedByAi: false
      };
    }

    console.log(`[scenario-generator] [${jiraKey}] IA generó ${parsed.length} escenario(s) correctamente`);
    return { jiraKey, storyTitle, storyType: hu.storyType, scenarios: parsed, generatedByAi: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[scenario-generator] [${jiraKey}] Error al invocar IA: ${msg}`);
    return {
      jiraKey, storyTitle, storyType: hu.storyType,
      scenarios: buildFallbackScenarios(hu, fallbackSteps),
      generatedByAi: false
    };
  }
}
