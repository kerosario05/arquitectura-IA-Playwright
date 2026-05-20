import type { Page, Locator } from "@playwright/test";
import type { PageSnapshot, SnapshotElement } from "../types/page-snapshot.types";
import { normalizeText } from "./target-resolver";

export type LoginFormField = {
  index: number;
  type: "text" | "password" | "email" | "unknown";
  locator: Locator;
  strategy: string;
  confidence: number;
  matchedText: string;
};

export type LoginButton = {
  locator: Locator;
  strategy: string;
  confidence: number;
  text: string;
};

export type LoginFormResolution = {
  status: "resolved" | "needs_setup_resolution" | "ambiguous";
  fields: LoginFormField[];
  submitButton?: LoginButton;
  confidence: number;
  diagnosis: string;
  userField?: LoginFormField;
  passwordField?: LoginFormField;
};

const SUBMIT_PATTERNS = [
  /login/i, /sign\s*in/i, /log\s*in/i, /submit/i,
  /ingresar/i, /iniciar/i, /acceder/i, /entrar/i,
  /continue/i, /continuar/i,
  /^go$/i, /^ir$/i
];

const REDACTED_PATTERN = /^\[.*\]$/;

function isNotRedacted(text: string | undefined): boolean {
  return !!text && !REDACTED_PATTERN.test(text);
}

async function locatorCount(locator: Locator): Promise<number> {
  try { return await locator.count(); } catch { return 0; }
}

export async function resolveLoginForm(
  page: Page,
  snapshot: PageSnapshot,
  valueKeys?: string[]
): Promise<LoginFormResolution> {
  // Strategy 1: Named locators using snapshot hints (placeholder, label, name, id)
  // Strategy 2: Type-based locators (input[type=text], input[type=password])
  // Strategy 3: Positional (first two non-password inputs + password input)

  const fields: LoginFormField[] = [];
  let userField: LoginFormField | undefined;
  let passwordField: LoginFormField | undefined;

  // --- Find user field ---
  // Try snapshot hints first (placeholder, label, name)
  const userSnapshotEl = snapshot.elements.find(
    (el) => isEditableField(el) && el.visible &&
    (el.inputType === "text" || el.inputType === "email" || !el.inputType || el.inputType === undefined)
  );

  if (userSnapshotEl) {
    const userLocator = await resolveLoginFieldByName(page, userSnapshotEl);
    if (userLocator) {
      userField = {
        index: 0,
        type: "text",
        locator: userLocator,
        strategy: "login_field:user:snapshot",
        confidence: 0.7,
        matchedText: userSnapshotEl.placeholder ?? userSnapshotEl.name ?? "user"
      };
      fields.push(userField);
    }
  }

  // If snapshot-based resolution failed, try type-based: first text input
  if (!userField) {
    const textInput = page.locator("input[type=text]").first();
    const textInputCount = await locatorCount(textInput);
    if (textInputCount > 0) {
      userField = {
        index: 0,
        type: "text",
        locator: textInput,
        strategy: "login_field:user:input[type=text]",
        confidence: 0.6,
        matchedText: "text_input"
      };
      fields.push(userField);
    }
  }

  // Fallback: first visible input:not([type=hidden]):not([type=password])
  if (!userField) {
    const genericInput = page.locator("input:not([type=hidden]):not([type=password])").first();
    const genericCount = await locatorCount(genericInput);
    if (genericCount > 0) {
      userField = {
        index: 0,
        type: "text",
        locator: genericInput,
        strategy: "login_field:user:generic_input",
        confidence: 0.5,
        matchedText: "generic_input"
      };
      fields.push(userField);
    }
  }

  // --- Find password field ---
  // Try snapshot hints
  const passwordSnapshotEl = snapshot.elements.find(
    (el) => isEditableField(el) && el.visible && el.inputType === "password"
  );

  if (passwordSnapshotEl) {
    const passwordLocator = await resolveLoginFieldByName(page, passwordSnapshotEl);
    if (passwordLocator) {
      passwordField = {
        index: 1,
        type: "password",
        locator: passwordLocator,
        strategy: "login_field:password:snapshot",
        confidence: 0.8,
        matchedText: passwordSnapshotEl.placeholder ?? passwordSnapshotEl.name ?? "password"
      };
      fields.push(passwordField);
    }
  }

  // If snapshot-based resolution failed, try type-based
  if (!passwordField) {
    const passwordInput = page.locator("input[type=password]").first();
    const passwordCount = await locatorCount(passwordInput);
    if (passwordCount > 0) {
      passwordField = {
        index: 1,
        type: "password",
        locator: passwordInput,
        strategy: "login_field:password:input[type=password]",
        confidence: 0.75,
        matchedText: "password_input"
      };
      fields.push(passwordField);
    }
  }

  // Fallback: if we have exactly 2 fields and only one is classified, use second as password
  if (!passwordField && userField) {
    const allInputs = page.locator("input:not([type=hidden])");
    const count = await locatorCount(allInputs);
    if (count >= 2) {
      const secondInput = allInputs.nth(1);
      passwordField = {
        index: 1,
        type: "password",
        locator: secondInput,
        strategy: "login_field:password:positional",
        confidence: 0.45,
        matchedText: "second_input"
      };
      fields.push(passwordField);
    }
  }

  if (fields.length === 0) {
    return {
      status: "needs_setup_resolution",
      fields: [],
      confidence: 0,
      diagnosis: "Could not find any editable fields for login form."
    };
  }

  // --- Find submit button ---
  let submitButton: LoginButton | undefined;

  // Try by name first: use snapshot hints
  const submitSnapshotEl = snapshot.elements.find(
    (el) => isSubmitButton(el) && el.visible
  );
  if (submitSnapshotEl) {
    const btnLocator = await resolveLoginButton(page, submitSnapshotEl);
    if (btnLocator) {
      submitButton = {
        locator: btnLocator,
        strategy: "login_submit:snapshot",
        confidence: 0.75,
        text: submitSnapshotEl.text ?? submitSnapshotEl.name ?? "submit"
      };
    }
  }

  // Try input[type=submit]
  if (!submitButton) {
    const submitInput = page.locator("input[type=submit]").first();
    const submitCount = await locatorCount(submitInput);
    if (submitCount > 0) {
      submitButton = {
        locator: submitInput,
        strategy: "login_submit:input[type=submit]",
        confidence: 0.7,
        text: "submit"
      };
    }
  }

  // Try button[type=submit]
  if (!submitButton) {
    const submitBtn = page.locator("button[type=submit]").first();
    const btnCount = await locatorCount(submitBtn);
    if (btnCount > 0) {
      submitButton = {
        locator: submitBtn,
        strategy: "login_submit:button[type=submit]",
        confidence: 0.7,
        text: "submit_button"
      };
    }
  }

  // Try role=button with submit/login text
  if (!submitButton) {
    for (const text of ["Login", "LOGIN", "login-button", "Sign In", "Sign in", "sign in", "Iniciar sesión", "Ingresar", "Acceder"]) {
      const btn = page.getByRole("button", { name: text });
      const count = await locatorCount(btn);
      if (count > 0) {
        submitButton = {
          locator: btn.first(),
          strategy: `login_submit:role:button:${text}`,
          confidence: 0.65,
          text
        };
        break;
      }
    }
  }

  // Try any visible button
  if (!submitButton) {
    const anyButton = page.locator("button, input[type=button], input[type=submit]").first();
    const anyCount = await locatorCount(anyButton);
    if (anyCount > 0) {
      submitButton = {
        locator: anyButton,
        strategy: "login_submit:generic_button",
        confidence: 0.4,
        text: "generic_button"
      };
    }
  }

  if (!submitButton) {
    return {
      status: "needs_setup_resolution",
      fields,
      userField,
      passwordField,
      confidence: 0.4,
      diagnosis: `Found ${fields.length} editable field(s) but no submit/login button detected.`
    };
  }

  const foundBoth = !!userField && !!passwordField;
  const confidence = Math.min(0.95, 0.4 + (userField ? 0.25 : 0) + (passwordField ? 0.25 : 0) + (submitButton ? 0.2 : 0));

  const diagnosis = foundBoth
    ? `Resolved login form: user field, password field, and submit button.`
    : `Resolved login form partially: ${userField ? "user field" : "no user field"}, ${passwordField ? "password field" : "no password field"}, submit button found.`;

  return {
    status: "resolved",
    fields,
    submitButton,
    confidence,
    diagnosis,
    userField,
    passwordField
  };
}

async function resolveLoginFieldByName(page: Page, el: SnapshotElement): Promise<Locator | undefined> {
  const candidates = [
    { label: "getByLabel", fn: () => page.getByLabel(el.placeholder ?? el.name ?? el.id ?? "", { exact: false }) },
    { label: "getByPlaceholder", fn: () => page.getByPlaceholder(el.placeholder ?? el.name ?? "", { exact: false }) },
    { label: "getByRole(textbox)", fn: () => page.getByRole("textbox", { name: el.placeholder ?? el.name ?? "" }) },
    { label: "getByRole(combobox)", fn: () => page.getByRole("combobox", { name: el.placeholder ?? el.name ?? "" }) },
    { label: `input[name="${el.name}"]`, fn: () => page.locator(`input[name="${el.name}"]`) },
    { label: `input[id="${el.id}"]`, fn: () => page.locator(`input[id="${el.id}"]`) },
    { label: `input[aria-label="${el.placeholder ?? el.name ?? ""}"]`, fn: () => page.locator(`input[aria-label="${el.placeholder ?? el.name ?? ""}"]`) },
    { label: `input[placeholder="${el.placeholder}"]`, fn: () => page.locator(`input[placeholder="${el.placeholder}"]`) },
  ];

  for (const c of candidates) {
    const locator = c.fn();
    const count = await locatorCount(locator);
    if (count > 0) return locator.first();
  }

  return undefined;
}

async function resolveLoginButton(page: Page, el: SnapshotElement): Promise<Locator | undefined> {
  const candidates = [
    { label: `input[name="${el.name}"]`, fn: () => page.locator(`input[name="${el.name}"]`) },
    { label: `input[id="${el.id}"]`, fn: () => page.locator(`input[id="${el.id}"]`) },
    { label: "getByRole(button)", fn: () => page.getByRole("button", { name: el.text ?? el.name ?? el.label ?? "" }) },
  ];

  for (const c of candidates) {
    const locator = c.fn();
    const count = await locatorCount(locator);
    if (count > 0) return locator.first();
  }

  return undefined;
}

function isEditableField(el: SnapshotElement): boolean {
  const EDITABLE_TAGS = new Set(["input", "textarea"]);
  const EDITABLE_ROLES = new Set(["textbox", "combobox", "searchbox", "spinbutton"]);
  if (el.tagName && EDITABLE_TAGS.has(el.tagName.toLowerCase())) return true;
  if (el.role && EDITABLE_ROLES.has(el.role)) return true;
  return false;
}

function isSubmitButton(el: SnapshotElement): boolean {
  if (el.type === "button") return true;
  if (el.tagName?.toLowerCase() === "button") return true;
  if (el.inputType === "submit") return true;
  if (el.role === "button" || el.role === "submit") return true;
  return false;
}
