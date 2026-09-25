"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_inflight_guard_1 = require("../src/scenarios/scenario-inflight-guard");
function keyFor(overrides = {}) {
    return (0, scenario_inflight_guard_1.buildScenarioPreviewInFlightKey)({
        appSlug: "test-app",
        projectKey: "TEST",
        sprintId: 1,
        activeSprint: false,
        status: "In Progress",
        selectedIssueKeys: ["TEST-1"],
        ...overrides,
    });
}
(0, test_1.test)("2 simultaneous equivalent requests → generatorCalls=1, both receive result", async () => {
    let calls = 0;
    const slowGen = async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 50));
        return "RESULT";
    };
    const key = keyFor();
    const [a, b] = await Promise.all([
        (0, scenario_inflight_guard_1.runScenarioPreviewInFlight)(key, slowGen),
        (0, scenario_inflight_guard_1.runScenarioPreviewInFlight)(key, slowGen),
    ]);
    (0, test_1.expect)(calls).toBe(1);
    (0, test_1.expect)(a).toBe("RESULT");
    (0, test_1.expect)(b).toBe("RESULT");
    // Released after completion — no permanent cache
    (0, test_1.expect)((0, scenario_inflight_guard_1.scenarioInFlightHas)(key)).toBe(false);
    (0, test_1.expect)((0, scenario_inflight_guard_1.getScenarioInFlightCount)()).toBe(0);
});
(0, test_1.test)("requests with different keys → generatorCalls=2", async () => {
    let calls = 0;
    const gen = async () => {
        calls++;
        return "R";
    };
    const k1 = keyFor({ selectedIssueKeys: ["TEST-1"] });
    const k2 = keyFor({ selectedIssueKeys: ["TEST-2"] });
    (0, test_1.expect)(k1).not.toBe(k2);
    const [a, b] = await Promise.all([
        (0, scenario_inflight_guard_1.runScenarioPreviewInFlight)(k1, gen),
        (0, scenario_inflight_guard_1.runScenarioPreviewInFlight)(k2, gen),
    ]);
    (0, test_1.expect)(calls).toBe(2);
    (0, test_1.expect)(a).toBe("R");
    (0, test_1.expect)(b).toBe("R");
    (0, test_1.expect)((0, scenario_inflight_guard_1.getScenarioInFlightCount)()).toBe(0);
});
(0, test_1.test)("same issueKey + different huFingerprint (revision) → different keys → generatorCalls=2", async () => {
    let calls = 0;
    const gen = async () => {
        calls++;
        return "R";
    };
    // Same request params, same issueKey — only huFingerprint differs (simulates
    // a HU modified in Jira between two concurrent requests).
    const k1 = keyFor({
        selectedIssueKeys: ["AA-X"],
        huFingerprint: "rev_aaaa0001",
    });
    const k2 = keyFor({
        selectedIssueKeys: ["AA-X"],
        huFingerprint: "rev_bbbb0002",
    });
    (0, test_1.expect)(k1).not.toBe(k2);
    const [a, b] = await Promise.all([
        (0, scenario_inflight_guard_1.runScenarioPreviewInFlight)(k1, gen),
        (0, scenario_inflight_guard_1.runScenarioPreviewInFlight)(k2, gen),
    ]);
    (0, test_1.expect)(calls).toBe(2);
    (0, test_1.expect)(a).toBe("R");
    (0, test_1.expect)(b).toBe("R");
    (0, test_1.expect)((0, scenario_inflight_guard_1.getScenarioInFlightCount)()).toBe(0);
});
(0, test_1.test)("same issueKey + same huFingerprint → same key → generatorCalls=1 (joined)", async () => {
    let calls = 0;
    const slowGen = async () => {
        calls++;
        await new Promise((r) => setTimeout(r, 50));
        return "RESULT";
    };
    const k1 = keyFor({
        selectedIssueKeys: ["AA-X"],
        huFingerprint: "rev_aaaa0001",
    });
    const k2 = keyFor({
        selectedIssueKeys: ["AA-X"],
        huFingerprint: "rev_aaaa0001",
    });
    (0, test_1.expect)(k1).toBe(k2);
    const [a, b] = await Promise.all([
        (0, scenario_inflight_guard_1.runScenarioPreviewInFlight)(k1, slowGen),
        (0, scenario_inflight_guard_1.runScenarioPreviewInFlight)(k2, slowGen),
    ]);
    (0, test_1.expect)(calls).toBe(1);
    (0, test_1.expect)(a).toBe("RESULT");
    (0, test_1.expect)(b).toBe("RESULT");
    (0, test_1.expect)((0, scenario_inflight_guard_1.scenarioInFlightHas)(k1)).toBe(false);
    (0, test_1.expect)((0, scenario_inflight_guard_1.getScenarioInFlightCount)()).toBe(0);
});
(0, test_1.test)("generation failure releases in-flight; next attempt can run again", async () => {
    let calls = 0;
    const failingGen = async () => {
        calls++;
        throw new Error("ai_failed");
    };
    const key = keyFor();
    await (0, test_1.expect)((0, scenario_inflight_guard_1.runScenarioPreviewInFlight)(key, failingGen)).rejects.toThrow("ai_failed");
    // Released after failure — no orphan lock
    (0, test_1.expect)((0, scenario_inflight_guard_1.scenarioInFlightHas)(key)).toBe(false);
    (0, test_1.expect)((0, scenario_inflight_guard_1.getScenarioInFlightCount)()).toBe(0);
    // Next attempt can generate again
    let okCalls = 0;
    const okGen = async () => {
        okCalls++;
        return "OK";
    };
    const result = await (0, scenario_inflight_guard_1.runScenarioPreviewInFlight)(key, okGen);
    (0, test_1.expect)(result).toBe("OK");
    (0, test_1.expect)(okCalls).toBe(1);
});
(0, test_1.test)("single request passes exactly one guard boundary (started=1, released=1)", async () => {
    const events = [];
    const origLog = console.log;
    console.log = (...args) => {
        const msg = args.map(String).join(" ");
        if (msg.includes("[scenario-generation:inflight]"))
            events.push(msg);
        origLog(...args);
    };
    try {
        const key = keyFor({ huFingerprint: "fp_single" });
        await (0, scenario_inflight_guard_1.runScenarioPreviewInFlight)(key, async () => "OK");
    }
    finally {
        console.log = origLog;
    }
    const started = events.filter((e) => e.includes("action=started"));
    const released = events.filter((e) => e.includes("action=released"));
    const joined = events.filter((e) => e.includes("action=joined"));
    (0, test_1.expect)(started).toHaveLength(1);
    (0, test_1.expect)(released).toHaveLength(1);
    (0, test_1.expect)(joined).toHaveLength(0);
});
(0, test_1.test)("two equivalent concurrent requests → generatorCalls=1, joined=true", async () => {
    const events = [];
    const origLog = console.log;
    console.log = (...args) => {
        const msg = args.map(String).join(" ");
        if (msg.includes("[scenario-generation:inflight]"))
            events.push(msg);
        origLog(...args);
    };
    let generatorCalls = 0;
    const slowGen = async () => {
        generatorCalls++;
        await new Promise((r) => setTimeout(r, 50));
        return "RESULT";
    };
    try {
        const key = keyFor({ huFingerprint: "fp_concurrent" });
        await Promise.all([
            (0, scenario_inflight_guard_1.runScenarioPreviewInFlight)(key, slowGen),
            (0, scenario_inflight_guard_1.runScenarioPreviewInFlight)(key, slowGen),
        ]);
    }
    finally {
        console.log = origLog;
    }
    const started = events.filter((e) => e.includes("action=started"));
    const released = events.filter((e) => e.includes("action=released"));
    const joined = events.filter((e) => e.includes("action=joined"));
    (0, test_1.expect)(generatorCalls).toBe(1);
    (0, test_1.expect)(started).toHaveLength(1);
    (0, test_1.expect)(released).toHaveLength(1);
    (0, test_1.expect)(joined).toHaveLength(1);
});
