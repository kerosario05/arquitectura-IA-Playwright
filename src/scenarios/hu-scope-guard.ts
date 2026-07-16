import type { JiraIssueSource } from "./scenario-types";
import type { ScenarioPathSelection } from "./scenario-path-selector";
import type { CoverageContract, CoverageContractItem } from "./scenario-types";

/**
 * Functional scope classification for a HU.
 * Determines what kinds of scenarios should be generated.
 */
export type HuFunctionalScope =
  | "entry_navigation"      // Entry screen, welcome, menu navigation (NO products)
  | "product_inquiry"       // Query single product info (balance, details, statement)
  | "product_management"    // Multiple products, transfers, payments, operations
  | "product_operations"    // Complex product operations (new account, app, settings)
  | "system_admin"          // System features (auth, profile, settings)
  | "unknown";              // Could not classify

/**
 * Result of HU scope evaluation.
 * NEW: Extracts functional scope + allowed terms directly from HU text.
 * Gating decisions based on actual HU content, not classification.
 */
export interface HuScopeGuardResult {
  functionalScope: HuFunctionalScope;
  allowedTermsFromHu: string[];          // Terms extracted from HU: buttons, options, labels, actions
  blockedExpansionTerms: string[];        // Terms that trigger catalog expansion (not in HU = blocked)
  allowsCatalogExpansion: boolean;       // false if HU doesn't explicitly request product catalog
  allowsProductSeeds: boolean;            // false if HU doesn't mention specific products
  allowsSelectedProductPath: boolean;    // false if HU describes entry/navigation only
  allowsFallbackProductCoverage: boolean; // false if no product scope mentioned
  allowsAppKnowledgeHints: boolean;      // true if app.knowledge can augment, but not override
  confidence: "high" | "medium" | "low";
  diagnostics: {
    matchedPatterns: string[];
    keywordMatches: string[];
    warnings: string[];
  };
}

/**
 * Alternative option flows detected in HU.
 * Represents distinct user paths/choices with different expected outcomes.
 * Used to ensure scenario generation covers all main options.
 */
export interface OptionFlow {
  optionLabel: string;          // User-visible option name (extracted from HU)
  expectedResult: string;        // What happens when user selects this option
  requiresAuth?: boolean;        // Does this path require authentication
  source: "hu" | "inferred";     // Where detection came from
}

/**
 * HU option flows detection result
 */
export interface HuOptionFlowsResult {
  flows: OptionFlow[];
  totalFlows: number;
  confidence: "high" | "medium" | "low";
  diagnostics: string[];
}

/**
 * Evaluate HU scope to guard scenario generation.
 *
 * CRITICAL: NEW approach - Extract allowed terms directly from HU text.
 * No classification-based gating. HU content drives what's allowed.
 *
 * Process:
 * 1. Extract actual terms from HU (buttons, options, labels, actions)
 * 2. Detect functional scope (for diagnostic purposes)
 * 3. Gate catalog/seeds/path/fallback based on extracted terms + scope
 * 4. Blocked terms come from app context (catalog, routeProfile), not hardcoded
 * 5. app.knowledge is hint-only, not authority
 *
 * @param issue - Jira/HU context
 * @param pathSelection - Previously selected path (for refinement)
 * @param appSlug - App slug for loading app context (catalog, routeProfile, app.knowledge)
 * @returns Scope guard result with extracted terms + gating decisions
 */
export function evaluateHuScopeGuard(
  issue: JiraIssueSource | null,
  pathSelection?: ScenarioPathSelection,
  appSlug?: string
): HuScopeGuardResult {
  if (!issue) {
    return buildUnknownScope();
  }

  // Build searchable corpus
  const corpus = buildSearchCorpus(issue);

  // Detect functional scope (for diagnostics + some gating)
  const detection = detectFunctionalScope(corpus, issue);

  // Extract allowed terms directly from HU
  const allowedTerms = extractAllowedTermsFromHu(issue);

  // Build guard result: scope + extracted terms + dynamic gating rules
  const guard = applyGuardRules(detection, allowedTerms, appSlug);

  console.log(
    `[hu-scope-boundary] issue=${issue.key} scope=${guard.functionalScope} ` +
    `catalog=${guard.allowsCatalogExpansion} seeds=${guard.allowsProductSeeds} ` +
    `path=${guard.allowsSelectedProductPath} fallbackProduct=${guard.allowsFallbackProductCoverage}`
  );

  const allowedTermsStr = guard.allowedTermsFromHu.slice(0, 5).join(",");
  const blockedTermsStr = guard.blockedExpansionTerms.slice(0, 3).join(",");
  console.log(
    `[hu-scope-boundary] allowedTerms=${guard.allowedTermsFromHu.length} ` +
    `[${allowedTermsStr}${guard.allowedTermsFromHu.length > 5 ? "..." : ""}] ` +
    `blockedExpansion=${guard.blockedExpansionTerms.length} [${blockedTermsStr}${guard.blockedExpansionTerms.length > 3 ? "..." : ""}]`
  );

  return guard;
}

/**
 * Build searchable corpus from HU
 */
function buildSearchCorpus(issue: JiraIssueSource): string {
  const parts: string[] = [];
  if (issue.summary) parts.push(issue.summary);
  if (issue.description) parts.push(issue.description);
  if (issue.acceptanceCriteria) parts.push(issue.acceptanceCriteria);
  if (issue.labels) parts.push(issue.labels.join(" "));
  if (issue.components) parts.push(issue.components.join(" "));

  return parts
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Extract allowed terms directly from HU text.
 * NEW: Looks for concrete terms: buttons, options, labels, actions, expected results.
 *
 * Examples:
 * - "Iniciar", "Siguiente", "Atrás", "Confirmar" (action buttons)
 * - "Información de productos", "Transacciones y servicios" (menu options)
 * - "pantalla inicial", "¿Qué deseas realizar hoy?" (UI labels)
 * - "no mostrar información financiera" (business rules)
 */
function extractAllowedTermsFromHu(issue: JiraIssueSource): string[] {
  const terms = new Set<string>();
  const text = [
    issue.summary,
    issue.description,
    issue.acceptanceCriteria,
    ...(issue.labels || []),
  ]
    .filter(Boolean)
    .join(" ");

  // Extract quoted phrases and common UI terms
  const quoted = text.match(/"([^"]+)"/g) || [];
  quoted.forEach(q => {
    const term = q.replace(/"/g, "").trim();
    if (term.length > 2) terms.add(term);
  });

  // Extract action verbs + nouns (common patterns)
  const actionPatterns = [
    /(?:hacer clic|click|pulsar|presionar|seleccionar|elegir)\s+(?:")?([^"\n,.]+)(?:")?/gi,
    /botón\s+(?:")?([^"\n,.]+)(?:")?/gi,
    /opción\s+(?:")?([^"\n,.]+)(?:")?/gi,
    /pantalla\s+(?:de\s+)?(?:")?([^"\n,.]+)(?:")?/gi,
    /menú\s+(?:")?([^"\n,.]+)(?:")?/gi,
    /campo\s+(?:")?([^"\n,.]+)(?:")?/gi,
  ];

  for (const pattern of actionPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const term = match[1]?.trim().replace(/[,.:;]/g, "");
      if (term && term.length > 2) terms.add(term);
    }
  }

  // Extract common UI keywords and module names
  const keywords = [
    // Navigation/Entry
    "iniciar", "inicio", "bienvenida", "menú", "navegación", "pantalla", "flujo",
    // Actions
    "siguiente", "anterior", "atrás", "continuar", "confirmar", "aceptar", "cancelar",
    // Common sections (if mentioned in HU text)
    ...["información de productos", "transacciones y servicios", "servicios", "consultas", "operaciones"]
      .filter(k => text.includes(k)),
    // Business rules (if mentioned as key phrases)
    ...["financiera", "datos", "validación", "confirmación"].filter(k => text.includes(k)),
  ];

  keywords.forEach(k => terms.add(k));

  // Filter out generic terms
  const filtered = Array.from(terms).filter(
    t => t.length > 1 && !/^\d+$/.test(t) && t !== " "
  );

  return filtered;
}


/**
 * Detect functional scope from corpus
 */
function detectFunctionalScope(
  corpus: string,
  issue: JiraIssueSource
): {
  scope: HuFunctionalScope;
  confidence: "high" | "medium" | "low";
  matchedPatterns: string[];
  keywordMatches: string[];
} {
  const matched: string[] = [];
  const keywords: string[] = [];

  // CRITICAL: Detect entry_navigation scope FIRST
  // These HUs describe ONLY navigation/menu/entry - NO product operations
  const entryPatterns = [
    /pantalla\s+inicial|welcome\s+screen/i,
    /menú\s+principal|main\s+menu/i,
    /navegación|navigation/i,
    /acceso\s+(?:a\s+)?(?:pantallas|funcionalidades)/i,
    /flujo\s+de\s+entrada|entry\s+flow/i,
    /pantalla\s+de\s+inicio|home\s+screen/i,
    /página\s+de\s+bienvenida|welcome\s+page/i,
    /seleccionar\s+(?:opción|funcionalidad|servicio)/i,
  ];

  let entryScore = 0;
  for (const pattern of entryPatterns) {
    if (pattern.test(corpus)) {
      entryScore++;
      matched.push(pattern.source.slice(0, 30));
    }
  }

  // CRITICAL: entry_navigation detection is based on STRUCTURE, not vocabulary
  // Do NOT use domain-specific keywords (producto, saldo, transacción, etc.) to gate entry_navigation
  // Those keywords are domain-specific and belong in app context (catalog, routeProfile, app.knowledge)
  // Core detection uses only functional patterns: entry screens, menus, navigation

  // entry_navigation: high entry score = clear entry/menu/navigation structure
  if (entryScore >= 2) {
    return {
      scope: "entry_navigation",
      confidence: "high",
      matchedPatterns: matched,
      keywordMatches: keywords,
    };
  }

  // Detect product_inquiry (single product, non-transactional)
  const inquiryPatterns = [
    /(?:consultar|ver|visualizar)\s+(?:saldo|detalles?|informacion)/i,
    /(?:visualizar|ver)\s+estado\s+de\s+cuenta/i,
    /(?:extracto|estado)\s+(?:de\s+)?(?:transacciones|movimientos)/i,
    /informacion\s+de\s+producto/i,
    /detalles?(?:\s+del)?\s+(?:producto|tarjeta|prestamo)/i,
  ];

  let inquiryScore = 0;
  for (const pattern of inquiryPatterns) {
    if (pattern.test(corpus)) {
      inquiryScore++;
      matched.push(pattern.source.slice(0, 30));
    }
  }

  // Detect transactional patterns (NOT inquiry)
  const transactionPatterns = [
    /transferencia|transfer/i,
    /pago|payment/i,
    /solicitar|request/i,
    /aplicar|apply/i,
    /contratar|hire|acquire/i,
    /cambiar|change/i,
    /modificar|modify/i,
  ];

  let transactionScore = 0;
  for (const pattern of transactionPatterns) {
    if (pattern.test(corpus)) {
      transactionScore++;
      matched.push(pattern.source.slice(0, 30));
    }
  }

  // product_inquiry: mentions query/view + no transactions
  if (inquiryScore >= 2 && transactionScore === 0) {
    return {
      scope: "product_inquiry",
      confidence: "high",
      matchedPatterns: matched,
      keywordMatches: keywords,
    };
  }

  // product_management: transactional operations indicate multiple products/operations
  if (transactionScore >= 2 && entryScore === 0) {
    return {
      scope: "product_management",
      confidence: "high",
      matchedPatterns: matched,
      keywordMatches: keywords,
    };
  }

  // Detect system_admin (auth, profile, security)
  const adminPatterns = [
    /autenticacion|authentication|login/i,
    /perfil|profile/i,
    /configuracion|settings|configuration/i,
    /seguridad|security/i,
    /contrasena|password/i,
    /datos\s+personales|personal\s+data/i,
  ];

  let adminScore = 0;
  for (const pattern of adminPatterns) {
    if (pattern.test(corpus)) {
      adminScore++;
      matched.push(pattern.source.slice(0, 30));
    }
  }

  if (adminScore >= 2 && transactionScore === 0 && inquiryScore === 0) {
    return {
      scope: "system_admin",
      confidence: "high",
      matchedPatterns: matched,
      keywordMatches: keywords,
    };
  }

  // Fallback: entry_navigation if we have entry patterns and no functional scope detected
  if (entryScore >= 1 && transactionScore === 0 && inquiryScore === 0 && adminScore === 0) {
    return {
      scope: "entry_navigation",
      confidence: "medium",
      matchedPatterns: matched,
      keywordMatches: keywords,
    };
  }

  // Fallback: unknown
  return {
    scope: "unknown",
    confidence: "low",
    matchedPatterns: matched,
    keywordMatches: keywords,
  };
}

/**
 * Load potential expansion terms from app context (catalog, routeProfile, app.knowledge).
 * These are terms that COULD be relevant but are NOT mentioned in the HU.
 * Built dynamically per app - NO hardcoded vocabulary.
 * Sync version: tries lightweight discovery without heavy imports.
 */
function loadAppExpansionCandidatesSync(appSlug?: string): {
  terms: string[];
  source: "catalog" | "routeProfile" | "appKnowledge" | "none";
} {
  if (!appSlug) {
    return { terms: [], source: "none" };
  }

  try {
    // Try loadCatalogSync if available
    const { loadCatalogSync } = require("../catalog/catalog-loader");
    const catalog = loadCatalogSync(appSlug);

    if (catalog?.products && catalog.products.length > 0) {
      const productNames = catalog.products
        .flatMap((p: any) => [p.name, p.category, ...(p.fields || [])])
        .filter(Boolean);
      return { terms: Array.from(new Set(productNames.map((t: any) => String(t)))), source: "catalog" };
    }

    // Fallback: try routeProfile
    const { loadRouteProfileSync } = require("../profiles/route-profile-loader");
    const routeProfile = loadRouteProfileSync(appSlug);

    if (routeProfile?.targetPaths && routeProfile.targetPaths.length > 0) {
      const pathNames = routeProfile.targetPaths.flatMap((p: any) => [p.label, p.category]);
      return { terms: Array.from(new Set(pathNames.filter(Boolean).map((t: any) => String(t)))), source: "routeProfile" };
    }
  } catch {
    // Silent: if app context not available, no blocked terms
  }

  return { terms: [], source: "none" };
}

/**
 * Apply guard rules based on detected scope + extracted allowed terms + app context.
 * CRITICAL: blockedExpansionTerms are built dynamically from app context,
 * not from hardcoded vocabulary.
 */
function applyGuardRules(
  detection: ReturnType<typeof detectFunctionalScope>,
  allowedTerms: string[],
  appSlug?: string
): HuScopeGuardResult {
  const allowedTermsLower = allowedTerms.map(t => t.toLowerCase());

  // Load app context candidates (NOT hardcoded vocabulary)
  const appContext = loadAppExpansionCandidatesSync(appSlug);

  // Terms from app that are NOT mentioned in HU = blocked
  const blockedExpansion = appContext.terms
    .filter(term => !allowedTermsLower.some(aTerm => aTerm.includes(term.toLowerCase())))
    .slice(0, 50); // Limit to prevent huge logs

  const baseResult = {
    functionalScope: detection.scope,
    confidence: detection.confidence,
    diagnostics: {
      matchedPatterns: detection.matchedPatterns,
      keywordMatches: detection.keywordMatches,
      warnings: appContext.source !== "none" ? [] : ["No app context available for blockedExpansionTerms"],
    },
  };

  // Log blockedExpansionTerms source for diagnostics
  if (appContext.source !== "none") {
    console.log(
      `[hu-scope-boundary] blockedExpansionSource=${appContext.source} blockedExpansion=${blockedExpansion.length}`
    );
  }

  // Gate catalog expansion: only if HU explicitly mentions terms from app context
  const mentionedAppTerms = appContext.terms.filter(term =>
    allowedTermsLower.some(aTerm => aTerm.includes(term.toLowerCase()))
  );
  const allowsCatalog = mentionedAppTerms.length > 0 && detection.scope !== "entry_navigation" && detection.scope !== "system_admin";

  // Gate seeds: only if HU mentions specific products/categories
  const allowsSeeds = mentionedAppTerms.length > 0 && (detection.scope === "product_management" || detection.scope === "product_operations" || detection.scope === "product_inquiry");

  // Gate path selection: only if HU describes product-specific flows
  const allowsPath = allowsSeeds && detection.scope !== "product_inquiry";

  // Gate fallback coverage: only if product scope is clear
  const allowsFallback = mentionedAppTerms.length > 0 && (detection.scope === "product_management" || detection.scope === "product_operations");

  return {
    ...baseResult,
    allowedTermsFromHu: allowedTerms,
    blockedExpansionTerms: blockedExpansion,
    allowsCatalogExpansion: allowsCatalog,
    allowsProductSeeds: allowsSeeds,
    allowsSelectedProductPath: allowsPath,
    allowsFallbackProductCoverage: allowsFallback,
    allowsAppKnowledgeHints: true,  // Always allow app.knowledge as hint, never as authority
  };
}

/**
 * Build result for unknown scope (fallback)
 */
function buildUnknownScope(): HuScopeGuardResult {
  return {
    functionalScope: "unknown",
    allowedTermsFromHu: [],
    blockedExpansionTerms: [],
    allowsCatalogExpansion: true,
    allowsProductSeeds: true,
    allowsSelectedProductPath: true,
    allowsFallbackProductCoverage: false,
    allowsAppKnowledgeHints: true,
    confidence: "low",
    diagnostics: {
      matchedPatterns: [],
      keywordMatches: [],
      warnings: ["No HU provided - using conservative defaults"],
    },
  };
}

/**
 * Detect alternative option flows in HU.
 * Finds distinct user choices/paths with different expected outcomes.
 * Works for any domain: "Si selecciona X, el sistema Y" → OptionFlow
 * CRITICAL: optionLabel = clickable option name (NOT result), expectedResult = consequence
 */
export function detectOptionFlows(issue: JiraIssueSource): HuOptionFlowsResult {
  if (!issue) {
    return { flows: [], totalFlows: 0, confidence: "low", diagnostics: ["No HU provided"] };
  }

  const corpus = [issue.summary, issue.description, issue.acceptanceCriteria]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  const flows: OptionFlow[] = [];
  const diagnostics: string[] = [];

  // Pattern 1: "Si [cliente|usuario] selecciona "<option>", [sistema] <result>"
  // CRITICAL: Capture option BETWEEN "selecciona" and "," with clear boundaries
  const ifSelectPattern = /si\s+(?:el\s+)?(?:cliente|usuario)\s+selecciona\s+(?:[""]|"|')?([^""\n,'".]+)(?:[""]|"|')?\s*,\s*(?:(?:el\s+)?sistema\s+)?(?:debe\s+)?([^.\n]+)/gi;
  let match;
  while ((match = ifSelectPattern.exec(corpus)) !== null) {
    let optionLabel = match[1]?.trim().replace(/[,.:;]/g, "").replace(/^\s+|\s+$/g, "");
    const resultRaw = match[2]?.trim().replace(/[,.:;]/g, "").replace(/^\s+|\s+$/g, "");

    // Skip if optionLabel is too generic or empty
    if (!optionLabel || optionLabel.length < 2 || /^el\s+|^del\s+|^debe\s+|^que\s+/.test(optionLabel)) {
      continue;
    }

    // Limit optionLabel to first phrase (avoid capturing result text)
    if (optionLabel.length > 60) {
      optionLabel = optionLabel.split(/\s+and\s+|\s+o\s+|\s+u\s+/)[0];
    }

    const expectedResult = resultRaw && resultRaw.length > 3 ? resultRaw : null;
    if (optionLabel && optionLabel.length > 2 && expectedResult) {
      const requiresAuth = /autenticaci[óo]n|identificaci[óo]n|login|validaci[óo]n\s+de\s+(?:cliente|usuario)|acceso\s+seguro|flujo\s+de\s+autenticaci[óo]n/i.test(expectedResult);
      if (!flows.some(f => f.optionLabel.toLowerCase() === optionLabel.toLowerCase())) {
        flows.push({ optionLabel, expectedResult, requiresAuth, source: "hu" });
        diagnostics.push(`detected_if_pattern: option="${optionLabel}"`);
      }
    }
  }

  // Pattern 2: "Opción <name>: <result>" where colon separates option name from consequence
  // CRITICAL: Text BEFORE colon = optionLabel (the clickable option)
  const optionColonPattern = /opci[óo]n\s+(?:[""]|"|')?([^""\n:,'".]+)(?:[""]|"|')?\s*:\s*([^.\n]+)/gi;
  while ((match = optionColonPattern.exec(corpus)) !== null) {
    let optionLabel = match[1]?.trim().replace(/[,.:;]/g, "").replace(/^\s+|\s+$/g, "");
    const resultRaw = match[2]?.trim().replace(/[,.:;]/g, "").replace(/^\s+|\s+$/g, "");

    if (!optionLabel || optionLabel.length < 2) continue;

    // Limit to first phrase
    if (optionLabel.length > 60) {
      optionLabel = optionLabel.split(/\s+and\s+|\s+o\s+|\s+u\s+/)[0];
    }

    const expectedResult = resultRaw && resultRaw.length > 3 ? resultRaw : null;
    if (optionLabel && optionLabel.length > 2 && expectedResult) {
      if (!flows.some(f => f.optionLabel.toLowerCase() === optionLabel.toLowerCase())) {
        const requiresAuth = /autenticaci[óo]n|identificaci[óo]n|login|validaci[óo]n\s+de\s+(?:cliente|usuario)|acceso\s+seguro|flujo\s+de\s+autenticaci[óo]n/i.test(expectedResult);
        flows.push({ optionLabel, expectedResult, requiresAuth, source: "hu" });
        diagnostics.push(`detected_option_colon: option="${optionLabel}"`);
      }
    }
  }

  // Pattern 3: "Cuando [cliente|usuario] selecciona "<option>" → <result>" (bullet format)
  // CRITICAL: Capture option between "selecciona" and logical boundary (→, :, or end)
  const whenSelectPattern = /cuando\s+(?:el\s+)?(?:cliente|usuario)\s+selecciona\s+(?:[""]|"|')?([^""\n,'".→:]+)(?:[""]|"|')?\s*(?:→|:|,)?\s*([^.\n]+)/gi;
  while ((match = whenSelectPattern.exec(corpus)) !== null) {
    let optionLabel = match[1]?.trim().replace(/[,.:;]/g, "").replace(/^\s+|\s+$/g, "");
    const resultRaw = match[2]?.trim().replace(/[,.:;]/g, "").replace(/^\s+|\s+$/g, "");

    if (!optionLabel || optionLabel.length < 2) continue;

    // Limit to first phrase
    if (optionLabel.length > 60) {
      optionLabel = optionLabel.split(/\s+and\s+|\s+o\s+|\s+u\s+/)[0];
    }

    const expectedResult = resultRaw && resultRaw.length > 3 ? resultRaw : null;
    if (optionLabel && optionLabel.length > 2 && expectedResult) {
      if (!flows.some(f => f.optionLabel.toLowerCase() === optionLabel.toLowerCase())) {
        const requiresAuth = /autenticaci[óo]n|identificaci[óo]n|login|validaci[óo]n\s+de\s+(?:cliente|usuario)|acceso\s+seguro|flujo\s+de\s+autenticaci[óo]n/i.test(expectedResult);
        flows.push({ optionLabel, expectedResult, requiresAuth, source: "hu" });
        diagnostics.push(`detected_when_pattern: option="${optionLabel}"`);
      }
    }
  }

  const confidence = flows.length > 0 ? (flows.length >= 2 ? "high" : "medium") : "low";

  if (flows.length > 0) {
    console.log(`[hu-option-flows] issue=${issue.key} options=${flows.length}`);
    for (const flow of flows) {
      console.log(
        `[hu-option-flows] optionLabel="${flow.optionLabel}" expectedResult="${flow.expectedResult.substring(0, 60)}" requiresAuth=${flow.requiresAuth}`
      );
    }
  }

  return {
    flows,
    totalFlows: flows.length,
    confidence,
    diagnostics,
  };
}

/**
 * Build coverage contract from HU: mandatory scenario requirements
 * Ensures AI generates scenarios for all critical paths
 */
export function buildCoverageContract(
  issue: JiraIssueSource | null,
  optionFlows?: { flows: OptionFlow[]; totalFlows: number }
): CoverageContract {
  const issueKey = issue?.key || "UNKNOWN";
  const corpus = [issue?.summary, issue?.description, issue?.acceptanceCriteria]
    .filter(Boolean).join("\n");
  const lower = corpus.toLowerCase();

  // --- Extract initial action (first interactive element) ---
  let initialAction: string | undefined;
  const actionKeywords = ["iniciar", "ingresar", "entrar", "acceder", "comenzar", "login", "start", "begin"];
  for (const kw of actionKeywords) {
    const re = new RegExp(`["""']?(${kw})["""']?`, "i");
    const m = re.exec(corpus);
    if (m) {
      initialAction = m[1];
      // Capitalize first letter
      initialAction = initialAction.charAt(0).toUpperCase() + initialAction.slice(1);
      break;
    }
  }

  // --- Extract initial screen elements (logo, saludo, bienvenida, etc.) ---
  const initialScreenEls: string[] = [];
  const screenPatterns = [
    /logo/i, /saludo/i, /bienvenid[ao]/i, /mensaje\s+de\s+bienvenida/i,
    /t[ií]tulo/i, /encabezado/i, /imagen/i, /nombre\s+del\s+(portal|sistema|kiosko)/i
  ];
  // Check if HU describes a landing/initial/welcome screen
  const hasInitialScreenDesc = /pantalla\s+(inicial|principal|bienvenida)/i.test(lower) ||
    /muestra\s+(un[a]?\s+)?(logo|saludo|bienvenida)/i.test(lower);
  for (const pat of screenPatterns) {
    if (pat.test(lower)) {
      // Extract the matched term
      const match = pat.exec(lower);
      if (match) {
        const term = match[0].charAt(0).toUpperCase() + match[0].slice(1);
        if (!initialScreenEls.includes(term)) {
          initialScreenEls.push(term);
        }
      }
    }
  }

  // --- Initial screen item ---
  const initialScreenItems: CoverageContractItem[] = [];
  if (hasInitialScreenDesc || initialScreenEls.length > 0 || /inicial/i.test(lower)) {
    initialScreenItems.push({
      id: "initial_screen",
      type: "initial_screen",
      label: "Display and validate initial screen elements",
      initialAction,
      initialScreenElements: initialScreenEls.length > 0 ? initialScreenEls.slice(0, 5) : undefined,
      automatable: true,
      required: true,
      source: "hu",
    });
  }

  // --- Extract post-action question (what appears after selecting initial action) ---
  let postActionQuestion: string | undefined;
  const questionMatch = lower.match(/((?:¿\s*)?\w[\w\s,;:áéíóúñ]+\?)/i);
  if (questionMatch) {
    const q = questionMatch[1].trim();
    if (/(deseas|quieres|prefieres|opciones|seleccionar|elegir|realizar|desea|quiere)/i.test(q)) {
      postActionQuestion = q;
    }
  }

  // --- Blocked without initial action (navigation guard) ---
  const blockedWithoutAction: CoverageContractItem[] = [];
  const blockedPatterns = [
    /no\s+(debe|puede|deber[íi]a)\s+.*?(avanzar|acceder|continuar|pasar|ingresar)\s+(sin|a menos)/i,
    /no\s+(se\s+)?(muestra|aparece|accede)\s+(sin|hasta)/i,
    /requiere\s+(seleccionar|hacer\s+clic\s+en|presionar)\s+["""']?iniciar["""']?/i,
    /bloquead[oao]\s+(sin|hasta)/i,
    /no\s+(se\s+)?(puede|debe)\s+(continuar|avanzar)\s+(a\s+)?(la\s+)?(siguiente|pantalla|opci[oó]n)/i,
    /no\s+debe\s+permitirse\s+avanzar\s+sin/i
  ];
  for (const pat of blockedPatterns) {
    if (pat.test(lower)) {
      blockedWithoutAction.push({
        id: "blocked_without_initial_action",
        type: "blocked_without_initial_action",
        label: `Validate that user cannot advance without selecting "${initialAction || "initial action"}"`,
        initialAction,
        postActionQuestion,
        automatable: true,
        required: true,
        source: "hu",
      });
      break;
    }
  }

  // --- Post-initial-action screen (screen after first click) ---
  const postActionScreens: CoverageContractItem[] = [];
  const postActionPatterns = [
    /(despu[eé]s\s+de|luego\s+de|al\s+seleccionar|al\s+hacer\s+clic|una\s+vez\s+que)\s+.*(?:iniciar|ingresar).*?(?:muestra|aparece|presenta|redirige)/i,
    /(segunda\s+pantalla|pantalla\s+(siguiente|posterior|de\s+opciones|de\s+bienvenida|principal))/i,
    /logo.*bienvenida.*(?:pregunta|opci[oó]n)/i,
    /bienvenid[ao]\s+(a|al)\s+(portal|sistema|kiosko).*\?(?:\s|$)/i,
  ];
  for (const pat of postActionPatterns) {
    if (pat.test(lower)) {
      // Extract post-action elements from context
      const postEls: string[] = [];
      const postTerms = [/logo/i, /bienvenid[ao]/i, /pregunta/i, /opcion/i, /opci[oó]n/i];
      for (const t of postTerms) {
        if (t.test(lower)) {
          const match = t.exec(lower);
          if (match) {
            const term = match[0].charAt(0).toUpperCase() + match[0].slice(1);
            if (!postEls.includes(term)) postEls.push(term);
          }
        }
      }
      postActionScreens.push({
        id: "post_initial_action_screen",
        type: "post_initial_action_screen",
        label: "Validate post-initial-action screen with options",
        initialAction,
        postActionElements: postEls.length > 0 ? postEls.slice(0, 5) : undefined,
        automatable: true,
        required: true,
        source: "hu",
      });
      break;
    }
  }

  // --- Option flows as mandatory coverage items ---
  const optionFlowItems: CoverageContractItem[] = [];
  if (optionFlows && optionFlows.flows && optionFlows.flows.length > 0) {
    for (let i = 0; i < optionFlows.flows.length; i++) {
      const flow = optionFlows.flows[i];
      optionFlowItems.push({
        id: `option_${i}`,
        type: "option_flow",
        label: `Select "${flow.optionLabel}" and validate "${flow.expectedResult}"`,
        initialAction,
        optionLabel: flow.optionLabel,
        expectedResult: flow.expectedResult,
        requiresAuth: flow.requiresAuth,
        automatable: true,
        required: true,
        source: "hu",
      });
    }
  }

  // --- Negative rules: validations of what should NOT appear ---
  // Only match display-specific patterns: "no debe mostrarse X", "no debe aparecer X", etc.
  // NOT generic "no debe" which could match "no debe permitirse avanzar sin..."
  const negativeRules: CoverageContractItem[] = [];
  const acLower = issue?.acceptanceCriteria?.toLowerCase() ?? "";
  const descLower = issue?.description?.toLowerCase() ?? "";
  const combinedNegCorpus = [acLower, descLower].join("\n");

  const negativeDisplayPatterns = [
    /no\s+(debe|deber[íi]a)\s+(mostrarse|aparecer|ser\s+visible)\s+(.+?)(?:\s+(?:en|a|para|cuando|si|de|por|sin|con|[.,;!?\n])|$)/i,
    /en\s+ning[uú]n\s+caso\s+(debe|deber[íi]a)\s+(mostrarse|aparecer)\s+(.+?)(?:\s+(?:en|a|para|cuando|si|de|por|sin|con|[.,;!?\n])|$)/i,
    /no\s+(se\s+)?(muestra|aparece|es\s+visible)\s+(.+?)(?:\s+(?:en|a|para|cuando|si|de|por|sin|con|[.,;!?\n])|$)/i,
    /no\s+(debe|deber[íi]a)\s+(contener|incluir)\s+(.+?)(?:\s+(?:en|a|para|cuando|si|de|por|sin|con|[.,;!?\n])|$)/i,
    /no\s+(mostrar|visualizar|permitir|permita|bloquear|presentar)\s+(la\s+)?(opci[oó]n|informaci[oó]n|datos|contenido|pantalla|elemento|valor)/i,
    /nunca\s+(mostrar|visualizar|presentar|aparecer)\s+(la\s+)?(opci[oó]n|informaci[oó]n|datos|contenido|valor)/i,
    /no\s+(se\s+)?debe\s+(permitir|bloquear|mostrar)\s+(la\s+)?/i,
  ];

  for (const pat of negativeDisplayPatterns) {
    const m = pat.exec(combinedNegCorpus);
    if (m) {
      // Captured term is always the last capture group
      let negativeTerm = m[m.length - 1].trim();
      // Clean up leading/trailing quotes and whitespace
      negativeTerm = negativeTerm.replace(/^["""'\s]+/, "").replace(/["""'\s]+$/, "").trim();
      // Remove leading "la", "el", "los", "las" articles for cleaner extraction
      negativeTerm = negativeTerm.replace(/^(la|el|los|las|un|una|unos|unas)\s+/i, "").trim();
      if (negativeTerm.length > 80) {
        negativeTerm = negativeTerm.substring(0, 80).replace(/\s+\S*$/, "");
      }
      if (negativeTerm && negativeTerm.length > 3) {
        negativeRules.push({
          id: `negative_rule_${negativeRules.length}`,
          type: "negative_rule",
          label: `Validate that restricted content does not appear`,
          negativeTerm,
          automatable: true,
          required: true,
          source: "hu",
        });
      }
      break; // Only one negative rule per HU
    }
  }

  // --- Functional HU items (list, detail, format, failures, etc.) ---
  const funcNavigationItems: CoverageContractItem[] = [];
  const funcListScreens: CoverageContractItem[] = [];
  const funcSelectionFlows: CoverageContractItem[] = [];
  const funcSingleItemShortcuts: CoverageContractItem[] = [];
  const funcDetailFields: CoverageContractItem[] = [];
  const funcFormatRules: CoverageContractItem[] = [];
  const funcActionOptions: CoverageContractItem[] = [];
  const funcConditionalAlerts: CoverageContractItem[] = [];
  const funcFailureCases: CoverageContractItem[] = [];

  // navigation_item: options/modules/actions declared in HU
  const navPatterns = [
    /(opciones|m[oó]dulos|acciones|funcionalidades)\s+(disponibles|principales|del\s+m(?:e|é)nu)/i,
    /(seleccionar|acceder\s+a|elegir|ingresar\s+a)\s+(un[oa]|el|la|los|las)\s+(opci[oó]n|m[oó]dulo|secci[oó]n)/i,
    /(opci[oó]n|m[oó]dulo|secci[oó]n|pantalla)\s+(de\s+)?(consulta|detalle|listado|formulario|configuraci[oó]n)/i,
  ];
  for (const pat of navPatterns) {
    if (pat.test(lower)) {
      funcNavigationItems.push({
        id: `navigation_item_${funcNavigationItems.length}`,
        type: "navigation_item",
        label: `Navigate to and validate the declared option/module`,
        automatable: true,
        required: true,
        source: "hu",
      });
      break;
    }
  }

  // list_screen: HU mentions listing, records, products, accounts, documents, contracts
  const listPatterns = [
    /(listad[o0]|lista\s+de|muestra\s+los|visualiza\s+(los|las|un)|relaci[oó]n\s+de)\s+(registros|productos|cuentas|documentos|solicitudes|contratos|elementos|p[oó]lizas)/i,
    /(mostrar|presentar|visualizar|listar)\s+(todos|los|varios|m[úu]ltiples)\s+(producto|registro|cuenta|documento|contrato|elemento)/i,
    /pantalla\s+de\s+(listado|resultados|b[uú]squeda|consulta\s+de\s+productos)/i,
    /muestra\s+listado/i,
    /muestra\s+(una\s+)?lista\s+(de\s+)?/i,
    /\blistado\s+de\s+(elementos|it[eé]ms|registros|contratos|productos|cuentas|solicitudes)/i,
  ];
  for (const pat of listPatterns) {
    if (pat.test(lower)) {
      funcListScreens.push({
        id: `list_screen_${funcListScreens.length}`,
        type: "list_screen",
        label: `Validate list/record display with expected items`,
        automatable: true,
        required: true,
        source: "hu",
      });
      break;
    }
  }
  if (funcListScreens.length > 0) console.log(`[coverage-contract] extractedListScreens count=${funcListScreens.length}`);

  // selection_flow: HU mentions selecting an item from a list
  const selectionPatterns = [
    /(seleccionar|seleccione|selecciona|elegir|elige|elija|escoger|escoge|escoja|hacer\s+click\s+en)\s+(un[oa]|el|la)\s+(elemento|registro|producto|cuenta|documento|contrato|[a-záéíóúñ]+\s*[a-záéíóúñ]*)\s+(del|de\s+la|de\s+los)\s+(listado|lista|relaci[oó]n)/i,
    /(al\s+)?(seleccionar|seleccione|selecciona|elegir|elige)\s+(un|el|la)\s+(elemento|registro|producto|[a-záéíóúñ]+\s*[a-záéíóúñ]*)\s+(se\s+)?(muestra|presenta|redirige|navega)/i,
    /(detalle|informaci[oó]n)\s+(del|de\s+la)\s+(elemento|registro|producto|cuenta|[a-záéíóúñ]+\s*[a-záéíóúñ]*)\s+(seleccionad[oa]?|elegid[oa]?)/i,
    /(seleccionar|seleccione|selecciona)\s+(un|el|la)\s+(elemento|registro|producto|[a-záéíóúñ]+\s*[a-záéíóúñ]*)\s+(del\s+listado|de\s+la\s+lista)/i,
    /(escoger|escoge|escoja)\s+(un|el|la)\s+(elemento|registro|producto|[a-záéíóúñ]+\s*[a-záéíóúñ]*)\s+(del|de\s+la)\s+(listado|lista)/i,
    /(elegir|elige|elija)\s+(un|el|la)\s+(elemento|registro|producto|[a-záéíóúñ]+\s*[a-záéíóúñ]*)\s+(del|de\s+la)\s+(listado|lista)/i,
    /(seleccion[ae]|escoj[ae]|elij[ae])\s+(el|la|los|las)\s+(que\s+desea|siguiente|[a-záéíóúñ]+\s+desea)/i,
  ];
  for (const pat of selectionPatterns) {
    if (pat.test(lower)) {
      funcSelectionFlows.push({
        id: `selection_flow_${funcSelectionFlows.length}`,
        type: "selection_flow",
        label: `Select an item from the list and validate the result`,
        automatable: true,
        required: true,
        source: "hu",
      });
      break;
    }
  }
  if (funcSelectionFlows.length > 0) console.log(`[coverage-contract] extractedSelectionFlows count=${funcSelectionFlows.length}`);

  // single_item_shortcut: HU says if only one item, show detail directly
  const singleItemPatterns = [
    /(si\s+)?(s[oó]lo\s+(hay|existe|tiene|cuenta\s+con|posee)\s+un\s+(elemento|registro|producto|cuenta|activo|[a-záéíóúñ]+\s+activo)|[uú]nico\s+(elemento|registro|producto|cuenta|activo|[a-záéíóúñ]+\s+activo))\s+(no\s+)?(mostrar|presentar|listar)/i,
    /(con\s+un\s+(solo|[uú]nico)\s+(elemento|registro|producto|activo|[a-záéíóúñ]+)\s+(saltar|ir\s+directo|navegar|mostrar)\s+(al\s+)?(detalle|criterio))/i,
    /(en\s+caso\s+de\s+(tener|existir)\s+un\s+[uú]nico\s+(elemento|registro|activo|[a-záéíóúñ]+)\s+(no\s+)?(listar|mostrar\s+listado)\s+(y\s+)?(mostrar|ir|navegar)\s+(directo|al\s+(detalle|criterio)))/i,
    /(si\s+)?(s[oó]lo\s+posee|tiene\s+[uú]nicamente|cuenta\s+con\s+un\s+[uú]nico)\s+(elemento|registro|producto|activo|[a-záéíóúñ]+)\s+(saltar|ir\s+directo|navegar|mostrar)/i,
    /(saltar|ir\s+directo|acceder\s+directamente)\s+(al\s+)?(detalle|crit[eé]rio?|contenido)\s+(del|de\s+la)\s+([uú]nico\s+)?(elemento|registro|producto|activo|[a-záéíóúñ]+)/i,
    /(si\s+)?(solo\s+existe\s+un|existe\s+un\s+[uú]nico)\s+(elemento|activo|registro|producto|[a-záéíóúñ]+)\s+(no\s+listar\s+y\s+)?(ir|mostrar|navegar)\s+(directo|al\s+(detalle|criterio\s+siguiente))/i,
    /(si\s+solo\s+(posee|tiene|existe)\s+un\s+[uú]nico\s+(elemento|activo|[a-záéíóúñ]+)\s+(saltar\s+)?(directo\s+)?(al\s+)?(detalle|criterio\s+siguiente))/i,
  ];
  for (const pat of singleItemPatterns) {
    if (pat.test(lower)) {
      funcSingleItemShortcuts.push({
        id: `single_item_shortcut_${funcSingleItemShortcuts.length}`,
        type: "single_item_shortcut",
        label: `Validate shortcut to detail when only one item exists`,
        automatable: true,
        required: true,
        source: "hu",
      });
      break;
    }
  }
  if (funcSingleItemShortcuts.length > 0) console.log(`[coverage-contract] extractedSingleItemShortcuts count=${funcSingleItemShortcuts.length}`);

  // detail_fields: HU mentions specific fields visible in detail screen
  const detailFieldPatterns = [
    /(campos|datos|informaci[oó]n|detalle)\s+(del|de\s+la|de\s+los)\s+(producto|registro|cuenta|documento|contrato|elemento)\s+(debe|deber[íi]a|se\s+muestra|visible)/i,
    /(mostrar|visualizar|presentar|validar|desplegar)\s+(los\s+)?(siguientes\s+)?(campos|datos|informaci[oó]n|detalles|valores)/i,
    /(monto|saldo|fecha|estado|tipo|n[úu]mero|identificador|nombre|descripci[oó]n|valor|plazo|tasa)\s+(del|de\s+la|de\s+los)/i,
    /deber[áa]\s+mostrar\s+(los\s+)?(siguientes\s+)?(campos|datos|valores|informaci[oó]n)/i,
    /mostrar\s+en\s+pantalla\s+(los\s+)?(siguientes\s+)?/i,
  ];

  // Extract field names from bullet lists or comma-separated after trigger phrases
  const extractedFieldNames: string[] = [];
  const fieldTriggers = [
    /deber[áa]\s+mostrar[:\s]+(.+?)(?:\n\n|$)/is,
    /mostrar\s+en\s+pantalla[:\s]+(.+?)(?:\n\n|$)/is,
    /visualizar[:\s]+(.+?)(?:\n\n|$)/is,
    /los\s+siguientes\s+(campos|datos|valores)[:\s]+(.+?)(?:\n\n|$)/is,
  ];
  for (const trigger of fieldTriggers) {
    const m = trigger.exec(corpus);
    if (m) {
      const block = (m[2] || m[1]).trim();
      // Extract items: bullet points, comma-separated, or line-separated
      const items = block.split(/[\n,•\-*]+/).map(s => s.replace(/^["""'\s]+|["""'\s]+$/g, "").trim()).filter(Boolean);
      for (const item of items) {
        if (item.length > 2 && item.length < 60 && !extractedFieldNames.includes(item)) {
          extractedFieldNames.push(item);
        }
      }
    }
  }

  // Also detect field names from bullet-pointed lists in acceptance criteria / description
  if (extractedFieldNames.length === 0) {
    const lines = corpus.split("\n");
    for (const line of lines) {
      const trimmed = line.replace(/^[\s•\-*]+/, "").trim();
      if (trimmed.length > 3 && trimmed.length < 60 && /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ\s]+$/.test(trimmed.trim())) {
        // Potential field name: capitalized single line that's not a section header
        const lowerTrimmed = trimmed.toLowerCase();
        if (/(monto|saldo|fecha|estado|tipo|n[uú]mero|identificador|nombre|tasa|plazo|inter[eé]s|valor)/i.test(lowerTrimmed) &&
            !/(listado|seleccionar|validar|mostrar|ingresar|acceder|iniciar)/i.test(lowerTrimmed)) {
          if (!extractedFieldNames.includes(trimmed)) {
            extractedFieldNames.push(trimmed);
          }
        }
      }
    }
  }

  let detailFieldsLabel = "Validate required fields are visible in detail screen";
  if (extractedFieldNames.length > 0) {
    detailFieldsLabel += `: ${extractedFieldNames.join(", ")}`;
  }

  for (const pat of detailFieldPatterns) {
    if (pat.test(lower)) {
      funcDetailFields.push({
        id: `detail_fields_${funcDetailFields.length}`,
        type: "detail_fields",
        label: detailFieldsLabel,
        fieldNames: extractedFieldNames,
        fieldCount: extractedFieldNames.length,
        automatable: true,
        required: true,
        source: "hu",
      });
      break;
    }
  }
  if (funcDetailFields.length > 0) console.log(`[coverage-contract] extractedDetailFields count=${extractedFieldNames.length}`);

  // format_rule: currency, percentage, date, masking, partial identifiers
  const formatPatterns = [
    /(formato|moneda|porcentaje|fecha|hora|enmascaramiento|m[áa]scara|identificador\s+parcial|formateo)/i,
    /(debe|deber[íi]a)\s+(mostrarse|presentarse|formatearse|visualizarse)\s+(con\s+)?(formato|moneda|s[íi]mbolo|m[áa]scara)/i,
    /(signo\s+monetario|s[íi]mbolo\s+de\s+moneda|miles|decimales|caracteres\s+enmascarados|d[íi]gitos\s+parciales)/i,
    /(formato\s+moneda|formato\s+porcentaje|formato\s+fecha|formato\s+hora|enmascarar|decimales)/i,
  ];

  // Extract specific format types mentioned
  const formatTypes: string[] = [];
  if (/moneda|signo\s+monetario|s[íi]mbolo\s+(de\s+)?moneda/i.test(lower)) formatTypes.push("Moneda");
  if (/porcentaje/i.test(lower)) formatTypes.push("Porcentaje");
  if (/fecha/i.test(lower)) formatTypes.push("Fecha");
  if (/hora/i.test(lower)) formatTypes.push("Hora");
  if (/enmascaramiento|m[áa]scara|caracteres\s+enmascarados/i.test(lower)) formatTypes.push("Enmascaramiento");
  if (/decimales|miles/i.test(lower)) formatTypes.push("Decimales");

  let formatLabel = "Validate format rules";
  if (formatTypes.length > 0) formatLabel += ` (${formatTypes.join(", ")})`;

  for (const pat of formatPatterns) {
    if (pat.test(lower)) {
      funcFormatRules.push({
        id: `format_rule_${funcFormatRules.length}`,
        type: "format_rule",
        label: formatLabel,
        automatable: true,
        required: true,
        source: "hu",
      });
      break;
    }
  }
  if (funcFormatRules.length > 0) console.log(`[coverage-contract] extractedFormatRules count=${formatTypes.length}`);

  // action_options: back, send, finish, cancel, return to menu
  const actionOptionPatterns = [
    /(opciones\s+)?(posteriores|adicionales|disponibles)\s*(como|son|incluyen)?\s*(volver|regresar|enviar|finalizar|cancelar|imprimir|salir|confirmar)/i,
    /(bot[oó]n|opci[oó]n|acci[oó]n)\s+(de\s+)?(volver|regresar|enviar|finalizar|cancelar|imprimir|salir|confirmar)/i,
    /(debe|deber[íi]a|puede)\s+(incluir|tener|mostrar|presentar)\s+(opciones\s+)?(de\s+)?(volver|regresar|enviar|finalizar|cancelar|imprimir|salir|confirmar)/i,
    /(podr[áa]\s+elegir|podr[áa]\s+escoger|puede\s+(elegir|escoger|seleccionar))\s+(una\s+(de\s+)?)?(estas\s+)?(opciones|acciones)/i,
    /(contar[áa]\s+con\s+las\s+siguientes\s+opciones|podr[áa]\s+realizar\s+las\s+siguientes\s+acciones)/i,
  ];

  // Extract action option terms from HU text
  const actionOpts: string[] = [];
  const optTerms = ["volver", "regresar", "enviar", "finalizar", "cancelar", "imprimir", "salir", "confirmar"];
  for (const opt of optTerms) {
    if (new RegExp(opt, "i").test(lower)) {
      actionOpts.push(opt.charAt(0).toUpperCase() + opt.slice(1));
    }
  }

  let actionOptionsLabel = "Validate post-action options";
  if (actionOpts.length > 0) actionOptionsLabel += ` (${actionOpts.join(", ")})`;

  for (const pat of actionOptionPatterns) {
    if (pat.test(lower)) {
      funcActionOptions.push({
        id: `action_options_${funcActionOptions.length}`,
        type: "action_options",
        label: actionOptionsLabel,
        automatable: true,
        required: true,
        source: "hu",
      });
      break;
    }
  }
  if (funcActionOptions.length > 0) console.log(`[coverage-contract] extractedActionOptions count=${actionOpts.length}`);

  // conditional_alert: alerts by expiry, proximity, status, availability, risk
  const alertPatterns = [
    /(alerta|mensaje|aviso|notificaci[oó]n|pop.up|modal)\s+(condicional|por|debido\s+a|seg[uú]n|dependiendo|cuando|si\s+(el|la|los)|en\s+caso\s+de)/i,
    /(vencimiento|proximidad|disponibilidad|riesgo|estado\s+(del|de\s+la)|regla\s+de\s+negocio|saldo\s+(m[íi]nimo|insuficiente))/i,
    /(si\s+)?(el\s+)?(saldo|estado|plazo|monto|tipo)\s+(es|est[aá]|supera|no\s+supera|menor|mayor|igual|vencid|pr[oó]ximo)/i,
  ];
  for (const pat of alertPatterns) {
    if (pat.test(lower)) {
      funcConditionalAlerts.push({
        id: `conditional_alert_${funcConditionalAlerts.length}`,
        type: "conditional_alert",
        label: `Validate conditional alert/notification based on business rule`,
        automatable: true,
        required: true,
        source: "hu",
      });
      break;
    }
  }

  // failure_case: error/fallback messages for session, backend, no data, invalid format
  const failurePatterns = [
    /(sesi[oó]n\s+(expirada|cerrada|no\s+v[aá]lida|terminada)|sistema\s+(origen|externo|back.end)\s+(no\s+)?(disponible|ca[íi]do|sin\s+respuesta))/i,
    /(cliente|usuario|persona)\s+(sin\s+datos\s+(asociados|registrados)|no\s+(tiene|posee|cuenta\s+con)\s+(productos|cuentas|registros))/i,
    /(elemento|registro|producto|cuenta)\s+(no\s+)?(disponible|no\s+encontrado|inexistente|sin\s+datos|no\s+v[aá]lido)/i,
    /(error|fallo|falla|mensaje\s+de\s+error|pantalla\s+de\s+error|c[oód]igo\s+de\s+error)\s+(del|de\s+la|de\s+los)\s+(sistema|servicio|origen|backend|integraci[oó]n)/i,
    /(formato\s+inv[aá]lido|c[aá]lculo\s+no\s+validable|dato\s+(incorrecto|inv[aá]lido|no\s+v[aá]lido)|integraci[oó]n\s+con\s+(error|falla))/i,
    /(escenarios?\s+de\s+falla|casos?\s+de\s+fallo|situaciones?\s+de\s+error|flujos?\s+de\s+error|condiciones?\s+de\s+falla)/i,
    /(cuando\s+el\s+(sistema|servicio|origen)\s+(no\s+)?(responda|est[eé]\s+ca[íi]do|presente\s+un\s+error)|en\s+caso\s+de\s+(error|fallo|excepci[oó]n))/i,
  ];

  // Parse failure scenarios from "Escenarios de falla" section
  let failureCount = 0;
  const failureSectionMatch = corpus.match(/(?:escenarios?\s+de\s+falla|casos?\s+de\s+fallo)[:\s]*\n?([\s\S]+?)(?:\n\n|\n#{1,3}\s|\n-{3,}|$)/i);
  if (failureSectionMatch) {
    const section = failureSectionMatch[1];
    const bulletPoints = section.split(/[\n\r]+/).map(l => l.replace(/^[\s•\-*\d+.]+/, "").trim()).filter(Boolean);
    failureCount = bulletPoints.filter(b => b.length > 10).length;
  }

  for (const pat of failurePatterns) {
    if (pat.test(lower)) {
      funcFailureCases.push({
        id: `failure_case_${funcFailureCases.length}`,
        type: "failure_case",
        label: `Validate error/fallback message for failure scenario`,
        automatable: true,
        required: true,
        source: "hu",
      });
      // Create additional items for multi-scenario failure section
      if (failureCount > 1) {
        for (let f = 1; f < Math.min(failureCount, 5); f++) {
          funcFailureCases.push({
            id: `failure_case_${funcFailureCases.length}`,
            type: "failure_case",
            label: `Validate additional failure scenario (case ${f + 1})`,
            automatable: true,
            required: true,
            source: "hu",
          });
        }
      }
      break;
    }
  }
  if (funcFailureCases.length > 0) console.log(`[coverage-contract] extractedFailureCases count=${funcFailureCases.length}`);

  // --- T3: selectable_options (periods, ranges, numeric options) ---
  const funcSelectableOptions: CoverageContractItem[] = [];
  const selectablePatterns = [
    /(periodo|rango|selecci[oó]n\s+por)\s+(de\s+)?(\d+\s*[a\s]+\s*\d+|meses|d[ií]as|a[nñ]os)/i,
    /[úu]ltimos\s+\d+\s*(meses|d[ií]as|a[nñ]os|semanas)/i,
    /\d+\s*(mes|d[ií]a|a[nñ]o|semana)\s*(a|o|y|[-–])\s*\d+/i,
    /(opciones?\s+(de\s+)?)?\d+\s*[,;]\s*\d+\s*(y|o|,)\s*\d+/i,
    /(seleccionar|elegir|escoger)\s+(entre|un)\s+(periodo|rango|lapso)/i,
    /(meses|d[ií]as|a[nñ]os|plazos?)\s+(de\s+)?\d+/i,
  ];
  for (const pat of selectablePatterns) {
    if (pat.test(lower)) {
      funcSelectableOptions.push({
        id: `selectable_options_${funcSelectableOptions.length}`,
        type: "selectable_options",
        label: `Validate selectable period/range options`,
        automatable: true,
        required: true,
        source: "hu",
      });
      break;
    }
  }
  if (funcSelectableOptions.length > 0) console.log(`[coverage-contract] extractedSelectableOptions count=${funcSelectableOptions.length}`);

  // --- T4: visible_message (quoted or described in HU) ---
  const funcVisibleMessages: CoverageContractItem[] = [];
  const quotedMsg = lower.match(/["""'']([^""""'']{10,120})["""'']/);
  const messagePatterns = [
    /(se\s+)?muestra\s+(el\s+)?mensaje/i,
    /(deber[áa]|debe)\s+mostrar\s+(el\s+)?(siguiente\s+)?mensaje/i,
    /(se\s+)?debe\s+visualizar\s+(el\s+)?mensaje/i,
    /(mensaje\s+de\s+(confirmaci[oó]n|error|[eé]xito|alerta|informaci[oó]n))/i,
    /(mostrar\s+(el\s+)?siguiente\s+mensaje|presentar\s+(el\s+)?mensaje)/i,
  ];
  const hasMessageText = messagePatterns.some(p => p.test(lower));
  if (hasMessageText || quotedMsg) {
    funcVisibleMessages.push({
      id: `visible_message_0`,
      type: "visible_message",
      label: `Validate visible message${quotedMsg ? `: ${quotedMsg[1].substring(0, 80)}` : ""}`,
      automatable: true,
      required: true,
      source: "hu",
    });
  }
  if (funcVisibleMessages.length > 0) console.log(`[coverage-contract] extractedVisibleMessages count=${funcVisibleMessages.length}`);

  // --- T5: confirmation_flow (confirm, send, finalize) ---
  const funcConfirmationFlows: CoverageContractItem[] = [];
  const confirmPatterns = [
    /(confirmar|confirmaci[oó]n|aceptar)\s+(la\s+)?(operaci[oó]n|solicitud|transacci[oó]n|eliminaci[oó]n|modificaci[oó]n|carga|env[ií]o)/i,
    /(generar|solicitar|enviar|finalizar)\s+(la\s+)?(solicitud|operaci[oó]n|transacci[oó]n|reporte|documento|comprobante)/i,
    /(descargar|imprimir)\s+(el\s+)?(comprobante|documento|reporte|constancia)/i,
    /(recibir|entregar)\s+(el\s+)?(comprobante|documento|resultado)/i,
    /(continuar|proceder)\s+(con\s+)?(la\s+)?(operaci[oó]n|solicitud|transacci[oó]n)/i,
  ];
  for (const pat of confirmPatterns) {
    if (pat.test(lower)) {
      const match = pat.exec(lower);
      const actionText = match ? match[0].substring(0, 60) : "confirmation";
      // Check if the action appears backend/Core — mark non-executable
      const isBackendAction = /(backend|core|api|db\b|base\s+de\s+datos|proceso\s+interno|externo)/i.test(lower);
      funcConfirmationFlows.push({
        id: `confirmation_flow_${funcConfirmationFlows.length}`,
        type: isBackendAction ? "non_executable" : "confirmation_flow",
        label: isBackendAction
          ? `Validate backend/external process initiated (manual verification needed)`
          : `Execute visible confirmation action: "${actionText}"`,
        automatable: !isBackendAction,
        required: !isBackendAction,
        manual: isBackendAction,
        source: "hu",
      });
      if (isBackendAction) {
        console.log(`[coverage-contract] nonExecutableRule reason=backend_or_external_system text="${actionText}"`);
      }
      break;
    }
  }
  if (funcConfirmationFlows.length > 0) console.log(`[coverage-contract] extractedConfirmationFlows count=${funcConfirmationFlows.length}`);

  // --- T7: delivery_option (email, delivery method) ---
  const funcDeliveryOptions: CoverageContractItem[] = [];
  const deliveryPatterns = [
    /(correo|email|e.mail)\s+(registrado|asociado|notificado|enviar\s+al)/i,
    /(enviar|recibir)\s+(al|por|mediante)\s+(correo|email)/i,
    /(s[oó]lo\s+se\s+)?(permite|env[ií]a)\s+(env[ií]o|entrega)\s+(por|a|mediante)/i,
    /(destinatario|medio\s+de\s+entrega|direcci[oó]n\s+de\s+correo)/i,
    /(notificar|notificaci[oó]n)\s+(por|v[ií]a|mediante)\s+(correo|email|sms)/i,
  ];
  for (const pat of deliveryPatterns) {
    if (pat.test(lower)) {
      funcDeliveryOptions.push({
        id: `delivery_option_${funcDeliveryOptions.length}`,
        type: "delivery_option",
        label: `Validate visible delivery/notification options`,
        automatable: true,
        required: true,
        source: "hu",
      });
      break;
    }
  }
  if (funcDeliveryOptions.length > 0) console.log(`[coverage-contract] extractedDeliveryOptions count=${funcDeliveryOptions.length}`);

  // --- T8: reference_number (unique visible identifier) ---
  const funcReferenceNumbers: CoverageContractItem[] = [];
  const refPatterns = [
    /(referencia|c[oód]igo\s+[úu]nico|n[úu]mero\s+(de\s+)?(solicitud|operaci[oó]n|transacci[oó]n|comprobante|identificador|referencia)|id\s+de\s+transacci[oó]n|comprobante)/i,
    /(genera|muestra|asigna|presenta)\s+(un\s+)?(n[úu]mero|c[oód]igo|referencia|identificador|comprobante|solicitud)/i,
    /(n[úu]mero\s+[úu]nico|c[oód]igo\s+[úu]nico\s+de\s+(solicitud|operaci[oó]n))/i,
    /(se\s+)?(muestra|visualiza|presenta)\s+(el\s+)?(n[úu]mero|c[oód]igo|referencia|comprobante|identificador)/i,
  ];
  for (const pat of refPatterns) {
    if (pat.test(lower)) {
      funcReferenceNumbers.push({
        id: `reference_number_${funcReferenceNumbers.length}`,
        type: "reference_number",
        label: `Validate visible reference/confirmation number`,
        automatable: true,
        required: true,
        source: "hu",
      });
      break;
    }
  }
  if (funcReferenceNumbers.length > 0) console.log(`[coverage-contract] extractedReferenceNumbers count=${funcReferenceNumbers.length}`);

  // --- Detect authenticatedPrecondition ---
  const authenticatedPrecondition =
    /\b(sesi[oó]n\s+(v[aá]lida|iniciada|activa|existente)|ya\s+(est[aá]|se\s+encuentra)\s+(autenticado|logueado)|autenticaci[oó]n\s+(completada|exitosa|ya\s+realizada)|precondici[oó]n\s+autenticada)\b/i.test(lower);

  // --- Inactivity and restart rules ---
  const inactivityRules: CoverageContractItem[] = [];
  const restartRules: CoverageContractItem[] = [];

  if (/\b(inactividad|sin\s+actividad|tiempo\s+(muerto|de\s+espera|sin)|no\s+(toca|interact[úu]a|presiona|selecciona)|esperar\s+\d+\s*(segundos?|minutos?))\b/i.test(lower)) {
    // MCP cannot reliably control session timeouts during automated scenario execution
    // Always mark as manual/non-automatable regardless of HU mentioning timeout values
    inactivityRules.push({
      id: "inactivity_rule",
      type: "inactivity_rule",
      label: `Validate session timeout after inactivity period (manual verification needed)`,
      automatable: false,
      required: false,
      manual: true,
      source: "hu",
    });
    console.log(`[coverage-contract] manualItem type="inactivity_rule"`);
  }

  if (/\b(reinicio?|p[eé]rdida\s+de\s+(energ[íi]a|corriente|conexi[óo]n)|apag[oó]n|restart|power\s+(loss|failure))\b/i.test(lower) &&
      /\b(pantalla\s+(inicial|#1|n[uú]mero\s+uno|principal)|selecci[óo]n\s+de\s+idioma|idioma)\b/i.test(lower)) {
    restartRules.push({
      id: "restart_rule",
      type: "restart_rule",
      label: "Validate restart/power-loss returns to initial screen (manual verification needed)",
      automatable: false,
      required: false,
      manual: true,
      source: "hu",
    });
    console.log(`[coverage-contract] manualItem type="restart_rule"`);
  }

  // --- Non-executable: manual and backend-only criteria ---
  const nonExecutable: CoverageContractItem[] = [];
  const manualKeywords = ["manual", "verificar", "revisar", "inspeccionar", "validar backend", "base de datos", "core banking"];
  for (const keyword of manualKeywords) {
    if (lower.includes(keyword)) {
      nonExecutable.push({
        id: `non_executable_${nonExecutable.length}`,
        type: "non_executable",
        label: `Manual/backend validation required (not MCP-automatable)`,
        automatable: false,
        required: false,
        source: "hu",
      });
      break;
    }
  }

  const allItems = [
    ...initialScreenItems,
    ...blockedWithoutAction,
    ...postActionScreens,
    ...optionFlowItems,
    ...funcNavigationItems,
    ...funcListScreens,
    ...funcSelectionFlows,
    ...funcSingleItemShortcuts,
    ...funcDetailFields,
    ...funcFormatRules,
    ...funcActionOptions,
    ...funcConditionalAlerts,
    ...funcFailureCases,
    ...funcSelectableOptions,
    ...funcVisibleMessages,
    ...funcConfirmationFlows,
    ...funcDeliveryOptions,
    ...funcReferenceNumbers,
    ...negativeRules,
    ...inactivityRules,
    ...restartRules,
    ...nonExecutable,
  ];

  const automatedItems = allItems.filter(i => i.automatable && i.required).length;
  const nonAutomatedItems = allItems.filter(i => !i.automatable).length;

  // --- Post-list dependency: if list + selection exist, mark detail/format/action/alert/failure items as selection-dependent ---
  let inferredTarget = "";
  if (funcListScreens.length > 0 && funcSelectionFlows.length > 0) {
    // Infer selectionTarget from HU: captured text after "seleccione/escoja/elija un/una/el/la" up to a delimiter
    const selMatch = lower.match(/(?:seleccion[ae]|escoj[ae]|elij[ae]|seleccionar|escoger|elegir)\s+(?:el|la|un|una)\s+([a-záéíóúñ][a-záéíóúñ\s]{2,40}?)(?:\s+(?:del|de\s+la|activo|que\s+desea|que\s+desee|para|en\s+el|visible|a\s+consultar))/i);
    if (selMatch) {
      inferredTarget = selMatch[1].trim();
    } else {
      // Fallback: use item type from selection flow label
      inferredTarget = "item";
    }
    const selectionRefId = funcSelectionFlows.length > 0 ? funcSelectionFlows[0].id : "selection_flow_0";
    const postSelectionTypes = [
      { arr: funcDetailFields, reason: "detail" },
      { arr: funcFormatRules, reason: "format" },
      { arr: funcActionOptions, reason: "action" },
      { arr: funcConditionalAlerts, reason: "alert" },
      { arr: funcFailureCases, reason: "failure" },
    ];
    for (const { arr, reason } of postSelectionTypes) {
      for (const item of arr) {
        (item as any).requiresSelection = true;
        (item as any).requiresSelectionRef = selectionRefId;
        (item as any).selectionTarget = inferredTarget;
        console.log(`[scenario-selection] requiresSelection item="${item.id}" type="${reason}" reason=${reason}_post_list`);
      }
    }
  }

  // Log negativeTerm for the first negative rule
  if (negativeRules.length > 0 && negativeRules[0].negativeTerm) {
    console.log(`[coverage-contract] negativeTerm="${negativeRules[0].negativeTerm}"`);
  }
  // Log manual items individually
  for (const item of [...inactivityRules, ...restartRules].filter(i => i.manual)) {
    console.log(`[coverage-contract] manualItem type="${item.type}"`);
  }

  console.log(`[coverage-contract] issue=${issueKey} initialScreen=${initialScreenItems.length} blockedWithoutAction=${blockedWithoutAction.length} postActionScreen=${postActionScreens.length} optionFlows=${optionFlowItems.length} navigationItems=${funcNavigationItems.length} listScreens=${funcListScreens.length} selectionFlows=${funcSelectionFlows.length} singleItemShortcuts=${funcSingleItemShortcuts.length} detailFields=${funcDetailFields.length} formatRules=${funcFormatRules.length} actionOptions=${funcActionOptions.length} conditionalAlerts=${funcConditionalAlerts.length} failureCases=${funcFailureCases.length} selectableOptions=${funcSelectableOptions.length} visibleMessages=${funcVisibleMessages.length} confirmationFlows=${funcConfirmationFlows.length} deliveryOptions=${funcDeliveryOptions.length} referenceNumbers=${funcReferenceNumbers.length} negativeRules=${negativeRules.length} inactivityRules=${inactivityRules.length} restartRules=${restartRules.length} nonExecutable=${nonExecutable.length}`);
  console.log(`[coverage-contract] requiredItems=${automatedItems} automatedItems=${automatedItems} manualItems=${nonAutomatedItems}`);
  if (inferredTarget) {
    console.log(`[scenario-selection] selectionTarget="${inferredTarget}" source=coverageContract`);
  }

  return {
    issueKey,
    initialActions: initialScreenItems,
    blockedWithoutAction,
    postActionScreens,
    optionFlows: optionFlowItems,
    navigationItems: funcNavigationItems,
    listScreens: funcListScreens,
    selectionFlows: funcSelectionFlows,
    singleItemShortcuts: funcSingleItemShortcuts,
    detailFields: funcDetailFields,
    formatRules: funcFormatRules,
    actionOptions: funcActionOptions,
    conditionalAlerts: funcConditionalAlerts,
    failureCases: funcFailureCases,
    selectableOptions: funcSelectableOptions.length > 0 ? funcSelectableOptions : undefined,
    visibleMessages: funcVisibleMessages.length > 0 ? funcVisibleMessages : undefined,
    confirmationFlows: funcConfirmationFlows.length > 0 ? funcConfirmationFlows : undefined,
    deliveryOptions: funcDeliveryOptions.length > 0 ? funcDeliveryOptions : undefined,
    referenceNumbers: funcReferenceNumbers.length > 0 ? funcReferenceNumbers : undefined,
    negativeRules,
    nonExecutable: [...inactivityRules, ...restartRules, ...nonExecutable],
    authenticatedPrecondition,
    totalItems: automatedItems + nonAutomatedItems,
    automatedItems,
  };
}

