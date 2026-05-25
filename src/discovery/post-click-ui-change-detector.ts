import type { Page } from "@playwright/test";
import type { PageSnapshot, SnapshotElement } from "../types/page-snapshot.types";

export type PostClickUiChangeReason =
  | "modal_opened"
  | "dialog_opened"
  | "form_opened"
  | "panel_opened"
  | "overlay_opened"
  | "next_targets_visible"
  | "new_fields_visible"
  | "new_buttons_visible";

export type PostClickUiChangeResult = {
  evaluated: boolean;
  success: boolean;
  reason?: PostClickUiChangeReason;
  evidence: string[];
  noTransitionAccepted: boolean;
  confidence: number;
};

const MODAL_DIALOG_INDICATORS = [
  "dialog",
  "modal",
  "popup",
  "overlay",
  "backdrop",
  "drawer",
  "panel"
];

const FORM_INDICATORS = [
  "form",
  "formulario",
  "formulario de",
  "login form",
  "order form",
  "checkout",
  "registration"
];

function detectModalDialogElements(snapshot: PageSnapshot): { detected: boolean; evidence: string[] } {
  const evidence: string[] = [];
  
  for (const element of snapshot.elements) {
    const role = element.role?.toLowerCase() || "";
    const tag = element.tagName?.toLowerCase() || "";
    const ariaModal = (element as any).ariaModal;
    const className = (element as any).className || "";
    
    if (role === "dialog" || role === "alertdialog") {
      evidence.push(`role="${role}" detected`);
    }
    
    if (tag === "dialog") {
      evidence.push(`<dialog> element detected`);
    }
    
    if (ariaModal === "true") {
      evidence.push(`aria-modal="true" detected`);
    }
    
    if (typeof className === "string") {
      for (const indicator of MODAL_DIALOG_INDICATORS) {
        if (className.toLowerCase().includes(indicator)) {
          evidence.push(`class "${indicator}" detected`);
          break;
        }
      }
    }
  }
  
  return { detected: evidence.length > 0, evidence };
}

function detectFormElements(snapshot: PageSnapshot): { detected: boolean; evidence: string[] } {
  const evidence: string[] = [];
  let formCount = 0;
  let inputCount = 0;
  
  for (const element of snapshot.elements) {
    const role = element.role?.toLowerCase() || "";
    const tag = element.tagName?.toLowerCase() || "";
    const type = element.type?.toLowerCase() || "";
    const className = (element as any).className || "";
    
    if (tag === "form" || role === "form") {
      formCount++;
      evidence.push(`<form> or role="form" detected`);
    }
    
    if (["input", "textbox", "combobox", "spinbutton"].includes(role) || 
        ["input", "select", "textarea"].includes(tag)) {
      inputCount++;
    }
    
    if (typeof className === "string") {
      for (const indicator of FORM_INDICATORS) {
        if (className.toLowerCase().includes(indicator)) {
          evidence.push(`form-related class "${indicator}" detected`);
          break;
        }
      }
    }
  }
  
  if (inputCount >= 2 && formCount === 0) {
    evidence.push(`${inputCount} input fields detected (likely form)`);
  }
  
  return { detected: evidence.length > 0, evidence };
}

function detectNextTargetsVisible(
  snapshot: PageSnapshot,
  nextTargets: string[]
): { detected: boolean; evidence: string[] } {
  const evidence: string[] = [];
  const visibleTexts = new Set<string>();
  
  for (const element of snapshot.elements) {
    const text = (element.text || element.label || element.name || "").toLowerCase().trim();
    if (text) visibleTexts.add(text);
  }
  
  for (const target of nextTargets) {
    const normalizedTarget = target.toLowerCase().trim();
    for (const visibleText of visibleTexts) {
      if (visibleText.includes(normalizedTarget) || normalizedTarget.includes(visibleText)) {
        evidence.push(`Next target "${target}" found as "${visibleText}"`);
        break;
      }
    }
  }
  
  return { detected: evidence.length > 0, evidence };
}

function detectNewUiElements(
  beforeSnapshot: PageSnapshot,
  afterSnapshot: PageSnapshot
): { detected: boolean; evidence: string[] } {
  const evidence: string[] = [];
  
  const beforeTexts = new Set(
    beforeSnapshot.elements.map(e => (e.text || e.label || e.name || "").toLowerCase().trim())
  );
  
  const afterTexts = new Set(
    afterSnapshot.elements.map(e => (e.text || e.label || e.name || "").toLowerCase().trim())
  );
  
  const newTexts = [...afterTexts].filter(t => t && !beforeTexts.has(t));
  
  if (newTexts.length >= 2) {
    evidence.push(`${newTexts.length} new text elements appeared`);
  }
  
  const beforeRoles = new Set(beforeSnapshot.elements.map(e => (e.role || "").toLowerCase()));
  const afterRoles = new Set(afterSnapshot.elements.map(e => (e.role || "").toLowerCase()));
  
  const newRoles = [...afterRoles].filter(r => r && !beforeRoles.has(r));
  
  for (const role of newRoles) {
    if (["dialog", "alertdialog", "form", "textbox", "combobox"].includes(role)) {
      evidence.push(`New role "${role}" appeared`);
    }
  }
  
  const beforeCount = beforeSnapshot.elements.length;
  const afterCount = afterSnapshot.elements.length;
  
  if (afterCount > beforeCount + 5) {
    evidence.push(`Element count increased from ${beforeCount} to ${afterCount}`);
  }
  
  return { detected: evidence.length > 0, evidence };
}

export async function detectPostClickUiChange(options: {
  page: Page;
  target: string;
  actionText: string;
  beforeSnapshot: PageSnapshot;
  afterSnapshot: PageSnapshot;
  nextTargets?: string[];
  expectedAssertions?: string[];
}): Promise<PostClickUiChangeResult> {
  const { beforeSnapshot, afterSnapshot, nextTargets = [] } = options;
  const evidence: string[] = [];
  
  const modalDialog = detectModalDialogElements(afterSnapshot);
  if (modalDialog.detected) {
    evidence.push(...modalDialog.evidence);
    
    const form = detectFormElements(afterSnapshot);
    if (form.detected) {
      return {
        evaluated: true,
        success: true,
        reason: "form_opened",
        evidence,
        noTransitionAccepted: true,
        confidence: 0.85
      };
    }
    
    return {
      evaluated: true,
      success: true,
      reason: modalDialog.evidence.some(e => e.includes("dialog")) ? "dialog_opened" : "modal_opened",
      evidence,
      noTransitionAccepted: true,
      confidence: 0.8
    };
  }
  
  const form = detectFormElements(afterSnapshot);
  if (form.detected) {
    evidence.push(...form.evidence);
    return {
      evaluated: true,
      success: true,
      reason: "form_opened",
      evidence,
      noTransitionAccepted: true,
      confidence: 0.8
    };
  }
  
  if (nextTargets.length > 0) {
    const nextTargetsVisible = detectNextTargetsVisible(afterSnapshot, nextTargets);
    if (nextTargetsVisible.detected) {
      evidence.push(...nextTargetsVisible.evidence);
      return {
        evaluated: true,
        success: true,
        reason: "next_targets_visible",
        evidence,
        noTransitionAccepted: true,
        confidence: 0.75
      };
    }
  }
  
  const newUi = detectNewUiElements(beforeSnapshot, afterSnapshot);
  if (newUi.detected) {
    evidence.push(...newUi.evidence);
    return {
      evaluated: true,
      success: true,
      reason: "panel_opened",
      evidence,
      noTransitionAccepted: true,
      confidence: 0.7
    };
  }
  
  return {
    evaluated: true,
    success: false,
    evidence: evidence.length > 0 ? evidence : ["No UI change detected after click"],
    noTransitionAccepted: false,
    confidence: 0.3
  };
}
