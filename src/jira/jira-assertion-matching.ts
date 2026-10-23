function normalizeAssertionText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

/**
 * Drop a leading word that only names the notification channel ("aviso", "toast"...) from an
 * expected text. The channel is not literal UI text; the remaining content is still required.
 * Returns the input unchanged when nothing substantive would remain (fail closed).
 */
export function stripJiraNotificationChannelWord(expected: string): string {
  const stripped = expected.replace(/^\s*(?:aviso|alerta|notificaci[oó]n|toast|snackbar)\b[\s:,-]*/i, "");
  return stripped.trim() ? stripped : expected;
}

/** Match a credential rejection oracle to an equivalent visible login error. */
export function jiraCredentialRejectionMatches(observed: string, expected: string): boolean {
  const actual = normalizeAssertionText(observed);
  const intended = normalizeAssertionText(expected);
  const credential = /\b(?:credencial(?:es)?|contrasena|password|usuario|user)\b/;
  const rejected = /\b(?:invalid[oa]s?|incorrect[oa]s?|errone[oa]s?|wrong|rechazad[oa]s?)\b/;
  const expectedRejection = rejected.test(intended)
    || /\bno\s+(?:son?\s+)?(?:valid[oa]s?|correct[oa]s?)\b/.test(intended)
    || /\b(?:problema|error|rechazo|fallo|falla)\b/.test(intended);
  return credential.test(intended) && expectedRejection && credential.test(actual) && rejected.test(actual);
}

/** Classify a failed assertion without returning page text or credential values. */
export async function observeJiraCredentialRejection(page: import("@playwright/test").Page): Promise<boolean> {
  // Credential-like wording elsewhere (help, historical activity, etc.) is not
  // evidence of a rejected login unless the password form is still visible.
  const passwordVisible = await page.locator('input[type="password"]').evaluateAll(elements => elements.some(element => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  }));
  if (!passwordVisible) return false;
  const texts = await page.locator("body *").evaluateAll(elements => elements
    .filter((element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
        && !element.closest('nav,aside,header,button,a,[role="navigation"],[role="button"],[role="link"]')
        && !element.querySelector('input,textarea,select,button');
    })
    .map(element => element.innerText.trim())
    .filter(text => text.length > 0 && text.length <= 240));
  return texts.some(text => jiraCredentialRejectionMatches(text, "credenciales inválidas"));
}

const NEGATIVE_STATE = /\b(?:error|errores|invalid[oa]s?|incorrect[oa]s?|errone[oa]s?|rechazad[oa]s?|rechazo|fallo|falla|fallid[oa]s?)\b|\bno\s+(?:es|son|esta|estan)?\s*(?:valid[oa]s?|correct[oa]s?)\b/;
const SUCCESS_STATE = /\b(?:exito|exitos[oa]s?|satisfactori[oa]s?|correctamente)\b/;
const SUBJECT_STOPWORDS = new Set(["de", "del", "la", "el", "los", "las", "un", "una", "que", "y", "en", "se", "mensaje", "aparece", "muestra", "mostrar", "visible", "no", "es", "son", "esta", "estan",
  "error", "errores", "invalido", "invalida", "invalidos", "invalidas", "incorrecto", "incorrecta", "rechazado", "rechazada", "rechazo", "fallo", "falla", "valido", "valida", "correcto", "correcta"]);
const stem = (token: string): string => (token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token);

/**
 * Deterministic equivalence for negative-validation assertions: the expected text must ask for an
 * error/invalid state, the currently visible alert must itself signal a negative (non-success)
 * state, and every substantive subject token of the expectation must appear in that alert.
 * Callers pass only alert/aria-live text; ordinary page text must never reach this function.
 */
export function jiraAlertErrorEquivalenceMatches(alertText: string, expected: string): boolean {
  const intended = normalizeAssertionText(expected);
  const actual = normalizeAssertionText(alertText);
  if (!NEGATIVE_STATE.test(intended) || !NEGATIVE_STATE.test(actual) || SUCCESS_STATE.test(actual)) return false;
  const subject = intended.split(" ").filter(token => token && !SUBJECT_STOPWORDS.has(token));
  if (!subject.length) return false;
  const observed = new Set(actual.split(" ").map(stem));
  return subject.every(token => observed.has(stem(token)));
}

/** Text of currently visible role=alert / aria-live regions only. */
export async function readVisibleJiraAlertTexts(page: import("@playwright/test").Page): Promise<string[]> {
  return page.locator('[role="alert"],[aria-live="assertive"],[aria-live="polite"]').evaluateAll(elements => elements
    .filter((element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    })
    .map(element => element.innerText.trim()).filter(Boolean));
}
