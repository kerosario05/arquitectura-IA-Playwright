import type { Page } from "@playwright/test";
import { createHash } from "node:crypto";

export type ObservedControl = {
  label: string;
  businessLabel?: string;
  locatorIdentity?: string;
  href?: string;
  role?: string;
  dataToggle?: string;
  ariaSelected?: string | null;
  ariaPressed?: string | null;
  parentRole?: string | null;
  sourceScreenKey: string;
};

export type RuntimeUiSnapshot = {
  screenKey: string;
  url: string;
  headings: string[];
  clickTargets: string[];
  businessLabels?: string[];
  observedControls: ObservedControl[];
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
    const businessLabels: string[] = [];
    const controls: Array<{
      label: string;
      businessLabel?: string;
      locatorIdentity?: string;
      href?: string;
      role?: string;
    }> = [];
    const inputs: string[] = [];
    const selects: string[] = [];

    const seenClick = new Set<string>();
    const seenHeading = new Set<string>();

    // Flat-string approximation of the accessible name: textContent concatenates
    // child text without separators (primary label + descriptive child become one
    // unresolvable token). Inserting a separator between element contributions
    // mirrors role/name matching so observed click targets stay localizable.
    // NOTE: no named function expressions — tsx wraps them with __name()
    // which does not exist in browser context.
    for (const el of els) {
      const tag = el.tagName.toLowerCase();
      const rawText = (el.textContent ?? "").trim();
      const role = el.getAttribute("role") ?? "";
      const ariaLabel = el.getAttribute("aria-label") ?? "";
      let accessibleName = ariaLabel;
      let businessLabel = ariaLabel;
      if (!accessibleName) {
        let flat = "";
        let primary = "";
        const stack: Node[] = [el];
        while (stack.length > 0) {
          const node = stack.pop()!;
          if (node.nodeType === Node.TEXT_NODE) {
            flat += node.textContent ?? "";
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (flat) {
              if (!primary) primary = flat;
              flat += " ";
            }
            const kids = node.childNodes;
            for (let j = kids.length - 1; j >= 0; j--) stack.push(kids[j]);
          }
        }
        accessibleName = flat;
        businessLabel = primary || flat;
      }
      const text = accessibleName.replace(/\s+/g, " ").trim() || rawText;
      const cleanBusiness = businessLabel.replace(/\s+/g, " ").trim();

      // Headings
      if (/^h[1-6]$/.test(tag) && text.length > 1 && text.length < 100 && !seenHeading.has(text)) {
        seenHeading.add(text);
        headings.push(text);
      }

      // Clickable elements (buttons, links, roles)
      const isClickable = tag === "button" || tag === "a" || role === "button" || role === "link" || role === "menuitem";
      if (isClickable && accessibleName.length > 1 && accessibleName.length < 80 && !seenClick.has(accessibleName)) {
        seenClick.add(accessibleName);
        clickTargets.push(accessibleName);
        const cleanBiz = cleanBusiness || accessibleName;
        businessLabels.push(cleanBiz);
        // Per-control identity — only genuinely observed signals, never invented.
        const href = tag === "a" ? (el.getAttribute("href") ?? undefined) : undefined;
        const stableId =
          el.getAttribute("data-testid") ||
          el.getAttribute("data-test-id") ||
          el.getAttribute("data-qa") ||
          ((el as HTMLElement).id ? (el as HTMLElement).id : undefined);
        const dataToggle = el.getAttribute("data-toggle") ?? undefined;
        const ariaSelected = el.getAttribute("aria-selected");
        const ariaPressed = el.getAttribute("aria-pressed");
        const parentRole = (el.parentElement?.getAttribute("role") ?? undefined) as string | undefined;
        controls.push({
          label: accessibleName,
          businessLabel: cleanBiz,
          ...(stableId ? { locatorIdentity: stableId } : {}),
          ...(href ? { href } : {}),
          role: role || tag,
          ...(dataToggle ? { dataToggle } : {}),
          ...(ariaSelected !== null ? { ariaSelected } : {}),
          ...(ariaPressed !== null ? { ariaPressed } : {}),
          ...(parentRole ? { parentRole } : {}),
        });
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

    return { headings, clickTargets, businessLabels, controls, inputs, selects };
  });

  const url = page.url().split("?")[0]; // Strip query params
  const clickKey = raw.clickTargets.slice(0, 8).join("|").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const screenKey = createHash("sha256").update(`ui:${url}:${raw.headings[0] ?? ""}:${clickKey}`).digest("hex").slice(0, 12);

  console.log(`[runtime-knowledge] snapshot captured screen=${screenKey} clicks=${raw.clickTargets.length} inputs=${raw.inputs.length}`);

  // Attach the observing screen to each structured control. No destination is
  // ever inferred here — destinationScreenKey comes only from real transitions.
  const observedControls = raw.controls.slice(0, 20).map((c) => ({ ...c, sourceScreenKey: screenKey }));

  return {
    screenKey,
    url,
    headings: raw.headings.slice(0, 5),
    clickTargets: raw.clickTargets.slice(0, 20),
    businessLabels: (raw.businessLabels ?? []).slice(0, 20),
    observedControls,
    assertionTargets: raw.headings.slice(0, 3),
    inputLabels: raw.inputs.slice(0, 10),
    selectLabels: raw.selects.slice(0, 5),
    capturedAt: new Date().toISOString(),
  };
}
