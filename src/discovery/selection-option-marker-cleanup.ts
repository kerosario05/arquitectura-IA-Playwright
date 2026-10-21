type MarkedLocator = {
  count(): Promise<number>;
  evaluate(
    pageFunction: (element: Element, arg: string) => void,
    arg: string,
    options?: { timeout?: number },
  ): Promise<void>;
};

/**
 * Remove a temporary marker only when the selected option is still attached.
 * Selection may close and detach the option immediately; cleanup must never hold
 * an already-verified selection open while Playwright waits for that locator.
 */
export async function cleanupSelectionOptionMarker(
  locator: MarkedLocator,
  markerAttribute: string,
  timeoutMs = 500,
): Promise<void> {
  const count = await locator.count().catch(() => 0);
  if (count !== 1) return;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const cleanup = locator.evaluate(
    (element, attribute) => element.removeAttribute(attribute),
    markerAttribute,
    { timeout: timeoutMs },
  ).then(() => undefined).catch(() => undefined);
  const deadline = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([cleanup, deadline]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
