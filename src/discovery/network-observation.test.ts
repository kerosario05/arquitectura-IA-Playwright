import assert from "node:assert/strict";
import test from "node:test";
import { fillAndObserveRuntimeInput, startNetworkObservation } from "./case-discovery";
import { waitForStableInteractiveScreen } from "../runner/execution-plan-executor";

class FakePage {
  private listeners = new Map<string, Set<(value: any) => void>>();
  private fakeContext = { on: (name: string, listener: (value: any) => void) => this.on(`context:${name}`, listener), off: (name: string, listener: (value: any) => void) => this.off(`context:${name}`, listener) };
  on(name: string, listener: (value: any) => void): void {
    const set = this.listeners.get(name) ?? new Set();
    set.add(listener);
    this.listeners.set(name, set);
  }
  off(name: string, listener: (value: any) => void): void { this.listeners.get(name)?.delete(listener); }
  emit(name: string, value: any): void { this.listeners.get(name)?.forEach((listener) => listener(value)); }
  context(): any { return this.fakeContext; }
}

class StableFakePage extends FakePage {
  loading = true;
  locator(selector: string): any {
    const isLoadingSelector = selector.includes("text=") || selector.includes("progressbar") || selector.includes("spinner") || selector.includes("loader") || selector.includes("load");
    return {
      count: async () => isLoadingSelector && this.loading ? 1 : 0,
      first: () => ({ isVisible: async () => this.loading }),
    };
  }
  async waitForTimeout(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(5, ms)));
  }
}

class FillObservationPage extends FakePage {
  private revision = 0;
  url(): string { return "https://example.test/form"; }
  async evaluate<T>(_pageFunction: () => T): Promise<T> {
    const changed = this.revision > 0;
    return {
      urlPath: "/form",
      focusedIdentity: changed ? undefined : "input|name=field",
      controls: [{
        identity: "input|name=field",
        tagName: "input",
        disabled: false,
        required: false,
        focused: !changed,
        ...(changed ? { stateAttributes: { "data-state": "resolved" } } : {}),
        validationNodeIds: [],
      }],
      validationNodes: [],
      forms: [],
      requiredControls: { total: 0, invalid: 0, empty: 0 },
    } as T;
  }
  async waitForTimeout(_ms: number): Promise<void> {}
  createLocator(): any {
    let activeRequest: any;
    return {
      fill: async (_value: string) => {
        this.revision += 1;
        activeRequest = request("https://example.test/api/lookup", "GET", "xhr");
        this.emit("request", activeRequest);
      },
      blur: async () => {
        this.emit("response", response(activeRequest, 200));
      },
    };
  }
}

const request = (url: string, method = "POST", resourceType = "fetch", redirectedFrom?: any) => ({
  url: () => url,
  method: () => method,
  resourceType: () => resourceType,
  redirectedFrom: () => redirectedFrom,
  failure: () => ({ errorText: "net::ERR_CONNECTION_RESET?token=SECRET" })
});

const response = (req: any, status: number, headers: Record<string, string> = {}) => ({ request: () => req, url: () => req.url(), status: () => status, headers: () => headers });

test("records safe request and response metadata without query, headers, or body", async () => {
  const page = new FakePage();
  const observation = startNetworkObservation(page as any, 4);
  const req = request("https://host.example/api/session?token=SECRET#fragment");
  page.emit("request", req);
  page.emit("response", response(req, 401));
  const [event] = await observation.stop();

  assert.equal(event.method, "POST");
  assert.equal(event.resourceType, "fetch");
  assert.equal(event.path, "/api/session");
  assert.equal(event.state, "completed");
  assert.equal(event.status, 401);
  assert.equal(event.statusCategory, "4xx");
  assert.equal(typeof event.durationMs, "number");
  assert.equal("query" in event, false);
  assert.equal("headers" in event, false);
  assert.equal("body" in event, false);
});

test("commits a row-scoped fill by blur and observes the resulting lookup", async () => {
  const page = new FillObservationPage();
  const result = await fillAndObserveRuntimeInput({
    page: page as any,
    locator: page.createLocator(),
    value: "runtime-only",
    stepIndex: 21,
    observe: true,
    waitMs: 1,
  });

  assert.equal(result.committedBy, "blur");
  assert.equal(result.networkEvents.length, 1);
  assert.equal(result.networkEvents[0].method, "GET");
  assert.equal(result.networkEvents[0].resourceType, "xhr");
  assert.equal(result.networkEvents[0].status, 200);
  assert.equal(result.mutation?.changed, true);
  assert.equal(result.mutation?.networkActivityDetected, true);
});

test("classifies 500, pending, and failed requests safely", async () => {
  const page = new FakePage();
  const observation = startNetworkObservation(page as any, 5);
  const server = request("https://host.example/api/resource", "GET", "document");
  const pending = request("https://host.example/api/pending");
  const failed = request("https://host.example/api/failure");
  page.emit("request", server);
  page.emit("response", response(server, 500));
  page.emit("request", pending);
  page.emit("request", failed);
  page.emit("requestfailed", failed);
  const events = await observation.stop();

  assert.equal(events.find((event) => event.path === "/api/resource")?.statusCategory, "5xx");
  assert.equal(events.find((event) => event.path === "/api/pending")?.state, "pending");
  assert.equal(events.find((event) => event.path === "/api/failure")?.state, "failed");
  assert.equal(events.find((event) => event.path === "/api/failure")?.failureCategory, "connection_reset");
});

test("supports normal document and multiple request events in order", async () => {
  const page = new FakePage();
  const observation = startNetworkObservation(page as any, 6);
  const first = request("https://host.example/page", "GET", "document");
  const second = request("https://host.example/api/data", "GET", "xhr");
  page.emit("request", first);
  page.emit("request", second);
  page.emit("response", response(first, 200));
  page.emit("response", response(second, 204));
  const events = await observation.stop();

  assert.deepEqual(events.map((event) => [event.method, event.resourceType, event.path, event.statusCategory]), [
    ["GET", "document", "/page", "2xx"],
    ["GET", "xhr", "/api/data", "2xx"]
  ]);
});

test("diagnostic observation captures a response after the action window", async () => {
  const page = new FakePage();
  const observation = startNetworkObservation(page as any, 7, 100, { diagnosticMs: 50 });
  const req = request("https://host.example/login");
  page.emit("request", req);
  const stopping = observation.stop();
  setTimeout(() => page.emit("response", response(req, 200)), 10);
  const [event] = await stopping;

  assert.equal(event.state, "completed");
  assert.equal(event.status, 200);
  assert.equal(event.statusCategory, "2xx");
});

test("diagnostic observation captures a late request failure", async () => {
  const page = new FakePage();
  const observation = startNetworkObservation(page as any, 8, 100, { diagnosticMs: 50 });
  const req = request("https://host.example/login");
  page.emit("request", req);
  const stopping = observation.stop();
  setTimeout(() => page.emit("requestfailed", req), 10);
  const [event] = await stopping;

  assert.equal(event.state, "failed");
  assert.equal(event.failureCategory, "connection_reset");
});

test("diagnostic timeout preserves pending without functional failure", async () => {
  const page = new FakePage();
  const observation = startNetworkObservation(page as any, 9, 100, { diagnosticMs: 15 });
  page.emit("request", request("https://host.example/pending"));
  const [event] = await observation.stop();

  assert.equal(event.state, "pending");
  assert.equal(event.terminalReason, "diagnostic_timeout");
});

test("normal observation remains immediate and does not wait diagnostically", async () => {
  const page = new FakePage();
  const observation = startNetworkObservation(page as any, 10);
  page.emit("request", request("https://host.example/pending"));
  const startedAt = Date.now();
  const [event] = await observation.stop();

  assert.equal(event.state, "pending");
  assert.ok(Date.now() - startedAt < 30);
});

test("passive tail observes late response without changing timeout result", async () => {
  const page = new FakePage();
  const observation = startNetworkObservation(page as any, 14);
  const req = request("https://host.example/login");
  page.emit("request", req);
  const events = await observation.stop();
  assert.equal(events[0].state, "pending");
  page.emit("response", response(req, 303));
  assert.equal(events[0].state, "pending");
});

test("requestfinished is tracked and passive failure is observed", async () => {
  const page = new FakePage();
  const finishedObservation = startNetworkObservation(page as any, 15);
  const finished = request("https://host.example/finished");
  page.emit("request", finished);
  page.emit("requestfinished", finished);
  assert.equal((await finishedObservation.stop())[0].state, "completed");

  const failedObservation = startNetworkObservation(page as any, 16);
  const failed = request("https://host.example/login");
  page.emit("request", failed);
  await failedObservation.stop();
  page.emit("requestfailed", failed);
});

test("bounded passive tail observes terminal lifecycle before cleanup and expires hangs", async () => {
  const previousTail = process.env.NETWORK_POST_TIMEOUT_TAIL_MS;
  process.env.NETWORK_POST_TIMEOUT_TAIL_MS = "25";
  try {
    const page = new FakePage();
    const observation = startNetworkObservation(page as any, 17);
    const req = request("https://host.example/login");
    page.emit("request", req);
    const stopped = await observation.stop();
    assert.equal(stopped[0].state, "pending");
    setTimeout(() => {
      page.emit("response", response(req, 303));
      page.emit("requestfinished", req);
    }, 5);
    await observation.waitForPassiveTail();

    const hungObservation = startNetworkObservation(page as any, 18);
    page.emit("request", request("https://host.example/hung"));
    await hungObservation.stop();
    await hungObservation.waitForPassiveTail();
  } finally {
    if (previousTail === undefined) delete process.env.NETWORK_POST_TIMEOUT_TAIL_MS;
    else process.env.NETWORK_POST_TIMEOUT_TAIL_MS = previousTail;
  }
});

test("adaptive wait tolerates a progressing request after the base deadline", async () => {
  const previousTimeout = process.env.LOADING_STABILITY_TIMEOUT_MS;
  const previousBudget = process.env.LOADING_STABILITY_PROGRESS_BUDGET_MS;
  process.env.LOADING_STABILITY_TIMEOUT_MS = "20";
  process.env.LOADING_STABILITY_PROGRESS_BUDGET_MS = "80";
  try {
    const page = new StableFakePage();
    const requestUnderTest = request("https://host.example/auth", "POST", "fetch");
    const observation = startNetworkObservation(page as any, 19);
    page.emit("request", requestUnderTest);
    setTimeout(() => {
      page.loading = false;
      page.emit("response", response(requestUnderTest, 303));
      page.emit("requestfinished", requestUnderTest);
    }, 30);
    const result = await waitForStableInteractiveScreen(page as any, {
      progressProbe: () => observation.getProgressState()
    });
    assert.equal(result.stable, true);
    assert.ok(result.signals.includes("progress_extension"));
    assert.equal(result.waitState, "completed");
    await observation.stop();
  } finally {
    if (previousTimeout === undefined) delete process.env.LOADING_STABILITY_TIMEOUT_MS;
    else process.env.LOADING_STABILITY_TIMEOUT_MS = previousTimeout;
    if (previousBudget === undefined) delete process.env.LOADING_STABILITY_PROGRESS_BUDGET_MS;
    else process.env.LOADING_STABILITY_PROGRESS_BUDGET_MS = previousBudget;
  }
});

test("pending request without new progress is classified as stalled", async () => {
  const previousTimeout = process.env.LOADING_STABILITY_TIMEOUT_MS;
  const previousBudget = process.env.LOADING_STABILITY_PROGRESS_BUDGET_MS;
  try {
    process.env.LOADING_STABILITY_TIMEOUT_MS = "20";
    process.env.LOADING_STABILITY_PROGRESS_BUDGET_MS = "20";
    const result = await waitForStableInteractiveScreen(new StableFakePage() as any, {
      waitForPendingTransport: true,
      progressProbe: () => ({ active: true, pendingCount: 1, lastProgressAt: 0 }),
      absoluteDeadlineMs: 50,
    });
    assert.equal(result.stable, false);
    assert.equal(result.waitState, "stalled");
    assert.equal(result.terminationReason, "stalled");
    assert.equal(result.relevantPendingRequests, 1);
    assert.ok(result.lastProgressAgeMs >= 20);
  } finally {
    if (previousTimeout === undefined) delete process.env.LOADING_STABILITY_TIMEOUT_MS;
    else process.env.LOADING_STABILITY_TIMEOUT_MS = previousTimeout;
    if (previousBudget === undefined) delete process.env.LOADING_STABILITY_PROGRESS_BUDGET_MS;
    else process.env.LOADING_STABILITY_PROGRESS_BUDGET_MS = previousBudget;
  }
});

test("adaptive wait still times out a hang and ignores a spinner without a request", async () => {
  const previousTimeout = process.env.LOADING_STABILITY_TIMEOUT_MS;
  const previousBudget = process.env.LOADING_STABILITY_PROGRESS_BUDGET_MS;
  process.env.LOADING_STABILITY_TIMEOUT_MS = "20";
  process.env.LOADING_STABILITY_PROGRESS_BUDGET_MS = "20";
  try {
    const hung = await waitForStableInteractiveScreen(new StableFakePage() as any);
    assert.equal(hung.stable, false);
    assert.equal(hung.reason, "loading_timeout");

    const spinnerOnly = new StableFakePage();
    const result = await waitForStableInteractiveScreen(spinnerOnly as any);
    assert.equal(result.stable, false);
    assert.equal(result.reason, "loading_timeout");
  } finally {
    if (previousTimeout === undefined) delete process.env.LOADING_STABILITY_TIMEOUT_MS;
    else process.env.LOADING_STABILITY_TIMEOUT_MS = previousTimeout;
    if (previousBudget === undefined) delete process.env.LOADING_STABILITY_PROGRESS_BUDGET_MS;
    else process.env.LOADING_STABILITY_PROGRESS_BUDGET_MS = previousBudget;
  }
});

test("diagnostic observation captures redirect pathname and follow-up request", async () => {
  const page = new FakePage();
  const observation = startNetworkObservation(page as any, 11, 100, { diagnosticMs: 50 });
  const login = request("https://host.example/login");
  const followup = request("https://host.example/app/home?token=SECRET", "GET", "document");
  page.emit("request", login);
  const stopping = observation.stop();
  page.emit("response", response(login, 303, { location: "https://host.example/app/home?token=SECRET" }));
  setTimeout(() => {
    page.emit("request", followup);
    page.emit("response", response(followup, 200));
  }, 5);
  const events = await stopping;

  assert.equal(events[0].state, "completed");
  assert.equal(events[0].statusCategory, "3xx");
  assert.equal(events[0].redirectTargetPathSafe, "/app/home");
  assert.equal(events[1].path, "/app/home");
  assert.equal(events[1].state, "completed");
  assert.equal("headers" in events[0], false);
});

test("diagnostic observation exposes a sanitized redirect chain", async () => {
  const page = new FakePage();
  const observation = startNetworkObservation(page as any, 12, 100, { diagnosticMs: 50 });
  const login = request("https://host.example/session");
  const home = request("https://host.example/home?token=SECRET", "GET", "document", login);
  page.emit("request", login);
  const stopping = observation.stop();
  page.emit("response", response(login, 303, { location: "https://host.example/home?token=SECRET#section" }));
  setTimeout(() => {
    page.emit("request", home);
    page.emit("response", response(home, 200));
  }, 5);
  const events = await stopping;
  const [event] = events;

  assert.equal(event.redirectChain?.length, 1);
  assert.deepEqual(event.redirectChain?.[0], {
    status: 303,
    targetPath: "/home",
    followupMethod: "GET",
    followupPath: "/home",
    followupState: "completed",
    followupStatus: 200,
    durationMs: event.redirectChain?.[0]?.durationMs,
  });
  assert.equal(event.chainCompleted, true);
  assert.equal("rawLocation" in event, false);
  assert.equal("headers" in event, false);
});

test("diagnostic timeout retains a pending redirect follow-up safely", async () => {
  const page = new FakePage();
  const observation = startNetworkObservation(page as any, 13, 100, { diagnosticMs: 15 });
  const login = request("https://host.example/session");
  const home = request("https://host.example/home?token=SECRET", "GET", "document", login);
  page.emit("request", login);
  const stopping = observation.stop();
  page.emit("response", response(login, 302, { location: "/home?token=SECRET" }));
  setTimeout(() => page.emit("request", home), 2);
  const [event] = await stopping;
  const [hop] = event.redirectChain ?? [];

  assert.equal(hop?.followupState, "pending");
  assert.equal(hop?.terminalReason, "diagnostic_timeout");
  assert.equal(event.chainCompleted, false);
});

test("diagnostic observation preserves ordered multi-hop redirects", async () => {
  const page = new FakePage();
  const observation = startNetworkObservation(page as any, 14, 100, { diagnosticMs: 50 });
  const first = request("https://host.example/start");
  const second = request("https://host.example/intermediate", "GET", "document", first);
  const third = request("https://host.example/final", "GET", "document", second);
  page.emit("request", first);
  const stopping = observation.stop();
  page.emit("response", response(first, 302, { location: "/intermediate" }));
  setTimeout(() => {
    page.emit("request", second);
    page.emit("response", response(second, 303, { location: "/final" }));
    setTimeout(() => {
      page.emit("request", third);
      page.emit("response", response(third, 200));
    }, 3);
  }, 3);
  const [event] = await stopping;

  assert.deepEqual(event.redirectChain?.map((hop) => [hop.status, hop.targetPath, hop.followupPath, hop.followupStatus]), [
    [302, "/intermediate", "/intermediate", 303],
    [303, "/final", "/final", 200],
  ]);
  assert.equal(event.chainCompleted, true);
});
