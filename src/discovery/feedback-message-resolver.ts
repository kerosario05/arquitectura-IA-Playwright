import type { PageSnapshot, SnapshotElement } from "../types/page-snapshot.types";

export type FeedbackMessageType =
  | "toast"
  | "snackbar"
  | "alert"
  | "dialog"
  | "banner"
  | "modal"
  | "notification"
  | "status_message";

export type FeedbackMessageEvidence = {
  type: FeedbackMessageType;
  text: string;
  visible: boolean;
  role?: string;
  className?: string;
};

export type FeedbackMessageResolution = {
  passed: boolean;
  resolver: "feedback_message";
  assertion: string;
  capturedMessage?: FeedbackMessageEvidence;
  evidence: string[];
  confidence: number;
};

const FEEDBACK_ASSERTION_PATTERNS = [
  /mensaje\s+(?:de\s+)?(?:éxito|exito|error|información|confirmación|alerta)/i,
  /message\s+(?:of\s+)?(?:success|error|info|information|confirmation|alert)/i,
  /toast\s+visible/i,
  /snackbar\s+visible/i,
  /alerta\s+visible/i,
  /banner\s+visible/i,
  /notificación\s+visible/i,
  /notification\s+visible/i,
  /mensaje\s+temporal/i,
  /feedback\s+visible/i,
  /confirmación\s+visible/i,
  /confirmation\s+visible/i,
  /product\s+added/i,
  /agregado\s+al\s+carrito/i,
  /añadido\s+al\s+carrito/i,
];

const FEEDBACK_ROLE_INDICATORS = ["alert", "status", "dialog", "alertdialog", "toast", "snackbar", "notification"];

const FEEDBACK_CLASS_PATTERNS = [
  /toast/i,
  /snackbar/i,
  /alert/i,
  /notification/i,
  /message/i,
  /feedback/i,
  /banner/i,
  /popup/i,
  /modal/i,
  /dialog/i,
];

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isFeedbackAssertion(assertionText: string): boolean {
  for (const pattern of FEEDBACK_ASSERTION_PATTERNS) {
    if (pattern.test(assertionText)) return true;
  }

  const normalized = normalizeText(assertionText);
  
  // Require message/toast/snackbar context, not just "información"
  const feedbackKeywords = ["mensaje", "message", "toast", "snackbar", "alerta", "alert", "banner", "notificación", "notification", "feedback", "confirmación", "confirmation", "product added", "agregado al carrito", "añadido al carrito"];
  for (const keyword of feedbackKeywords) {
    if (normalized.includes(keyword)) return true;
  }

  return false;
}

function detectFeedbackMessageType(element: SnapshotElement): FeedbackMessageType | null {
  const role = element.role?.toLowerCase() || "";
  const tag = element.tagName?.toLowerCase() || "";
  const className = (element as any).className || "";
  const text = (element.text || element.label || "").toLowerCase();

  if (FEEDBACK_ROLE_INDICATORS.includes(role)) {
    if (role === "alert" || role === "alertdialog") return "alert";
    if (role === "status") return "status_message";
    if (role === "dialog" || role === "alertdialog") return "dialog";
    if (role === "toast") return "toast";
  }

  if (tag === "dialog") return "dialog";
  if (tag === "alert") return "alert";

  const normalizedClass = typeof className === "string" ? className.toLowerCase() : "";
  for (const pattern of FEEDBACK_CLASS_PATTERNS) {
    if (pattern.test(normalizedClass)) {
      if (normalizedClass.includes("toast")) return "toast";
      if (normalizedClass.includes("snackbar")) return "snackbar";
      if (normalizedClass.includes("alert")) return "alert";
      if (normalizedClass.includes("notification")) return "notification";
      if (normalizedClass.includes("banner")) return "banner";
      if (normalizedClass.includes("modal") || normalizedClass.includes("dialog")) return "modal";
      return "status_message";
    }
  }

  if (text.includes("toast") || text.includes("snackbar")) return "toast";
  if (text.includes("alert")) return "alert";
  if (text.includes("notification")) return "notification";

  return null;
}

function findFeedbackMessages(snapshot: PageSnapshot): FeedbackMessageEvidence[] {
  const messages: FeedbackMessageEvidence[] = [];

  for (const element of snapshot.elements) {
    const messageType = detectFeedbackMessageType(element);
    if (messageType) {
      const text = element.text || element.label || element.name || "";
      if (text && text.trim().length > 0) {
        messages.push({
          type: messageType,
          text: text.trim(),
          visible: element.visible ?? true,
          role: element.role,
          className: (element as any).className,
        });
      }
    }
  }

  return messages;
}

export function resolveFeedbackMessageAssertion(
  snapshot: PageSnapshot,
  assertionText: string
): FeedbackMessageResolution {
  if (!isFeedbackAssertion(assertionText)) {
    return {
      passed: false,
      resolver: "feedback_message",
      assertion: assertionText,
      evidence: [],
      confidence: 0,
    };
  }

  const normalizedAssertion = normalizeText(assertionText);
  const messages = findFeedbackMessages(snapshot);

  const evidence: string[] = [];
  let capturedMessage: FeedbackMessageEvidence | undefined;

  if (messages.length === 0) {
    return {
      passed: false,
      resolver: "feedback_message",
      assertion: assertionText,
      evidence: ["No feedback messages detected in snapshot"],
      confidence: 0.2,
    };
  }

  for (const msg of messages) {
    if (msg.visible) {
      const msgNormalized = normalizeText(msg.text);
      
      let matches = false;
      
      if (normalizedAssertion.includes("éxito") || normalizedAssertion.includes("exito") || normalizedAssertion.includes("success")) {
        matches = /éxito|exito|success|ok|completed|added/i.test(msg.text);
      } else if (normalizedAssertion.includes("error")) {
        matches = /error|failed|failure/i.test(msg.text);
      } else if (normalizedAssertion.includes("información") || normalizedAssertion.includes("informacion") || normalizedAssertion.includes("info")) {
        matches = /información|informacion|info|information|notice/i.test(msg.text);
      } else if (normalizedAssertion.includes("confirmación") || normalizedAssertion.includes("confirmacion") || normalizedAssertion.includes("confirmation")) {
        matches = /confirmación|confirmacion|confirmation|confirmed/i.test(msg.text);
      } else if (normalizedAssertion.includes("producto") || normalizedAssertion.includes("product")) {
        matches = /producto|product|item/i.test(msg.text);
      } else {
        matches = true;
      }

      if (matches) {
        capturedMessage = msg;
        evidence.push(`Feedback ${msg.type} captured: "${msg.text.slice(0, 100)}"`);
        break;
      }
    }
  }

  if (!capturedMessage && messages.length > 0) {
    const visibleMsg = messages.find(m => m.visible);
    if (visibleMsg) {
      capturedMessage = visibleMsg;
      evidence.push(`Feedback ${visibleMsg.type} captured (generic match): "${visibleMsg.text.slice(0, 100)}"`);
    }
  }

  const passed = capturedMessage !== undefined && capturedMessage.visible;
  const confidence = passed ? 0.85 : 0.3;

  return {
    passed,
    resolver: "feedback_message",
    assertion: assertionText,
    capturedMessage,
    evidence,
    confidence,
  };
}

export { isFeedbackAssertion, findFeedbackMessages };
