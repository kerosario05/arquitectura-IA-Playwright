import type { JiraIssueSource } from "./scenario-types";
import type { AiMessage } from "../ai/ai-provider.types";
import type { MobileRouteProfile } from "../mobile/mobile-route-profile.types";
import type { MobileLearnedScreen } from "../mobile/mobile-knowledge-resolver";

const SYSTEM_PROMPT = `Eres un generador de pasos de prueba automatizados para apps Android nativas usando Appium/UiAutomator2.

Recibiras UNA historia de usuario (Jira) y debes generar pasos de prueba en JSON.

FORMATO DE SALIDA (JSON estricto, sin explicaciones, sin markdown, sin texto antes o despues):
{
  "scenarios": [
    {
      "sourceIssueKey": "AA-91",
      "title": "Titulo corto y descriptivo del escenario",
      "steps": [
        { "action": "launchApp", "description": "Abrir la aplicacion" },
        { "action": "click", "description": "Descripcion de la accion", "target": { "strategy": "accessibilityId", "value": "Texto visible del boton" } },
        { "action": "fill", "description": "Descripcion", "target": { "strategy": "accessibilityId", "value": "Etiqueta del campo" }, "value": "valor de ejemplo" },
        { "action": "assertVisible", "description": "Descripcion", "target": { "strategy": "accessibilityId", "value": "Texto esperado en pantalla" } },
        { "action": "assertDisabled", "description": "Verificar que el boton queda deshabilitado", "target": { "strategy": "accessibilityId", "value": "Continuar" } }
      ],
      "expectedResult": "Resultado esperado del escenario completo, en 1-2 frases",
      "preconditions": ["Precondicion 1 (puede ser un array vacio si no aplica)"]
    }
  ],
  "rejected": []
}

REGLAS:
- "strategy" debe ser exactamente uno de: accessibilityId | id | xpath | androidUiAutomator | className.
- Preferir SIEMPRE "accessibilityId" usando el texto visible mencionado o implicito en la historia — es la estrategia mas confiable sin conocer la jerarquia real de la app.
- NO inventes resource-id (strategy "id") ni XPaths especificos — no tienes visibilidad de la app real, solo del texto de la historia.
- "action" debe ser exactamente uno de: launchApp | click | fill | assertVisible | assertEnabled | assertDisabled | waitFor | screenshot.
- BOTONES CON GATE (deshabilitados hasta cumplir una condicion): si un elemento del contexto tiene "gated": true, esta DESHABILITADO hasta cumplir su "enabledWhen". Un paso "click" sobre un boton deshabilitado FALLA. Reglas:
  * Happy path: primero genera los pasos que cumplen el gate (segun "enabledWhen") y LUEGO el "click" sobre el boton.
  * Escenarios NEGATIVOS (datos invalidos/incompletos que caen en "disabledWhen"): NO generes "click" sobre ese boton; genera un paso {"action":"assertDisabled","target":{...}} para validar que queda deshabilitado (ese es el resultado esperado del escenario negativo).
  * Opcional: usa {"action":"assertEnabled","target":{...}} para confirmar que el gate se cumplio antes de clickear.
- El primer paso de cada escenario debe ser siempre {"action":"launchApp"}.
- "expectedResult" es OBLIGATORIO en cada escenario — describe el resultado final esperado, no un paso mas.
- "preconditions" es un array de strings (puede ser vacio []) con lo que debe cumplirse antes de ejecutar el escenario.
- Genera entre 1 y 4 escenarios por historia (happy path + variantes relevantes mencionadas en criterios de aceptacion).
- Si la historia NO tiene suficiente informacion (sin descripcion, sin criterios de aceptacion, texto vacio o irrelevante) para generar pasos con confianza razonable, NO inventes pasos genericos — agrega la historia al array "rejected" con una razon clara en "reason".
- RUTEO POR INTENCION (FLUJOS): si el contexto incluye una seccion "FLUJOS DE NAVEGACION", primero identifica a que flujo pertenece la historia comparando su texto (titulo/descripcion/criterios) con los "triggerKeywords" y la descripcion de cada flujo. Cuando la historia corresponda a un flujo, DEBES anteponer los "entrySteps" de ese flujo (justo despues del paso launchApp) para llegar a la pantalla correcta, y luego continuar con los pasos especificos de la historia usando los elementos de la pantalla destino de ese flujo. Ejemplo: una historia de "validación del cliente / registro de nuevo usuario" NO empieza escribiendo usuario y contraseña en el login — empieza tocando el enlace de registro segun los entrySteps del flujo de registro.
- No incluyas ninguna explicacion fuera del objeto JSON.`;

function formatFlows(routeProfile: MobileRouteProfile): string {
  if (!routeProfile.flows || Object.keys(routeProfile.flows).length === 0) return "";

  const lines = [
    "## FLUJOS DE NAVEGACION (rutas por intencion)",
    "Identifica a que flujo pertenece la historia y antepon sus 'entrySteps' (despues de launchApp) para llegar a la pantalla correcta antes de los pasos especificos.",
    ""
  ];

  for (const [flowId, flow] of Object.entries(routeProfile.flows)) {
    lines.push(`### Flujo: ${flowId}`);
    lines.push(`- Cuando aplica: ${flow.description}`);
    lines.push(`- Palabras clave: ${flow.triggerKeywords.join(", ")}`);
    if (flow.entryFromScreen) lines.push(`- Pantalla destino: ${flow.entryFromScreen}`);
    if (flow.entrySteps.length === 0) {
      lines.push(`- Pasos de entrada: ninguno (ya se esta en la pantalla de entrada tras launchApp)`);
    } else {
      lines.push(`- Pasos de entrada (anteponer estos, en orden):`);
      for (const st of flow.entrySteps) {
        const tgt = st.target ? ` -> target: {"strategy":"${st.target.strategy}","value":${JSON.stringify(st.target.value)}}` : "";
        lines.push(`    { "action": "${st.action}"${st.value ? `, "value": ${JSON.stringify(st.value)}` : ""}, "description": ${JSON.stringify(st.description ?? "")} }${tgt}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatRouteProfile(routeProfile: MobileRouteProfile): string {
  const lines = [
    `## PANTALLAS REALES CONOCIDAS DE LA APP (${routeProfile.appName}, package=${routeProfile.packageName})`,
    "Estas son pantallas y elementos REALES, descubiertos inspeccionando la app en un emulador.",
    "Si la historia de usuario menciona una accion relacionada con alguna de estas pantallas, USA EXACTAMENTE el 'strategy' y 'value' indicados abajo para ese elemento en vez de inventar un accessibilityId.",
    ""
  ];

  for (const screen of Object.values(routeProfile.screens)) {
    const entryTag = screen.isEntryScreen ? " (pantalla de entrada de la app)" : "";
    lines.push(`### Pantalla [${screen.screenId}]: ${screen.title}${entryTag}`);
    for (const el of screen.elements) {
      if (el.locator?.strategy) {
        const loc = `{"strategy":"${el.locator.strategy}","value":${JSON.stringify(el.locator.value)}}`;
        const hint = el.interaction ? ` [interaccion: ${JSON.stringify(el.interaction)}]` : "";
        const gate = el.gated
          ? ` [GATED: deshabilitado hasta ${JSON.stringify(el.enabledWhen ?? [])}${el.disabledWhen ? `; permanece deshabilitado si ${JSON.stringify(el.disabledWhen)}` : ""}. En escenarios negativos usa assertDisabled en vez de click]`
          : "";
        lines.push(`- [${el.role}] "${el.label}" -> target: ${loc}${el.notes ? ` (${el.notes})` : ""}${hint}${gate}`);
      } else {
        // Guidance-only element (e.g. a modal/overlay) — no tappable target, surface as a note.
        const closeNote = el.close ? ` [cierre: ${el.close.hint ?? ""}${el.close.note ? ` — ${el.close.note}` : ""}]` : "";
        lines.push(`- [${el.role}] "${el.label}" (sin target directo)${el.notes ? `: ${el.notes}` : ""}${closeNote}`);
      }
    }
    if (screen.dataFields && screen.dataFields.length > 0) {
      lines.push(`  DATOS OBLIGATORIOS de esta pantalla (SIEMPRE genera pasos para cada uno, sin importar el fraseo de la historia):`);
      for (const df of screen.dataFields) {
        if (df.kind === "select") {
          const opts = (df.options ?? []).join(" | ");
          lines.push(`  - "${df.label}" (seleccion): genera un paso "click" sobre la opcion por defecto "${df.defaultValue ?? df.options?.[0] ?? ""}" usando target ${JSON.stringify(df.applyTargetTemplate?.value.replace("{{value}}", df.defaultValue ?? df.options?.[0] ?? ""))}. Opciones validas: ${opts}.`);
        } else {
          lines.push(`  - "${df.label}" (texto): genera un paso "fill" con target ${JSON.stringify(df.matchLocator.value)} strategy "${df.matchLocator.strategy}" y value de ejemplo ${JSON.stringify(df.exampleValue ?? "")}.`);
        }
      }
    }
    if (screen.flowNotes && screen.flowNotes.length > 0) {
      lines.push(`  FLUJO de esta pantalla (respeta el orden y evita los errores indicados):`);
      for (const note of screen.flowNotes) lines.push(`  - ${note}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function formatIssue(issue: JiraIssueSource): string {
  const parts = [`## ${issue.key}: ${issue.summary}`];
  const description = issue.acceptanceCriteria || issue.description || "";
  if (description) {
    parts.push(description.slice(0, 2000));
  } else {
    parts.push("(sin descripcion ni criterios de aceptacion)");
  }
  return parts.join("\n");
}

/**
 * Builds the AI prompt for ONE Jira issue at a time. Batching multiple issues into a
 * single call causes the model (and the equivalent web pipeline before this fix) to
 * only address the first one — see scenario-preview.service.ts's per-issue processing
 * for the same lesson learned on the web side.
 */
function formatLearnedKnowledge(learnedScreens: MobileLearnedScreen[]): string {
  if (learnedScreens.length === 0) return "";
  const lines = [
    "## CONOCIMIENTO DE EJECUCIONES PREVIAS (pantallas reales confirmadas)",
    "Estas pantallas y elementos fueron OBSERVADOS en ejecuciones reales de la app en el emulador.",
    "Son la verdad del terreno: prefiere estos elementos reales sobre suposiciones, especialmente en pantallas que no aparecen en el perfil de rutas curado.",
    ""
  ];
  for (const screen of learnedScreens) {
    lines.push(`### Pantalla: ${screen.title || screen.screenKey}`);
    if (screen.clickTargets.length > 0) {
      lines.push(`- Elementos tappables reales: ${screen.clickTargets.map((t) => `"${t}"`).join(", ")}`);
    }
    if (screen.assertionTargets.length > 0) {
      lines.push(`- Textos visibles (para aserciones): ${screen.assertionTargets.map((t) => `"${t}"`).join(", ")}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function buildMobileScenarioMessages(
  issue: JiraIssueSource,
  routeProfile?: MobileRouteProfile | null,
  learnedScreens?: MobileLearnedScreen[]
): AiMessage[] {
  const userParts = [
    "Genera pasos de prueba mobile para la siguiente historia de usuario:",
    "",
    formatIssue(issue)
  ];

  if (routeProfile) {
    const flowsBlock = formatFlows(routeProfile);
    if (flowsBlock) userParts.push("", flowsBlock);
    if (Object.keys(routeProfile.screens).length > 0) {
      userParts.push("", formatRouteProfile(routeProfile));
    }
  }

  if (learnedScreens && learnedScreens.length > 0) {
    userParts.push("", formatLearnedKnowledge(learnedScreens));
  }

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userParts.join("\n") }
  ];
}
