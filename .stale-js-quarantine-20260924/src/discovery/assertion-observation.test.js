"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const assertion_observation_1 = require("./assertion-observation");
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
function snapshot(overrides = {}) {
    return {
        urlPath: "/form",
        focusedIdentity: "input|name=field",
        controls: [{
                identity: "input|name=field",
                tagName: "input",
                ariaInvalid: "false",
                ariaDescribedBy: "",
                disabled: false,
                required: true,
                focused: true,
                validity: { valid: true, valueMissing: false, typeMismatch: false, patternMismatch: false },
                validationNodeIds: [],
            }],
        validationNodes: [],
        forms: [{ identity: "form", valid: true }],
        fingerprint: "synthetic",
        ...overrides,
    };
}
(0, node_test_1.default)("captures bounded structural state without reading field values", async () => {
    const page = {
        url: () => "https://example.test/form",
        evaluate: async () => snapshot(),
    };
    const result = await (0, assertion_observation_1.captureAssertionObservationSnapshot)(page);
    strict_1.default.equal(result.urlPath, "/form");
    strict_1.default.equal(result.controls[0].identity, "input|name=field");
    strict_1.default.equal("value" in result.controls[0], false);
    strict_1.default.match(result.fingerprint, /^[a-f0-9]{16}$/);
});
(0, node_test_1.default)("detects valid-to-invalid mutation and associated validation node", () => {
    const before = snapshot();
    const after = snapshot({
        controls: [{ ...before.controls[0], ariaInvalid: "true", validationNodeIds: ["field-error"], validity: { ...before.controls[0].validity, valid: false, patternMismatch: true } }],
        validationNodes: [{ identity: "span|id=field-error", role: "alert", id: "field-error" }],
        forms: [{ identity: "form", valid: false }],
    });
    const diff = (0, assertion_observation_1.diffAssertionObservation)(before, after, true);
    strict_1.default.equal(diff.changed, true);
    strict_1.default.equal(diff.validationMutation, true);
    strict_1.default.equal(diff.accessibilityMutation, true);
    strict_1.default.equal(diff.formStateChanged, true);
    strict_1.default.equal(diff.networkActivityDetected, true);
});
(0, node_test_1.default)("does not invent a mutation when before and after are equal", () => {
    const same = snapshot();
    const diff = (0, assertion_observation_1.diffAssertionObservation)(same, same);
    strict_1.default.deepEqual(diff.changedPaths, []);
    strict_1.default.equal(diff.changed, false);
    strict_1.default.equal(diff.validationMutation, false);
    strict_1.default.equal(diff.navigationMutation, false);
});
(0, node_test_1.default)("observation artifact keeps requirement lineage and excludes sensitive values", async () => {
    const directory = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "assertion-observation-"));
    try {
        const artifactPath = await (0, assertion_observation_1.writeAssertionObservationArtifact)(directory, {
            version: "1.0",
            scenarioId: "synthetic-scenario",
            caseId: 17,
            requirementId: "requirement:synthetic:validation",
            requirementRefs: ["requirement:synthetic:validation"],
            triggerActionIdentity: { action: "trigger", stepIndex: 2 },
            before: snapshot(),
            after: snapshot(),
            mutation: (0, assertion_observation_1.diffAssertionObservation)(snapshot(), snapshot()),
            network: { eventCount: 0, classification: "unknown" },
            createdAt: new Date().toISOString(),
        });
        const saved = await promises_1.default.readFile(artifactPath, "utf8");
        strict_1.default.match(saved, /requirement:synthetic:validation/);
        strict_1.default.doesNotMatch(saved, /password|secret|sensitive-runtime-value/);
    }
    finally {
        await promises_1.default.rm(directory, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("classifies network activity conservatively from safe transport metadata", () => {
    strict_1.default.equal((0, assertion_observation_1.classifyNetworkActivity)([{ method: "GET", resourceType: "xhr", state: "completed", status: 200 }]), "lookup");
    strict_1.default.equal((0, assertion_observation_1.classifyNetworkActivity)([{ method: "POST", resourceType: "fetch", state: "completed", status: 200 }]), "submit");
    strict_1.default.equal((0, assertion_observation_1.classifyNetworkActivity)([{ method: "POST", resourceType: "fetch", state: "completed", status: 422 }]), "validation");
    strict_1.default.equal((0, assertion_observation_1.classifyNetworkActivity)([{ method: "GET", resourceType: "document", state: "completed", status: 200 }], "/form", "/next"), "navigation");
    strict_1.default.equal((0, assertion_observation_1.classifyNetworkActivity)([{ method: "POST", resourceType: "websocket", state: "pending" }]), "unknown");
});
