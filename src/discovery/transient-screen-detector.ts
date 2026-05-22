import type { PageSnapshot } from "../types/page-snapshot.types";

export type TransientScreenReason =
  | "redirecting_after_auth"
  | "loading"
  | "processing"
  | "success_intermediate"
  | "data_loading"
  | "list_loading"
  | "unknown";

export type TransientScreenDetection = {
  transient: boolean;
  reason: TransientScreenReason | null;
  evidence: string[];
  confidence: number;
};

const LOADING_KEYWORDS = [
  "cargando",
  "loading",
  "procesando",
  "processing",
  "espere",
  "un momento",
  "por favor espere",
  "preparando",
  "preparing"
];

const DATA_LOADING_KEYWORDS = [
  "cargando productos",
  "cargando informacion",
  "cargando información",
  "cargando datos",
  "cargando cuentas",
  "cargando tarjetas",
  "cargando opciones",
  "cargando resultados",
  "cargando lista",
  "cargando servicios",
  "buscando",
  "consultando",
  "obteniendo",
  "sincronizando",
  "loading products",
  "loading data",
  "loading accounts",
  "loading cards",
  "loading options",
  "loading results",
  "searching",
  "fetching",
  "syncing",
  "synchronizing"
];

const ZERO_PRODUCT_INDICATORS = [
  "0 productos",
  "0 items",
  "0 resultados",
  "0 cuentas",
  "0 tarjetas",
  "continuar (0 productos)",
  "continuar (0 items)",
  "continuar (0 resultados)",
  "no hay productos disponibles",
  "no hay resultados",
  "sin productos",
  "sin resultados"
];

const REDIRECT_KEYWORDS = [
  "redirigiendo",
  "redirecting",
  "redireccionando",
  "será redirigido",
  "sera redirigido"
];

const SUCCESS_INTERMEDIATE_KEYWORDS = [
  "autenticación exitosa",
  "autenticacion exitosa",
  "identidad validada",
  "código verificado exitosamente",
  "codigo verificado exitosamente",
  "código verificado",
  "codigo verificado",
  "operación exitosa",
  "operacion exitosa",
  "validando",
  "validating",
  "ahora puede acceder",
  "menu de operaciones",
  "menú de operaciones"
];

const TRANSIENT_URL_PATTERNS = [
  "authentication-success",
  "success",
  "loading",
  "redirect",
  "callback",
  "processing",
  "auth-callback",
  "login-callback"
];

const FUNCTIONAL_LANDING_KEYWORDS = [
  "transacciones y servicios",
  "transacciones y services",
  "selecciona la operación",
  "selecciona la operacion",
  "estado de cuenta",
  "consulta de balance",
  "pago de productos",
  "generar cartas",
  "carta de referencia",
  "menú principal",
  "menu principal"
];

const LOADED_PRODUCT_INDICATORS = [
  "cuenta de ahorros",
  "cuenta de ahorro",
  "deposito a plazo",
  "depósito a plazo",
  "prestamo",
  "préstamo",
  "tarjeta de credito",
  "tarjeta de crédito",
  "tarjeta de debito",
  "tarjeta de débito",
  "saldo",
  "activa",
  "vigente",
  "bloqueada",
  "cancelada",
  "desembolsado",
  "pagado",
  "cuenta corriente"
];

const PRODUCT_LIST_CONTAINER_HINTS = [
  "lista de productos",
  "lista de cuentas",
  "lista de tarjetas",
  "mis productos",
  "mis cuentas",
  "selecciona una cuenta",
  "selecciona un producto",
  "selecciona la cuenta",
  "selecciona el producto"
];

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractVisibleTexts(snapshot: PageSnapshot): string[] {
  const texts: string[] = [];

  if ((snapshot as any).elements) {
    for (const el of (snapshot as any).elements) {
      if (el.text) texts.push(el.text);
      if (el.nearbyText) texts.push(el.nearbyText);
      if (el.alt) texts.push(el.alt);
      if (el.placeholder) texts.push(el.placeholder);
      if (el.label) texts.push(el.label);
    }
  }

  return texts;
}

function hasMatchingKeyword(texts: string[], keywords: string[]): string[] {
  const matched: string[] = [];
  const normalizedTexts = texts.map(normalizeText);

  for (const keyword of keywords) {
    const normalizedKeyword = normalizeText(keyword);
    for (const text of normalizedTexts) {
      if (text.includes(normalizedKeyword)) {
        matched.push(keyword);
        break;
      }
    }
  }

  return matched;
}

function hasFunctionalLanding(texts: string[]): boolean {
  const normalizedTexts = texts.map(normalizeText);
  return FUNCTIONAL_LANDING_KEYWORDS.some((keyword) =>
    normalizedTexts.some((text) => text.includes(normalizeText(keyword)))
  );
}

function hasLoadedProducts(texts: string[]): boolean {
  const normalizedTexts = texts.map(normalizeText);
  return LOADED_PRODUCT_INDICATORS.some((indicator) =>
    normalizedTexts.some((text) => text.includes(normalizeText(indicator)))
  );
}

function hasProductListContainer(texts: string[]): boolean {
  const normalizedTexts = texts.map(normalizeText);
  return PRODUCT_LIST_CONTAINER_HINTS.some((hint) =>
    normalizedTexts.some((text) => text.includes(normalizeText(hint)))
  );
}

function hasVisibleProductCards(snapshot: PageSnapshot): boolean {
  const elements = (snapshot as any).elements || [];
  let visibleProductCards = 0;

  for (const el of elements) {
    if (!el.visible) continue;
    const text = (el.text || "") + " " + (el.nearbyText || "");
    const normalized = normalizeText(text);

    const isProductCard = LOADED_PRODUCT_INDICATORS.some(indicator =>
      normalized.includes(normalizeText(indicator))
    );

    if (isProductCard) {
      const isClickable = el.type === "button" || el.type === "link" || el.type === "checkbox" ||
        el.role === "button" || el.role === "link" || el.role === "checkbox" ||
        el.tagName?.toLowerCase() === "button" || el.tagName?.toLowerCase() === "a" ||
        el.isClickable;

      if (isClickable || el.type === "card" || el.role === "listitem") {
        visibleProductCards++;
      }
    }
  }

  return visibleProductCards >= 1;
}

function hasActionableElements(snapshot: PageSnapshot): boolean {
  if (!(snapshot as any).elements) return false;
  const buttons = (snapshot as any).elements.filter((el: any) => el.type === "button" || el.tagName === "button").length;
  const links = (snapshot as any).elements.filter((el: any) => el.type === "link" || el.tagName === "a").length;
  return buttons >= 3 || links >= 3;
}

function hasDisabledZeroButton(texts: string[]): boolean {
  const normalizedTexts = texts.map(normalizeText);
  return ZERO_PRODUCT_INDICATORS.some((indicator) =>
    normalizedTexts.some((text) => text.includes(normalizeText(indicator)))
  );
}

export function detectTransientScreen(snapshot: PageSnapshot): TransientScreenDetection {
  const texts = extractVisibleTexts(snapshot);
  const url = (snapshot as any).url || "";
  const evidence: string[] = [];

  if (texts.length === 0 && !url) {
    return { transient: false, reason: null, evidence: [], confidence: 0 };
  }

  const loadingMatches = hasMatchingKeyword(texts, LOADING_KEYWORDS);
  const dataLoadingMatches = hasMatchingKeyword(texts, DATA_LOADING_KEYWORDS);
  const redirectMatches = hasMatchingKeyword(texts, REDIRECT_KEYWORDS);
  const successMatches = hasMatchingKeyword(texts, SUCCESS_INTERMEDIATE_KEYWORDS);
  const zeroProductMatches = hasMatchingKeyword(texts, ZERO_PRODUCT_INDICATORS);

  const urlNormalized = normalizeText(url);
  const urlMatches = TRANSIENT_URL_PATTERNS.filter((pattern) =>
    urlNormalized.includes(normalizeText(pattern))
  );

  if (hasLoadedProducts(texts) && !loadingMatches.length && !dataLoadingMatches.length && !zeroProductMatches.length) {
    return { transient: false, reason: null, evidence: [], confidence: 0 };
  }

  if (hasVisibleProductCards(snapshot) && !loadingMatches.length && !dataLoadingMatches.length && !zeroProductMatches.length) {
    return { transient: false, reason: null, evidence: ["visible_product_cards_detected"], confidence: 0 };
  }

  if (hasFunctionalLanding(texts) && hasActionableElements(snapshot) && !loadingMatches.length && !dataLoadingMatches.length && !zeroProductMatches.length) {
    return { transient: false, reason: null, evidence: [], confidence: 0 };
  }

  if (urlMatches.length > 0) {
    evidence.push(...urlMatches.map(u => `URL pattern: ${u}`));
  }

  if (dataLoadingMatches.length > 0) {
    evidence.push(...dataLoadingMatches);
  }

  if (zeroProductMatches.length > 0) {
    evidence.push(...zeroProductMatches);
  }

  if (loadingMatches.length > 0) {
    evidence.push(...loadingMatches);
  }

  if (redirectMatches.length > 0) {
    evidence.push(...redirectMatches);
  }

  if (successMatches.length > 0) {
    evidence.push(...successMatches);
  }

  if (evidence.length === 0) {
    return { transient: false, reason: null, evidence: [], confidence: 0 };
  }

  let reason: TransientScreenReason = "unknown";
  let confidence = 0;

  if (dataLoadingMatches.length > 0 || zeroProductMatches.length > 0) {
    reason = "data_loading";
    confidence = Math.min(0.95, 0.7 + dataLoadingMatches.length * 0.1 + zeroProductMatches.length * 0.15);
  } else if (redirectMatches.length > 0 || urlMatches.some(u => u.includes("redirect") || u.includes("callback"))) {
    reason = "redirecting_after_auth";
    confidence = Math.min(0.98, 0.6 + redirectMatches.length * 0.15 + urlMatches.length * 0.1);
  } else if (loadingMatches.length > 0 || urlMatches.some(u => u.includes("loading") || u.includes("processing"))) {
    reason = "loading";
    confidence = Math.min(0.95, 0.5 + loadingMatches.length * 0.15 + urlMatches.length * 0.1);
  } else if (successMatches.length > 0) {
    reason = "success_intermediate";
    confidence = Math.min(0.95, 0.5 + successMatches.length * 0.15);
  } else {
    reason = "processing";
    confidence = 0.5;
  }

  return {
    transient: confidence >= 0.5,
    reason,
    evidence,
    confidence: Math.round(confidence * 100) / 100
  };
}
