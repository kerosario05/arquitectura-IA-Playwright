import type { PageSnapshot, SnapshotElement } from "../types/page-snapshot.types";

export type CompoundFormFieldsAssertion = {
  type: "compound_form_fields";
  containerKind: "form" | "modal" | "dialog" | "panel" | "screen";
  fields: string[];
  originalText: string;
};

export type CompoundFormFieldsResolution = {
  passed: boolean;
  resolver: "compound_form_fields";
  assertion: string;
  fields: string[];
  satisfied: string[];
  missing: string[];
  evidence: string[];
  confidence: number;
};

const CONTAINER_PATTERNS: Record<string, RegExp> = {
  form: /formulario|form\b/i,
  modal: /modal|ventana\s+emergente/i,
  dialog: /dialog|di[aá]logo/i,
  panel: /panel|panel\s+lateral|drawer/i,
  screen: /pantalla|screen|page|p[aá]gina/i
};

function extractQuotedFields(text: string): string[] {
  const fields: string[] = [];
  
  const doubleQuotePattern = /"([^"]+)"/g;
  const singleQuotePattern = /'([^']+)'/g;
  
  let match;
  while ((match = doubleQuotePattern.exec(text)) !== null) {
    fields.push(match[1].trim());
  }
  
  while ((match = singleQuotePattern.exec(text)) !== null) {
    fields.push(match[1].trim());
  }
  
  return fields;
}

function detectContainerKind(text: string): "form" | "modal" | "dialog" | "panel" | "screen" {
  const normalized = text.toLowerCase();
  
  for (const [kind, pattern] of Object.entries(CONTAINER_PATTERNS)) {
    if (pattern.test(normalized)) {
      return kind as "form" | "modal" | "dialog" | "panel" | "screen";
    }
  }
  
  return "form";
}

function parseCompoundFormFieldsAssertion(assertionText: string): CompoundFormFieldsAssertion | null {
  const fields = extractQuotedFields(assertionText);
  
  // Must have at least 2 quoted fields to be considered a compound assertion
  // Single quoted text should remain as literal_observable
  if (fields.length < 2) {
    return null;
  }
  
  // Must have form/modal/dialog context keywords
  const hasContainerContext = /formulario|form\b|modal|dialog|pantalla|screen|campos|fields/i.test(assertionText);
  
  if (!hasContainerContext) {
    return null;
  }
  
  const containerKind = detectContainerKind(assertionText);
  
  return {
    type: "compound_form_fields",
    containerKind,
    fields,
    originalText: assertionText
  };
}

function isFieldVisibleInSnapshot(snapshot: PageSnapshot, fieldName: string): { visible: boolean; evidence: string } {
  const normalizedField = fieldName.toLowerCase().trim();
  
  for (const element of snapshot.elements) {
    const texts = [
      element.text,
      element.label,
      element.name,
      element.placeholder,
      element.nearbyText
    ].filter(Boolean) as string[];
    
    const role = element.role?.toLowerCase() || "";
    const tag = element.tagName?.toLowerCase() || "";
    const type = element.type?.toLowerCase() || "";
    
    for (const text of texts) {
      const normalizedText = text.toLowerCase().trim();
      
      if (normalizedText === normalizedField) {
        return { visible: true, evidence: `Label/text "${fieldName}" found` };
      }
      
      if (normalizedText.includes(normalizedField) && normalizedText.length < 50) {
        return { visible: true, evidence: `Text containing "${fieldName}" found: "${text}"` };
      }
    }
    
    const fieldRoles = ["textbox", "combobox", "spinbutton", "input", "searchbox"];
    if (fieldRoles.includes(role) || ["input", "select", "textarea"].includes(tag)) {
      if (element.name?.toLowerCase().includes(normalizedField) ||
          element.label?.toLowerCase().includes(normalizedField) ||
          element.placeholder?.toLowerCase().includes(normalizedField)) {
        return { visible: true, evidence: `Input field "${fieldName}" found (role: ${role || tag})` };
      }
    }
  }
  
  return { visible: false, evidence: `Field "${fieldName}" not found in visible elements` };
}

export function resolveCompoundFormFieldsAssertion(
  snapshot: PageSnapshot,
  assertionText: string
): CompoundFormFieldsResolution {
  const parsed = parseCompoundFormFieldsAssertion(assertionText);
  
  if (!parsed) {
    return {
      passed: false,
      resolver: "compound_form_fields",
      assertion: assertionText,
      fields: [],
      satisfied: [],
      missing: [],
      evidence: ["Not a compound form fields assertion"],
      confidence: 0
    };
  }
  
  const satisfied: string[] = [];
  const missing: string[] = [];
  const evidence: string[] = [];
  
  for (const field of parsed.fields) {
    const result = isFieldVisibleInSnapshot(snapshot, field);
    if (result.visible) {
      satisfied.push(field);
      evidence.push(result.evidence);
    } else {
      missing.push(field);
      evidence.push(result.evidence);
    }
  }
  
  const passed = missing.length === 0 && satisfied.length > 0;
  const confidence = passed
    ? Math.min(0.95, 0.7 + satisfied.length * 0.05)
    : satisfied.length > 0
      ? 0.5
      : 0.3;
  
  return {
    passed,
    resolver: "compound_form_fields",
    assertion: assertionText,
    fields: parsed.fields,
    satisfied,
    missing,
    evidence,
    confidence
  };
}

export { parseCompoundFormFieldsAssertion, extractQuotedFields };
