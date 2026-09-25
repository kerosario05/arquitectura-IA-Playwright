/** Browser-side predicate passed as source so transpiler helpers cannot leak into the page. */
export const PAGE_LOADING_STATE_PREDICATE = `() => {
  const visible = (element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0 && rect.width > 0 && rect.height > 0;
  };
  const explicitSignals = Array.from(document.querySelectorAll('[aria-busy="true"], [role="progressbar"], [data-loading="true"], [data-testid*="loading" i]'));
  if (explicitSignals.some(visible)) return false;
  const textSignals = Array.from(document.querySelectorAll("[aria-label], button, p, span, div"))
    .filter(visible)
    .map((element) => (element.textContent || element.getAttribute("aria-label") || "").trim())
    .filter((text) => text.length > 0 && text.length <= 80);
  return !textSignals.some((text) => /^(generando|cargando|procesando|loading(?:\.\.\.)?|preparando)\\b/i.test(text));
}`;
