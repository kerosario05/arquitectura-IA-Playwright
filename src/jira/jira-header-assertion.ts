import type { Page } from "@playwright/test";

export type JiraHeaderTextObservation = { matchCount: number; observedText?: string };

function normalizeExactHeaderText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

/** Read one exact, currently visible header text leaf outside global navigation. */
export async function observeJiraHeaderText(page: Page, expected: string): Promise<JiraHeaderTextObservation> {
  const normalizedExpected = normalizeExactHeaderText(expected);
  if (!normalizedExpected) return { matchCount: 0 };
  return page.evaluate((target) => {
    const roots = Array.from(document.querySelectorAll<HTMLElement>('header,[role="banner"]'))
      .filter(root => !root.parentElement?.closest('header,[role="banner"]'));
    const matches: string[] = [];
    for (const root of roots) {
      if (root.closest('main,[role="main"]')) continue;
      for (const element of [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]) {
        if (element.closest('nav,aside,[role="navigation"],[role="complementary"],[role="menu"],[role="menubar"],[aria-hidden="true"],[aria-label*="breadcrumb" i],[class*="breadcrumb" i]')) continue;
        const text = (element.innerText || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es")
          .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
        if (!text || text !== target
          || Array.from(element.children).some(child => ((child as HTMLElement).innerText ?? child.textContent ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es")
            .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ") === target)) continue;
        let visible = true;
        for (let current: HTMLElement | null = element; current; current = current.parentElement) {
          const style = window.getComputedStyle(current);
          const rect = current.getBoundingClientRect();
          if (current.hidden || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse"
            || rect.width <= 0 || rect.height <= 0) { visible = false; break; }
        }
        if (visible) matches.push(element.innerText.trim());
      }
    }
    return { matchCount: matches.length, ...(matches.length === 1 ? { observedText: matches[0] } : {}) };
  }, normalizedExpected);
}

/** Wait on the browser's render cycle until the exact header identity/role is uniquely visible. */
export async function waitForJiraHeaderText(page: Page, expected: string, timeoutMs: number): Promise<string> {
  const normalizedExpected = normalizeExactHeaderText(expected);
  if (!normalizedExpected) throw new Error("JIRA_HEADER_ASSERTION_TEXT_MISSING");
  const handle = await page.waitForFunction((target) => {
    const roots = Array.from(document.querySelectorAll<HTMLElement>('header,[role="banner"]'))
      .filter(root => !root.parentElement?.closest('header,[role="banner"]'));
    const matches: string[] = [];
    for (const root of roots) {
      if (root.closest('main,[role="main"]')) continue;
      for (const element of [root, ...Array.from(root.querySelectorAll<HTMLElement>("*"))]) {
        if (element.closest('nav,aside,[role="navigation"],[role="complementary"],[role="menu"],[role="menubar"],[aria-hidden="true"],[aria-label*="breadcrumb" i],[class*="breadcrumb" i]')) continue;
        const text = (element.innerText || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es")
          .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
        if (text !== target || Array.from(element.children).some(child => ((child as HTMLElement).innerText ?? child.textContent ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es")
          .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ") === target)) continue;
        let visible = true;
        for (let current: HTMLElement | null = element; current; current = current.parentElement) {
          const style = window.getComputedStyle(current);
          const rect = current.getBoundingClientRect();
          if (current.hidden || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse"
            || rect.width <= 0 || rect.height <= 0) { visible = false; break; }
        }
        if (visible) matches.push(element.innerText.trim());
      }
    }
    return matches.length === 1 ? matches[0] : false;
  }, normalizedExpected, { timeout: timeoutMs, polling: "raf" });
  const observedText: unknown = await handle.jsonValue();
  if (typeof observedText !== "string") throw new Error("JIRA_HEADER_ASSERTION_NOT_SATISFIED");
  return observedText;
}
