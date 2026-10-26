import type { Page } from "@playwright/test";

export type JiraFieldValidationEvidence = {
  fieldLabel: string;
  invalid: true;
  associatedError: true;
};

/**
 * Confirms a field-level error from the accessible form state. A generic alert
 * is insufficient unless it names the field; linked ARIA error text is also
 * accepted. Field values are never returned or logged.
 */
export async function observeJiraFieldValidation(
  page: Page,
  requestedLabel: string,
): Promise<JiraFieldValidationEvidence | undefined> {
  const expected = normalize(requestedLabel);
  if (!expected) return undefined;
  const observation = String.raw`(target) => {
    function normalizeText(value) {
      return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("es").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
    }
    function visible(element) {
      if (!(element instanceof HTMLElement) || element.hidden) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && style.visibility !== "collapse"
        && rect.width > 0 && rect.height > 0;
    }
    const controls = Array.from(document.querySelectorAll("input,select,textarea,[contenteditable='true']"))
      .filter(visible)
      .map((control) => {
        const labels = [
          ...(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement
            ? Array.from(control.labels ?? []).map((label) => label.innerText || label.textContent || "") : []),
          control.getAttribute("aria-label") ?? "",
          ...(control.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? ""),
        ].map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean);
        const matchingLabel = labels.find((label) => {
          const normalized = normalizeText(label);
          return normalized === target || normalized.includes(target);
        });
        return matchingLabel ? { control, label: matchingLabel } : undefined;
      })
      .filter(Boolean);
    function isInvalid(control) {
      return control.getAttribute("aria-invalid") === "true"
        || (control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement)
          && !control.validity.valid;
    }
    function labelsOf(control) {
      return [
        ...(control instanceof HTMLInputElement || control instanceof HTMLSelectElement || control instanceof HTMLTextAreaElement
          ? Array.from(control.labels ?? []).map((item) => item.innerText || item.textContent || "") : []),
        control.getAttribute("aria-label") ?? "",
        ...(control.getAttribute("aria-labelledby") ?? "").split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? ""),
      ].map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean);
    }
    // A generic required-field assertion has no field name to resolve. It is
    // still observable when a control's local field group exposes the required
    // message. Many applications render custom validation styles/messages
    // without setting aria-invalid or native required attributes, so the local
    // message itself is authoritative when tied to a visible control. Keep it
    // scoped to that control's immediate form group; a page-level toast or a
    // neighboring field's error cannot satisfy it.
    if (/^(?:campo requerido|campo obligatorio|required field|field required)$/.test(target)) {
      const visibleControls = Array.from(document.querySelectorAll("input,select,textarea,[contenteditable='true']"))
        .filter(visible);
      for (const control of visibleControls) {
        const labels = labelsOf(control);
        const referencedIds = [control.getAttribute("aria-describedby"), control.getAttribute("aria-errormessage")]
          .filter(Boolean).flatMap((value) => value.split(/\s+/));
        const linkedMessages = referencedIds.map((id) => document.getElementById(id))
          .filter((element) => Boolean(element && visible(element)))
          .map((element) => normalizeText(element.innerText || element.textContent || ""));
        let current = control.parentElement;
        const localMessages = [];
        for (let depth = 0; current && depth < 3 && !current.matches("form,body"); depth += 1, current = current.parentElement) {
          localMessages.push(...Array.from(current.querySelectorAll("[role='alert'],[aria-live],small,span,p,[class*='error'],[class*='invalid']"))
            .filter(visible).map((element) => normalizeText(element.innerText || element.textContent || "")));
        }
        const requiredMessage = /(?:^|\b)(?:campo requerido|campo obligatorio|required field|field required)(?:\b|$)/;
        if (![...linkedMessages, ...localMessages].some((message) => requiredMessage.test(message))) continue;
        return { fieldLabel: labels[0] ?? "Required field", invalid: true, associatedError: true };
      }
      return undefined;
    }
    function columnStart(cell) {
      let start = 0;
      for (const sibling of Array.from(cell.parentElement.children)) {
        if (sibling === cell) return start;
        start += Math.max(1, sibling.colSpan || 1);
      }
      return start;
    }
    // Table-aware: semantic column header -> the single invalid editable control in that column.
    function tableControl() {
      const headers = Array.from(document.querySelectorAll("th,[role='columnheader']")).filter(visible)
        .filter((header) => normalizeText(header.innerText || header.textContent || "").includes(target));
      if (headers.length !== 1) return undefined;
      const header = headers[0];
      const table = header.closest("table");
      if (!table) return undefined;
      const start = columnStart(header);
      const invalidControls = [];
      for (const row of Array.from(table.rows)) {
        if (row.contains(header)) continue;
        let position = 0;
        for (const cell of Array.from(row.cells)) {
          const span = Math.max(1, cell.colSpan || 1);
          if (start >= position && start < position + span) {
            for (const control of Array.from(cell.querySelectorAll("input,select,textarea,[contenteditable='true']"))) {
              if (visible(control) && isInvalid(control)) invalidControls.push(control);
            }
          }
          position += span;
        }
      }
      if (invalidControls.length !== 1) return undefined;
      return { control: invalidControls[0], label: labelsOf(invalidControls[0])[0] ?? "", table: true };
    }
    // Exactly one direct label match wins; zero or several fall back to the table-header mapping (fails closed if ambiguous).
    const found = controls.length === 1 ? { ...controls[0], table: false } : tableControl();
    if (!found) return undefined;
    const { control, label, table } = found;
    if (!table && !isInvalid(control)) return undefined;

    const referencedIds = [control.getAttribute("aria-describedby"), control.getAttribute("aria-errormessage")]
      .filter(Boolean).flatMap((value) => value.split(/\s+/));
    const linkedMessages = referencedIds.map((id) => document.getElementById(id)).filter((element) => Boolean(element && visible(element)));
    const fieldTokens = normalizeText(label).split(" ").filter((token) => token.length > 1);
    const visibleAlerts = Array.from(document.querySelectorAll("[role='alert'],[aria-live='assertive'],[aria-live='polite']"))
      .filter(visible);
    const namedAlert = visibleAlerts.find((element) => {
      const message = normalizeText(element.innerText || element.textContent || "");
      // Table rows share tokens except the row ordinal, so require the whole row-specific label as a phrase.
      if (table) return Boolean(normalizeText(label)) && (" " + message + " ").includes(" " + normalizeText(label) + " ");
      return fieldTokens.length > 0 && fieldTokens.every((token) => message.includes(token));
    });
    const linkedError = linkedMessages.find((element) => (element.innerText || element.textContent || "").trim().length > 0);
    if (!linkedError && !namedAlert) return undefined;
    return { fieldLabel: label, invalid: true, associatedError: true };
  }`;
  return await page.evaluate(`(${observation})(${JSON.stringify(expected)})`) as JiraFieldValidationEvidence | undefined;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}
