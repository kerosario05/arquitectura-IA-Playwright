export type SemanticMethodIntent =
  | "open_home"
  | "open_module"
  | "start_session"
  | "open_login_modal"
  | "expect_login_form"
  | "fill_username"
  | "fill_password"
  | "submit_login"
  | "expect_logged_in"
  | "open_product_information"
  | "select_category"
  | "select_product"
  | "select_first_visible_item"
  | "select_first_visible_product"
  | "select_first_visible_card"
  | "select_first_visible_row"
  | "select_visible_item_by_ordinal"
  | "click_primary_action"
  | "expect_primary_action_visible"
  | "expect_primary_action_enabled"
  | "expect_primary_action_disabled"
  | "expect_loaded"
  | "fill_form_field"
  | "submit_form"
  | "confirm_action"
  | "return_to_list"
  | "unknown";

export type SemanticScreenType =
  | "home"
  | "main_menu"
  | "product_information"
  | "category"
  | "product_list"
  | "product_detail"
  | "selection"
  | "form"
  | "confirmation"
  | "login"
  | "otp"
  | "unknown";

export const SCREEN_TYPE_CLASS_MAP: Record<SemanticScreenType, string> = {
  home: "HomePage",
  main_menu: "MainMenuPage",
  product_information: "ProductInformationPage",
  category: "CategoryPage",
  product_list: "ProductListPage",
  product_detail: "ProductDetailPage",
  selection: "SelectionPage",
  form: "FormPage",
  confirmation: "ConfirmationPage",
  login: "LoginPage",
  otp: "OtpPage",
  unknown: "GenericPage"
};

export const METHOD_INTENT_NAME_MAP: Record<SemanticMethodIntent, string> = {
  open_home: "open",
  open_module: "openModule",
  start_session: "start",
  open_login_modal: "openLoginModal",
  expect_login_form: "expectLoginFormVisible",
  fill_username: "fillUsername",
  fill_password: "fillPassword",
  submit_login: "submitLogin",
  expect_logged_in: "expectLoggedIn",
  open_product_information: "openProductInformation",
  select_category: "selectCategory",
  select_product: "selectProduct",
  select_first_visible_item: "selectFirstVisibleItem",
  select_first_visible_product: "selectFirstVisibleProduct",
  select_first_visible_card: "selectFirstVisibleCard",
  select_first_visible_row: "selectFirstVisibleRow",
  select_visible_item_by_ordinal: "selectVisibleItemByOrdinal",
  click_primary_action: "clickPrimaryAction",
  expect_primary_action_visible: "expectPrimaryActionVisible",
  expect_primary_action_enabled: "expectPrimaryActionEnabled",
  expect_primary_action_disabled: "expectPrimaryActionDisabled",
  expect_loaded: "expectLoaded",
  fill_form_field: "fillField",
  submit_form: "submit",
  confirm_action: "confirm",
  return_to_list: "backToList",
  unknown: "executeAction"
};

export const METHOD_INTENT_PARAMS: Record<SemanticMethodIntent, string[]> = {
  open_home: [],
  open_module: ["moduleName"],
  start_session: [],
  open_login_modal: [],
  expect_login_form: [],
  fill_username: ["value"],
  fill_password: ["value"],
  submit_login: [],
  expect_logged_in: [],
  open_product_information: [],
  select_category: ["categoryName"],
  select_product: ["productName"],
  select_first_visible_item: [],
  select_first_visible_product: [],
  select_first_visible_card: [],
  select_first_visible_row: [],
  select_visible_item_by_ordinal: ["ordinal", "domainTerm"],
  click_primary_action: ["actionName"],
  expect_primary_action_visible: ["actionName"],
  expect_primary_action_enabled: ["actionName"],
  expect_primary_action_disabled: ["actionName"],
  expect_loaded: [],
  fill_form_field: ["fieldName", "value"],
  submit_form: [],
  confirm_action: [],
  return_to_list: [],
  unknown: []
};

export const INTENT_CLASS_OWNERSHIP: Record<string, string[]> = {
  start_session: ["HomePage", "LoginPage"],
  open_home: ["HomePage"],
  open_module: ["OperationsMenuPage", "MainMenuPage", "HomePage", "DashboardPage"],
  open_login_modal: ["HomePage"],
  expect_login_form: ["LoginPage"],
  fill_username: ["LoginPage"],
  fill_password: ["LoginPage"],
  submit_login: ["LoginPage"],
  expect_logged_in: ["LoginPage", "HomePage"],
  open_product_information: ["HomePage", "ProductInformationPage"],
  select_category: ["CategoryPage"],
  select_product: ["ProductListPage"],
  select_first_visible_item: ["ProductListPage"],
  select_first_visible_product: ["ProductListPage"],
  select_first_visible_card: ["ProductListPage"],
  select_first_visible_row: ["ProductListPage"],
  click_primary_action: ["HomePage", "ProductDetailPage", "CategoryPage", "ProductListPage", "ConfirmationPage"],
  expect_primary_action_visible: ["ProductDetailPage", "CategoryPage", "ProductListPage", "HomePage", "ConfirmationPage", "FormPage"],
  expect_primary_action_enabled: ["ProductDetailPage", "CategoryPage", "ProductListPage", "HomePage", "ConfirmationPage", "FormPage"],
  expect_primary_action_disabled: ["ProductDetailPage", "CategoryPage", "ProductListPage", "HomePage", "ConfirmationPage", "FormPage"],
  expect_loaded: ["ProductDetailPage", "CategoryPage", "ProductListPage", "HomePage", "ConfirmationPage"],
  fill_form_field: ["FormPage", "LoginPage"],
  submit_form: ["FormPage", "LoginPage"],
  confirm_action: ["ConfirmationPage", "FormPage"],
  return_to_list: ["ProductDetailPage", "ProductListPage"]
};

export const INTENT_PREFERRED_OWNER: Record<string, string> = {
  start_session: "HomePage",
  open_home: "HomePage",
  open_module: "OperationsMenuPage",
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
  select_visible_item_by_ordinal: "ProductListPage",
  click_primary_action: "ProductDetailPage",
  expect_primary_action_visible: "ProductDetailPage",
  expect_primary_action_enabled: "ProductDetailPage",
  expect_primary_action_disabled: "ProductDetailPage",
  expect_loaded: "ProductDetailPage",
  fill_form_field: "FormPage",
  submit_form: "FormPage",
  confirm_action: "ConfirmationPage",
  return_to_list: "ProductDetailPage"
};

export const CLASS_SPECIFIC_METHODS: Record<string, Array<{ name: string; intent: string; parameters: string[] }>> = {
  ProductDetailPage: [
    { name: "expectLoaded", intent: "expect_loaded", parameters: [] },
    { name: "expectProductDetail", intent: "expect_loaded", parameters: ["productName"] },
    { name: "clickPrimaryAction", intent: "click_primary_action", parameters: ["actionName"] },
    { name: "expectPrimaryActionVisible", intent: "expect_primary_action_visible", parameters: ["actionName"] },
    { name: "expectPrimaryActionEnabled", intent: "expect_primary_action_enabled", parameters: ["actionName"] },
    { name: "expectPrimaryActionDisabled", intent: "expect_primary_action_disabled", parameters: ["actionName"] },
    { name: "backToList", intent: "return_to_list", parameters: [] }
  ],
  ProductListPage: [
    { name: "selectProduct", intent: "select_product", parameters: ["productName"] },
    { name: "selectFirstVisibleItem", intent: "select_first_visible_item", parameters: [] },
    { name: "selectFirstVisibleProduct", intent: "select_first_visible_product", parameters: [] },
    { name: "selectFirstVisibleCard", intent: "select_first_visible_card", parameters: [] },
    { name: "selectFirstVisibleRow", intent: "select_first_visible_row", parameters: [] },
    { name: "selectVisibleItemByOrdinal", intent: "select_visible_item_by_ordinal", parameters: ["ordinal", "domainTerm"] }
  ],
  OperationsMenuPage: [
    { name: "openModule", intent: "open_module", parameters: ["moduleName"] }
  ],
  MainMenuPage: [
    { name: "openModule", intent: "open_module", parameters: ["moduleName"] }
  ],
  HomePage: [
    { name: "start", intent: "start_session", parameters: [] },
    { name: "open", intent: "open_home", parameters: [] },
    { name: "openLoginModal", intent: "open_login_modal", parameters: [] },
    { name: "openProductInformation", intent: "open_product_information", parameters: [] },
    { name: "openModule", intent: "open_module", parameters: ["moduleName"] }
  ],
  CategoryPage: [
    { name: "selectCategory", intent: "select_category", parameters: ["categoryName"] }
  ],
  ProductInformationPage: [
    { name: "openProductInformation", intent: "open_product_information", parameters: [] }
  ],
  LoginPage: [
    { name: "expectLoginFormVisible", intent: "expect_login_form", parameters: [] },
    { name: "fillUsername", intent: "fill_username", parameters: ["value"] },
    { name: "fillPassword", intent: "fill_password", parameters: ["value"] },
    { name: "submitLogin", intent: "submit_login", parameters: [] },
    { name: "expectLoggedIn", intent: "expect_logged_in", parameters: [] },
    { name: "loginWithCredentials", intent: "submit_login", parameters: ["username", "password"] }
  ],
  FormPage: [
    { name: "fillField", intent: "fill_form_field", parameters: ["fieldName", "value"] },
    { name: "submit", intent: "submit_form", parameters: [] }
  ],
  ConfirmationPage: [
    { name: "expectLoaded", intent: "expect_loaded", parameters: [] },
    { name: "confirm", intent: "confirm_action", parameters: [] }
  ]
};

export function getPreferredOwnerForIntent(intent: string): string {
  return INTENT_PREFERRED_OWNER[intent] ?? "GenericPage";
}

export function isMethodAllowedForClass(className: string, intent: string): boolean {
  const allowedClasses = INTENT_CLASS_OWNERSHIP[intent];
  if (!allowedClasses) return true;
  return allowedClasses.includes(className);
}

export function getMisplacedMethodWarning(className: string, methodName: string, intent: string): string | null {
  const allowedClasses = INTENT_CLASS_OWNERSHIP[intent];
  if (!allowedClasses) return null;
  if (allowedClasses.includes(className)) return null;
  return `Method '${methodName}' (intent: ${intent}) does not belong in ${className}. Allowed classes: ${allowedClasses.join(", ")}`;
}

/**
 * Context-dependent action intents that require specific screen/module context
 */
export const CONTEXT_DEPENDENT_INTENTS: Set<SemanticMethodIntent> = new Set([
  "select_product",
  "select_category",
  "click_primary_action",
  "return_to_list",
  "submit_form",
  "confirm_action",
  "fill_form_field",
  "select_first_visible_item",
  "select_first_visible_product",
  "select_first_visible_card",
  "select_first_visible_row",
  "select_visible_item_by_ordinal",
  "expect_primary_action_visible",
  "expect_primary_action_enabled",
  "expect_primary_action_disabled"
]);

/**
 * Intents that produce/establish screen context
 */
export const CONTEXT_PRODUCING_INTENTS: Partial<Record<SemanticMethodIntent, string>> = {
  open_home: "home",
  open_module: "module",
  start_session: "entry_started",
  submit_login: "authenticated",
  select_category: "category_selected",
  select_product: "product_selected"
};

/**
 * Check if an intent is context-dependent
 */
export function isContextDependentIntent(intent: SemanticMethodIntent): boolean {
  return CONTEXT_DEPENDENT_INTENTS.has(intent);
}

/**
 * Get the context produced by an intent (if any)
 */
export function getContextProducedByIntent(intent: SemanticMethodIntent): string | undefined {
  return CONTEXT_PRODUCING_INTENTS[intent];
}
