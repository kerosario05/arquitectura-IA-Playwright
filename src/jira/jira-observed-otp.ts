import type { Locator, Page } from "playwright";

const CONTINUE_ACTION = /^(?:continuar|verificar|confirmar|validar|ingresar|aceptar|enviar|siguiente|continue|verify|confirm|submit|next)$/i;
const CODE_INPUT = 'input:visible:not([type="password"],[type="hidden"],[type="checkbox"],[type="radio"],[type="submit"],[type="button"])';
const ACTIONS = 'button:visible, input[type="submit"]:visible, [role="button"]:visible';

/**
 * Jira-only completion of an OTP/access-code stage the executor already observed.
 * Uses only the live DOM: exactly one visible code input and exactly one visible
 * continue/verify action. Anything else fails closed. The code is never logged or put in errors.
 */
export async function completeObservedOtpStage(
  page: Pick<Page, "locator">,
  code: string | undefined,
  settle: () => Promise<string | undefined>,
): Promise<{ success: boolean }> {
  if (!code?.trim()) throw new Error("JIRA_OTP_CODE_MISSING");
  const inputs = page.locator(CODE_INPUT);
  if (await inputs.count() !== 1) throw new Error("JIRA_OTP_INPUT_NOT_UNIQUE");
  const actions = page.locator(ACTIONS);
  const labels: string[] = await actions.evaluateAll(els => els.map(el => ((el as HTMLElement).innerText || (el as HTMLInputElement).value || el.getAttribute("aria-label") || "").trim()));
  const matches = labels.flatMap((label, index) => CONTINUE_ACTION.test(label) ? [index] : []);
  if (matches.length !== 1) throw new Error("JIRA_OTP_ACTION_NOT_UNIQUE");
  const input: Locator = inputs.first();
  await input.fill(code);
  await actions.nth(matches[0]).click();
  return { success: (await settle()) !== "otp" };
}
