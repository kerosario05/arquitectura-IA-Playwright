export type StoryType =
  | "auth"
  | "transfer"
  | "query"
  | "form"
  | "navigation"
  | "report"
  | "config"
  | "unknown";

export type ProcessedJiraHu = {
  storyTitle: string;
  acceptanceCriteria: string;
  additionalContext: string;
  storyType: StoryType;
  hasCriteria: boolean;
};

const STORY_TYPE_PATTERNS: Record<StoryType, RegExp[]> = {
  auth: [
    /\blogin\b/i, /iniciar\s+sesi[oó]n/i, /autenti[cz]/i,
    /\botp\b/i, /c[eé]dula/i, /contrase[ñn]/i,
    /desbloqueo/i, /verificaci[oó]n/i, /acceso\s+(al\s+)?sistema/i
  ],
  transfer: [
    /transfer/i, /enviar\s+(dinero|fondos)/i, /\bpago\b/i,
    /\bmonto\b/i, /cuenta\s+destino/i, /beneficiario/i,
    /remesa/i, /depositar/i, /debitar/i
  ],
  query: [
    /consul/i, /\bsaldo\b/i, /historial/i, /movimiento/i,
    /estado\s+de\s+cuenta/i, /\bver\b.*cuenta/i, /visualizar/i,
    /\blistar\b/i, /\bextracto\b/i
  ],
  form: [
    /registrar/i, /\bcrear\b/i, /formulario/i, /actualizar\s+datos/i,
    /modificar/i, /solicitud/i, /apertura\s+de/i, /\beditar\b/i
  ],
  navigation: [
    /navegar/i, /ir\s+a\s+/i, /acceder\s+a/i,
    /men[uú]/i, /pantalla\s+principal/i, /secci[oó]n/i
  ],
  report: [
    /reporte/i, /informe/i, /exportar/i,
    /descargar/i, /\bpdf\b/i, /\bexcel\b/i, /generar\s+reporte/i
  ],
  config: [
    /configurar/i, /ajuste/i, /preferencia/i,
    /notificaci[oó]n/i, /alerta/i, /\bperfil\b/i, /cambiar\s+(pin|contrase)/i
  ],
  unknown: []
};

const NOISE_HEADERS = [
  /^historia\s+de\s+usuario/i,
  /^user\s+story/i,
  /^como\s+(un?\s+)?(usuario|cliente|administrador|operador)/i,
  /^alcance/i,
  /^scope/i,
  /^descripci[oó]n/i,
  /^description/i,
  /^contexto/i,
  /^context/i,
  /^notas?/i,
  /^notes?/i,
  /^objetivo/i,
  /^dependencias?/i,
  /^supuestos?/i,
  /^fuera\s+de\s+alcance/i,
  /^out\s+of\s+scope/i,
];

const CRITERIA_HEADERS = [
  /^criterios?\s+de\s+aceptaci[oó]n/i,
  /^acceptance\s+criteria/i,
  /^criterios?\s+de\s+aceptabilidad/i,
  /^condiciones?\s+de\s+aceptaci[oó]n/i,
  /^requisitos?\s+de\s+aceptaci[oó]n/i,
  /^criterios?:/i,
  /^criterios?\s+funcionales?/i,
];

function isNoise(line: string): boolean {
  return NOISE_HEADERS.some((re) => re.test(line.trim()));
}

function isCriteriaHeader(line: string): boolean {
  return CRITERIA_HEADERS.some((re) => re.test(line.trim()));
}

function isListItem(line: string): boolean {
  return /^[-*•►]|\d+[.)]\s/.test(line.trim());
}

function cleanListMarker(line: string): string {
  return line.replace(/^[-*•►\d.)]\s*/, "").trim();
}

function extractCriteriaSection(lines: string[]): { criteria: string[]; context: string[] } {
  const criteriaStart = lines.findIndex((l) => isCriteriaHeader(l));

  if (criteriaStart !== -1) {
    const criteriaLines: string[] = [];
    const contextLines: string[] = lines
      .slice(0, criteriaStart)
      .filter((l) => !isNoise(l) && l.trim().length > 2);

    for (let i = criteriaStart + 1; i < lines.length; i++) {
      const line = lines[i];
      if (isCriteriaHeader(line) || isNoise(line)) break;
      if (line.trim().length > 2) criteriaLines.push(cleanListMarker(line));
    }

    return { criteria: criteriaLines, context: contextLines };
  }

  // No explicit criteria header — try to extract list items as criteria
  const cleanLines = lines.filter((l) => !isNoise(l) && l.trim().length > 2);
  const listItems = cleanLines.filter(isListItem);
  const nonListLines = cleanLines.filter((l) => !isListItem(l));

  if (listItems.length >= 2) {
    return {
      criteria: listItems.map(cleanListMarker),
      context: nonListLines
    };
  }

  // Last resort: use Gherkin lines as criteria if present
  const gherkinLines = cleanLines.filter((l) =>
    /^(dado|given|cuando|when|entonces|then|y\s|and\s|pero|but)/i.test(l.trim())
  );
  if (gherkinLines.length > 0) {
    return {
      criteria: gherkinLines.map((l) =>
        l.replace(/^(dado|given|cuando|when|entonces|then|y|and|pero|but)\s+/i, "").trim()
      ),
      context: cleanLines.filter((l) =>
        !/^(dado|given|cuando|when|entonces|then|y\s|and\s|pero|but)/i.test(l.trim())
      )
    };
  }

  // No structure found — return everything as criteria
  return { criteria: cleanLines, context: [] };
}

export function detectStoryType(title: string, text: string): StoryType {
  const combined = `${title} ${text}`.toLowerCase();
  for (const [type, patterns] of Object.entries(STORY_TYPE_PATTERNS) as [StoryType, RegExp[]][]) {
    if (type === "unknown") continue;
    if (patterns.some((p) => p.test(combined))) return type;
  }
  return "unknown";
}

export function preprocessJiraHu(title: string, rawDescription: string): ProcessedJiraHu {
  const lines = rawDescription
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const { criteria, context } = extractCriteriaSection(lines);

  const acceptanceCriteria = criteria.join("\n").trim();
  const additionalContext = context.join("\n").trim();
  const storyType = detectStoryType(title, rawDescription);

  return {
    storyTitle: title,
    acceptanceCriteria,
    additionalContext,
    storyType,
    hasCriteria: acceptanceCriteria.length > 0
  };
}
