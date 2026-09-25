"use strict";
/**
 * HU Intent Classifier
 *
 * Detects the functional intent of a Jira HU/issue to guard scenario generation
 * against routing a transactional/documental flow through a catalog/listing route
 * profile (e.g. "Información de productos" for a "Carta de Referencia" flow).
 *
 * Generic signals — no hardcoded appSlug, issueKey, products, routes or labels.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectHuIntent = detectHuIntent;
exports.isCatalogListingIntent = isCatalogListingIntent;
exports.isTransactionalDocumentIntent = isTransactionalDocumentIntent;
const TRANSACTIONAL_DOCUMENT_TERMS = [
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
const TRANSACTIONAL_DOCUMENT_SECONDARY = [
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
const CATALOG_LISTING_TERMS = [
    "informacion de productos",
    "catalogo de productos",
    "listado de productos",
    "ver productos",
    "explorar productos",
    "consultar productos",
    "productos disponibles",
    "categorias disponibles"
];
const PRIVATE_NAVIGATION_TERMS = [
    "menu:",
    "ruta:",
    "modulo:",
    "opcion:"
];
const PRODUCT_DETAIL_TERMS = [
    "detalle del producto",
    "detalle de la tarjeta",
    "detalle del prestamo",
    "detalle de la cuenta",
    "visualizar informacion",
    "ver informacion del producto"
];
function normalize(input) {
    return (input ?? "")
        .toString()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
}
function buildCorpus(input) {
    const parts = [];
    if (input.summary)
        parts.push(input.summary);
    if (input.description)
        parts.push(input.description);
    if (input.acceptanceCriteria)
        parts.push(input.acceptanceCriteria);
    if (input.labels && input.labels.length > 0)
        parts.push(input.labels.join(" "));
    if (input.components && input.components.length > 0)
        parts.push(input.components.join(" "));
    return normalize(parts.join(" "));
}
function countMatches(corpus, term) {
    const needle = normalize(term);
    if (!needle)
        return 0;
    let count = 0;
    let idx = 0;
    while ((idx = corpus.indexOf(needle, idx)) !== -1) {
        count++;
        idx += needle.length;
    }
    return count;
}
function detectHuIntent(input, issueKey) {
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
function isCatalogListingIntent(intent) {
    return intent === "catalog_listing_flow";
}
function isTransactionalDocumentIntent(intent) {
    return intent === "transactional_document_flow";
}
