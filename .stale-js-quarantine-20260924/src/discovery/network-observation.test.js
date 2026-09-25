"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const case_discovery_1 = require("./case-discovery");
const execution_plan_executor_1 = require("../runner/execution-plan-executor");
class FakePage {
    listeners = new Map();
    fakeContext = { on: (name, listener) => this.on(`context:${name}`, listener), off: (name, listener) => this.off(`context:${name}`, listener) };
    on(name, listener) {
        const set = this.listeners.get(name) ?? new Set();
        set.add(listener);
        this.listeners.set(name, set);
    }
    off(name, listener) { this.listeners.get(name)?.delete(listener); }
    emit(name, value) { this.listeners.get(name)?.forEach((listener) => listener(value)); }
    context() { return this.fakeContext; }
}
class StableFakePage extends FakePage {
    loading = true;
    locator(selector) {
        const isLoadingSelector = selector.includes("text=") || selector.includes("progressbar") || selector.includes("spinner") || selector.includes("loader") || selector.includes("load");
        return {
            count: async () => isLoadingSelector && this.loading ? 1 : 0,
            first: () => ({ isVisible: async () => this.loading }),
        };
    }
    async waitForTimeout(ms) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(5, ms)));
    }
}
class FillObservationPage extends FakePage {
    revision = 0;
    url() { return "https://example.test/form"; }
    async evaluate(_pageFunction) {
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
        };
    }
    async waitForTimeout(_ms) { }
    createLocator() {
        let activeRequest;
        let currentValue = "";
        return {
            fill: async (_value) => {
                currentValue = _value;
                this.revision += 1;
                activeRequest = request("https://example.test/api/lookup", "GET", "xhr");
                this.emit("request", activeRequest);
            },
            blur: async () => {
                this.emit("response", response(activeRequest, 200));
            },
            evaluate: async () => currentValue,
            page: () => this,
        };
    }
}
class BoundedBlurPage extends FakePage {
    value = "";
    async waitForTimeout(_ms) { }
    createLocator() {
        return {
            fill: async (value) => { this.value = value; },
            blur: async (options) => {
                strict_1.default.equal(options?.timeout, 250);
            },
            evaluate: async () => this.value,
            page: () => this,
        };
    }
}
class HangingBlurPage extends BoundedBlurPage {
    createLocator() {
        return {
            fill: async (value) => { this.value = value; },
            blur: async (options) => {
                strict_1.default.equal(options?.timeout, 250);
                await new Promise(() => undefined);
            },
            evaluate: async () => this.value,
            page: () => this,
        };
    }
}
const request = (url, method = "POST", resourceType = "fetch", redirectedFrom) => ({
    url: () => url,
    method: () => method,
    resourceType: () => resourceType,
    redirectedFrom: () => redirectedFrom,
    failure: () => ({ errorText: "net::ERR_CONNECTION_RESET?token=SECRET" })
});
const response = (req, status, headers = {}) => ({ request: () => req, url: () => req.url(), status: () => status, headers: () => headers });
(0, node_test_1.default)("records safe request and response metadata without query, headers, or body", async () => {
    const page = new FakePage();
    const observation = (0, case_discovery_1.startNetworkObservation)(page, 4);
    const req = request("https://host.example/api/session?token=SECRET#fragment");
    page.emit("request", req);
    page.emit("response", response(req, 401));
    const [event] = await observation.stop();
    strict_1.default.equal(event.method, "POST");
    strict_1.default.equal(event.resourceType, "fetch");
    strict_1.default.equal(event.path, "/api/session");
    strict_1.default.equal(event.state, "completed");
    strict_1.default.equal(event.status, 401);
    strict_1.default.equal(event.statusCategory, "4xx");
    strict_1.default.equal(typeof event.durationMs, "number");
    strict_1.default.equal("query" in event, false);
    strict_1.default.equal("headers" in event, false);
    strict_1.default.equal("body" in event, false);
});
(0, node_test_1.default)("commits a row-scoped fill by blur and observes the resulting lookup", async () => {
    const page = new FillObservationPage();
    const result = await (0, case_discovery_1.fillAndObserveRuntimeInput)({
        page: page,
        locator: page.createLocator(),
        value: "runtime-only",
        stepIndex: 21,
        observe: true,
        waitMs: 1,
    });
    strict_1.default.equal(result.committedBy, "blur");
    strict_1.default.equal(result.networkEvents.length, 1);
    strict_1.default.equal(result.networkEvents[0].method, "GET");
    strict_1.default.equal(result.networkEvents[0].resourceType, "xhr");
    strict_1.default.equal(result.networkEvents[0].status, 200);
    strict_1.default.equal(result.mutation?.changed, true);
    strict_1.default.equal(result.mutation?.networkActivityDetected, true);
});
(0, node_test_1.default)("bounds a best-effort grid blur below the global action timeout", async () => {
    const page = new BoundedBlurPage();
    const result = await (0, case_discovery_1.fillAndObserveRuntimeInput)({
        page: page,
        locator: page.createLocator(),
        value: "runtime-only",
        stepIndex: 22,
        observe: false,
    });
    strict_1.default.equal(result.committedBy, "blur");
});
(0, node_test_1.default)("continues when a grid blur never settles", async () => {
    const page = new HangingBlurPage();
    const startedAt = Date.now();
    const result = await (0, case_discovery_1.fillAndObserveRuntimeInput)({
        page: page,
        locator: page.createLocator(),
        value: "runtime-only",
        stepIndex: 23,
        observe: false,
    });
    strict_1.default.equal(result.committedBy, "blur");
    strict_1.default.ok(Date.now() - startedAt < 1000);
});
(0, node_test_1.default)("classifies 500, pending, and failed requests safely", async () => {
    const page = new FakePage();
    const observation = (0, case_discovery_1.startNetworkObservation)(page, 5);
    const server = request("https://host.example/api/resource", "GET", "document");
    const pending = request("https://host.example/api/pending");
    const failed = request("https://host.example/api/failure");
    page.emit("request", server);
    page.emit("response", response(server, 500));
    page.emit("request", pending);
    page.emit("request", failed);
    page.emit("requestfailed", failed);
    const events = await observation.stop();
    strict_1.default.equal(events.find((event) => event.path === "/api/resource")?.statusCategory, "5xx");
    strict_1.default.equal(events.find((event) => event.path === "/api/pending")?.state, "pending");
    strict_1.default.equal(events.find((event) => event.path === "/api/failure")?.state, "failed");
    strict_1.default.equal(events.find((event) => event.path === "/api/failure")?.failureCategory, "connection_reset");
});
(0, node_test_1.default)("supports normal document and multiple request events in order", async () => {
    const page = new FakePage();
    const observation = (0, case_discovery_1.startNetworkObservation)(page, 6);
    const first = request("https://host.example/page", "GET", "document");
    const second = request("https://host.example/api/data", "GET", "xhr");
    page.emit("request", first);
    page.emit("request", second);
    page.emit("response", response(first, 200));
    page.emit("response", response(second, 204));
    const events = await observation.stop();
    strict_1.default.deepEqual(events.map((event) => [event.method, event.resourceType, event.path, event.statusCategory]), [
        ["GET", "document", "/page", "2xx"],
        ["GET", "xhr", "/api/data", "2xx"]
    ]);
});
(0, node_test_1.default)("diagnostic observation captures a response after the action window", async () => {
    const page = new FakePage();
    const observation = (0, case_discovery_1.startNetworkObservation)(page, 7, 100, { diagnosticMs: 50 });
    const req = request("https://host.example/login");
    page.emit("request", req);
    const stopping = observation.stop();
    setTimeout(() => page.emit("response", response(req, 200)), 10);
    const [event] = await stopping;
    strict_1.default.equal(event.state, "completed");
    strict_1.default.equal(event.status, 200);
    strict_1.default.equal(event.statusCategory, "2xx");
});
(0, node_test_1.default)("diagnostic observation captures a late request failure", async () => {
    const page = new FakePage();
    const observation = (0, case_discovery_1.startNetworkObservation)(page, 8, 100, { diagnosticMs: 50 });
    const req = request("https://host.example/login");
    page.emit("request", req);
    const stopping = observation.stop();
    setTimeout(() => page.emit("requestfailed", req), 10);
    const [event] = await stopping;
    strict_1.default.equal(event.state, "failed");
    strict_1.default.equal(event.failureCategory, "connection_reset");
});
(0, node_test_1.default)("diagnostic timeout preserves pending without functional failure", async () => {
    const page = new FakePage();
    const observation = (0, case_discovery_1.startNetworkObservation)(page, 9, 100, { diagnosticMs: 15 });
    page.emit("request", request("https://host.example/pending"));
    const [event] = await observation.stop();
    strict_1.default.equal(event.state, "pending");
    strict_1.default.equal(event.terminalReason, "diagnostic_timeout");
});
(0, node_test_1.default)("normal observation remains immediate and does not wait diagnostically", async () => {
    const page = new FakePage();
    const observation = (0, case_discovery_1.startNetworkObservation)(page, 10);
    page.emit("request", request("https://host.example/pending"));
    const startedAt = Date.now();
    const [event] = await observation.stop();
    strict_1.default.equal(event.state, "pending");
    strict_1.default.ok(Date.now() - startedAt < 30);
});
(0, node_test_1.default)("passive tail observes late response without changing timeout result", async () => {
    const page = new FakePage();
    const observation = (0, case_discovery_1.startNetworkObservation)(page, 14);
    const req = request("https://host.example/login");
    page.emit("request", req);
    const events = await observation.stop();
    strict_1.default.equal(events[0].state, "pending");
    page.emit("response", response(req, 303));
    strict_1.default.equal(events[0].state, "pending");
});
(0, node_test_1.default)("requestfinished is tracked and passive failure is observed", async () => {
    const page = new FakePage();
    const finishedObservation = (0, case_discovery_1.startNetworkObservation)(page, 15);
    const finished = request("https://host.example/finished");
    page.emit("request", finished);
    page.emit("requestfinished", finished);
    strict_1.default.equal((await finishedObservation.stop())[0].state, "completed");
    const failedObservation = (0, case_discovery_1.startNetworkObservation)(page, 16);
    const failed = request("https://host.example/login");
    page.emit("request", failed);
    await failedObservation.stop();
    page.emit("requestfailed", failed);
});
(0, node_test_1.default)("bounded passive tail observes terminal lifecycle before cleanup and expires hangs", async () => {
    const previousTail = process.env.NETWORK_POST_TIMEOUT_TAIL_MS;
    process.env.NETWORK_POST_TIMEOUT_TAIL_MS = "25";
    try {
        const page = new FakePage();
        const observation = (0, case_discovery_1.startNetworkObservation)(page, 17);
        const req = request("https://host.example/login");
        page.emit("request", req);
        const stopped = await observation.stop();
        strict_1.default.equal(stopped[0].state, "pending");
        setTimeout(() => {
            page.emit("response", response(req, 303));
            page.emit("requestfinished", req);
        }, 5);
        await observation.waitForPassiveTail();
        const hungObservation = (0, case_discovery_1.startNetworkObservation)(page, 18);
        page.emit("request", request("https://host.example/hung"));
        await hungObservation.stop();
        await hungObservation.waitForPassiveTail();
    }
    finally {
        if (previousTail === undefined)
            delete process.env.NETWORK_POST_TIMEOUT_TAIL_MS;
        else
            process.env.NETWORK_POST_TIMEOUT_TAIL_MS = previousTail;
    }
});
(0, node_test_1.default)("keeps a correlated pending request alive past the stall threshold until response", async () => {
    const previousTimeout = process.env.LOADING_STABILITY_TIMEOUT_MS;
    process.env.LOADING_STABILITY_TIMEOUT_MS = "20";
    try {
        const page = new StableFakePage();
        const requestUnderTest = request("https://host.example/auth", "POST", "fetch");
        const observation = (0, case_discovery_1.startNetworkObservation)(page, 19);
        page.emit("request", requestUnderTest);
        setTimeout(() => {
            page.loading = false;
            page.emit("response", response(requestUnderTest, 303));
            page.emit("requestfinished", requestUnderTest);
        }, 30);
        const result = await (0, execution_plan_executor_1.waitForStableInteractiveScreen)(page, {
            progressProbe: () => observation.getProgressState(),
            waitForPendingTransport: true,
            absoluteDeadlineMs: 100,
        });
        strict_1.default.equal(result.stable, true);
        strict_1.default.equal(result.waitState, "completed");
        strict_1.default.ok(result.waitedMs >= 20);
        await observation.stop();
    }
    finally {
        if (previousTimeout === undefined)
            delete process.env.LOADING_STABILITY_TIMEOUT_MS;
        else
            process.env.LOADING_STABILITY_TIMEOUT_MS = previousTimeout;
    }
});
async function waitForResponseBeforeHardCap(delayMs, absoluteDeadlineMs = 120) {
    const page = new StableFakePage();
    const observation = (0, case_discovery_1.startNetworkObservation)(page, 23);
    const requestUnderTest = request("https://host.example/async", "POST", "fetch");
    page.emit("request", requestUnderTest);
    setTimeout(() => {
        page.loading = false;
        page.emit("response", response(requestUnderTest, 200));
        page.emit("requestfinished", requestUnderTest);
    }, delayMs);
    const result = await (0, execution_plan_executor_1.waitForStableInteractiveScreen)(page, {
        progressProbe: () => observation.getProgressState(),
        waitForPendingTransport: true,
        absoluteDeadlineMs,
    });
    await observation.stop({ passiveTail: false });
    return result;
}
(0, node_test_1.default)("fast response completes without consuming the hard cap", async () => {
    const previousTimeout = process.env.LOADING_STABILITY_TIMEOUT_MS;
    process.env.LOADING_STABILITY_TIMEOUT_MS = "8";
    try {
        const result = await waitForResponseBeforeHardCap(2);
        strict_1.default.equal(result.stable, true);
        strict_1.default.ok(result.waitedMs < 120);
    }
    finally {
        if (previousTimeout === undefined)
            delete process.env.LOADING_STABILITY_TIMEOUT_MS;
        else
            process.env.LOADING_STABILITY_TIMEOUT_MS = previousTimeout;
    }
});
(0, node_test_1.default)("12 second equivalent response survives the idle window", async () => {
    const previousTimeout = process.env.LOADING_STABILITY_TIMEOUT_MS;
    process.env.LOADING_STABILITY_TIMEOUT_MS = "8";
    try {
        const result = await waitForResponseBeforeHardCap(12, 60);
        strict_1.default.equal(result.stable, true);
        strict_1.default.ok(result.waitedMs >= 8);
    }
    finally {
        if (previousTimeout === undefined)
            delete process.env.LOADING_STABILITY_TIMEOUT_MS;
        else
            process.env.LOADING_STABILITY_TIMEOUT_MS = previousTimeout;
    }
});
(0, node_test_1.default)("47 second equivalent response survives beyond the former 30 second boundary", async () => {
    const previousTimeout = process.env.LOADING_STABILITY_TIMEOUT_MS;
    process.env.LOADING_STABILITY_TIMEOUT_MS = "8";
    try {
        const result = await waitForResponseBeforeHardCap(47, 120);
        strict_1.default.equal(result.stable, true);
        strict_1.default.ok(result.waitedMs > 30);
    }
    finally {
        if (previousTimeout === undefined)
            delete process.env.LOADING_STABILITY_TIMEOUT_MS;
        else
            process.env.LOADING_STABILITY_TIMEOUT_MS = previousTimeout;
    }
});
(0, node_test_1.default)("a valid response after the former absolute boundary still completes before hard cap", async () => {
    const previousTimeout = process.env.LOADING_STABILITY_TIMEOUT_MS;
    process.env.LOADING_STABILITY_TIMEOUT_MS = "8";
    try {
        const result = await waitForResponseBeforeHardCap(35, 100);
        strict_1.default.equal(result.stable, true);
        strict_1.default.ok(result.waitedMs > 30);
    }
    finally {
        if (previousTimeout === undefined)
            delete process.env.LOADING_STABILITY_TIMEOUT_MS;
        else
            process.env.LOADING_STABILITY_TIMEOUT_MS = previousTimeout;
    }
});
(0, node_test_1.default)("pending request without new progress remains active until absolute deadline", async () => {
    const previousTimeout = process.env.LOADING_STABILITY_TIMEOUT_MS;
    try {
        process.env.LOADING_STABILITY_TIMEOUT_MS = "20";
        const result = await (0, execution_plan_executor_1.waitForStableInteractiveScreen)(new StableFakePage(), {
            waitForPendingTransport: true,
            progressProbe: () => ({ active: true, pendingCount: 1, lastProgressAt: 0 }),
            absoluteDeadlineMs: 50,
        });
        strict_1.default.equal(result.stable, false);
        strict_1.default.equal(result.waitState, "active_async_operation");
        strict_1.default.equal(result.terminationReason, "absolute_deadline_reached");
        strict_1.default.equal(result.relevantPendingRequests, 1);
        strict_1.default.equal(result.activeAsyncOperation, true);
        strict_1.default.equal(result.stallThresholdReached, true);
        strict_1.default.ok(result.waitedMs >= 50);
    }
    finally {
        if (previousTimeout === undefined)
            delete process.env.LOADING_STABILITY_TIMEOUT_MS;
        else
            process.env.LOADING_STABILITY_TIMEOUT_MS = previousTimeout;
    }
});
(0, node_test_1.default)("stale loading signal without a request reaches idle stall", async () => {
    const previousTimeout = process.env.LOADING_STABILITY_TIMEOUT_MS;
    process.env.LOADING_STABILITY_TIMEOUT_MS = "20";
    try {
        const hung = await (0, execution_plan_executor_1.waitForStableInteractiveScreen)(new StableFakePage(), { absoluteDeadlineMs: 50 });
        strict_1.default.equal(hung.stable, false);
        strict_1.default.equal(hung.terminationReason, "stalled");
        strict_1.default.equal(hung.waitState, "stalled");
        strict_1.default.equal(hung.activeAsyncOperation, false);
        const spinnerOnly = new StableFakePage();
        const result = await (0, execution_plan_executor_1.waitForStableInteractiveScreen)(spinnerOnly, { absoluteDeadlineMs: 50 });
        strict_1.default.equal(result.stable, false);
        strict_1.default.equal(result.terminationReason, "stalled");
    }
    finally {
        if (previousTimeout === undefined)
            delete process.env.LOADING_STABILITY_TIMEOUT_MS;
        else
            process.env.LOADING_STABILITY_TIMEOUT_MS = previousTimeout;
    }
});
(0, node_test_1.default)("request failure terminates the active wait immediately", async () => {
    const page = new StableFakePage();
    const observation = (0, case_discovery_1.startNetworkObservation)(page, 20);
    const requestUnderTest = request("https://host.example/login", "POST", "fetch");
    page.emit("request", requestUnderTest);
    setTimeout(() => page.emit("requestfailed", requestUnderTest), 10);
    const result = await (0, execution_plan_executor_1.waitForStableInteractiveScreen)(page, {
        progressProbe: () => observation.getProgressState(),
        waitForPendingTransport: true,
        absoluteDeadlineMs: 100,
    });
    strict_1.default.equal(result.stable, false);
    strict_1.default.equal(result.waitState, "failed");
    strict_1.default.equal(result.terminationReason, "request_failed");
    strict_1.default.ok(result.waitedMs < 100);
    await observation.stop();
});
(0, node_test_1.default)("page close terminates the active wait immediately", async () => {
    const page = new StableFakePage();
    const observation = (0, case_discovery_1.startNetworkObservation)(page, 21);
    page.emit("request", request("https://host.example/route", "POST", "fetch"));
    setTimeout(() => page.emit("close", undefined), 10);
    const result = await (0, execution_plan_executor_1.waitForStableInteractiveScreen)(page, {
        progressProbe: () => observation.getProgressState(),
        waitForPendingTransport: true,
        absoluteDeadlineMs: 100,
    });
    strict_1.default.equal(result.stable, false);
    strict_1.default.equal(result.waitState, "failed");
    strict_1.default.equal(result.terminationReason, "page_closed");
    strict_1.default.ok(result.waitedMs < 100);
    await observation.stop();
});
(0, node_test_1.default)("unrelated background requests do not become relevant pending transport", async () => {
    const page = new StableFakePage();
    page.loading = false;
    const observation = (0, case_discovery_1.startNetworkObservation)(page, 22);
    page.emit("request", request("https://host.example/image.png", "GET", "image"));
    const result = await (0, execution_plan_executor_1.waitForStableInteractiveScreen)(page, {
        progressProbe: () => observation.getProgressState(),
        waitForPendingTransport: true,
        absoluteDeadlineMs: 100,
    });
    strict_1.default.equal(result.stable, true);
    strict_1.default.equal(result.relevantPendingRequests, 0);
    strict_1.default.equal(result.activeAsyncOperation, false);
    await observation.stop();
});
(0, node_test_1.default)("diagnostic observation captures redirect pathname and follow-up request", async () => {
    const page = new FakePage();
    const observation = (0, case_discovery_1.startNetworkObservation)(page, 11, 100, { diagnosticMs: 50 });
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
    strict_1.default.equal(events[0].state, "completed");
    strict_1.default.equal(events[0].statusCategory, "3xx");
    strict_1.default.equal(events[0].redirectTargetPathSafe, "/app/home");
    strict_1.default.equal(events[1].path, "/app/home");
    strict_1.default.equal(events[1].state, "completed");
    strict_1.default.equal("headers" in events[0], false);
});
(0, node_test_1.default)("diagnostic observation exposes a sanitized redirect chain", async () => {
    const page = new FakePage();
    const observation = (0, case_discovery_1.startNetworkObservation)(page, 12, 100, { diagnosticMs: 50 });
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
    strict_1.default.equal(event.redirectChain?.length, 1);
    strict_1.default.deepEqual(event.redirectChain?.[0], {
        status: 303,
        targetPath: "/home",
        followupMethod: "GET",
        followupPath: "/home",
        followupState: "completed",
        followupStatus: 200,
        durationMs: event.redirectChain?.[0]?.durationMs,
    });
    strict_1.default.equal(event.chainCompleted, true);
    strict_1.default.equal("rawLocation" in event, false);
    strict_1.default.equal("headers" in event, false);
});
(0, node_test_1.default)("diagnostic timeout retains a pending redirect follow-up safely", async () => {
    const page = new FakePage();
    const observation = (0, case_discovery_1.startNetworkObservation)(page, 13, 100, { diagnosticMs: 15 });
    const login = request("https://host.example/session");
    const home = request("https://host.example/home?token=SECRET", "GET", "document", login);
    page.emit("request", login);
    const stopping = observation.stop();
    page.emit("response", response(login, 302, { location: "/home?token=SECRET" }));
    setTimeout(() => page.emit("request", home), 2);
    const [event] = await stopping;
    const [hop] = event.redirectChain ?? [];
    strict_1.default.equal(hop?.followupState, "pending");
    strict_1.default.equal(hop?.terminalReason, "diagnostic_timeout");
    strict_1.default.equal(event.chainCompleted, false);
});
(0, node_test_1.default)("diagnostic observation preserves ordered multi-hop redirects", async () => {
    const page = new FakePage();
    const observation = (0, case_discovery_1.startNetworkObservation)(page, 14, 100, { diagnosticMs: 50 });
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
    strict_1.default.deepEqual(event.redirectChain?.map((hop) => [hop.status, hop.targetPath, hop.followupPath, hop.followupStatus]), [
        [302, "/intermediate", "/intermediate", 303],
        [303, "/final", "/final", 200],
    ]);
    strict_1.default.equal(event.chainCompleted, true);
});
