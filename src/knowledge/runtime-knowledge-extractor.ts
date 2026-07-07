import type { Page } from "@playwright/test";
import { createHash } from "node:crypto";

export type RuntimeUiSnapshot = {
  screenKey: string;
  url: string;
  headings: string[];
  clickTargets: string[];
  assertionTargets: string[];
  inputLabels: string[];
  selectLabels: string[];
  capturedAt: string;
};

/**
 * Extract a lightweight UI snapshot from the current page.
 * No discovery — just captures visible navigation elements.
 */
export async function extractRuntimeUiSnapshot(page: Page): Promise<RuntimeUiSnapshot> {
  const raw = await page.evaluate(() => {
    const els = Array.from(document.querySelectorAll("*")).filter(e => {
      const style = window.getComputedStyle(e);
      return style.display !== "none" && style.visibility !== "hidden" && e.getBoundingClientRect().width > 0;
    });

    const headings: string[] = [];
    const clickTargets: string[] = [];
    const inputs: string[] = [];
    const selects: string[] = [];

    const seenClick = new Set<string>();
    const seenHeading = new Set<string>();

    for (const el of els) {
      const tag = el.tagName.toLowerCase();
      const text = (el.textContent ?? "").trim();
      const role = el.getAttribute("role") ?? "";
      const ariaLabel = el.getAttribute("aria-label") ?? "";

      // Headings
      if (/^h[1-6]$/.test(tag) && text.length > 1 && text.length < 100 && !seenHeading.has(text)) {
        seenHeading.add(text);
        headings.push(text);
      }

      // Clickable elements (buttons, links, roles)
      const isClickable = tag === "button" || tag === "a" || role === "button" || role === "link" || role === "menuitem";
      if (isClickable && text.length > 1 && text.length < 80 && !seenClick.has(text)) {
        seenClick.add(text);
        clickTargets.push(text);
      }

      // Input labels
      if ((tag === "input" || tag === "textarea") && (ariaLabel || text)) {
        inputs.push(ariaLabel || text);
      }

      // Select labels
      if (tag === "select" && (ariaLabel || text)) {
        selects.push(ariaLabel || text);
      }
    }

    // Also look for labels associated with inputs
    for (const el of els) {
      if (el.tagName.toLowerCase() === "label") {
        const forAttr = (el as HTMLLabelElement).htmlFor;
        if (forAttr && document.getElementById(forAttr)) {
          const labelText = (el.textContent ?? "").trim();
          if (labelText && !inputs.includes(labelText)) inputs.push(labelText);
        }
      }
    }

    return { headings, clickTargets, inputs, selects };
  });

  const url = page.url().split("?")[0]; // Strip query params
  const clickKey = raw.clickTargets.slice(0, 8).join("|").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const screenKey = createHash("sha256").update(`ui:${url}:${raw.headings[0] ?? ""}:${clickKey}`).digest("hex").slice(0, 12);

  console.log(`[runtime-knowledge] snapshot captured screen=${screenKey} clicks=${raw.clickTargets.length} inputs=${raw.inputs.length}`);

  return {
    screenKey,
    url,
    headings: raw.headings.slice(0, 5),
    clickTargets: raw.clickTargets.slice(0, 20),
    assertionTargets: raw.headings.slice(0, 3),
    inputLabels: raw.inputs.slice(0, 10),
    selectLabels: raw.selects.slice(0, 5),
    capturedAt: new Date().toISOString(),
  };
}
