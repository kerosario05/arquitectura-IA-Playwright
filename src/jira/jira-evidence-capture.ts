import type { Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { waitForVisualSettle } from "../evidence/screen-settle";

/** Captures Jira QA evidence as it appears in the test browser, without Playwright mask overlays. */
export async function captureJiraEvidenceScreenshot(
  page: Page,
  options: { path?: string; fullPage?: boolean; settleTimeoutMs?: number; settleQuietMs?: number },
): Promise<Buffer> {
  const { settleTimeoutMs = 8000, settleQuietMs = 250, ...screenshotOptions } = options;
  const settled = await waitForVisualSettle(page, { timeoutMs: settleTimeoutMs, quietMs: settleQuietMs });
  if (!settled.settled) {
    throw new Error(settled.loaderVisible ? "JIRA_EVIDENCE_LOADER_STILL_VISIBLE" : "JIRA_EVIDENCE_SCREEN_NOT_SETTLED");
  }
  return page.screenshot(screenshotOptions);
}

/**
 * Waits until no visible loading indicator (busy region, progressbar, or status/labelled "loading" text)
 * remains, using the page's own readiness signals. Returns false when it never settles within the bound,
 * so callers can refuse to persist a transient overlay as evidence.
 */
export async function waitForJiraScreenSettled(
  page: Page,
  timeoutMs = 8000,
): Promise<boolean> {
  const settled = await waitForVisualSettle(page, { timeoutMs, quietMs: 250 });
  return settled.settled;
}

/** Names an observed screen from its visible heading, then from the SPA route. */
export function jiraScreenTitleFromObservedIdentity(headingTitle: string | undefined, routePart: string): string {
  const heading = headingTitle?.trim();
  if (heading) return heading;

  const routeName = routePart.split(/[?#]/, 1)[0]
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?.replace(/[-_]+/g, " ")
    .replace(/\d+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return routeName ? `Pantalla ${routeName}` : "Pantalla principal";
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
    const { signature, routePart, headingTitle } = await page.evaluate<{ signature: string; routePart: string; headingTitle?: string }>(`(() => {
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
      const headingTitle = Array.from(document.querySelectorAll(
        'h1,[role="heading"][aria-level="1"],h2,h3,legend',
      )).filter(visible).map(element => normalize(element.textContent ?? "")).find(Boolean);
      const controls = Array.from(document.querySelectorAll(
        'button,a[href],input:not([type="hidden"]),textarea,select,[role="button"],[role="tab"],[role="checkbox"],[role="radio"],[role="switch"],[role="combobox"],[role="textbox"]',
      )).filter(visible).map(element => {
        const type = element.getAttribute("type") ?? "";
        // The screenshot identity represents the screen structure, not interaction state.
        // A selected tab/value or expanded control must not create a new document screen.
        return [element.tagName.toLowerCase(), element.getAttribute("role") ?? "", type, accessibleName(element)].join("|");
      });
      const hashRoute = location.hash.startsWith("#") ? location.hash.slice(1).split(/[?#]/, 1)[0] : "";
      const routePart = hashRoute || location.pathname;
      return { signature: JSON.stringify({ route: routePart, landmarks, controls }), routePart, headingTitle };
    })()`);
    if (!signature) return undefined;
    return {
      id: createHash("sha1").update(signature).digest("hex").slice(0, 16),
      title: jiraScreenTitleFromObservedIdentity(headingTitle, routePart),
    };
  } catch (error) {
    void error;
    return undefined;
  }
}
