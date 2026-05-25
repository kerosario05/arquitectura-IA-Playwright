import type { ExecutionPlanStep } from "../types/execution-plan.types";
import type { SemanticScreenType, SemanticMethodIntent } from "../types/pom-ownership";

const METHOD_INTENT_KEYWORDS: Record<string, SemanticMethodIntent> = {
  navigate: "open_home",
  "app_base_url": "open_home",
  iniciar: "start_session",
  start: "start_session",
  login: "start_session",
  "log in": "open_login_modal",
  "iniciar sesion": "open_login_modal",
  "informacion de productos": "open_product_information",
  "product information": "open_product_information",
  tarjetas: "select_category",
  prestamos: "select_category",
  cuentas: "select_category",
  categoria: "select_category",
  category: "select_category",
  solicitar: "click_primary_action",
  "solicitar tarjeta": "click_primary_action",
  apply: "click_primary_action",
  request: "click_primary_action",
  detalle: "expect_loaded",
  detail: "expect_loaded",
  validar: "expect_loaded",
  verificar: "expect_loaded",
  comprobar: "expect_loaded",
  expect: "expect_loaded",
  visible: "expect_loaded",
  fill: "fill_form_field",
  escribir: "fill_form_field",
  ingresar: "fill_form_field",
  completar: "fill_form_field",
  producto: "select_product",
  product: "select_product",
  submit: "submit_form",
  enviar: "submit_form",
  confirmar: "confirm_action",
  confirm: "confirm_action",
  pay: "confirm_action",
  pagar: "confirm_action",
  continuar: "click_primary_action",
  siguiente: "click_primary_action"
};

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function getStepText(step: ExecutionPlanStep): string {
  const target = step.target && typeof step.target === "object"
    ? `${step.target.value ?? ""} ${step.target.name ?? ""} ${step.target.role ?? ""}`
    : "";
  return normalize(`${target} ${step.description ?? ""} ${step.action}`);
}

function isFirstVisibleItemSelection(text: string): boolean {
  return /\b(primer[ao]?\s+(producto|item|registro|card|tarjeta|fila)|primera?\s+(tarjeta|card|fila)|first\s+visible\s+(item|product|card|row))\b/i.test(text);
}

function deriveFirstVisibleSelectionIntent(text: string): SemanticMethodIntent {
  if (/\b(fila|row)\b/i.test(text)) return "select_first_visible_row";
  if (/\b(tarjeta|card)\b/i.test(text)) return "select_first_visible_card";
  if (/\b(producto|product)\b/i.test(text)) return "select_first_visible_product";
  return "select_first_visible_item";
}

function isDetailPrimaryAction(text: string): boolean {
  return /\b(add to cart|agregar al carrito|purchase|buy|comprar|checkout|place order|continuar|confirmar|submit|enviar|pagar)\b/i.test(text);
}

function isUsernameTarget(text: string): boolean {
  return text.includes("username") || text.includes("usuario");
}

function isPasswordTarget(text: string): boolean {
  return text.includes("password") || text.includes("contrasena");
}

function isLoginTrigger(text: string): boolean {
  return text.includes("log in") || text.includes("login") || text.includes("iniciar sesion");
}

function isLoggedInIndicator(text: string): boolean {
  return text.includes("welcome") || text.includes("logout") || text.includes("log out") || text.includes("cerrar sesion");
}

function hasPriorLoginFormEvidence(step: ExecutionPlanStep, allSteps: ExecutionPlanStep[]): boolean {
  const currentIndex = allSteps.indexOf(step);
  if (currentIndex <= 0) return false;
  return allSteps.slice(0, currentIndex).some((candidate) => {
    const text = getStepText(candidate);
    return (candidate.action === "fill" || candidate.action.startsWith("assert"))
      && (isUsernameTarget(text) || isPasswordTarget(text));
  });
}

export function deriveSemanticMethodIntent(
  step: ExecutionPlanStep,
  screenType: SemanticScreenType,
  allSteps: ExecutionPlanStep[] = []
): SemanticMethodIntent {
  const target = step.target && typeof step.target === "object"
    ? `${step.target.value ?? ""} ${step.target.name ?? ""} ${step.target.role ?? ""}`.toLowerCase().trim()
    : "";
  const action = step.action.toLowerCase();
  const recoveryMeta = (step as any).recoveryMetadata;
  const recoveredText = recoveryMeta?.selectedCandidateText?.toLowerCase() ?? "";
  const semanticRelation = recoveryMeta?.semanticRelation?.toLowerCase() ?? "";
  const selectionDiagnostics = (step as any).selectionDiagnostics;
  const actionType = recoveryMeta?.actionType;
  const semanticRole = recoveryMeta?.semanticRole;
  const normalizedText = getStepText(step);

  if ((action === "click" || action === "select") && isFirstVisibleItemSelection(normalizedText)) {
    return deriveFirstVisibleSelectionIntent(normalizedText);
  }

  if ((action === "click" || action === "select") && isDetailPrimaryAction(normalizedText)) {
    return (screenType === "form" || screenType === "confirmation") ? "submit_form" : "click_primary_action";
  }

  if (action.startsWith("assert")) {
    if (isUsernameTarget(normalizedText) || isPasswordTarget(normalizedText)) return "expect_login_form";
    if (isLoggedInIndicator(normalizedText)) return "expect_logged_in";
    return "expect_loaded";
  }

  if (action === "fill") {
    if (isUsernameTarget(normalizedText)) return "fill_username";
    if (isPasswordTarget(normalizedText)) return "fill_password";
    return "fill_form_field";
  }

  if ((action === "click" || action === "select") && isLoginTrigger(normalizedText)) {
    return hasPriorLoginFormEvidence(step, allSteps) ? "submit_login" : "open_login_modal";
  }

  if (selectionDiagnostics?.selectionLike && selectionDiagnostics?.success) {
    if (screenType === "category" || semanticRole === "category") return "select_category";
    if (screenType === "product_list" || ["product", "card", "item", "entity"].includes(semanticRole)) return "select_product";
    return "select_product";
  }

  if (actionType === "action_select") {
    if (screenType === "category" || semanticRole === "category") return "select_category";
    return "select_product";
  }

  if (["option", "card", "item", "entity", "product", "recipient", "list_item"].includes(semanticRole)) {
    if (semanticRole === "category") return "select_category";
    return "select_product";
  }

  if (selectionDiagnostics?.reason === "selection_no_transition_next_action_enabled") {
    if (screenType === "category") return "select_category";
    return "select_product";
  }

  const combinedText = normalize(`${target} ${action} ${recoveredText} ${semanticRelation}`);
  for (const [keyword, intent] of Object.entries(METHOD_INTENT_KEYWORDS)) {
    const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (regex.test(combinedText)) {
      return intent;
    }
  }

  if (action === "navigate") return "open_home";
  if (action === "login") return "start_session";
  if (action.startsWith("assert")) return "expect_loaded";
  if (action === "click" || action === "select") {
    if (screenType === "login") return hasPriorLoginFormEvidence(step, allSteps) ? "submit_login" : "open_login_modal";
    if (screenType === "category") return "select_category";
    if (screenType === "product_list") return "select_product";
    if (screenType === "home") return "click_primary_action";
    return "click_primary_action";
  }

  return "unknown";
}

export function deriveSemanticScreenType(step: ExecutionPlanStep, _allSteps: ExecutionPlanStep[]): SemanticScreenType {
  const text = getStepText(step);
  const action = step.action.toLowerCase();
  const recoveryMeta = (step as any).recoveryMetadata;
  const semanticRelation = recoveryMeta?.semanticRelation?.toLowerCase() ?? "";

  const screenTypeKeywords: Record<string, SemanticScreenType> = {
    "iniciar sesion": "login",
    home: "home",
    inicio: "home",
    principal: "home",
    dashboard: "home",
    iniciar: "home",
    start: "home",
    menu: "main_menu",
    navegacion: "main_menu",
    "informacion de productos": "product_information",
    "product information": "product_information",
    catalogo: "product_list",
    listado: "product_list",
    lista: "product_list",
    list: "product_list",
    "tarjeta de credito": "product_list",
    visa: "product_list",
    prestamo: "product_list",
    producto: "product_list",
    product: "product_list",
    categoria: "category",
    category: "category",
    tarjetas: "category",
    prestamos: "category",
    cuentas: "category",
    creditos: "category",
    detalle: "product_detail",
    detail: "product_detail",
    "detalle de": "product_detail",
    info: "product_detail",
    seleccion: "selection",
    selection: "selection",
    escoger: "selection",
    elegir: "selection",
    formulario: "form",
    form: "form",
    registro: "form",
    register: "form",
    confirmacion: "confirmation",
    confirmation: "confirmation",
    exito: "confirmation",
    success: "confirmation",
    login: "login",
    auth: "login",
    otp: "otp",
    codigo: "otp",
    code: "otp",
    verificacion: "otp",
    verification: "otp"
  };

  for (const [keyword, screenType] of Object.entries(screenTypeKeywords)) {
    if (text.includes(keyword)) return screenType;
  }

  if (action === "navigate" || text.includes("base_url") || text.includes("app_base")) return "home";
  if (action === "login" || action === "auth") return "login";
  if (isLoginTrigger(text) || isUsernameTarget(text) || isPasswordTarget(text)) return "login";
  if (semanticRelation === "parent_category" || semanticRelation === "category") return "category";
  if (action.startsWith("assert") || action.includes("valid") || action.includes("expect")) return "product_detail";
  if (action === "click" || action === "select") return "product_list";
  if (action === "fill") return "form";
  return "unknown";
}

export function deriveMethodIntentFromStep(step: ExecutionPlanStep): SemanticMethodIntent {
  return deriveMethodIntentFromStepWithContext(step, []);
}

export function deriveMethodIntentFromStepWithContext(
  step: ExecutionPlanStep,
  allSteps: ExecutionPlanStep[]
): SemanticMethodIntent {
  const screenType = deriveSemanticScreenType(step, allSteps);
  return deriveSemanticMethodIntent(step, screenType, allSteps);
}

export function deriveExpectedOwnerForStep(step: ExecutionPlanStep, allSteps: ExecutionPlanStep[] = []): string {
  const intent = deriveMethodIntentFromStepWithContext(step, allSteps);
  const target = getStepText(step);

  if (
    intent === "expect_login_form" ||
    intent === "fill_username" ||
    intent === "fill_password" ||
    intent === "submit_login" ||
    intent === "expect_logged_in" ||
    isUsernameTarget(target) ||
    isPasswordTarget(target)
  ) {
    return "LoginPage";
  }

  if (isFirstVisibleItemSelection(target)) {
    return "ProductListPage";
  }
  if (isDetailPrimaryAction(target)) {
    if (target.includes("submit") || target.includes("enviar") || target.includes("purchase") || target.includes("place order")) {
      return "FormPage";
    }
    return "ProductDetailPage";
  }

  const preferredOwner: Record<string, string> = {
    start_session: "HomePage",
    open_home: "HomePage",
    open_login_modal: "HomePage",
    expect_login_form: "LoginPage",
    fill_username: "LoginPage",
    fill_password: "LoginPage",
    submit_login: "LoginPage",
    expect_logged_in: "LoginPage",
    open_product_information: "ProductInformationPage",
    select_category: "CategoryPage",
    select_product: "ProductListPage",
    select_first_visible_item: "ProductListPage",
    select_first_visible_product: "ProductListPage",
    select_first_visible_card: "ProductListPage",
    select_first_visible_row: "ProductListPage",
    click_primary_action: "ProductDetailPage",
    expect_loaded: "ProductDetailPage",
    fill_form_field: "FormPage",
    submit_form: "FormPage",
    confirm_action: "ConfirmationPage"
  };
  return preferredOwner[intent] ?? "GenericPage";
}
