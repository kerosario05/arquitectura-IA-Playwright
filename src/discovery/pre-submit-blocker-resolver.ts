import type { Page, Locator } from "@playwright/test";
import type { PageSnapshot, SnapshotElement } from "../types/page-snapshot.types";
import type { AutoGenerateConfig } from "../data/auto-test-data-generator";
import type { DataKeyResolution } from "../data/data-key-resolver";

export type BlockerType =
  | "required_text_fields"
  | "required_numeric_fields"
  | "required_selection"
  | "required_radio"
  | "required_checkbox"
  | "required_dropdown"
  | "required_date"
  | "required_file"
  | "required_consent"
  | "waiting_for_async_state"
  | "unknown_blocker";

export type BlockerResolution = {
  type: BlockerType;
  field?: string;
  label?: string;
  resolved: boolean;
  source?: string;
  reason?: string;
  sensitive?: boolean;
};

export type PreSubmitBlockerResult = {
  evaluated: boolean;
  target: string;
  blockerTypes: BlockerType[];
  blockers: BlockerResolution[];
  fieldsFilled: string[];
  selectionsMade: string[];
  checkboxesChecked: string[];
  generatedDataUsed: boolean;
  sensitiveBlocked: boolean;
  retriedSubmit: boolean;
  result: "submitted_after_blockers_resolved" | "pre_submit_blocker_unresolved" | "button_still_blocked" | "no_blockers_detected";
};

export type PreSubmitBlockerOptions = {
  page: Page;
  actionText: string;
  target: string;
  snapshot: PageSnapshot;
  submitLocator?: Locator;
  testData?: Record<string, unknown>;
  autoGenerateConfig?: AutoGenerateConfig;
  autoSelectSafeDefaults?: boolean;
  autoAcceptSafeCheckboxes?: boolean;
};

const SUBMIT_LIKE_KEYWORDS = [
  "continuar", "continue", "siguiente", "next",
  "confirmar", "confirm", "enviar", "submit",
  "guardar", "save", "purchase", "comprar",
  "solicitar", "finalizar", "aceptar", "ok",
  "proceed", "place order", "pay", "pagar"
];

const SENSITIVE_CONSENT_KEYWORDS = [
  "términos", "terminos", "terms", "conditions", "condiciones",
  "contrato", "contract", "pago", "payment", "transferencia", "transfer",
  "préstamo", "prestamo", "loan", "débito", "debit",
  "autorización", "autorizacion", "authorization", "firma", "signature",
  "consentimiento", "consent", "privacidad", "privacy"
];

function isSubmitLikeAction(actionText: string, target: string): boolean {
  const combined = `${actionText} ${target}`.toLowerCase();
  return SUBMIT_LIKE_KEYWORDS.some(keyword => combined.includes(keyword));
}

function isSensitiveConsent(label: string): boolean {
  const normalized = label.toLowerCase();
  return SENSITIVE_CONSENT_KEYWORDS.some(keyword => normalized.includes(keyword));
}

async function detectBlockers(snapshot: PageSnapshot, submitLocator?: Locator): Promise<{ blockerTypes: BlockerType[]; elements: SnapshotElement[] }> {
  const blockerTypes = new Set<BlockerType>();
  const elements: SnapshotElement[] = [];
  
  for (const element of snapshot.elements) {
    const role = element.role?.toLowerCase() || "";
    const tag = element.tagName?.toLowerCase() || "";
    const type = element.type?.toLowerCase() || "";
    const text = (element.text || element.label || element.name || "").toLowerCase();
    const ariaRequired = (element as any).ariaRequired;
    const required = (element as any).required;
    const ariaInvalid = (element as any).ariaInvalid;
    const disabled = (element as any).disabled;
    const checked = (element as any).checked;
    
    // Check for required text/numeric fields
    if (["textbox", "input", "searchbox", "spinbutton"].includes(role) || ["input", "textarea"].includes(tag)) {
      const isNumeric = type === "number" || role === "spinbutton" || /\b(monto|amount|precio|price|cantidad|quantity|número|numero)\b/i.test(text);
      
      if ((ariaRequired === "true" || required === true) && !element.text?.trim()) {
        blockerTypes.add(isNumeric ? "required_numeric_fields" : "required_text_fields");
        elements.push(element);
      }
    }
    
    // Check for required radio without selection
    if (role === "radio" || tag === "input" && type === "radio") {
      if (ariaRequired === "true" || required === true) {
        if (checked !== true) {
          blockerTypes.add("required_radio");
          elements.push(element);
        }
      }
    }
    
    // Check for required checkbox without check
    if (role === "checkbox" || tag === "input" && type === "checkbox") {
      if (ariaRequired === "true" || required === true) {
        if (checked !== true) {
          blockerTypes.add("required_checkbox");
          elements.push(element);
        }
      }
    }
    
    // Check for required dropdown/combobox without value
    if (role === "combobox" || role === "listbox" || tag === "select") {
      if ((ariaRequired === "true" || required === true) && !text.trim()) {
        blockerTypes.add("required_dropdown");
        elements.push(element);
      }
    }
    
    // Check for required date
    if (type === "date" || role === "date") {
      if ((ariaRequired === "true" || required === true) && !text.trim()) {
        blockerTypes.add("required_date");
        elements.push(element);
      }
    }
    
    // Check for required file
    if (type === "file" || role === "file") {
      if ((ariaRequired === "true" || required === true)) {
        blockerTypes.add("required_file");
        elements.push(element);
      }
    }
    
    // Check for consent checkboxes
    if ((role === "checkbox" || tag === "input" && type === "checkbox") && isSensitiveConsent(text)) {
      if (checked !== true) {
        blockerTypes.add("required_consent");
        elements.push(element);
      }
    }
    
    // Check for validation error messages
    if (ariaInvalid === "true" || role === "alert" || text.includes("required") || text.includes("requerido")) {
      if (text.trim()) {
        blockerTypes.add("required_text_fields");
        elements.push(element);
      }
    }
  }
  
  // Check if submit button is disabled
  if (submitLocator) {
    const isDisabled = await submitLocator.isDisabled().catch(() => false);
    if (isDisabled && blockerTypes.size === 0) {
      blockerTypes.add("unknown_blocker");
    }
  }
  
  return {
    blockerTypes: Array.from(blockerTypes),
    elements
  };
}

export async function resolvePreSubmitBlockers(options: PreSubmitBlockerOptions): Promise<PreSubmitBlockerResult> {
  const { page, actionText, target, snapshot, submitLocator, testData, autoGenerateConfig, autoSelectSafeDefaults = false, autoAcceptSafeCheckboxes = false } = options;
  
  if (!isSubmitLikeAction(actionText, target)) {
    return {
      evaluated: false,
      target,
      blockerTypes: [],
      blockers: [],
      fieldsFilled: [],
      selectionsMade: [],
      checkboxesChecked: [],
      generatedDataUsed: false,
      sensitiveBlocked: false,
      retriedSubmit: false,
      result: "no_blockers_detected"
    };
  }
  
  console.log(`[pre-submit] Evaluating blockers before submit: target="${target}"`);
  
  const { blockerTypes, elements } = await detectBlockers(snapshot, submitLocator);
  
  if (blockerTypes.length === 0) {
    return {
      evaluated: true,
      target,
      blockerTypes: [],
      blockers: [],
      fieldsFilled: [],
      selectionsMade: [],
      checkboxesChecked: [],
      generatedDataUsed: false,
      sensitiveBlocked: false,
      retriedSubmit: false,
      result: "no_blockers_detected"
    };
  }
  
  console.log(`[pre-submit] Blockers detected: ${blockerTypes.join(", ")}`);
  
  const blockers: BlockerResolution[] = [];
  const fieldsFilled: string[] = [];
  const selectionsMade: string[] = [];
  const checkboxesChecked: string[] = [];
  let generatedDataUsed = false;
  let sensitiveBlocked = false;
  
  // Process required text/numeric fields
  if (blockerTypes.includes("required_text_fields") || blockerTypes.includes("required_numeric_fields")) {
    for (const el of elements) {
      const role = el.role?.toLowerCase() || "";
      const tag = el.tagName?.toLowerCase() || "";
      
      if (["textbox", "input", "searchbox", "spinbutton"].includes(role) || ["input", "textarea"].includes(tag)) {
        const fieldName = el.label || el.name || el.placeholder || el.text || "unknown_field";
        const isNumeric = role === "spinbutton" || /\b(monto|amount|precio|price)\b/i.test(fieldName);
        
        // Try to resolve from test data or auto-generate
        if (testData && autoGenerateConfig?.enabled) {
          // In a real implementation, this would call resolveDataKey
          // For now, we'll just mark it as potentially resolvable
          blockers.push({
            type: isNumeric ? "required_numeric_fields" : "required_text_fields",
            field: fieldName,
            resolved: false,
            reason: "requires_data_resolver_integration"
          });
        } else {
          blockers.push({
            type: isNumeric ? "required_numeric_fields" : "required_text_fields",
            field: fieldName,
            resolved: false,
            reason: "missing_test_data"
          });
        }
      }
    }
  }
  
  // Process required radio
  if (blockerTypes.includes("required_radio")) {
    blockers.push({
      type: "required_radio",
      resolved: false,
      reason: autoSelectSafeDefaults ? "safe_default_selection_not_implemented" : "auto_select_safe_defaults_disabled"
    });
  }
  
  // Process required checkbox
  if (blockerTypes.includes("required_checkbox")) {
    for (const el of elements) {
      const label = el.label || el.text || "unknown_checkbox";
      if (isSensitiveConsent(label)) {
        blockers.push({
          type: "required_checkbox",
          label,
          resolved: false,
          reason: "sensitive_consent_requires_manual_handling",
          sensitive: true
        });
        sensitiveBlocked = true;
      } else if (autoAcceptSafeCheckboxes) {
        blockers.push({
          type: "required_checkbox",
          label,
          resolved: false,
          reason: "safe_checkbox_auto_accept_not_implemented"
        });
      } else {
        blockers.push({
          type: "required_checkbox",
          label,
          resolved: false,
          reason: "auto_accept_safe_checkboxes_disabled"
        });
      }
    }
  }
  
  // Process required dropdown
  if (blockerTypes.includes("required_dropdown")) {
    blockers.push({
      type: "required_dropdown",
      resolved: false,
      reason: autoSelectSafeDefaults ? "safe_default_selection_not_implemented" : "auto_select_safe_defaults_disabled"
    });
  }
  
  // Process required file
  if (blockerTypes.includes("required_file")) {
    blockers.push({
      type: "required_file",
      resolved: false,
      reason: "file_upload_cannot_be_auto_generated"
    });
  }
  
  // Process required consent
  if (blockerTypes.includes("required_consent")) {
    blockers.push({
      type: "required_consent",
      resolved: false,
      reason: "sensitive_consent_requires_manual_handling",
      sensitive: true
    });
    sensitiveBlocked = true;
  }
  
  // Process waiting for async state
  if (blockerTypes.includes("waiting_for_async_state")) {
    blockers.push({
      type: "waiting_for_async_state",
      resolved: false,
      reason: "async_state_detected_wait_for_stability"
    });
  }
  
  // Process unknown blockers
  if (blockerTypes.includes("unknown_blocker")) {
    blockers.push({
      type: "unknown_blocker",
      resolved: false,
      reason: "unable_to_identify_specific_blocker"
    });
  }
  
  const hasUnresolvedBlockers = blockers.some(b => !b.resolved);
  const hasSensitiveBlockers = blockers.some(b => b.sensitive);
  
  console.log(`[pre-submit] Blockers evaluation complete: ${blockers.filter(b => b.resolved).length} resolved, ${blockers.filter(b => !b.resolved).length} unresolved`);
  
  if (hasUnresolvedBlockers) {
    if (hasSensitiveBlockers) {
      console.log(`[pre-submit] Sensitive blockers detected; not auto-resolving.`);
    }
    return {
      evaluated: true,
      target,
      blockerTypes,
      blockers,
      fieldsFilled,
      selectionsMade,
      checkboxesChecked,
      generatedDataUsed,
      sensitiveBlocked,
      retriedSubmit: false,
      result: "pre_submit_blocker_unresolved"
    };
  }
  
  // If all blockers were resolved, retry the submit
  if (submitLocator && blockers.every(b => b.resolved)) {
    console.log(`[pre-submit] Retrying submit action: target="${target}"`);
    try {
      await submitLocator.click();
      console.log(`[pre-submit] Submit succeeded after resolving blockers.`);
      return {
        evaluated: true,
        target,
        blockerTypes,
        blockers,
        fieldsFilled,
        selectionsMade,
        checkboxesChecked,
        generatedDataUsed,
        sensitiveBlocked,
        retriedSubmit: true,
        result: "submitted_after_blockers_resolved"
      };
    } catch (err) {
      console.log(`[pre-submit] Submit retry failed: ${err instanceof Error ? err.message : String(err)}`);
      return {
        evaluated: true,
        target,
        blockerTypes,
        blockers,
        fieldsFilled,
        selectionsMade,
        checkboxesChecked,
        generatedDataUsed,
        sensitiveBlocked,
        retriedSubmit: true,
        result: "button_still_blocked"
      };
    }
  }
  
  return {
    evaluated: true,
    target,
    blockerTypes,
    blockers,
    fieldsFilled,
    selectionsMade,
    checkboxesChecked,
    generatedDataUsed,
    sensitiveBlocked,
    retriedSubmit: false,
    result: "pre_submit_blocker_unresolved"
  };
}

export { isSubmitLikeAction, isSensitiveConsent, detectBlockers };
