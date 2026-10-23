import type { Page } from "@playwright/test";
import { createHash } from "node:crypto";

/** Captures Jira QA evidence as it appears in the test browser, without Playwright mask overlays. */
export async function captureJiraEvidenceScreenshot(
  page: Pick<Page, "screenshot">,
  options: { path?: string; fullPage?: boolean },
): Promise<Buffer> {
  return page.screenshot(options);
}

/**
 * Waits until no visible loading indicator (busy region, progressbar, or status/labelled "loading" text)
 * remains, using the page's own readiness signals. Returns false when it never settles within the bound,
 * so callers can refuse to persist a transient overlay as evidence.
 */
export async function waitForJiraScreenSettled(
  page: Pick<Page, "isClosed" | "waitForFunction">,
  timeoutMs = 8000,
): Promise<boolean> {
  if (page.isClosed()) return false;
  try {
    await page.waitForFunction(`(() => {
      const visible = element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 2 && rect.height > 2 && style.display !== "none"
          && style.visibility !== "hidden" && Number(style.opacity) > 0.05;
      };
      const loadingLabel = /\\b(?:estado\\s+(?:de\\s+)?carga|cargando|loading|procesando|processing|actualizando|updating)\\b/i;
      return !Array.from(document.querySelectorAll(
        '[aria-busy="true"],[role="progressbar"],[role="status"],[aria-live],[aria-label]',
      )).some(element => visible(element) && (
        element.getAttribute("aria-busy") === "true" || element.getAttribute("role") === "progressbar"
        || loadingLabel.test(element.getAttribute("aria-label") || element.textContent || "")
      ));
    })()`, undefined, { timeout: timeoutMs });
    return true;
  } catch (error) {
    void error;
    return false;
  }
}

/**
 * Builds a Jira-only screen identity from visible UI structure, labels and control states.
 * Field contents are deliberately excluded so credentials and business data never enter the
 * persisted identity or report. The shared Recording screen signature remains untouched.
 */
export async function readJiraScreenIdentity(
  page: Pick<Page, "isClosed" | "evaluate">,
): Promise<{ id: string; title: string } | undefined> {
  if (page.isClosed()) return undefined;
  try {
    const { signature, routePart } = await page.evaluate<{ signature: string; routePart: string }>(`(() => {
      const visible = element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 2 && rect.height > 2 && style.display !== "none"
          && style.visibility !== "hidden" && Number(style.opacity) > 0.05;
      };
      const normalize = value => value.replace(/\\s+/g, " ").trim().slice(0, 100)
        .replace(/\\b\\d{4,}\\b/g, "<number>")
        .replace(/\\b[\\w.+-]+@[\\w.-]+\\.[a-z]{2,}\\b/gi, "<email>")
        .replace(/\\b(?:RD|US)\\$\\s*[\\d,.]+/gi, "<amount>");
      const accessibleName = element => {
        const labelledBy = element.getAttribute("aria-labelledby")
          ?.split(/\\s+/).map(id => document.getElementById(id)?.textContent ?? "").join(" ");
        const label = element.id
          ? Array.from(document.querySelectorAll("label[for]")).find(candidate => candidate.getAttribute("for") === element.id)?.textContent
          : element.closest("label")?.textContent;
        return normalize(element.getAttribute("aria-label") || labelledBy || label || element.getAttribute("placeholder") || element.textContent || "");
      };
      const landmarks = Array.from(document.querySelectorAll(
        'h1,h2,h3,[role="heading"],legend,[role="dialog"],[role="alertdialog"],dialog',
      )).filter(visible).map(element => element.tagName.toLowerCase() + ":" + normalize(element.textContent ?? ""));
      const controls = Array.from(document.querySelectorAll(
        'button,a[href],input:not([type="hidden"]),textarea,select,[role="button"],[role="tab"],[role="checkbox"],[role="radio"],[role="switch"],[role="combobox"],[role="textbox"]',
      )).filter(visible).map(element => {
        const type = element.getAttribute("type") ?? "";
        // The screenshot identity represents the screen structure, not interaction state.
        // A selected tab/value or expanded control must not create a new document screen.
        return [element.tagName.toLowerCase(), element.getAttribute("role") ?? "", type, accessibleName(element)].join("|");
      });
      return { signature: JSON.stringify({ route: location.pathname, landmarks, controls }), routePart: location.pathname };
    })()`);
    if (!signature) return undefined;
    const routeName = routePart.split("/").filter(Boolean).at(-1)?.replace(/[-_]+/g, " ").replace(/\d+/g, "").trim();
    return {
      id: createHash("sha1").update(signature).digest("hex").slice(0, 16),
      title: routeName ? `Pantalla ${routeName}` : "Pantalla principal",
    };
  } catch (error) {
    void error;
    return undefined;
  }
}
