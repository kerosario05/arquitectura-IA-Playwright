import type { JiraIssueSource } from "./scenario-types";
import type { AiMessage } from "../ai/ai-provider.types";
import type { MobileRouteProfile } from "../mobile/mobile-route-profile.types";
import type { MobileLearnedScreen } from "../mobile/mobile-knowledge-resolver";
import type { DestinationClaimDefinition } from "../mobile/mobile-destination-claim";

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
      "preconditions": ["Precondicion 1 (puede ser un array vacio si no aplica)"],
      "requiredDataProfile": "nombre-del-perfil-funcional (SOLO si el escenario depende de un estado de negocio backend y existe un perfil compatible; omitir si no aplica)",
      "requiresManualData": false,
      "coveredCriteria": ["CA01"],
      "stepRequirementRefs": [
        { "stepIndex": 1, "requirementIds": ["CA01"] }
      ],
      "stepDestinationExpectations": [
        { "stepIndex": 1, "destinationClaimId": "abc123def456" }
      ]
    }
  ],
  "rejected": []
}

REGLAS:
- "strategy" debe ser exactamente uno de: accessibilityId | id | xpath | androidUiAutomator | className.
- Preferir SIEMPRE "accessibilityId" usando el texto visible mencionado o implicito en la historia — es la estrategia mas confiable sin conocer la jerarquia real de la app.
- NO inventes resource-id (strategy "id") ni XPaths especificos — no tienes visibilidad de la app real, solo del texto de la historia.
- "action" debe ser exactamente uno de: launchApp | click | fill | assertVisible | assertEnabled | assertDisabled | waitFor | screenshot.
- OTP (codigo temporal de un solo uso): si la historia/evidencia/pantalla indican que el flujo requiere validar un codigo OTP (por ejemplo una pantalla de "codigo de verificacion" o "codigo recibido"), genera el paso que ingresa ese codigo con un "fill" accionable (por ejemplo description "Validar el codigo OTP recibido." o "Ingresar el codigo OTP vigente.") y anade en ESE paso la metadata estructurada: "otp": { "required": true, "identityField": "<campo opcional si la evidencia lo identifica>", "channel": "<canal opcional si la evidencia lo identifica>" }. 
  * NUNCA escribas un codigo OTP concreto en "value" ni en ningun campo: el codigo es dinamico y se resuelve en runtime. Prohibido producir "otp": "123456", "codigo": "000000" o cualquier OTP estatico.
  * "identityField" y "channel" solo deben provenir de configuracion/evidencia disponible (ej. pantallas reales o dataFields del perfil); si no puedes determinarlos de forma segura, OMITELOS para que runtime los resuelva desde mobile.config/app.config. No hardcodees numeros de identificacion, canales ni nombres de apps.
  * Solo declara "otp" cuando el flujo REALMENTE requiere un codigo temporal (la pantalla/evidencia lo soporta); no lo inventes en flujos que no lo necesitan.
- BOTONES CON GATE (deshabilitados hasta cumplir una condicion): si un elemento del contexto tiene "gated": true, esta DESHABILITADO hasta cumplir su "enabledWhen". Un paso "click" sobre un boton deshabilitado FALLA. Reglas:
  * Happy path: primero genera los pasos que cumplen el gate (segun "enabledWhen") y LUEGO el "click" sobre el boton.
  * Escenarios NEGATIVOS (datos invalidos/incompletos que caen en "disabledWhen"): NO generes "click" sobre ese boton; genera un paso {"action":"assertDisabled","target":{...}} para validar que queda deshabilitado (ese es el resultado esperado del escenario negativo).
  * Opcional: usa {"action":"assertEnabled","target":{...}} para confirmar que el gate se cumplio antes de clickear.
- El primer paso de cada escenario debe ser siempre {"action":"launchApp"}.
- "expectedResult" es OBLIGATORIO en cada escenario — describe el resultado final esperado, no un paso mas.
- "preconditions" es un array de strings (puede ser vacio []) con lo que debe cumplirse antes de ejecutar el escenario.
- Genera tantos escenarios como sean necesarios para cubrir TODOS los criterios funcionales automatizables de la historia. Un escenario puede cubrir varios criterios solo si su flujo y su resultado esperado (oracle) son coherentes; no generes escenarios redundantes solo para aumentar la cantidad. No generes escenarios para requisitos NO ejecutables: si un criterio requiere una precondicion que el motor no puede inducir (por ejemplo un error tecnico o una condicion externa que no se puede forzar desde la UI), omite ese criterio y deja su cobertura para los escenarios restantes. Mantén cada paso MCP accionable y basado únicamente en la evidencia disponible (pantallas, elementos, flujos y criterios proporcionados).
- Si la historia NO tiene suficiente informacion (sin descripcion, sin criterios de aceptacion, texto vacio o irrelevante) para generar pasos con confianza razonable, NO inventes pasos genericos — agrega la historia al array "rejected" con una razon clara en "reason".
- RUTEO POR INTENCION (FLUJOS): si el contexto incluye una seccion "FLUJOS DE NAVEGACION", primero identifica a que flujo pertenece la historia comparando su texto (titulo/descripcion/criterios) con los "triggerKeywords" y la descripcion de cada flujo. Cuando la historia corresponda a un flujo, DEBES anteponer los "entrySteps" de ese flujo (justo despues del paso launchApp) para llegar a la pantalla correcta, y luego continuar con los pasos especificos de la historia usando los elementos de la pantalla destino de ese flujo. Los entrySteps son transiciones OBSERVADAS: incluyelos TODOS en orden y NUNCA saltes una pantalla intermedia que requiera una accion para avanzar (no colapses A -> B -> C en A -> C). Ejemplo: una historia de "validación del cliente / registro de nuevo usuario" NO empieza escribiendo usuario y contraseña en el login — empieza tocando el enlace de registro segun los entrySteps del flujo de registro.
- SELECTORES/DROPDOWNS: cualquier validacion de opciones disponibles de un selector debe ocurrir ANTES de seleccionar una opcion que cierre el selector. Abre el selector, ejecuta todas las assertVisible necesarias sobre las opciones mientras sigue abierto, y SOLO entonces selecciona la opcion requerida. No valides opciones ni intentes re-seleccionar despues de haber seleccionado (el selector ya esta cerrado y las demas opciones ya no son visibles). No selecciones dos veces la misma opcion.
- PERFILES DE DATOS FUNCIONALES (estado de negocio backend): si la historia o un criterio depende de un estado de negocio que NO se puede inducir desde la UI (cliente con un estado particular en el backend, cuenta con saldo, usuario ya registrado, entidad inexistente, etc.), genera el escenario normalmente. Reglas para "requiredDataProfile" y "requiresManualData":
  * Si existe un perfil en "PERFILES FUNCIONALES DISPONIBLES" que cubra exactamente el estado requerido: declara "requiredDataProfile" con ese nombre exacto y "requiresManualData": false.
  * Si el escenario depende de un estado funcional y NO existe un perfil compatible: omite "requiredDataProfile" y declara "requiresManualData": true. NUNCA inventes un nombre de perfil.
  * Si el escenario es puramente UI/formato (opciones visibles, formato invalido, campos incompletos, boton deshabilitado) y NO depende de un estado funcional: omite "requiredDataProfile" y declara "requiresManualData": false.
  * NUNCA rechazes un escenario por ausencia de perfil funcional. Los perfiles son una fuente opcional de datos precargados; su falta no impide la automatizacion.
  * NO inventes documentos, identificaciones, saldos, numeros ni valores de negocio para satisfacer un estado funcional. Los valores reales se resuelven en tiempo de ejecucion desde testData usando el perfil; tu solo declaras el nombre del perfil. "exampleValue" es solo una referencia de formato, nunca una garantia de estado de negocio.
  * Un escenario con "requiredDataProfile" no puede mezclar dos estados de negocio distintos; si la historia pide varios estados, genera un escenario por cada estado con su perfil correspondiente.
- COBERTURA DE CRITERIOS DE ACEPTACION: en cada escenario declara "coveredCriteria" como un array con los identificadores de los criterios de aceptacion de la historia que ese escenario cubre, tal como aparecen en el texto (por ejemplo "CA01", "Criterio 2", "AC3"). Un escenario puede cubrir uno o varios criterios. Si el escenario no corresponde a ningun criterio identificable, usa []. Ningun criterio de aceptacion debe quedar sin cubrir en silencio: si un criterio no puede automatizarse (rejected/incapaz), declara su identificador en el array "coveredCriteria" de la entrada correspondiente en "rejected" (cada entrada de "rejected" acepta "sourceIssueKey", "reason" y "coveredCriteria").
- STEP REQUIREMENT REFS: en cada escenario declara "stepRequirementRefs" como array de objetos { "stepIndex": 0, "requirementIds": ["CA01"] } que mapea el paso funcional (0-based, contando desde launchApp) al criterion o criterios que materializa directamente. Solo declara un ref cuando el paso ejecuta inequívocamente el criterion (click que realiza la accion requerida, fill que ingresa el dato principal). NO propages coveredCriteria automaticamente a cada paso. Si no puedes asignar un criterion inequivocamente a un paso, omite el ref para ese paso. Los IDs deben pertenecer al conjunto de coveredCriteria del escenario. Si la IA no puede determinar la asignacion con certeza, deja el array vacio.
- STEP DESTINATION EXPECTATIONS: si hay destination claims disponibles (seccion "DESTINATION CLAIMS DISPONIBLES"), en cada escenario declara "stepDestinationExpectations" como array de objetos { "stepIndex": 1, "destinationClaimId": "<id_del_claim>" } que asocia un paso a un claim preexistente. Solo asocia un claim cuando el paso produce inequivocamente un cambio de pantalla hacia ese destino. NO crees claims nuevos — solo referencia claims existentes. Si no hay claims disponibles, omite el array. El campo "requirementIds", "semanticIdentity", "kind", "source" y "trustLevel" se resuelven automaticamente desde el manifest — NO los incluyas en tu output.
- No incluyas ninguna explicacion fuera del objeto JSON.`;

function formatFlows(routeProfile: MobileRouteProfile): string {
  if (!routeProfile.flows || Object.keys(routeProfile.flows).length === 0) return "";

  const lines = [
    "## FLUJOS DE NAVEGACION (rutas por intencion)",
    "Identifica a que flujo pertenece la historia y antepon sus 'entrySteps' (despues de launchApp) para llegar a la pantalla correcta antes de los pasos especificos.",
    "",
    "REGLAS OBLIGATORIAS DE TRANSICION:",
    "- Los 'entrySteps' de un flujo son transiciones REALES OBSERVADAS (pantalla por pantalla). Cuando la historia corresponda a un flujo con entrySteps NO vacios, DEBES incluir TODOS los entrySteps en orden exacto, sin omitir ninguna pantalla intermedia.",
    "- PROHIBIDO colapsar o saltar una pantalla intermedia: si la secuencia observada es A -> B -> C, NO generes A -> C saltando B, aunque puedas inferir una ruta mas corta. Si una pantalla intermedia requiere una accion para continuar (p. ej. un boton 'Continuar' o 'Siguiente'), debes incluir esa accion antes de pasar a la siguiente pantalla.",
    "- Si el contexto de pantallas (PANTALLAS REALES CONOCIDAS o CONOCIMIENTO DE EJECUCIONES PREVIAS) muestra una pantalla intermedia entre la pantalla de entrada y la pantalla destino de la historia, y esa pantalla tiene acciones que permiten avanzar, trata esa transicion como obligatoria: nunca la omitas ni la fusiones con otra.",
    "- Solo considera obligatoria una transicion cuando la evidencia la soporta como secuencia continua; no inventes pasos de navegacion que no esten en la evidencia.",
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
      lines.push(`  DATOS OBLIGATORIOS de esta pantalla (SIEMPRE genera pasos para cada uno, sin importar el fraseo de la historia). Para campos (texto): el exampleValue es SOLO una referencia estructural del formato, no un dato fijo. Si por razones de negocio el escenario requiere un valor alternativo (usuario inexistente, no cliente, cuenta inexistente, documento no registrado, etc.), puedes cambiar el CONTENIDO pero debes CONSERVAR la estructura observable del exampleValue: misma cantidad de caracteres significativos y mismas posiciones/separadores. EXCEPCION: si el escenario o criterio de aceptacion prueba precisamente formato invalido, longitud invalida, caracteres invalidos o dato mal formado, entonces si se permite violar esa estructura:`);
      for (const df of screen.dataFields) {
        if (df.kind === "select") {
          const opts = (df.options ?? []).join(" | ");
          lines.push(`  - "${df.label}" (seleccion): usa la opcion por defecto "${df.defaultValue ?? df.options?.[0] ?? ""}" usando target ${JSON.stringify(df.applyTargetTemplate?.value.replace("{{value}}", df.defaultValue ?? df.options?.[0] ?? ""))}. Opciones validas: ${opts}. Este campo debe quedar resuelto dentro del escenario, pero NO agregues un click de seleccion redundante si el flujo ya contiene una seleccion equivalente de este mismo campo. Si la historia/criterio pide validar las opciones disponibles, haz TODAS las assertVisible sobre las opciones MIENTRAS el selector permanece ABIERTO y ANTES de seleccionar; luego selecciona exactamente UNA opcion y NO intentes validar opciones restantes despues de seleccionar (el selector se cierra). No selecciones dos veces consecutivas o semanticamente la misma opcion.`);
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

/**
 * Exposes the available functional data profile NAMES for the appSlug (never their
 * resolved testData values — those are resolved deterministically at precheck time). The AI
 * matches a backend/business-state scenario to one of these names when a compatible profile
 * exists, or omits the field when no profile covers the required state. Absence of a profile
 * never blocks scenario generation; the user supplies dataOverrides manually later.
 */
function formatFunctionalDataProfiles(routeProfile: MobileRouteProfile): string {
  const profiles = routeProfile.functionalDataProfiles;
  if (!profiles || Object.keys(profiles).length === 0) return "";
  const lines = [
    "## PERFILES FUNCIONALES DISPONIBLES (estados de negocio respaldados)",
    "Estos son los estados de negocio backend disponibles para declarar como requiredDataProfile. Si un escenario depende de un estado distinto a estos, igualmente genera el escenario — simplemente omite requiredDataProfile y el usuario proveera dataOverrides manuales.",
    ""
  ];
  for (const profileName of Object.keys(profiles)) {
    lines.push(`- ${profileName}`);
  }
  lines.push("");
  return lines.join("\n");
}

function formatIssue(issue: JiraIssueSource): string {
  const parts = [`## ${issue.key}: ${issue.summary}`];
  const description = issue.acceptanceCriteria || issue.description || "";
  if (description) {
    parts.push(description);
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
    if (screen.disabledTargets.length > 0) {
      // A disabled control is the screen telling us a precondition is still unmet. Saying so
      // explicitly is what lets the model notice that steps are missing before it.
      lines.push(
        `- Controles DESHABILITADOS en este estado: ${screen.disabledTargets.map((t) => `"${t}"`).join(", ")}. ` +
        `Un control deshabilitado significa que la pantalla exige acciones previas todavía no realizadas: ` +
        `el escenario debe incluir esos pasos ANTES de intentar usarlo.`,
      );
    }
    lines.push("");
  }
  return lines.join("\n").trim();
}

function formatDestinationClaimManifest(manifest: DestinationClaimDefinition[]): string {
  if (manifest.length === 0) return "";
  const lines = [
    "## DESTINATION CLAIMS DISPONIBLES",
    "Estos son los claims de destino validos que puedes referenciar en stepDestinationExpectations.",
    "NO crees claims nuevos. SOLO referencia estos claims por su destinationClaimId.",
    "",
  ];
  for (const claim of manifest) {
    lines.push(`- destinationClaimId: "${claim.destinationClaimId}"`);
    lines.push(`  requirementIds: [${claim.requirementIds.map((id) => `"${id}"`).join(", ")}]`);
    lines.push(`  semanticIdentity: "${claim.semanticIdentity}"`);
    lines.push(`  kind: "${claim.kind}"`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

export function buildMobileScenarioMessages(
  issue: JiraIssueSource,
  routeProfile?: MobileRouteProfile | null,
  learnedScreens?: MobileLearnedScreen[],
  destinationClaimManifest?: DestinationClaimDefinition[],
): AiMessage[] {
  const userParts = [
    "Genera pasos de prueba mobile para la siguiente historia de usuario:",
    "",
    formatIssue(issue)
  ];

  let flowsBlock = "";
  let routeBlock = "";
  let profilesBlock = "";
  let knowledgeBlock = "";
  let manifestBlock = "";

  if (routeProfile) {
    flowsBlock = formatFlows(routeProfile);
    if (flowsBlock) userParts.push("", flowsBlock);
    if (routeProfile.screens && Object.keys(routeProfile.screens).length > 0) {
      routeBlock = formatRouteProfile(routeProfile);
      userParts.push("", routeBlock);
    }
    profilesBlock = formatFunctionalDataProfiles(routeProfile);
    if (profilesBlock) userParts.push("", profilesBlock);
  }

  if (learnedScreens && learnedScreens.length > 0) {
    knowledgeBlock = formatLearnedKnowledge(learnedScreens);
    userParts.push("", knowledgeBlock);
  }

  if (destinationClaimManifest && destinationClaimManifest.length > 0) {
    manifestBlock = formatDestinationClaimManifest(destinationClaimManifest);
    userParts.push("", manifestBlock);
  }

  const systemContent = SYSTEM_PROMPT;
  const userContent = userParts.join("\n");

  const systemChars = systemContent.length;
  const huChars = userParts[2]?.length ?? 0;
  const instructionsChars = userParts[0].length + 2; // header + "\n\n"
  const routeProfileChars = flowsBlock.length + routeBlock.length + profilesBlock.length;
  const knowledgeChars = knowledgeBlock.length;
  const manifestChars = manifestBlock.length;
  const totalChars = systemChars + userContent.length;
  const estimatedTokens = Math.ceil(totalChars / 4);

  console.log(
    `[mobile:prompt-size] issue=${issue.key} ` +
    `totalChars=${totalChars} estimatedTokens=${estimatedTokens} ` +
    `systemChars=${systemChars} huChars=${huChars} instructionsChars=${instructionsChars} ` +
    `routeProfileChars=${routeProfileChars} knowledgeChars=${knowledgeChars} manifestChars=${manifestChars}`
  );

  return [
    { role: "system", content: systemContent },
    { role: "user", content: userContent }
  ];
}
