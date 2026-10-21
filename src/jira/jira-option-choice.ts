import { createHash } from "node:crypto";
import type { Locator, Page } from "@playwright/test";

/** Honor the popup relation observed on the field when the app supplies one. */
export async function jiraOptionSearchRoot(page: Page, field: Locator): Promise<Locator> {
  const ids = `${await field.getAttribute("aria-controls") ?? ""} ${await field.getAttribute("aria-owns") ?? ""}`.trim().split(/\s+/).filter(Boolean);
  return ids.length ? page.locator([...new Set(ids)].map(id => `[id=${JSON.stringify(id)}]`).join(",")) : page.locator("body");
}

export async function jiraOptionBelongsToRoot(root: Locator, option: Locator): Promise<boolean> {
  const handle = await option.elementHandle();
  if (!handle) return false;
  try { return await root.evaluateAll((elements, option) => elements.some(element => element.contains(option)), handle); }
  finally { await handle.dispose(); }
}

/** User-authorized any-match policy; stable identity makes DOM order irrelevant. */
export function chooseJiraMatchingOption<T>(matches: readonly T[], identity: (item: T) => string, query: string): T | undefined {
  const canonicalQuery = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(token => !["de", "del", "la", "el", "los", "las"].includes(token)).join(" ");
  let selected: T | undefined;
  let selectedRank: string | undefined;
  const identities=new Set<string>();
  for (const item of matches) {
    // Text-only option identities may contain a changing balance/price. Retain
    // the currency and durable account/product number, not its monetary amount.
    const raw=identity(item);
    const stable=/^(?:id|testid):/.test(raw)?raw:raw.replace(/([\p{L}]{1,3}\$|\p{Sc})\s*[-+]?\d[\d.,]*(?:\s|$)/gu,'$1[amount] ').trim();
    // If removing volatile amounts loses the only distinction, there is no
    // durable choice. Do not turn the any-match policy into DOM-order authority.
    if(identities.has(stable)) return undefined;
    identities.add(stable);
    const rank = createHash("sha256").update(`${canonicalQuery}\0${stable}`).digest("hex");
    if (selectedRank === undefined || rank > selectedRank) { selected = item; selectedRank = rank; }
  }
  return selected;
}

export function jiraOptionTextMatches(observed: string, expected: string): boolean {
  const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(token => token && !["de", "del", "la", "el", "los", "las"].includes(token));
  const variants = (token: string) => {
    const result = new Set([token]);
    if (token.length > 5 && token.endsWith("ces")) result.add(`${token.slice(0, -3)}z`);
    if (token.length > 4 && token.endsWith("es")) result.add(token.slice(0, -2));
    if (token.length > 3 && token.endsWith("s")) result.add(token.slice(0, -1));
    return result;
  };
  const requested = normalize(expected).map(variants);
  const available = normalize(observed).map(variants);
  return requested.length > 0 && requested.every(tokens => available.some(other => [...tokens].some(token => other.has(token))));
}
