import type { ExecutionPlanStep } from "../types/execution-plan.types";
import type { SemanticScreenType, SemanticMethodIntent } from "../types/pom-ownership";
import { SCREEN_TYPE_CLASS_MAP } from "../types/pom-ownership";

const METHOD_INTENT_KEYWORDS: Record<string, SemanticMethodIntent> = {
  navigate: "open_home",
  "app_base_url": "open_home",
  iniciar: "start_session",
  start: "start_session",
  login: "start_session",
  "informacion de productos": "open_product_information",
  "información de productos": "open_product_information",
  "product information": "open_product_information",
  tarjetas: "select_category",
  prestamos: "select_category",
  cuentas: "select_category",
  categoria: "select_category",
  category: "select_category",
  "tarjeta de credito": "select_product",
  "tarjeta de crédito": "select_product",
  visa: "select_product",
  prestamo: "select_product",
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
  pagar: "confirm_action"
};

export function deriveSemanticMethodIntent(
  step: ExecutionPlanStep,
  screenType: SemanticScreenType
): SemanticMethodIntent {
  const target = step.target && typeof step.target === "object"
    ? `${step.target.value ?? ""} ${step.target.name ?? ""} ${step.target.role ?? ""}`.toLowerCase().trim()
    : "";
  const action = step.action.toLowerCase();
  const description = (step.description ?? "").toLowerCase();
  const recoveryMeta = (step as any).recoveryMetadata;
  const recoveredText = recoveryMeta?.selectedCandidateText?.toLowerCase() ?? "";
  const semanticRelation = recoveryMeta?.semanticRelation?.toLowerCase() ?? "";

  const combinedText = `${target} ${action} ${description} ${recoveredText} ${semanticRelation}`;

  for (const [keyword, intent] of Object.entries(METHOD_INTENT_KEYWORDS)) {
    if (combinedText.includes(keyword)) {
      return intent;
    }
  }

  if (action === "navigate") return "open_home";
  if (action === "login") return "start_session";
  if (action.startsWith("assert")) return "expect_loaded";
  if (action === "fill") return "fill_form_field";
  if (action === "click" || action === "select") {
    if (screenType === "category") return "select_category";
    if (screenType === "product_list") return "select_product";
    if (screenType === "home") return "click_primary_action";
    return "click_primary_action";
  }

  return "unknown";
}

export function deriveSemanticScreenType(step: ExecutionPlanStep, _allSteps: ExecutionPlanStep[]): SemanticScreenType {
  const target = step.target && typeof step.target === "object"
    ? `${step.target.value ?? ""} ${step.target.name ?? ""} ${step.target.role ?? ""}`.toLowerCase().trim()
    : "";
  const action = step.action.toLowerCase();
  const description = (step.description ?? "").toLowerCase();
  const recoveryMeta = (step as any).recoveryMetadata;
  const recoveredText = recoveryMeta?.selectedCandidateText?.toLowerCase() ?? "";
  const semanticRelation = recoveryMeta?.semanticRelation?.toLowerCase() ?? "";

  const combinedText = `${target} ${action} ${description} ${recoveredText} ${semanticRelation}`;

  const SCREEN_TYPE_KEYWORDS: Record<string, SemanticScreenType> = {
    "iniciar sesion": "login",
    "iniciar sesión": "login",
    home: "home",
    inicio: "home",
    principal: "home",
    dashboard: "home",
    iniciar: "home",
    start: "home",
    menu: "main_menu",
    navegacion: "main_menu",
    "informacion de productos": "product_information",
    "información de productos": "product_information",
    "product information": "product_information",
    catalogo: "product_list",
    listado: "product_list",
    lista: "product_list",
    list: "product_list",
    "tarjeta de credito": "product_list",
    "tarjeta de crédito": "product_list",
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

  for (const [keyword, screenType] of Object.entries(SCREEN_TYPE_KEYWORDS)) {
    if (combinedText.includes(keyword)) {
      return screenType;
    }
  }

  if (action === "navigate" || target.includes("base_url") || target.includes("app_base")) {
    return "home";
  }

  if (action === "login" || action === "auth") {
    return "login";
  }

  if (semanticRelation === "parent_category" || semanticRelation === "category") {
    return "category";
  }

  if (action.startsWith("assert") || action.includes("valid") || action.includes("expect")) {
    return "product_detail";
  }

  if (action === "click" || action === "select") {
    return "product_list";
  }

  if (action === "fill") {
    return "form";
  }

  return "unknown";
}

export function deriveMethodIntentFromStep(step: ExecutionPlanStep): SemanticMethodIntent {
  const screenType = deriveSemanticScreenType(step, []);
  return deriveSemanticMethodIntent(step, screenType);
}

export function deriveExpectedOwnerForStep(step: ExecutionPlanStep): string {
  const intent = deriveMethodIntentFromStep(step);
  const INTENT_PREFERRED_OWNER: Record<string, string> = {
    start_session: "HomePage",
    open_home: "HomePage",
    open_product_information: "ProductInformationPage",
    select_category: "CategoryPage",
    select_product: "ProductListPage",
    click_primary_action: "ProductDetailPage",
    expect_loaded: "ProductDetailPage",
    fill_form_field: "FormPage",
    submit_form: "FormPage",
    confirm_action: "ConfirmationPage"
  };
  return INTENT_PREFERRED_OWNER[intent] ?? "GenericPage";
}
