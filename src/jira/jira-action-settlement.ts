import type { Page, Request, Response } from "@playwright/test";
import { ensureJiraDownloadObserver } from "./jira-download-assertion";
import { findActionServerError, type ActionHttpObservation } from "../discovery/action-http-outcome";

export class JiraActionServerError extends Error {
  constructor(readonly response: ActionHttpObservation) {
    super(`JIRA_APPLICATION_HTTP_SERVER_ERROR:${response.status} ${response.method} ${response.path}`);
    this.name = "JiraActionServerError";
  }
}

/** Wait for application requests started by this action, never global networkidle. */
export async function settleJiraAction<T>(page: Page, action: () => Promise<T>, applicationUrl = page.url()): Promise<T> {
  // The owning Playwright scenario supplies the overall deadline. Teardown
  // closes the page; abort here on that real signal without another timer.
  ensureJiraDownloadObserver(page);
  const interrupted = new Error("JIRA_SPEC_ACTION_INTERRUPTED");
  let rejectStopped!: (error: Error) => void;
  const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
  const closed = () => rejectStopped(interrupted);
  const origin = new URL(applicationUrl).origin;
  const observations: ActionHttpObservation[] = [];
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
  const responded = (response: Response) => {
    const request = response.request();
    if (!pending.has(request)) return;
    observations.push({ sameOrigin: true, method: request.method(), resourceType: request.resourceType(),
      path: new URL(request.url()).pathname, status: response.status(), state: "completed" });
  };
  page.on("request", started);
  page.on("response", responded);
  page.on("requestfinished", finished);
  page.on("requestfailed", finished);
  page.on("close", closed);
  page.on("crash", closed);
  try {
    const value = await Promise.race([action(), stopped]);
    if (pending.size) {
      await Promise.race([
        (async () => { while (pending.size) await Promise.all([...pending.values()].map(item => item.done)); })(),
        stopped,
      ]);
    }
    const failed = findActionServerError(observations);
    if (failed) throw new JiraActionServerError(failed);
    return value;
  } finally {
    page.off("request", started);
    page.off("response", responded);
    page.off("requestfinished", finished);
    page.off("requestfailed", finished);
    page.off("close", closed);
    page.off("crash", closed);
    for (const item of pending.values()) item.resolve();
    pending.clear();
  }
}
