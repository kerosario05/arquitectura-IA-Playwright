import { Locator } from "playwright";

/** Optional evidence: a removed click owner must not consume the action timeout. */
export async function readClickOwnerClassTokens(locator: Locator): Promise<string[] | undefined> {
  return locator.evaluate(
    (el) => (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean),
    undefined,
    { timeout: 300 },
  ).catch(() => undefined);
}
