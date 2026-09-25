import type { Page, Request, Response } from "@playwright/test";

export type NavigationCausalityEvent = {
  timestamp: number;
  eventType: string;
  urlBefore?: string;
  urlAfter?: string;
  frame?: string;
  isMainFrame?: boolean;
  method?: string;
  resourceType?: string;
  status?: number;
  initiator?: string;
  stack?: string;
};

const browserInitScript = () => {
  const safePath = () => `${location.pathname}${location.search}${location.hash}`;
  const root = window as Window & { __qaNavigationCausality?: NavigationCausalityEvent[] };
  const events = root.__qaNavigationCausality ?? (root.__qaNavigationCausality = []);
  const record = (eventType: string, from?: string, to?: string, extra: Partial<NavigationCausalityEvent> = {}) => {
    events.push({ timestamp: performance.now(), eventType, urlBefore: from ?? safePath(), urlAfter: to ?? safePath(), ...extra });
    if (events.length > 1000) events.splice(0, events.length - 1000);
  };
  const wrapHistory = (name: "pushState" | "replaceState") => {
    const original = history[name];
    history[name] = function wrappedHistory(this: History, state: any, unused: string, url?: string | URL | null) {
      const from = safePath();
      const result = original.call(this, state, unused, url);
      record(name, from, safePath(), { stack: new Error().stack?.split("\\n").slice(0, 6).join("\\n") });
      return result;
    };
  };
  wrapHistory("pushState");
  wrapHistory("replaceState");
  for (const eventType of ["popstate", "hashchange", "beforeunload", "pagehide", "pageshow", "visibilitychange", "unhandledrejection"]) {
    window.addEventListener(eventType, () => record(eventType));
  }
};

function safePath(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return `${url.pathname}${url.hash}`;
  } catch {
    return rawUrl;
  }
}

function add(events: NavigationCausalityEvent[], eventType: string, before: string, after: string, extra: Partial<NavigationCausalityEvent> = {}) {
  events.push({ timestamp: Date.now(), eventType, urlBefore: before, urlAfter: after, ...extra });
}

export async function installNavigationCausalityObserver(page: Page): Promise<{ read: () => Promise<NavigationCausalityEvent[]> }> {
  const events: NavigationCausalityEvent[] = [];
  let lastMainFramePath = safePath(page.url());
  // Transpilers may emit an internal __name helper inside function.toString().
  // Define that harmless identity locally so diagnostics can never page-error.
  const initScript = `const __name=(fn)=>fn; (${browserInitScript.toString()})();`;
  await page.addInitScript({ content: initScript });
  // addInitScript covers every future document; evaluate covers the already-loaded
  // target document without changing history behavior.
  await page.evaluate(initScript).catch(() => undefined);
  page.on("framenavigated", (frame) => {
    const nextPath = safePath(frame.url());
    const previousPath = frame === page.mainFrame() ? lastMainFramePath : "";
    add(events, "framenavigated", previousPath, nextPath, { frame: nextPath, isMainFrame: frame === page.mainFrame() });
    if (frame === page.mainFrame()) lastMainFramePath = nextPath;
  });
  page.on("request", (request: Request) => {
    if (["document", "fetch", "xhr"].includes(request.resourceType())) {
      add(events, "request_started", safePath(page.url()), safePath(request.url()), { method: request.method(), resourceType: request.resourceType(), isMainFrame: request.isNavigationRequest() });
    }
  });
  page.on("response", (response: Response) => {
    const request = response.request();
    if (["document", "fetch", "xhr"].includes(request.resourceType())) {
      add(events, "response_received", safePath(request.url()), safePath(page.url()), { method: request.method(), resourceType: request.resourceType(), status: response.status(), isMainFrame: request.isNavigationRequest() });
    }
  });
  page.on("requestfinished", (request) => {
    if (["document", "fetch", "xhr"].includes(request.resourceType())) add(events, "request_finished", safePath(request.url()), safePath(page.url()), { method: request.method(), resourceType: request.resourceType(), isMainFrame: request.isNavigationRequest() });
  });
  page.on("requestfailed", (request) => {
    if (["document", "fetch", "xhr"].includes(request.resourceType())) add(events, "request_failed", safePath(request.url()), safePath(page.url()), { method: request.method(), resourceType: request.resourceType(), isMainFrame: request.isNavigationRequest() });
  });
  page.on("console", (message) => add(events, "console", safePath(page.url()), safePath(page.url()), { initiator: message.type(), stack: message.text().slice(0, 240) }));
  page.on("pageerror", (error) => add(events, "pageerror", safePath(page.url()), safePath(page.url()), { initiator: "APP_JS", stack: error.message.slice(0, 240) }));
  return {
    read: async () => {
      const browserEvents = await page.evaluate(() => (window as Window & { __qaNavigationCausality?: NavigationCausalityEvent[] }).__qaNavigationCausality ?? []).catch(() => []);
      return [...events, ...browserEvents].sort((a, b) => a.timestamp - b.timestamp);
    },
  };
}

export function summarizeNavigationCausality(events: readonly NavigationCausalityEvent[]): {
  historyPushStateCount: number;
  historyReplaceStateCount: number;
  popstateCount: number;
  routeTransitions: NavigationCausalityEvent[];
  firstApiResponse?: NavigationCausalityEvent;
  firstEventAfterApiResponse?: NavigationCausalityEvent;
} {
  const navigationEvents = new Set(["pushState", "replaceState", "popstate", "hashchange", "beforeunload", "pagehide", "pageshow", "framenavigated", "location.assign", "location.replace"]);
  const routeTransitions = events.filter((event) => navigationEvents.has(event.eventType) && event.urlBefore !== event.urlAfter && event.urlAfter !== undefined);
  const firstApiResponse = events.find((event) => event.eventType === "response_received" && event.status === 200 && (event.resourceType === "fetch" || event.resourceType === "xhr"));
  const firstEventAfterApiResponse = firstApiResponse
    ? events.find((event) => event.timestamp > firstApiResponse.timestamp && event.eventType !== "request_finished")
    : undefined;
  return {
    historyPushStateCount: events.filter((event) => event.eventType === "pushState").length,
    historyReplaceStateCount: events.filter((event) => event.eventType === "replaceState").length,
    popstateCount: events.filter((event) => event.eventType === "popstate").length,
    routeTransitions,
    firstApiResponse,
    firstEventAfterApiResponse,
  };
}
