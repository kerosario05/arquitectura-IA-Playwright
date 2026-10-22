import type { PageSnapshot, SnapshotElement } from "../types/page-snapshot.types";

export const VISIBLE_DATE_TIME_TARGET = "__visible_date_time__";

const STOP_WORDS = new Set([
  "validar", "verificar", "comprobar", "confirmar", "que", "se", "muestre", "muestra", "mostrar",
  "el", "la", "los", "las", "un", "una", "de", "del", "y", "en", "por", "sus", "su", "the", "is", "are", "of", "and",
]);

type Concept =
  | "summary" | "product" | "confirmation" | "transfer" | "account" | "origin" | "destination"
  | "selected" | "amount" | "tax" | "commission" | "exchange_rate" | "total_debit"
  | "receipt" | "transaction" | "success" | "date_time" | "reference";

const CONCEPTS: Array<{ concept: Concept; pattern: RegExp }> = [
  { concept: "summary", pattern: /^(?:resumen|summary|overview)$/ },
  { concept: "product", pattern: /^(?:producto\w*|product\w*|cuenta\w*|account\w*|tarjeta\w*|card\w*|prestamo\w*|loan\w*|certificado\w*)$/ },
  { concept: "confirmation", pattern: /^(?:confirmacion\w*|confirmation\w*)$/ },
  { concept: "transfer", pattern: /^(?:transfer\w*|transferencia\w*|transfers?)$/ },
  { concept: "account", pattern: /^(?:cuenta\w*|account\w*)$/ },
  { concept: "origin", pattern: /^(?:origen|source|from)$/ },
  { concept: "destination", pattern: /^(?:destino|destination|to)$/ },
  { concept: "selected", pattern: /^(?:seleccionad\w*|involucrad\w*|selected|involved)$/ },
  { concept: "amount", pattern: /^(?:monto\w*|importe\w*|amount\w*|acredit\w*)$/ },
  { concept: "tax", pattern: /^(?:impuesto\w*|tax\w*)$/ },
  { concept: "commission", pattern: /^(?:comision\w*|commission\w*|fee\w*)$/ },
  { concept: "exchange_rate", pattern: /^(?:tasa|rate|cambio|exchange)$/ },
  { concept: "total_debit", pattern: /^(?:total\w*|debit\w*|debitad\w*)$/ },
  { concept: "receipt", pattern: /^(?:comprobante\w*|receipt\w*|voucher\w*|proof)$/ },
  { concept: "transaction", pattern: /^(?:transaccion\w*|transaction\w*|operacion\w*|operation\w*)$/ },
  { concept: "success", pattern: /^(?:exitos\w*|successful|success|successful\w*)$/ },
  { concept: "date_time", pattern: /^(?:fecha|date|hora|time|datetime)$/ },
  { concept: "reference", pattern: /^(?:referencia\w*|reference\w*|ref)$/ },
];

function normalize(value: string): string {
  return value.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function conceptsIn(value: string): Set<Concept> {
  const result = new Set<Concept>();
  for (const token of normalize(value).split(/\s+/).filter(Boolean)) {
    if (STOP_WORDS.has(token)) continue;
    for (const entry of CONCEPTS) {
      if (entry.pattern.test(token)) result.add(entry.concept);
    }
  }
  return result;
}

function visibleText(element: SnapshotElement): string | undefined {
  if (element.visible === false) return undefined;
  return [element.text, element.label, element.accessibleName, element.ariaLabel, element.name, element.title]
    .find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function candidatePriority(element: SnapshotElement): number {
  if (element.type === "heading" || element.type === "section" || element.type === "card") return 0;
  if (element.type === "text" || element.type === "dialog" || element.type === "table") return 1;
  if (element.type === "link") return 3;
  return 2;
}

/**
 * Bind a natural-language expected outcome to exact visible text from one causal page snapshot.
 * Composite requirements are supported only when each semantic component is independently
 * observed in that same snapshot. The special date/time target carries no rendered value.
 */
export function resolveObservableSnapshotMatch(requirement: string, snapshot: PageSnapshot): {
  targets: string[];
  concepts: Concept[];
  dateTimePattern?: boolean;
} | undefined {
  const quoted = requirement.match(/["“‘']([^"”’']+)["”’']/)?.[1];
  const phrase = quoted?.trim() || requirement;
  const required = conceptsIn(phrase);
  if (required.size === 0) return undefined;

  const candidates = (snapshot.elements ?? [])
    .filter((element) => element.visible !== false)
    .flatMap((element) => {
      const text = visibleText(element);
      if (!text) return [];
      // nearbyText is useful for value-only nodes, but some scanners attach an entire
      // navigation/content region to it. Keep it as a fallback, never let it outrank
      // the element's own visible label.
      const nearbyText = element.nearbyText?.trim();
      const contextualConcepts = nearbyText && nearbyText.length <= 120 ? conceptsIn(nearbyText) : new Set<Concept>();
      return [{ element, text, directConcepts: conceptsIn(text), contextualConcepts }];
    });
  const dateTimeObserved = (snapshot.elements ?? []).some((element) =>
    element.visible !== false && element.semanticSignals?.includes("date_time_value") === true,
  );
  const hasConcept = (concept: Concept) => candidates.some((candidate) =>
    candidate.directConcepts.has(concept) || candidate.contextualConcepts.has(concept),
  );
  const bestCandidate = (concept: Concept) => {
    const direct = candidates.filter((candidate) => candidate.directConcepts.has(concept))
      .sort((a, b) => candidatePriority(a.element) - candidatePriority(b.element))[0];
    if (direct) return direct;
    return candidates.filter((candidate) => candidate.contextualConcepts.has(concept))
      .sort((a, b) => candidatePriority(a.element) - candidatePriority(b.element))[0];
  };
  const source = candidates.find((candidate) => candidate.directConcepts.has("origin"))?.text;
  const destination = candidates.find((candidate) => candidate.directConcepts.has("destination"))?.text;
  const accountPairObserved = Boolean(source && destination && hasConcept("account"));
  const available = new Set<Concept>(candidates.flatMap((candidate) => [...candidate.directConcepts, ...candidate.contextualConcepts]));
  if (accountPairObserved) {
    available.add("account");
    available.add("selected");
  }
  // A confirmation view may not literally say "confirmation". Require the stronger
  // summary shape: both accounts, a transfer, an amount, and a total debit value.
  if (accountPairObserved && hasConcept("transfer") && hasConcept("amount") && hasConcept("total_debit")) {
    available.add("confirmation");
  }
  if (dateTimeObserved) available.add("date_time");
  if (required.has("selected") && required.has("account")) available.add("selected");
  if (required.has("date_time") && dateTimeObserved) available.add("date_time");
  if (![...required].every((concept) => available.has(concept))) return undefined;

  const targets: string[] = [];
  if (required.has("account") && (required.has("selected") || required.has("origin") || required.has("destination"))) {
    if (!source || !destination) return undefined;
    targets.push(source, destination);
  }
  if (required.has("date_time")) targets.push(VISIBLE_DATE_TIME_TARGET);
  for (const concept of required) {
    if (["account", "origin", "destination", "selected", "date_time"].includes(concept) || (concept === "product" && required.has("account"))) continue;
    const match = bestCandidate(concept);
    if (match) targets.push(match.text);
  }
  const deduped = [...new Set(targets)];
  return deduped.length > 0
    ? { targets: deduped, concepts: [...required], ...(dateTimeObserved && required.has("date_time") ? { dateTimePattern: true } : {}) }
    : undefined;
}

export function isVisibleDateTime(value: string): boolean {
  const text = value.replace(/\s+/g, " ").trim();
  const date = String.raw`(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})`;
  const time = String.raw`\d{1,2}:\d{2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?`;
  return new RegExp(String.raw`\b${date}\s+${time}\b`, "i").test(text);
}

export const VISIBLE_DATE_TIME_REGEX_SOURCE = String.raw`\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\b`;
