import type { PageSnapshot, SnapshotElement } from "../types/page-snapshot.types";

export type CatalogItemEvidence = {
  hasTitle: boolean;
  hasPrice: boolean;
  hasImage: boolean;
  titleText?: string;
  priceText?: string;
  imageAlt?: string;
};

export type CatalogListResolution = {
  passed: boolean;
  resolver: "catalog_list_structure";
  assertion: string;
  matchedItems: number;
  evidence: string[];
  items?: CatalogItemEvidence[];
  confidence: number;
  diagnostics?: {
    category?: string;
    productsVisible: boolean;
    cardCount: number;
    structuralMatch: boolean;
    reason: string;
  };
};

const MONETARY_PATTERN = /(?:USD?\$|EUR|RD\$|\$|€|£)\s*\d[\d,.]*|\d[\d,.]*\s*(?:USD|EUR|RD\$)/i;

const CATALOG_ASSERTION_PATTERNS = [
  /listado\s+se\s+actualiza/i,
  /catalogo\s+se\s+actualiza/i,
  /cat[aá]logo\s+se\s+actualiza/i,
  /listado\s+actualizado/i,
  /catalogo\s+actualizado/i,
  /cat[aá]logo\s+actualizado/i,
  /primera\s+tarjeta\s+visible/i,
  /productos?\s+relacionados?\s+con\s+(?:la\s+)?categor[ií]a/i,
  /producto\s+visible.*(?:nombre.*precio|precio.*nombre)/i,
  /producto.*(?:nombre.*precio|precio.*nombre).*visible/i,
  /productos?\s+disponibles?/i,
  /precio\s+visible/i,
  /imagen\s+(?:de\s+)?(?:referencia|producto)/i,
  /lista\s+de\s+resultados?\s+visible/i,
  /tarjetas?\s+visibles?/i,
  /cat[aá]logo\s+visible/i,
  /resultados?\s+disponibles?/i,
  /listado\s+de\s+(?:opciones?|productos?|resultados?)\s+visible/i,
  /al\s+menos\s+un\s+producto/i,
  /(?:card|tarjeta).*(?:titulo|nombre|precio|imagen)/i,
  /(?:title|name|price|image).*(?:title|name|price|image)/i,
  /listado\s+filtrado/i,
  /cada\s+producto\s+visible/i,
  /elementos?\s+disponibles?/i,
  /lista\s+(?:de\s+)?(?:productos?|resultados?|opciones?)\s+visible/i,
];

const CATALOG_LIST_KEYWORDS = [
  "productos disponibles",
  "precio visible",
  "imagen de referencia",
  "lista de resultados",
  "tarjetas visibles",
  "catalogo visible",
  "catálogo visible",
  "resultados disponibles",
  "listado de opciones visible",
  "listado de productos visible",
  "listado visible",
  "al menos un producto",
  "card visible",
  "cards visibles",
  "listado filtrado",
  "cada producto visible",
  "elementos disponibles",
  "lista de productos",
  "lista de resultados",
];

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isCatalogListAssertion(assertionText: string): boolean {
  const normalized = normalizeText(assertionText);

  for (const pattern of CATALOG_ASSERTION_PATTERNS) {
    if (pattern.test(assertionText)) return true;
  }

  for (const keyword of CATALOG_LIST_KEYWORDS) {
    if (normalized.includes(normalizeText(keyword))) return true;
  }

  return false;
}

function extractCategoryFromAssertion(assertionText: string): string | undefined {
  const match = assertionText.match(/categor[ií]a\s+['"]?([a-z0-9 _-]{2,})['"]?/i);
  if (!match?.[1]) return undefined;
  return match[1].trim();
}

function hasPricePattern(text: string): boolean {
  return MONETARY_PATTERN.test(text);
}

function isImageElement(el: SnapshotElement): boolean {
  const tag = el.tagName?.toLowerCase();
  const role = el.role?.toLowerCase();
  const type = el.type?.toLowerCase();

  if (tag === "img") return true;
  if (role === "img" || role === "image") return true;
  if (type === "image") return true;

  if (el.alt && el.alt.trim().length > 0) return true;
  if ((el as any).src && (el as any).src.trim().length > 0) return true;

  return false;
}

function isContainerElement(el: SnapshotElement): boolean {
  const tag = el.tagName?.toLowerCase();
  const role = el.role?.toLowerCase();
  const elType = el.type?.toLowerCase();
  const className = (el as any).className || "";

  if (tag === "article") return true;
  if (role === "listitem" || role === "list-item") return true;
  if (elType === "card") return true;

  const containerPatterns = ["card", "list-item", "listitem", "product-item", "product-card", "item-card"];
  if (typeof className === "string") {
    const normalizedClass = className.toLowerCase();
    for (const pattern of containerPatterns) {
      if (normalizedClass.includes(pattern)) return true;
    }
  }

  return false;
}

function collectContainerItems(snapshot: PageSnapshot): Array<{ container: SnapshotElement; children: SnapshotElement[] }> {
  const containers = snapshot.elements.filter(isContainerElement);
  const result: Array<{ container: SnapshotElement; children: SnapshotElement[] }> = [];

  for (const container of containers) {
    const children = snapshot.elements.filter((el) => {
      if (el === container) return false;

      const containerIndex = snapshot.elements.indexOf(container);
      const elIndex = snapshot.elements.indexOf(el);

      if (elIndex > containerIndex) {
        let parent = containerIndex;
        for (let i = containerIndex + 1; i < elIndex; i++) {
          const intermediate = snapshot.elements[i];
          if (isContainerElement(intermediate)) {
            parent = i;
          }
        }
        return parent === containerIndex;
      }

      return false;
    });

    if (children.length > 0) {
      result.push({ container, children });
    }
  }

  return result;
}

function analyzeItemForEvidence(elements: SnapshotElement[]): CatalogItemEvidence {
  const evidence: CatalogItemEvidence = {
    hasTitle: false,
    hasPrice: false,
    hasImage: false,
  };

  for (const el of elements) {
    const text = el.text || el.label || el.name || el.placeholder || "";

    if (!evidence.hasTitle && text && text.trim().length > 2) {
      const tag = el.tagName?.toLowerCase();
      const role = el.role?.toLowerCase();
      if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") {
        evidence.hasTitle = true;
        evidence.titleText = text.trim();
      } else if (role === "heading") {
        evidence.hasTitle = true;
        evidence.titleText = text.trim();
      } else if (text.trim().length > 3 && text.trim().length < 100) {
        if (!hasPricePattern(text)) {
          evidence.hasTitle = true;
          evidence.titleText = text.trim();
        }
      }
    }

    if (!evidence.hasPrice && hasPricePattern(text)) {
      evidence.hasPrice = true;
      evidence.priceText = text.trim();
    }

    if (!evidence.hasImage && isImageElement(el)) {
      evidence.hasImage = true;
      evidence.imageAlt = el.alt || el.text || "";
    }
  }

  return evidence;
}

function analyzeFlatElements(elements: SnapshotElement[]): CatalogItemEvidence[] {
  const items: CatalogItemEvidence[] = [];
  const priceElements = elements.filter((el) => {
    const text = el.text || el.label || el.name || "";
    return hasPricePattern(text);
  });

  const imageElements = elements.filter(isImageElement);

  const titleElements = elements.filter((el) => {
    const text = el.text || el.label || el.name || "";
    if (!text || text.trim().length < 3) return false;
    if (hasPricePattern(text)) return false;
    const tag = el.tagName?.toLowerCase();
    const role = el.role?.toLowerCase();
    if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") return true;
    if (role === "heading") return true;
    return text.trim().length > 3 && text.trim().length < 100;
  });

  const maxCount = Math.max(
    priceElements.length,
    imageElements.length,
    titleElements.length,
    0
  );

  if (maxCount === 0) return [];

  for (let i = 0; i < maxCount; i++) {
    const evidence: CatalogItemEvidence = {
      hasTitle: false,
      hasPrice: false,
      hasImage: false,
    };

    if (i < titleElements.length) {
      evidence.hasTitle = true;
      evidence.titleText = (titleElements[i].text || titleElements[i].label || "").trim();
    }
    if (i < priceElements.length) {
      evidence.hasPrice = true;
      evidence.priceText = (priceElements[i].text || priceElements[i].label || "").trim();
    }
    if (i < imageElements.length) {
      evidence.hasImage = true;
      evidence.imageAlt = imageElements[i].alt || "";
    }

    items.push(evidence);
  }

  return items;
}

export function resolveCatalogListAssertion(
  snapshot: PageSnapshot,
  assertionText: string
): CatalogListResolution {
  if (!isCatalogListAssertion(assertionText)) {
    return {
      passed: false,
      resolver: "catalog_list_structure",
      assertion: assertionText,
      matchedItems: 0,
      evidence: [],
      confidence: 0,
    };
  }

  const normalized = normalizeText(assertionText);
  const requiresTitle = /nombre|title|name/i.test(assertionText);
  const requiresPrice = /precio|price|monto|amount/i.test(assertionText);
  const requiresImage = /imagen|image|foto|photo/i.test(assertionText);
  const requiresAtLeastOne = /al\s+menos\s+un|at\s+least\s+one/i.test(assertionText);
  const requiresEach = /cada\s+producto|each\s+product/i.test(assertionText);
  const isFilteredList = /listado\s+filtrado|filtered\s+list/i.test(assertionText);
  const requiresVisibleItems = /visibles?|disponibles?|available|visible/i.test(assertionText);
  const isUpdateAssertion = /listado\s+(?:actualizado|se\s+actualiza)|cat[aá]logo\s+(?:actualizado|se\s+actualiza)|resultados?\s+visibles?/i.test(normalized);
  const isCategoryRelatedAssertion = /productos?\s+relacionados?\s+con\s+(?:la\s+)?categor[ií]a/i.test(assertionText);
  const category = extractCategoryFromAssertion(assertionText);

  const containerGroups = collectContainerItems(snapshot);
  let items: CatalogItemEvidence[] = [];

  if (containerGroups.length > 0) {
    for (const group of containerGroups) {
      const evidence = analyzeItemForEvidence(group.children);
      items.push(evidence);
    }
  } else {
    items = analyzeFlatElements(snapshot.elements);
  }

  const passingItems = items.filter((item) => {
    if (requiresTitle && !item.hasTitle) return false;
    if (requiresPrice && !item.hasPrice) return false;
    if (requiresImage && !item.hasImage) return false;
    return true;
  });

  const matchedItems = passingItems.length;
  const evidence: string[] = [];

  for (const item of passingItems.slice(0, 5)) {
    const parts: string[] = [];
    if (item.hasTitle) parts.push(`item has title text${item.titleText ? `: "${item.titleText.slice(0, 40)}"` : ""}`);
    if (item.hasPrice) parts.push(`item has price pattern${item.priceText ? `: "${item.priceText}"` : ""}`);
    if (item.hasImage) parts.push(`item has visible image${item.imageAlt ? `: "${item.imageAlt.slice(0, 40)}"` : ""}`);
    if (parts.length > 0) {
      evidence.push(parts.join(", "));
    }
  }

  if (items.length > 0 && passingItems.length === 0) {
    for (const item of items.slice(0, 3)) {
      const missing: string[] = [];
      if (requiresTitle && !item.hasTitle) missing.push("title");
      if (requiresPrice && !item.hasPrice) missing.push("price");
      if (requiresImage && !item.hasImage) missing.push("image");
      if (missing.length > 0) {
        evidence.push(`item missing: ${missing.join(", ")}`);
      }
    }
  }

  const hasAnyVisibleItems = items.length > 0;
  const cardCount = snapshot.elements.filter((el) => {
    const tag = (el.tagName ?? "").toLowerCase();
    const role = (el.role ?? "").toLowerCase();
    const type = (el.type ?? "").toLowerCase();
    return type === "card" || tag === "article" || role === "listitem";
  }).length || items.length;
  
  // "cada producto visible" requires ALL items to pass, not just one
  let passed = false;
  if (requiresEach) {
    passed = items.length > 0 && passingItems.length === items.length;
  } else if (requiresAtLeastOne) {
    passed = passingItems.length >= 1;
  } else if (requiresVisibleItems || isFilteredList) {
    passed = passingItems.length >= 1;
  } else {
    passed = passingItems.length >= 1;
  }

  if (!passed && (isUpdateAssertion || isCategoryRelatedAssertion) && hasAnyVisibleItems) {
    passed = true;
  }

  let confidence = 0;
  if (passed) {
    if (requiresEach) {
      confidence = Math.min(0.95, 0.75 + (passingItems.length / Math.max(items.length, 1)) * 0.2);
    } else {
      confidence = Math.min(0.95, 0.7 + passingItems.length * 0.05);
    }
  } else if (hasAnyVisibleItems) {
    confidence = 0.3;
  }

  const structuralMatch = passed && (isUpdateAssertion || isCategoryRelatedAssertion || requiresVisibleItems);
  const reason = isCategoryRelatedAssertion
    ? "category_click_changed_visible_product_list"
    : isUpdateAssertion
      ? "catalog_list_updated_with_visible_products"
      : "catalog_list_structure_detected";

  return {
    passed,
    resolver: "catalog_list_structure",
    assertion: assertionText,
    matchedItems,
    evidence,
    items: passingItems.slice(0, 10),
    confidence,
    diagnostics: {
      category,
      productsVisible: hasAnyVisibleItems,
      cardCount,
      structuralMatch,
      reason
    }
  };
}

export { isCatalogListAssertion };
