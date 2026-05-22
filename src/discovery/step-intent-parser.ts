export type StepIntentType =
  | "navigation_path"
  | "action_click"
  | "action_select"
  | "action_fill"
  | "action_submit"
  | "assertion"
  | "precondition_context"
  | "optional_action"
  | "setup_route"
  | "setup_authentication"
  | "composite_action"
  | "unknown";

type SplitFragment = {
  text: string;
  order: number;
};

export type ParsedStepIntent = {
  type: StepIntentType;
  originalText: string;
  normalizedText: string;
  path?: string[];
  actionTarget?: string;
  actionVerb?: string;
  context?: string;
  contextType?: string;
  preferredTarget?: string;
  isOptional?: boolean;
  priority: number;
  value?: string;
  valueKey?: string;
  valueKeys?: string[];
  valueSource?: string;
  associatedEntity?: string;
  semanticRole?: "product" | "card" | "option" | "category" | "item" | "section" | "unknown";
  relationContext?: string;
};

export type StepSetIntent = {
  setupIntents: ParsedStepIntent[];
  actionIntents: ParsedStepIntent[];
  assertionIntents: ParsedStepIntent[];
  preconditionContext?: string;
  navigationPath?: string[];
};

export type ActionTargetItem = {
  index: number;
  action: string;
  target: string;
  isOptional?: boolean;
  value?: string;
  valueKey?: string;
  valueSource?: FillValueSource;
  associatedEntity?: string;
  actionType?: StepIntentType;
  semanticRole?: "product" | "card" | "option" | "category" | "item" | "section" | "unknown";
  relationContext?: string;
};

export type FillValueSource = "literal" | "test_data" | "unknown";

const BOUNDARY_WORDS = [
  "click", "clic",
  "presionar", "tocar",
  "seleccionar", "escoger", "elegir",
  "abrir", "ingresar", "acceder",
  "esperar",
  "validar", "verificar", "comprobar", "confirmar", "revisar",
  "Opcional:", "Optional:"
];

const MODIFIER_PATTERNS = [
  /^preferiblemente\s+/i,
  /^idealmente\s+/i,
  /^de\s+preferencia\s+/i,
  /^por\s+ejemplo\s+/i
];

const ASSERTION_PREFIX_PATTERN = /^(?:validar|verificar|comprobar|confirmar|esperar|observar|revisar|should see|verify|validate|check|assert|wait for)\b/i;
const NAVIGATION_PREFIX_PATTERN = /^(?:abrir|ir a|navegar a|navegar hacia|acceder a|ingresar a|open|go to|navigate to|access)\b/i;

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['""«»]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseStepIntent(stepText: string, _context?: Record<string, unknown>): ParsedStepIntent[] {
  const intents: ParsedStepIntent[] = [];
  let trimmed = stepText.trim();
  if (!trimmed) return intents;

  // Strip leading step numbers like "1. " or "1) " or "N. "
  trimmed = trimmed.replace(/^\d+\s*[.)]\s*/, "").trim();
  if (!trimmed) return intents;

  const fragments = splitStepText(trimmed);

  for (const fragment of fragments) {
    const subFragments = splitByIntentBoundaries(fragment.text);

    for (let idx = 0; idx < subFragments.length; idx += 1) {
      let subText = subFragments[idx];
      if (/^(?:Opcional|Optional):\s*$/i.test(subText) && idx + 1 < subFragments.length) {
        subText = `${subText} ${subFragments[idx + 1]}`.trim();
        idx += 1;
      }
      const mixedParts = splitMixedActionNavigation(subText);
      for (const part of mixedParts) {
        const parsed = parseSingleIntent(part);
        if (parsed) {
          intents.push({ ...parsed, originalText: part });
        } else {
          intents.push({
            type: "unknown",
            originalText: part,
            normalizedText: normalizeText(part),
            priority: 0
          });
        }
      }
    }
  }

  return intents;
}

export function parseSingleIntent(text: string): ParsedStepIntent | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const normalized = normalizeText(trimmed);

  const setupResult = tryParseSetupRoute(trimmed, normalized);
  if (setupResult) return setupResult;

  const directiveResult = tryParseOptionalDirective(trimmed, normalized);
  if (directiveResult) return directiveResult;

  const precondResult = tryParsePreconditionContext(trimmed, normalized);
  if (precondResult) return precondResult;

  const assertionResult = tryParseAssertion(trimmed, normalized);
  if (assertionResult) return assertionResult;

  const pathResult = tryParseNavigationPathEnhanced(trimmed, normalized);
  if (pathResult) return pathResult;

  const optionalResult = tryParseOptionalAction(trimmed, normalized);
  if (optionalResult) return optionalResult;

  const clickResult = tryParseClickAction(trimmed, normalized);
  if (clickResult) return clickResult;

  const selectResult = tryParseSelectAction(trimmed, normalized);
  if (selectResult) return selectResult;

  const loginResult = tryParseLoginSetup(trimmed, normalized);
  if (loginResult) return loginResult;

  const compositeResult = tryParseCompositeAction(trimmed, normalized);
  if (compositeResult) return compositeResult;

  const fillResult = tryParseFillAction(trimmed, normalized);
  if (fillResult) return fillResult;

  const standaloneResult = tryParseStandaloneAction(trimmed, normalized);
  if (standaloneResult) return standaloneResult;

  return null;
}

const COMPOUND_PREFIXES: Record<string, string[]> = {
  "clic": ["hacer", "hace", "haz", "opcional:", "optional:"],
  "click": ["hacer", "hace", "haz", "opcional:", "optional:"],
  "validar": ["opcional:", "optional:"],
  "verificar": ["opcional:", "optional:"],
  "comprobar": ["opcional:", "optional:"],
  "confirmar": ["opcional:", "optional:"],
  "revisar": ["opcional:", "optional:"],
  "seleccionar": ["opcional:", "optional:"],
  "escoger": ["opcional:", "optional:"],
  "elegir": ["opcional:", "optional:"]
};

function isLetter(ch: string | undefined): boolean {
  if (!ch) return false;
  return /[a-zA-ZáéíóúñüÁÉÍÓÚÑÜ]/.test(ch);
}

export function splitByIntentBoundaries(text: string): string[] {
  if (!text || text.length < 3) return [text];

  const sorted = [...BOUNDARY_WORDS].sort((a, b) => b.length - a.length);
  const escaped = sorted.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = escaped.join("|");
  const regex = new RegExp(pattern, "gi");

  const splitPoints: number[] = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index === 0) continue;
    if (isInsideQuotes(text, match.index)) continue;

    const afterPos = match.index + match[0].length;
    if (afterPos < text.length && isLetter(text[afterPos])) continue;

    const matchedWord = match[0].toLowerCase();
    const prefixes = COMPOUND_PREFIXES[matchedWord];
    if (prefixes) {
      const before = text.slice(0, match.index);
      const trimmedBefore = before.trimEnd();
      const lastSpace = trimmedBefore.lastIndexOf(" ");
      const prevWord = lastSpace >= 0
        ? trimmedBefore.slice(lastSpace + 1).toLowerCase()
        : trimmedBefore.toLowerCase();
      if (prevWord && prefixes.includes(prevWord)) continue;
    }

    splitPoints.push(match.index);
  }

  if (splitPoints.length === 0) return [text];

  const uniquePoints = [...new Set(splitPoints)].sort((a, b) => a - b);

  const fragments: string[] = [];
  let start = 0;
  for (const point of uniquePoints) {
    if (point > start) {
      fragments.push(text.slice(start, point).trim());
      start = point;
    }
  }
  if (start < text.length) {
    fragments.push(text.slice(start).trim());
  }

  return fragments.filter(Boolean);
}

function isInsideQuotes(text: string, position: number): boolean {
  let inQuote = false;
  let quoteChar: string | null = null;

  for (let i = 0; i < Math.min(position, text.length); i++) {
    const ch = text[i];
    if ((ch === "'" || ch === '"') && (quoteChar === null || quoteChar === ch)) {
      if (inQuote && quoteChar === ch) {
        inQuote = false;
        quoteChar = null;
      } else if (!inQuote) {
        inQuote = true;
        quoteChar = ch;
      }
    }
  }

  return inQuote;
}

function splitStepText(text: string): SplitFragment[] {
  const protectedTokens = protectSplitSensitiveTokens(text);
  const sourceText = protectedTokens.protectedText;
  const fragments: SplitFragment[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar: string | null = null;
  let order = 0;

  for (let i = 0; i < sourceText.length; i++) {
    const ch = sourceText[i];

    if ((ch === "'" || ch === '"') && (quoteChar === null || quoteChar === ch)) {
      if (inQuote && quoteChar === ch) {
        inQuote = false;
        quoteChar = null;
      } else if (!inQuote) {
        inQuote = true;
        quoteChar = ch;
      }
      current += ch;
    } else if (ch === "." && !inQuote) {
      const trimmed = current.trim();
      if (trimmed) {
        fragments.push({ text: trimmed, order: order++ });
      }
      current = "";
    } else if (ch === "," && !inQuote) {
      const restTrimmed = sourceText.slice(i + 1).trim();
      const isModifier = MODIFIER_PATTERNS.some((mp) => mp.test(restTrimmed));
      if (isModifier) {
        current += ch;
      } else {
        const trimmed = current.trim();
        if (trimmed) {
          fragments.push({ text: trimmed, order: order++ });
        }
        current = "";
      }
    } else {
      current += ch;
    }
  }

  const trimmed = current.trim();
  if (trimmed) {
    fragments.push({ text: trimmed, order: order++ });
  }

  return fragments.map((fragment) => ({
    ...fragment,
    text: restoreProtectedTokens(fragment.text, protectedTokens.tokenMap)
  }));
}

function tryParseSetupRoute(text: string, normalized: string): ParsedStepIntent | null {
  const navVerbs = [
    "abrir", "acceder", "ingresar", "entrar", "navegar", "ir", "cargar",
    "open", "access", "enter", "launch", "navigate", "go", "load"
  ];

  const targetKeywords =
    /\b(url|portal|aplicaci[oó]n|sistema|sitio|web|p[aá]gina|home|inicio|iniciar\s+s[eé]sion|application|app|site|page|homepage|website)\b/i;

  const verbPattern = new RegExp(
    `^(?:${navVerbs.join("|")})(?:\\s+(?:a|al|the|el|la|los|las))?\\s+`,
    "i"
  );

  if (!verbPattern.test(text)) return null;
  if (!targetKeywords.test(text)) return null;

  const urlMatch = text.match(/https?:\/\/[^\s,.]+/i);

  return {
    type: "setup_route",
    originalText: text,
    normalizedText: normalized,
    actionTarget: urlMatch ? urlMatch[0] : "APP_BASE_URL",
    priority: 6
  };
}

function extractQuotedTarget(text: string): string | null {
  const match = text.match(/['""]([^\n'""]+)['""]/);
  return match ? match[1].trim() : null;
}

function stripTrailingPeriod(s: string): string {
  return s.replace(/\.+$/, "").trim();
}

function tryParseOptionalDirective(text: string, normalized: string): ParsedStepIntent | null {
  const pattern = /^(?:Opcional|Optional):\s*(.+)$/i;
  const match = text.match(pattern);
  if (!match) return null;

  const rest = match[1].trim();
  if (!rest) return null;

  const quotedTarget = extractQuotedTarget(rest);

  return {
    type: "optional_action",
    originalText: text,
    normalizedText: normalized,
    actionTarget: quotedTarget ?? rest,
    isOptional: true,
    priority: 7
  };
}

function tryParsePreconditionContext(text: string, normalized: string): ParsedStepIntent | null {
  const pattern = /^desde\s+(el\s+)?(listado\s+de|pantalla\s+de|seccion\s+de|modulo\s+de|la\s+pantalla\s+de|el\s+listado\s+de|el\s+modulo\s+de)\s+(.+?)$/i;
  const match = text.match(pattern);
  if (!match) return null;

  const contextContent = match[3]?.trim();
  const contextType = match[2]?.toLowerCase().trim().replace(/^(el|la)\s+/, "") ?? "general";

  if (!contextContent) return null;

  return {
    type: "precondition_context",
    originalText: text,
    normalizedText: normalized,
    context: contextContent,
    contextType,
    priority: 8
  };
}

function tryParseNavigationPath(text: string, normalized: string): ParsedStepIntent | null {
  const navVerbs = [
    "abrir", "ir a", "navegar a", "navegar hacia",
    "acceder a", "ingresar a", "dirigirse a", "entrar a"
  ];

  const hasNavVerb = navVerbs.some((verb) => {
    const pattern = new RegExp(`^${verb}\\s+`, "i");
    return pattern.test(normalized);
  });

  const hasSeparator = /[>→/]/.test(text) || /->/.test(text);
  if (!hasNavVerb && !hasSeparator) return null;

  const verbPattern = /^(?:abrir|ir a|navegar a|navegar hacia|acceder a|ingresar a|dirigirse a|entrar a)\s+/i;
  const pathText = hasNavVerb ? text.replace(verbPattern, "").trim() : text;

  const segments = pathText
    .split(/\s*(?:>|→|\/|->)\s*/)
    .map((s) => s.replace(/['""«»]/g, "").trim())
    .filter(Boolean);

  if (segments.length >= 2) {
    return {
      type: "navigation_path",
      originalText: text,
      normalizedText: normalized,
      path: segments,
      priority: 10
    };
  }

  if (segments.length === 1 && hasNavVerb) {
    return {
      type: "action_click",
      originalText: text,
      normalizedText: normalized,
      actionTarget: segments[0],
      actionVerb: "abrir",
      priority: 5
    };
  }

  return null;
}

function tryParseNavigationPathEnhanced(text: string, normalized: string): ParsedStepIntent | null {
  if (/^.+@.+\..+/i.test(text) || /https?:\/\/|www\./i.test(text)) return null;

  const normalizedForMatch = normalized
    .replace(/["\u201C\u201D]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  const moduleAccessPattern = /^(?:acceder|ingresar|abrir|entrar|ir)\s+(?:al|a\s+el|a\s+la|a\s+los|a\s+las|a|el|la|los|las)\s+(?:modulo|seccion|menu|aplicacion|pantalla)\s+['"]?([^'"]+?)['"]?\s*\.?$/i;
  const moduleMatch = normalizedForMatch.match(moduleAccessPattern);
  if (moduleMatch) {
    const target = moduleMatch[1].trim();
    if (target && target.length < 150 && !/[>\/]/.test(target)) {
      const originalTarget = extractQuotedTarget(text) || target;
      return {
        type: "action_click",
        originalText: text,
        normalizedText: normalized,
        actionTarget: originalTarget,
        actionVerb: "acceder",
        priority: 5
      };
    }
  }

  const directAccessPattern = /^(?:acceder|ingresar|abrir|entrar|ir)\s+(?:a|al)\s+['"]?([^'"]+?)['"]?\s*\.?$/i;
  const directMatch = normalizedForMatch.match(directAccessPattern);
  if (directMatch) {
    const target = directMatch[1].trim();
    if (target && target.length < 150 && !isAssertionLike(target) && !/[>\/]/.test(target)) {
      const originalTarget = extractQuotedTarget(text) || target;
      return {
        type: "action_click",
        originalText: text,
        normalizedText: normalized,
        actionTarget: originalTarget,
        actionVerb: "acceder",
        priority: 5
      };
    }
  }

  if (isAssertionLike(normalized)) return null;

  const parsed = tryParseNavigationPath(text, normalized);
  if (!parsed) return null;

  if (parsed.type === "navigation_path" && parsed.path) {
    return {
      ...parsed,
      path: parsed.path.map((segment) => cleanActionTarget(segment)).filter(Boolean)
    };
  }

  if (parsed.type === "action_click" && parsed.actionTarget) {
    return {
      ...parsed,
      actionTarget: cleanActionTarget(parsed.actionTarget)
    };
  }

  return parsed;
}

function tryParseOptionalAction(text: string, normalized: string): ParsedStepIntent | null {
  const optionalPatterns = [
    /^seleccionar\s+(?:una\s+)?(?:tarjeta|opcion|elemento|item)?,?\s*(?:preferiblemente|idealmente|de\s+preferencia)\s+(?:['""])?(.+?)(?:['""])?$/i,
    /^escoger\s+(?:una\s+)?(?:tarjeta|opcion|elemento|item)?,?\s*(?:preferiblemente|idealmente|de\s+preferencia)\s+(?:['""])?(.+?)(?:['""])?$/i,
    /^elegir\s+(?:una\s+)?(?:tarjeta|opcion|elemento|item)?,?\s*(?:preferiblemente|idealmente|de\s+preferencia)\s+(?:['""])?(.+?)(?:['""])?$/i
  ];

  for (const pattern of optionalPatterns) {
    const match = text.match(pattern);
    if (match) {
      let target = stripTrailingPeriod(match[1].trim());
      if (target) {
        return {
          type: "optional_action",
          originalText: text,
          normalizedText: normalized,
          actionTarget: target,
          isOptional: true,
          priority: 7
        };
      }
    }
  }

  return null;
}

function tryParseClickAction(text: string, normalized: string): ParsedStepIntent | null {
  const clickVerbs = [
    "clic en", "hacer clic en", "click en", "click on", "click",
    "presionar", "tocar"
  ];

  const verbPattern = new RegExp(
    `^(?:${clickVerbs.join("|")})\\s+`,
    "i"
  );

  const verbMatch = text.match(verbPattern);
  if (!verbMatch) return null;

  const afterVerb = text.slice(verbMatch[0].length).trim();

  // Pattern: action target 'X' associated with entity 'Y'
  const associatedPattern = text.match(
    /^(?:clic en|hacer clic en|click en|click on|click|presionar|tocar)\s+['""]([^'""]+)['""]\s+(?:asociado|associat\w*|relacionado|related)\s+(?:a|al|con|to|with|the)?\s*(?:\w+\s+)*\s*['""]([^'""]+)['""]/i
  );
  if (associatedPattern) {
    const target = cleanActionTarget(associatedPattern[1]);
    const entity = associatedPattern[2].trim();
    return {
      type: "action_click",
      originalText: text,
      normalizedText: normalized,
      actionTarget: target,
      associatedEntity: entity,
      actionVerb: verbMatch[0].trim().toLowerCase(),
      priority: 5
    };
  }

  // Pattern: producto visible relacionado con 'X' dentro de la categoría 'Y'
  const relationalPattern = text.match(
    /^(?:clic en|hacer clic en|click en|click on|click|presionar|tocar)\s+(?:el|la|los|las)?\s*(producto|card|opci[oó]n|elemento|secci[oó]n|categor[ií]a|[ií]tem)\s*(?:visible\s+)?(?:relacionad[oa]|asociad[oa]|vinculad[oa])\s*(?:con|a)\s*['""]([^'""]+)['""](?:\s+(?:dentro\s+de|en)\s+(?:la\s+)?(categor[ií]a\s+seleccionada|secci[oó]n\s+actual|contexto\s+actual|[^'""]+))?/i
  );
  if (relationalPattern) {
    const rawRole = relationalPattern[1].toLowerCase().replace(/[óo]/g, "o").replace(/[ií]/g, "i");
    let semanticRole: "product" | "card" | "option" | "category" | "item" | "section" | "unknown" = "unknown";
    if (rawRole.includes("product")) semanticRole = "product";
    else if (rawRole.includes("card")) semanticRole = "card";
    else if (rawRole.includes("opcion")) semanticRole = "option";
    else if (rawRole.includes("categoria")) semanticRole = "category";
    else if (rawRole.includes("seccion")) semanticRole = "section";
    else if (rawRole.includes("elemento") || rawRole.includes("item")) semanticRole = "item";

    const target = cleanActionTarget(relationalPattern[2]);
    const relationContext = relationalPattern[3]?.trim();

    return {
      type: "action_click",
      originalText: text,
      normalizedText: normalized,
      actionTarget: target,
      semanticRole,
      relationContext,
      actionVerb: verbMatch[0].trim().toLowerCase(),
      priority: 5
    };
  }

  const quoted = extractQuotedTarget(afterVerb);
  if (quoted) {
    return {
      type: "action_click",
      originalText: text,
      normalizedText: normalized,
      actionTarget: cleanActionTarget(quoted),
      actionVerb: verbMatch[0].trim().toLowerCase(),
      priority: 5
    };
  }

  const raw = cleanActionTarget(stripTrailingPeriod(afterVerb));
  if (raw && raw.length < 100) {
    return {
      type: "action_click",
      originalText: text,
      normalizedText: normalized,
      actionTarget: raw,
      actionVerb: verbMatch[0].trim().toLowerCase(),
      priority: 5
    };
  }

  return null;
}

function tryParseSelectAction(text: string, normalized: string): ParsedStepIntent | null {
  const selectVerbs = [
    "seleccionar", "escoger", "elegir"
  ];

  const verbPattern = new RegExp(
    `^(?:${selectVerbs.join("|")})\\s+`,
    "i"
  );

  const verbMatch = text.match(verbPattern);
  if (!verbMatch) return null;

  const afterVerb = text.slice(verbMatch[0].length).trim();

  const quoted = extractQuotedTarget(afterVerb);
  if (quoted) {
    return {
      type: "action_select",
      originalText: text,
      normalizedText: normalized,
      actionTarget: cleanActionTarget(quoted),
      actionVerb: verbMatch[0].trim().toLowerCase(),
      priority: 5
    };
  }

  const raw = cleanActionTarget(stripTrailingPeriod(afterVerb));
  if (raw && raw.length < 100) {
    return {
      type: "action_select",
      originalText: text,
      normalizedText: normalized,
      actionTarget: raw,
      actionVerb: verbMatch[0].trim().toLowerCase(),
      priority: 5
    };
  }

  return null;
}

function tryParseLoginSetup(text: string, normalized: string): ParsedStepIntent | null {
  // Pattern: Iniciar sesión con el dato 'A' y 'B'
  // English: Log in with data 'A' and 'B'
  const loginPatterns = [
    // Spanish: iniciar sesión con el dato 'A' y 'B'
    /^(?:iniciar\s+sesi[oó]n|autenticarse|ingresar\s+con\s+credenciales|acceder\s+con\s+credenciales)\s+con\s+(?:el\s+)?dato\s+['""]([^'""]+)['""]\s+(?:y\s+|and\s+)(?:el\s+)?dato\s+['""]([^'""]+)['""]/i,
    // Spanish: iniciar sesión con usuario 'A' y contraseña 'B'
    /^(?:iniciar\s+sesi[oó]n|autenticarse)\s+con\s+(?:usuario|user|usuario_valido)\s+['""]([^'""]+)['""]\s+(?:y\s+|and\s+)(?:contraseña|password|pass|contrasena|clave)\s+['""]([^'""]+)['""]/i,
    // English: log in with data 'A' and 'B' (with or without second 'data')
    /^(?:log\s+in|sign\s+in|login|authenticate)\s+with\s+(?:test\s+)?data\s+['""]([^'""]+)['""]\s+(?:and\s+)(?:test\s+)?(?:data\s+)?['""]([^'""]+)['""]/i,
    // English: log in with username 'A' and password 'B'
    /^(?:log\s+in|sign\s+in|login|authenticate)\s+with\s+(?:username|user)\s+['""]([^'""]+)['""]\s+(?:and\s+)(?:password|pass)\s+['""]([^'""]+)['""]/i,
    // Generic: iniciar sesión / log in (without explicit keys)
    /^(?:iniciar\s+sesi[oó]n|autenticarse|ingresar\s+con\s+credenciales\s+v[aá]lidas|acceder\s+con\s+credenciales\s+v[aá]lidas|log\s+in|sign\s+in|login|authenticate)\s*$/i,
    // iniciar sesión with ... (no quotes, generic)
    /^(?:iniciar\s+sesi[oó]n|autenticarse)\s+con\s+(?:el\s+)?dato\s+['""]([^'""]+)['""]\s+(?:y\s+|and\s+)(?:el\s+)?(?:dato)?\s*['""]?([^'""]+)?['""]?/i,
  ];

  for (const pattern of loginPatterns) {
    const match = text.match(pattern);
    if (match) {
      const result: ParsedStepIntent = {
        type: "setup_authentication",
        originalText: text,
        normalizedText: normalized,
        priority: 6
      };
      // Extract keys if present (match groups 1 and 2)
      if (match[1] !== undefined) {
        result.valueKey = match[1].trim();
      }
      if (match[2] !== undefined) {
        result.valueKeys = [result.valueKey ?? "", match[2].trim()].filter(Boolean);
      }
      // If no explicit keys, use default credential keys
      if (!result.valueKeys || result.valueKeys.length === 0) {
        result.valueKeys = ["usuario_valido", "contrasena_valida"];
      }
      // If only one key captured, provide both defaults
      if (result.valueKeys && result.valueKeys.length === 1) {
        result.valueKeys = [result.valueKeys[0], "contrasena_valida"];
      }
      return result;
    }
  }

  return null;
}

function tryParseCompositeAction(text: string, normalized: string): ParsedStepIntent | null {
  // Pattern: Agregar 'X' al carrito / Add 'X' to cart / Remove 'X' from cart
  const compositePatterns = [
    /^(?:agregar|añadir|add)\s+['""]([^'""]+)['""]\s+(?:al|a|to|the|en\s+el)\s+(?:carrito|cart|basket|lista|list|bolsa)/i,
    /^(?:quitar|remover|remove|delete)\s+['""]([^'""]+)['""]\s+(?:del|de|from|the)\s+(?:carrito|cart|basket|lista|list)/i,
    /^(?:seleccionar|select)\s+['""]([^'""]+)['""]\s+(?:para|for|to)\s+(?:agregar|add)\s+(?:al|to|the)\s+(?:carrito|cart)/i,
  ];

  for (const pattern of compositePatterns) {
    const match = text.match(pattern);
    if (match) {
      const entity = match[1].trim();
      return {
        type: "composite_action",
        originalText: text,
        normalizedText: normalized,
        actionTarget: entity,
        associatedEntity: entity,
        actionVerb: "add_to_cart",
        priority: 5
      };
    }
  }

  return null;
}

function tryParseFillAction(text: string, normalized: string): ParsedStepIntent | null {
  const fillVerbs = [
    "ingresar", "digitar", "escribir", "completar", "llenar",
    "type", "enter", "fill"
  ];

  const verbPattern = new RegExp(
    `^(?:${fillVerbs.join("|")})\\s+`,
    "i"
  );

  const verbMatch = text.match(verbPattern);
  if (!verbMatch) return null;

  const verb = verbMatch[0].trim().toLowerCase();

  // === Pattern 1: dato 'KEY' en campo 'FIELD' (test data) ===
  // Spanish: Escribir el valor del dato 'KEY' en el campo 'FIELD'
  // English: Type the value of data 'KEY' into field 'FIELD'
  const testDataToField = text.match(
    /^(?:escribir|ingresar|digitar|type|enter)\s+el\s+valor\s+del\s+dato\s+['""]([^'""]+)['""]\s+en\s+(?:el\s+)?campo\s+['""]([^'""]+)['""]/i
  );
  if (testDataToField) {
    return {
      type: "action_fill",
      originalText: text,
      normalizedText: normalized,
      actionTarget: testDataToField[2],
      actionVerb: verb,
      valueKey: testDataToField[1],
      valueSource: "test_data",
      priority: 5
    };
  }

  const englishDataToField = text.match(
    /^(?:type|enter)\s+the\s+value\s+of\s+(?:test\s+)?data\s+['""]([^'""]+)['""]\s+(?:into|in)\s+(?:the\s+)?field\s+['""]([^'""]+)['""]/i
  );
  if (englishDataToField) {
    return {
      type: "action_fill",
      originalText: text,
      normalizedText: normalized,
      actionTarget: englishDataToField[2],
      actionVerb: verb,
      valueKey: englishDataToField[1],
      valueSource: "test_data",
      priority: 5
    };
  }

  // === Pattern 2: campo 'FIELD' con dato 'KEY' (test data) ===
  // Spanish: Completar el campo 'FIELD' con el dato 'KEY'
  // English: Fill field 'FIELD' with data 'KEY'
  const campoConDato = text.match(
    /^(?:completar|llenar|fill)\s+(?:el\s+)?campo\s+['""]([^'""]+)['""]\s+con\s+(?:el\s+)?(?:valor\s+del\s+)?dato\s+['""]([^'""]+)['""]/i
  );
  if (campoConDato) {
    return {
      type: "action_fill",
      originalText: text,
      normalizedText: normalized,
      actionTarget: campoConDato[1],
      actionVerb: verb,
      valueKey: campoConDato[2],
      valueSource: "test_data",
      priority: 5
    };
  }

  const fillFieldWithData = text.match(
    /^fill\s+field\s+['""]([^'""]+)['""]\s+with\s+(?:test\s+)?data\s+['""]([^'""]+)['""]/i
  );
  if (fillFieldWithData) {
    return {
      type: "action_fill",
      originalText: text,
      normalizedText: normalized,
      actionTarget: fillFieldWithData[1],
      actionVerb: verb,
      valueKey: fillFieldWithData[2],
      valueSource: "test_data",
      priority: 5
    };
  }

  // === Pattern 3: 'VALUE' en campo 'FIELD' (literal value) ===
  // Spanish: Escribir 'VALUE' en el campo 'FIELD'
  // English: Type 'VALUE' into field 'FIELD'
  const literalToField = text.match(
    /^(?:escribir|ingresar|digitar|type|enter)\s+['""]([^'""]+)['""]\s+en\s+(?:el\s+)?campo\s+['""]([^'""]+)['""]/i
  );
  if (literalToField) {
    return {
      type: "action_fill",
      originalText: text,
      normalizedText: normalized,
      actionTarget: literalToField[2],
      actionVerb: verb,
      value: literalToField[1],
      valueSource: "literal",
      priority: 5
    };
  }

  const englishLiteralToField = text.match(
    /^(?:type|enter)\s+['""]([^'""]+)['""]\s+(?:into|in)\s+(?:the\s+)?field\s+['""]([^'""]+)['""]/i
  );
  if (englishLiteralToField) {
    return {
      type: "action_fill",
      originalText: text,
      normalizedText: normalized,
      actionTarget: englishLiteralToField[2],
      actionVerb: verb,
      value: englishLiteralToField[1],
      valueSource: "literal",
      priority: 5
    };
  }

  // === Pattern 4: campo 'FIELD' con 'VALUE' (literal) ===
  const campoConLiteral = text.match(
    /^(?:completar|llenar|fill)\s+(?:el\s+)?campo\s+['""]([^'""]+)['""]\s+con\s+['""]([^'""]+)['""]/i
  );
  if (campoConLiteral) {
    return {
      type: "action_fill",
      originalText: text,
      normalizedText: normalized,
      actionTarget: campoConLiteral[1],
      actionVerb: verb,
      value: campoConLiteral[2],
      valueSource: "literal",
      priority: 5
    };
  }

  // === Pattern 5: Simple fill (existing behavior) ===
  const afterVerb = text.slice(verbMatch[0].length).trim();

  const quoted = extractQuotedTarget(afterVerb);
  if (quoted) {
    return {
      type: "action_fill",
      originalText: text,
      normalizedText: normalized,
      actionTarget: quoted,
      actionVerb: verb,
      priority: 5,
      valueSource: "unknown"
    };
  }

  const raw = cleanActionTarget(stripTrailingPeriod(afterVerb));
  if (raw && raw.length < 100) {
    return {
      type: "action_fill",
      originalText: text,
      normalizedText: normalized,
      actionTarget: raw,
      actionVerb: verb,
      priority: 5,
      valueSource: "unknown"
    };
  }

  return null;
}

function tryParseAssertion(text: string, normalized: string): ParsedStepIntent | null {
  const assertPatterns = [
    /^(?:validar|verificar|comprobar|confirmar|revisar)\s+(.+)/i,
    /^(?:esperar|observar|wait\s+for|should\s+see|verify|validate|check|assert)\s+(.+)/i,
    /^(?:debe\s+mostrar|se\s+debe\s+mostrar|se\s+muestra|deberia\s+mostrar)\s+(.+)/i,
    /^(?:asegurar\s+que|chequear\s+que)\s+(.+)/i,
    /^(?:esperar\s+que\s+est[eé]\s+visible|esperar\s+visible|wait\s+for\s+visible|expect\s+visible)\s+(.+)/i,
  ];

  for (const pattern of assertPatterns) {
    const match = text.match(pattern);
    if (match) {
      const raw = stripTrailingPeriod(match[1].trim());
      if (!raw || raw.length >= 150) continue;

      const quotedTarget = extractQuotedTarget(raw);
      const target = quotedTarget ?? raw;

      return {
        type: "assertion",
        originalText: text,
        normalizedText: normalized,
        actionTarget: target,
        actionVerb: "validar",
        priority: 3
      };
    }
  }

  return null;
}

export function isAssertionLike(text: string): boolean {
  return ASSERTION_PREFIX_PATTERN.test(normalizeText(text));
}

export function cleanActionTarget(target: string): string {
  return target
    .replace(/\u00a0/g, " ")
    .replace(/^[\s>.:;\-–—]+/, "")
    .replace(/[\s>.:;\-–—]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitMixedActionNavigation(text: string): string[] {
  const match = text.match(/^(.*?(?:clic en|hacer clic en|click en|click on|click|presionar|tocar)\s+.+?)\s*(?:>|->)\s*(.+)$/i);
  if (!match) return [text];

  const actionPart = cleanActionTarget(match[1] ?? "");
  const navigationPart = (match[2] ?? "").trim();
  if (!actionPart || !navigationPart) return [text];
  if (!NAVIGATION_PREFIX_PATTERN.test(normalizeText(navigationPart))) return [text];

  return [actionPart, navigationPart];
}

function protectSplitSensitiveTokens(text: string): { protectedText: string; tokenMap: Map<string, string> } {
  const tokenMap = new Map<string, string>();
  let index = 0;
  const patterns = [
    /https?:\/\/[^\s,;]+/gi,
    /www\.[^\s,;]+/gi,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    /\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi
  ];

  let protectedText = text;
  for (const pattern of patterns) {
    protectedText = protectedText.replace(pattern, (value) => {
      const key = `__TOKEN_${index++}__`;
      tokenMap.set(key, value);
      return key;
    });
  }

  return { protectedText, tokenMap };
}

function restoreProtectedTokens(text: string, tokenMap: Map<string, string>): string {
  let restored = text;
  for (const [key, value] of tokenMap.entries()) {
    restored = restored.replaceAll(key, value);
  }
  return restored;
}

const STANDALONE_ACTION_VERBS = [
  "continuar",
  "confirmar",
  "siguiente",
  "atrás",
  "atras",
  "cancelar",
  "guardar",
  "enviar",
  "aceptar",
  "rechazar",
  "salir",
  "cerrar",
  "buscar",
  "filtrar",
  "limpiar",
  "resetear",
  "continue",
  "submit",
  "cancel",
  "save",
  "back",
  "next",
  "search",
  "apply"
];

function tryParseStandaloneAction(text: string, normalized: string): ParsedStepIntent | null {
  const normalizedLower = normalized.toLowerCase();
  const trimmed = text.trim().replace(/\.$/, "").trim();
  const trimmedNormalized = normalizeText(trimmed).toLowerCase();

  for (const verb of STANDALONE_ACTION_VERBS) {
    if (trimmedNormalized === verb || trimmedNormalized === verb.toLowerCase()) {
      return {
        type: "action_click",
        originalText: trimmed,
        normalizedText: normalized,
        actionTarget: trimmed.charAt(0).toUpperCase() + trimmed.slice(1),
        actionVerb: verb,
        priority: 5
      };
    }
  }

  return null;
}

export function classifyStepSet(steps: ParsedStepIntent[]): StepSetIntent {
  const result: StepSetIntent = {
    setupIntents: [],
    actionIntents: [],
    assertionIntents: []
  };

  for (const intent of steps) {
    if (intent.type === "navigation_path" || intent.type === "precondition_context" || intent.type === "setup_route" || intent.type === "setup_authentication") {
      result.setupIntents.push(intent);
      if (intent.type === "precondition_context" && intent.context) {
        result.preconditionContext = intent.context;
      }
      if (intent.type === "navigation_path" && intent.path) {
        result.navigationPath = intent.path;
      }
    } else if (intent.type === "assertion" && !intent.isOptional) {
      result.assertionIntents.push(intent);
    } else if (
      intent.type === "action_click" ||
      intent.type === "action_select" ||
      intent.type === "action_fill" ||
      intent.type === "action_submit" ||
      intent.type === "composite_action" ||
      intent.type === "optional_action"
    ) {
      result.actionIntents.push(intent);
    }
  }

  return result;
}
