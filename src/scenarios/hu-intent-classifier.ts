/**
 * HU Intent Classifier
 *
 * Detects the functional intent of a Jira HU/issue to guard scenario generation
 * against routing a transactional/documental flow through a catalog/listing route
 * profile (e.g. "Información de productos" for a "Carta de Referencia" flow).
 *
 * Generic signals — no hardcoded appSlug, issueKey, products, routes or labels.
 */

export type HuIntent =
  | "catalog_listing_flow"
  | "transactional_document_flow"
  | "private_navigation_flow"
  | "product_detail_flow"
  | "unknown_flow";

export type HuIntentDetection = {
  intent: HuIntent;
  confidence: "high" | "medium" | "low";
  reason: string;
  matchedSignals: string[];
};

export type HuIntentInput = {
  summary?: string;
  description?: string;
  acceptanceCriteria?: string;
  labels?: string[];
  components?: string[];
};

const TRANSACTIONAL_DOCUMENT_TERMS: string[] = [
  "generar carta",
  "carta de referencia",
  "carta bancaria",
  "certificacion",
  "certificado bancario",
  "documento bancario",
  "constancia",
  "comprobante",
  "estado de cuenta",
  "destinatario",
  "enviar por correo",
  "correo electronico",
  "vista previa",
  "confirmar datos",
  "codigo de autenticacion",
  "codigo qr",
  "rnc",
  "empresas frecuentes"
];

const TRANSACTIONAL_DOCUMENT_SECONDARY: string[] = [
  "qr",
  "vista",
  "previa",
  "correo",
  "confirmar",
  "autenticacion",
  "documento",
  "certificacion",
  "constancia",
  "comprobante"
];

const CATALOG_LISTING_TERMS: string[] = [
  "informacion de productos",
  "catalogo de productos",
  "listado de productos",
  "ver productos",
  "explorar productos",
  "consultar productos",
  "productos disponibles",
  "categorias disponibles"
];

const PRIVATE_NAVIGATION_TERMS: string[] = [
  "menu:",
  "ruta:",
  "modulo:",
  "opcion:"
];

const PRODUCT_DETAIL_TERMS: string[] = [
  "detalle del producto",
  "detalle de la tarjeta",
  "detalle del prestamo",
  "detalle de la cuenta",
  "visualizar informacion",
  "ver informacion del producto"
];

function normalize(input: string): string {
  return (input ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function buildCorpus(input: HuIntentInput): string {
  const parts: string[] = [];
  if (input.summary) parts.push(input.summary);
  if (input.description) parts.push(input.description);
  if (input.acceptanceCriteria) parts.push(input.acceptanceCriteria);
  if (input.labels && input.labels.length > 0) parts.push(input.labels.join(" "));
  if (input.components && input.components.length > 0) parts.push(input.components.join(" "));
  return normalize(parts.join(" "));
}

function countMatches(corpus: string, term: string): number {
  const needle = normalize(term);
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = corpus.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

export function detectHuIntent(input: HuIntentInput, issueKey?: string): HuIntentDetection {
  const corpus = buildCorpus(input);
  const keyLabel = issueKey ? ` issue=${issueKey}` : "";

  const docPrimary = TRANSACTIONAL_DOCUMENT_TERMS.filter((t) => countMatches(corpus, t) > 0);
  const docSecondary = TRANSACTIONAL_DOCUMENT_SECONDARY.filter((t) => countMatches(corpus, t) > 0);

  if (docPrimary.length >= 2) {
    return {
      intent: "transactional_document_flow",
      confidence: "high",
      reason: "document_generation_terms",
      matchedSignals: docPrimary
    };
  }

  if (docPrimary.length === 1 && docSecondary.length >= 2) {
    return {
      intent: "transactional_document_flow",
      confidence: docSecondary.length >= 3 ? "high" : "medium",
      reason: "document_generation_terms_combined",
      matchedSignals: [...docPrimary, ...docSecondary.slice(0, 3)]
    };
  }

  const catalogHits = CATALOG_LISTING_TERMS.filter((t) => countMatches(corpus, t) > 0);
  if (catalogHits.length >= 1) {
    return {
      intent: "catalog_listing_flow",
      confidence: "high",
      reason: "catalog_browse_terms",
      matchedSignals: catalogHits
    };
  }

  const privateHits = PRIVATE_NAVIGATION_TERMS.filter((t) => countMatches(corpus, t) > 0);
  if (privateHits.length >= 1) {
    return {
      intent: "private_navigation_flow",
      confidence: "high",
      reason: "explicit_private_path",
      matchedSignals: privateHits
    };
  }

  const detailHits = PRODUCT_DETAIL_TERMS.filter((t) => countMatches(corpus, t) > 0);
  if (detailHits.length >= 1) {
    return {
      intent: "product_detail_flow",
      confidence: "medium",
      reason: "product_detail_terms",
      matchedSignals: detailHits
    };
  }

  return {
    intent: "unknown_flow",
    confidence: "low",
    reason: "no_specific_intent",
    matchedSignals: []
  };
}

export function isCatalogListingIntent(intent: HuIntent): boolean {
  return intent === "catalog_listing_flow";
}

export function isTransactionalDocumentIntent(intent: HuIntent): boolean {
  return intent === "transactional_document_flow";
}
