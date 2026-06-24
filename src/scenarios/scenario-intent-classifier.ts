import type { JiraIssueSource, McpRouteProfile } from "./scenario-types";

export type ScenarioIntent =
  | "public/product_information"
  | "private/authenticated_transaction"
  | "ambiguous";

export type ScenarioIntentConfidence = "high" | "medium" | "low";
export type ScenarioIntentSource = "core" | "app_config" | "mixed";

export type ScenarioIntentClassification = {
  intent: ScenarioIntent;
  requiresAuth: boolean;
  confidence: ScenarioIntentConfidence;
  source: ScenarioIntentSource;
  reason: string;
  suggestedModule?: string;
  suggestedRoute?: string;
};

type IntentRouteConfig = {
  module?: string;
  path?: string[] | string;
  signals?: string[];
  requiresAuth?: boolean;
};

type IntentRuleConfig = {
  signals?: string[];
};

type IntentAppConfig = {
  intentRules?: {
    public?: IntentRuleConfig;
    private?: IntentRuleConfig;
  };
  privateRoutes?: IntentRouteConfig[];
  publicRoutes?: IntentRouteConfig[];
  authProfile?: Record<string, unknown> | null;
};

type IntentMetadata = {
  domainTerms: string[];
  visibleControls: string[];
  targetLabels: string[];
};

const CORE_PUBLIC_SIGNALS = [
  "informacion de productos",
  "beneficios",
  "requisitos",
  "tasas",
  "descripcion general",
  "solicitar producto",
  "listado de productos",
  "detalle informativo",
];

const CORE_PRIVATE_SIGNALS = [
  "balance",
  "saldo",
  "mis productos",
  "productos del cliente",
  "movimientos",
  "transaccion",
  "transacciones",
  "sesion valida",
  "autenticacion",
  "monto invertido",
  "estado del producto del cliente",
  "depositos del cliente",
  "enviar por correo",
  "imprimir",
  "finalizar sesion",
  "inactividad",
  "sesion expirada",
  "historial",
  "factura",
  "facturas",
  "pedido",
  "pedidos",
  "datos del cliente",
];

const PRIVATE_PRECEDENCE_SIGNALS = [
  "balance",
  "saldo",
  "mis productos",
  "productos del cliente",
  "movimientos",
  "transaccion",
  "transacciones",
  "sesion",
  "autenticacion",
  "monto invertido",
  "datos del cliente",
  "historial",
  "factura",
  "pedido",
];

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s>/:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildIssueCorpus(issue: JiraIssueSource): string {
  return [issue.summary, issue.description, issue.acceptanceCriteria || ""].filter(Boolean).join(" ");
}

function collectMatches(corpus: string, signals: string[]): string[] {
  const seen = new Set<string>();
  for (const signal of signals) {
    const normalizedSignal = normalizeText(signal);
    if (normalizedSignal && corpus.includes(normalizedSignal)) {
      seen.add(normalizedSignal);
    }
  }
  return Array.from(seen);
}

function getIntentMetadata(routeProfile: McpRouteProfile | null): IntentMetadata {
  const domainTerms = new Set<string>();
  const visibleControls = new Set<string>();
  const targetLabels = new Set<string>();

  if (routeProfile?.domainTerms) {
    for (const value of Object.values(routeProfile.domainTerms)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === "string") domainTerms.add(normalizeText(item));
        }
      } else if (typeof value === "string") {
        domainTerms.add(normalizeText(value));
      }
    }
  }

  if (routeProfile?.visibleControls) {
    for (const control of routeProfile.visibleControls) {
      visibleControls.add(normalizeText(control));
    }
  }

  if (routeProfile?.targetPaths) {
    for (const [target, targetPath] of Object.entries(routeProfile.targetPaths)) {
      targetLabels.add(normalizeText(target));
      const metadata = targetPath.productMetadata;
      if (metadata?.category) targetLabels.add(normalizeText(metadata.category));
      if (metadata?.subcategory) targetLabels.add(normalizeText(metadata.subcategory));
      if (metadata?.variant) targetLabels.add(normalizeText(metadata.variant));
      if (metadata?.productLabel) targetLabels.add(normalizeText(metadata.productLabel));
    }
  }

  return {
    domainTerms: Array.from(domainTerms).filter(Boolean),
    visibleControls: Array.from(visibleControls).filter(Boolean),
    targetLabels: Array.from(targetLabels).filter(Boolean),
  };
}

function buildConfiguredSignals(appConfig: IntentAppConfig | null, routeProfile: McpRouteProfile | null): {
  publicSignals: string[];
  privateSignals: string[];
} {
  const metadata = getIntentMetadata(routeProfile);
  const configPublicSignals = appConfig?.intentRules?.public?.signals ?? [];
  const configPrivateSignals = appConfig?.intentRules?.private?.signals ?? [];

  return {
    publicSignals: Array.from(new Set([...configPublicSignals, ...metadata.domainTerms, ...metadata.targetLabels])),
    privateSignals: Array.from(new Set([...configPrivateSignals, ...metadata.visibleControls])),
  };
}

function resolveSuggestedRoute(
  corpus: string,
  routes: IntentRouteConfig[] | undefined,
): Pick<ScenarioIntentClassification, "suggestedModule" | "suggestedRoute"> {
  if (!routes || routes.length === 0) {
    return {};
  }

  for (const route of routes) {
    const matches = collectMatches(corpus, route.signals ?? []);
    if (matches.length === 0) {
      continue;
    }

    const pathSegments = Array.isArray(route.path)
      ? route.path
      : typeof route.path === "string"
        ? route.path.split(">").map(segment => segment.trim()).filter(Boolean)
        : [];
    const suggestedRoute = pathSegments.length > 0 ? pathSegments.join(" > ") : undefined;
    return {
      suggestedModule: route.module ?? pathSegments[0],
      suggestedRoute,
    };
  }

  return {};
}

export function classifyScenarioIntent(args: {
  issue: JiraIssueSource;
  appSlug: string;
  appConfig?: IntentAppConfig | null;
  routeProfile?: McpRouteProfile | null;
}): ScenarioIntentClassification {
  const normalizedCorpus = normalizeText(buildIssueCorpus(args.issue));
  const configuredSignals = buildConfiguredSignals(args.appConfig ?? null, args.routeProfile ?? null);

  const corePublicMatches = collectMatches(normalizedCorpus, CORE_PUBLIC_SIGNALS);
  const corePrivateMatches = collectMatches(normalizedCorpus, CORE_PRIVATE_SIGNALS);
  const configuredPublicMatches = collectMatches(normalizedCorpus, configuredSignals.publicSignals);
  const configuredPrivateMatches = collectMatches(normalizedCorpus, configuredSignals.privateSignals);

  const allPublicMatches = Array.from(new Set([...corePublicMatches, ...configuredPublicMatches]));
  const allPrivateMatches = Array.from(new Set([...corePrivateMatches, ...configuredPrivateMatches]));
  const privatePrecedence = allPrivateMatches.some(match => PRIVATE_PRECEDENCE_SIGNALS.includes(match));

  let source: ScenarioIntentSource = "core";
  if ((configuredPublicMatches.length > 0 || configuredPrivateMatches.length > 0) && (corePublicMatches.length > 0 || corePrivateMatches.length > 0)) {
    source = "mixed";
  } else if (configuredPublicMatches.length > 0 || configuredPrivateMatches.length > 0) {
    source = "app_config";
  }

  if (allPrivateMatches.length > 0 && (privatePrecedence || allPublicMatches.length === 0)) {
    const routeSuggestion = resolveSuggestedRoute(normalizedCorpus, args.appConfig?.privateRoutes);
    return {
      intent: "private/authenticated_transaction",
      requiresAuth: true,
      confidence: routeSuggestion.suggestedRoute || allPrivateMatches.length >= 2 ? "high" : "medium",
      source,
      reason: `private_signals=${allPrivateMatches.slice(0, 4).join(",")}`,
      ...routeSuggestion,
    };
  }

  if (allPublicMatches.length > 0 && allPrivateMatches.length === 0) {
    const routeSuggestion = resolveSuggestedRoute(normalizedCorpus, args.appConfig?.publicRoutes);
    return {
      intent: "public/product_information",
      requiresAuth: false,
      confidence: allPublicMatches.length >= 2 ? "high" : "medium",
      source,
      reason: `public_signals=${allPublicMatches.slice(0, 4).join(",")}`,
      ...routeSuggestion,
    };
  }

  if (allPrivateMatches.length > 0 && allPublicMatches.length > 0) {
    const routeSuggestion = resolveSuggestedRoute(normalizedCorpus, args.appConfig?.privateRoutes);
    return {
      intent: "private/authenticated_transaction",
      requiresAuth: true,
      confidence: privatePrecedence ? "high" : "medium",
      source,
      reason: `precedence_private private_signals=${allPrivateMatches.slice(0, 3).join(",")} public_signals=${allPublicMatches.slice(0, 3).join(",")}`,
      ...routeSuggestion,
    };
  }

  return {
    intent: "ambiguous",
    requiresAuth: false,
    confidence: "low",
    source,
    reason: "no_deterministic_signals",
  };
}

export function logScenarioIntentClassification(args: {
  appSlug: string;
  issue: JiraIssueSource;
  classification: ScenarioIntentClassification;
}): void {
  const { appSlug, issue, classification } = args;
  console.log(
    `[scenario-intent] appSlug=${appSlug} issue=${issue.key} intent=${classification.intent} ` +
      `requiresAuth=${classification.requiresAuth} confidence=${classification.confidence} source=${classification.source} ` +
      `reason="${classification.reason}"`
  );
}

export function hasPrivateIntentConfiguration(appConfig: IntentAppConfig | null | undefined): boolean {
  const hasAuthProfile = Boolean(appConfig?.authProfile && Object.keys(appConfig.authProfile).length > 0);
  const hasPrivateRoutes = Boolean(appConfig?.privateRoutes && appConfig.privateRoutes.length > 0);
  return hasAuthProfile && hasPrivateRoutes;
}
