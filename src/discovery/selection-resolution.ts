/**
 * Selection Resolution Utilities
 * 
 * Utilities for detecting selection-like targets and enforcing
 * higher confidence thresholds for semantic selection.
 */

/**
 * Selection-like keywords that indicate a product/item selection action
 */
const SELECTION_KEYWORDS = [
  "seleccionar", "select", "choose", "pick", "elegir",
  "portátil", "laptop", "notebook", "computadora", "computador",
  "teléfono", "telefono", "phone", "mobile", "celular",
  "tablet", "ipad",
  "reloj", "watch",
  "airpods", "audífonos", "audifonos", "headphones",
  "macbook", "mac book", "apple", "samsung", "sony", "lg", "hp", "dell", "lenovo",
  "air", "pro", "max", "mini",
  "barato", "cheap", "económico", "economico",
  "caro", "expensive", "costoso",
  "primero", "first", "primer", "último", "ultimo", "last",
  "mejor", "best", "peor", "worst",
  "más cercano", "mas cercano", "closest", "nearest",
  "más barato", "mas barato", "cheapest",
  "más caro", "mas caro", "most expensive"
];

/**
 * Tokens to ignore when comparing semantic match
 */
const STOPWORDS = [
  "la", "las", "lo", "los", "el", "de", "del", "y", "o", "pero",
  "con", "sin", "por", "para", "en", "un", "una", "unos", "unas",
  "the", "a", "an", "and", "or", "but", "with", "without", "for", "in", "on"
];

/**
 * Check if a target is selection-like (product/item selection)
 */
export function isSelectionLikeTarget(target: string): boolean {
  const normalized = target.toLowerCase();
  return SELECTION_KEYWORDS.some(keyword => normalized.includes(keyword));
}

/**
 * Extract meaningful tokens from target (excluding stopwords)
 */
export function extractMeaningfulTokens(target: string): string[] {
  const normalized = target.toLowerCase();
  const tokens = normalized.split(/[\s,.-]+/).filter(t => t.length > 0);
  return tokens.filter(t => !STOPWORDS.includes(t));
}

/**
 * Check if post-click content matches target semantics
 */
export function verifyPostClickSemanticMatch(
  target: string,
  visibleTexts: string[],
  pageTitle?: string
): { matches: boolean; mismatchReason?: string; matchedTokens: string[]; missingTokens: string[] } {
  const meaningfulTokens = extractMeaningfulTokens(target);
  const allText = [pageTitle, ...visibleTexts].join(" ").toLowerCase();
  
  const matchedTokens: string[] = [];
  const missingTokens: string[] = [];
  
  for (const token of meaningfulTokens) {
    if (allText.includes(token)) {
      matchedTokens.push(token);
    } else {
      missingTokens.push(token);
    }
  }
  
  // If more than 50% of meaningful tokens are missing, it's a mismatch
  const matchRatio = meaningfulTokens.length > 0 ? matchedTokens.length / meaningfulTokens.length : 0;
  
  if (matchRatio < 0.5 && missingTokens.length > 0) {
    return {
      matches: false,
      mismatchReason: `Post-click content missing key tokens: ${missingTokens.join(", ")}`,
      matchedTokens,
      missingTokens
    };
  }
  
  return { matches: true, matchedTokens, missingTokens };
}

/**
 * Get selection-specific confidence threshold
 */
export function getSelectionConfidenceThreshold(): number {
  const envThreshold = process.env.SELECTION_LOCAL_CONFIDENCE_THRESHOLD;
  if (envThreshold) {
    const parsed = parseFloat(envThreshold);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      return parsed;
    }
  }
  return 0.85; // Default: high threshold for selection
}

/**
 * Get AI repair threshold for selection (when to invoke AI)
 */
export function getSelectionAiRepairThreshold(): number {
  const envThreshold = process.env.SELECTION_AI_REPAIR_THRESHOLD;
  if (envThreshold) {
    const parsed = parseFloat(envThreshold);
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      return parsed;
    }
  }
  return 0.60; // Default: invoke AI when confidence < 0.60
}

/**
 * Check if confidence is sufficient for selection-like target
 */
export function isSelectionConfidenceSufficient(confidence: number): boolean {
  return confidence >= getSelectionConfidenceThreshold();
}

/**
 * Check if AI selection_resolution should be invoked
 */
export function shouldInvokeAiSelectionResolution(
  confidence: number,
  isAmbiguous: boolean
): boolean {
  const aiThreshold = getSelectionAiRepairThreshold();
  const localThreshold = getSelectionConfidenceThreshold();
  
  // Always invoke AI for ambiguous selection
  if (isAmbiguous) {
    return true;
  }
  
  // Invoke AI if confidence is below local threshold but above AI threshold
  if (confidence < localThreshold && confidence >= aiThreshold) {
    return true;
  }
  
  return false;
}

/**
 * Block low-confidence semantic fallback for selection-like targets
 */
export function shouldBlockSemanticFallback(
  target: string,
  confidence: number,
  strategy: string
): boolean {
  if (!isSelectionLikeTarget(target)) {
    return false;
  }
  
  if (!strategy.includes("semantic")) {
    return false;
  }
  
  const localThreshold = getSelectionConfidenceThreshold();
  
  // Block semantic fallback for selection-like targets with low confidence
  return confidence < localThreshold;
}

/**
 * Selection candidate with enriched context for AI repair
 */
export interface SelectionCandidate {
  candidateId: string;
  role: string;
  name: string;
  text: string;
  visible: boolean;
  enabled: boolean;
  clickable: boolean;
  editable: boolean;
  semanticRelation?: string;
  score?: number;
  sensitive: boolean;
  // Enriched fields for AI selection
  cardText?: string;
  nearbyText?: string;
  priceText?: string;
  categoryHeading?: string;
  position: number;
}

/**
 * Snapshot element type for harvesting
 */
interface SnapshotElement {
  id: string;
  role?: string;
  name?: string;
  text?: string;
  label?: string;
  placeholder?: string;
  type?: string;
  tagName?: string;
  visible?: boolean;
  nearbyText?: string;
  heading?: number;
}

/**
 * Snapshot type for harvesting (compatible with PageSnapshot)
 */
interface Snapshot {
  elements: SnapshotElement[];
  title?: string;
  url?: string;
  summary?: { totalElements?: number } | string;
}

/**
 * Price pattern for extraction
 */
const PRICE_PATTERN = /\$[\d,]+(\.\d{2})?|\d{3,}(,\d{3})*(\.\d{2})?/g;

/**
 * Extract price from text
 */
function extractPrice(text: string): string | undefined {
  const matches = text.match(PRICE_PATTERN);
  return matches && matches.length > 0 ? matches[0] : undefined;
}

/**
 * Check if element is product/card-like
 */
function isProductCardElement(el: SnapshotElement): boolean {
  const text = (el.text ?? el.name ?? el.label ?? "").toLowerCase();
  const role = el.role?.toLowerCase();
  const tag = el.tagName?.toLowerCase();
  
  // Check for heading elements (product names)
  if (el.heading === 4 || el.heading === 5) {
    return true;
  }
  
  // Check for link/button roles with product-like text
  if (role === "link" || role === "button") {
    return true;
  }
  
  // Check for common product card tags
  if (tag === "a" || tag === "button") {
    return true;
  }
  
  return false;
}

/**
 * Build enriched selection candidates from snapshot
 * 
 * Harvests all visible product/card elements from the current snapshot,
 * enriching each with card text, nearby text, price, and category context.
 */
export function buildSelectionCandidatesFromSnapshot(
  snapshot: Snapshot,
  target: string,
  existingCandidates?: Array<{ elementId?: string; matchReason?: string; matchScore?: number }>
): SelectionCandidate[] {
  const candidates: SelectionCandidate[] = [];
  const seenIds = new Set<string>();
  const meaningfulTokens = extractMeaningfulTokens(target);
  
  // Extract category headings for context
  const headings = snapshot.elements
    .filter(el => el.heading === 3 || el.heading === 4)
    .map(el => el.text ?? el.name ?? "")
    .filter(Boolean);
  
  // Find product card elements
  const productElements = snapshot.elements.filter(el => isProductCardElement(el));
  
  // Group elements by proximity (simple: by index distance)
  const elementIndexMap = new Map<string, number>();
  snapshot.elements.forEach((el, idx) => {
    elementIndexMap.set(el.id, idx);
  });
  
  // Build candidates from product elements
  for (let i = 0; i < productElements.length; i++) {
    const el = productElements[i];
    const elementIndex = elementIndexMap.get(el.id) ?? i;
    
    // Skip if already processed
    if (seenIds.has(el.id)) {
      continue;
    }
    
    // Extract nearby elements (within 10 positions)
    const nearbyTexts: string[] = [];
    const cardTexts: string[] = [];
    let priceText: string | undefined;
    let categoryHeading: string | undefined;
    
    const nearbyStart = Math.max(0, elementIndex - 10);
    const nearbyEnd = Math.min(snapshot.elements.length, elementIndex + 10);
    
    for (let j = nearbyStart; j < nearbyEnd; j++) {
      if (j === elementIndex) continue;
      
      const nearbyEl = snapshot.elements[j];
      const nearbyText = nearbyEl.text ?? nearbyEl.name ?? nearbyEl.label;
      
      if (nearbyText) {
        // Check if it's a heading (category context)
        if (nearbyEl.heading === 3 || nearbyEl.heading === 4) {
          if (!categoryHeading) {
            categoryHeading = nearbyText;
          }
        } else {
          nearbyTexts.push(nearbyText);
        }
        
        // Extract price
        if (!priceText) {
          priceText = extractPrice(nearbyText);
        }
      }
    }
    
    // Build card text from element's own content
    const elementTexts = [el.text, el.name, el.label, el.placeholder, el.nearbyText].filter((t): t is string => Boolean(t));
    if (elementTexts.length > 0) {
      cardTexts.push(...elementTexts);
    }
    
    // Extract price from element's own text if not found nearby
    if (!priceText) {
      const allElementTexts = elementTexts.join(" ");
      priceText = extractPrice(allElementTexts);
    }
    
    // Determine semantic relation based on token matching
    const elText = (el.text ?? el.name ?? el.label ?? "").toLowerCase();
    const matchCount = meaningfulTokens.filter(token => elText.includes(token)).length;
    const semanticRelation = matchCount >= 2 ? "strong_match" : 
                             matchCount === 1 ? "partial_match" : 
                             "eligible_option";
    
    // Calculate score based on match
    const score = meaningfulTokens.length > 0 ? matchCount / meaningfulTokens.length : 0.5;
    
    const candidate: SelectionCandidate = {
      candidateId: el.id,
      role: el.role ?? "link",
      name: el.name ?? el.label ?? el.text ?? `product-${i}`,
      text: el.text ?? el.label ?? el.name ?? `product-${i}`,
      visible: Boolean(el.visible),
      enabled: true,
      clickable: Boolean(el.visible && (el.type === "button" || el.tagName === "a" || el.role === "link" || el.role === "button")),
      editable: Boolean(el.type === "input" || el.type === "textarea" || el.role === "textbox"),
      semanticRelation,
      score,
      sensitive: false,
      cardText: cardTexts.slice(0, 5).join(" ") || undefined,
      nearbyText: nearbyTexts.slice(0, 10).join(" ") || undefined,
      priceText,
      categoryHeading,
      position: candidates.length + 1
    };
    
    candidates.push(candidate);
    seenIds.add(el.id);
  }
  
  // Merge with existing candidates from resolution (if any)
  if (existingCandidates && existingCandidates.length > 0) {
    for (const existing of existingCandidates) {
      if (!seenIds.has(existing.elementId ?? "")) {
        const el = snapshot.elements.find(e => e.id === existing.elementId);
        if (el) {
          const candidate: SelectionCandidate = {
            candidateId: existing.elementId ?? `candidate-${candidates.length}`,
            role: el.role ?? "button",
            name: el.name ?? el.label ?? el.text ?? `candidate-${candidates.length}`,
            text: el.text ?? el.label ?? el.name ?? `candidate-${candidates.length}`,
            visible: Boolean(el.visible),
            enabled: true,
            clickable: Boolean(el.visible && (el.type === "button" || el.type === "link" || el.role === "button" || el.role === "link")),
            editable: Boolean(el.type === "input" || el.type === "textarea" || el.role === "textbox"),
            semanticRelation: existing.matchReason ?? "candidate",
            score: existing.matchScore,
            sensitive: false,
            position: candidates.length + 1
          };
          candidates.push(candidate);
          seenIds.add(existing.elementId ?? "");
        }
      }
    }
  }
  
  // Sort by score (semantic match) and visibility
  candidates.sort((a, b) => {
    // Prefer visible and clickable
    if (a.visible && !b.visible) return -1;
    if (!a.visible && b.visible) return 1;
    if (a.clickable && !b.clickable) return -1;
    if (!a.clickable && b.clickable) return 1;
    
    // Then by semantic score
    if (a.score !== undefined && b.score !== undefined) {
      return b.score - a.score;
    }
    
    // Then by position
    return a.position - b.position;
  });
  
  // Limit to top 12 candidates
  return candidates.slice(0, 12);
}
