import type { Page, Request } from "@playwright/test";
import { ensureJiraDownloadObserver } from "./jira-download-assertion";

/** Wait for application requests started by this action, never global networkidle. */
export async function settleJiraAction(page: Page, action: () => Promise<unknown>): Promise<void> {
  // The owning Playwright scenario supplies the overall deadline. Teardown
  // closes the page; abort here on that real signal without another timer.
  ensureJiraDownloadObserver(page);
  const interrupted = new Error("JIRA_SPEC_ACTION_INTERRUPTED");
  let rejectStopped!: (error: Error) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
  const closed = () => rejectStopped(interrupted);
  const origin = new URL(page.url()).origin;
  const pending = new Map<Request, { done: Promise<void>; resolve: () => void }>();
  const started = (request: Request) => {
    if (new URL(request.url()).origin !== origin
      || !["xhr", "fetch", "document"].includes(request.resourceType())) return;
    let resolve!: () => void;
    const done = new Promise<void>(complete => { resolve = complete; });
    pending.set(request, { done, resolve });
  };
  const finished = (request: Request) => {
    pending.get(request)?.resolve();
    pending.delete(request);
  };
  page.on("request", started);
  page.on("requestfinished", finished);
  page.on("requestfailed", finished);
  page.on("close", closed);
  page.on("crash", closed);
  try {
    await Promise.race([action(), stopped]);
    if (pending.size) {
      await Promise.race([
        (async () => { while (pending.size) await Promise.all([...pending.values()].map(item => item.done)); })(),
        stopped,
      ]);
    }
  } finally {
    page.off("request", started);
    page.off("requestfinished", finished);
    page.off("requestfailed", finished);
    page.off("close", closed);
    page.off("crash", closed);
    for (const item of pending.values()) item.resolve();
    pending.clear();
  }
}
