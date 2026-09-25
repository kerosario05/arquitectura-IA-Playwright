"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const projects_1 = require("./projects");
function test(label, fn) {
    Promise.resolve()
        .then(fn)
        .then(() => console.log(`  PASS  ${label}`))
        .catch((err) => {
        console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    });
}
function describe(_name, fn) {
    console.log(`\n${_name}`);
    fn();
}
function makeRes() {
    let statusCode = 200;
    let body;
    const res = {
        status(code) {
            statusCode = code;
            return res;
        },
        json(payload) {
            body = payload;
            return res;
        },
        get statusCode() {
            return statusCode;
        },
        get body() {
            return body;
        },
    };
    return res;
}
function makeService() {
    const calls = [];
    return {
        calls,
        getByProjectAndCase: async (projectSlug, caseId) => {
            calls.push({ op: "get", projectSlug, caseId });
            if (projectSlug === "missing")
                throw new Error(`project not found: ${projectSlug}`);
            return [{ key: "auth.username", required: true, namedProfileRef: "profile_a" }];
        },
        replaceForProjectAndCase: async (projectSlug, caseId, requirements) => {
            calls.push({ op: "replace", projectSlug, caseId, requirements });
        },
    };
}
describe("projects input-requirements handlers", () => {
    test("A: GET valid calls service with slug+caseId and responds with inputRequirements", async () => {
        const svc = makeService();
        const { getInputRequirements } = (0, projects_1.createInputRequirementsHandlers)(svc);
        const res = makeRes();
        let nextErr;
        await getInputRequirements({ params: { projectSlug: "app-a", caseId: "4171" } }, res, (e) => {
            nextErr = e;
        });
        node_assert_1.default.strictEqual(nextErr, undefined);
        node_assert_1.default.strictEqual(res.statusCode, 200);
        node_assert_1.default.deepStrictEqual(svc.calls[0], { op: "get", projectSlug: "app-a", caseId: 4171 });
        node_assert_1.default.deepStrictEqual(res.body, {
            projectSlug: "app-a",
            caseId: 4171,
            inputRequirements: [{ key: "auth.username", required: true, namedProfileRef: "profile_a" }],
        });
    });
    test("B: PUT valid calls replace and responds with the persisted state", async () => {
        const svc = makeService();
        const { putInputRequirements } = (0, projects_1.createInputRequirementsHandlers)(svc);
        const res = makeRes();
        let nextErr;
        await putInputRequirements({ params: { projectSlug: "app-a", caseId: "4171" }, body: { inputRequirements: [{ key: "auth.username" }] } }, res, (e) => {
            nextErr = e;
        });
        node_assert_1.default.strictEqual(nextErr, undefined);
        node_assert_1.default.strictEqual(res.statusCode, 200);
        node_assert_1.default.deepStrictEqual(svc.calls[0], {
            op: "replace",
            projectSlug: "app-a",
            caseId: 4171,
            requirements: [{ key: "auth.username" }],
        });
        node_assert_1.default.deepStrictEqual(res.body, {
            projectSlug: "app-a",
            caseId: 4171,
            inputRequirements: [{ key: "auth.username", required: true, namedProfileRef: "profile_a" }],
        });
    });
    test("C: invalid caseId returns 400 and does not call the service", async () => {
        const svc = makeService();
        const { getInputRequirements } = (0, projects_1.createInputRequirementsHandlers)(svc);
        const res = makeRes();
        await getInputRequirements({ params: { projectSlug: "app-a", caseId: "not-a-number" } }, res, () => { });
        node_assert_1.default.strictEqual(res.statusCode, 400);
        node_assert_1.default.strictEqual(svc.calls.length, 0);
    });
    test("D: PUT without an inputRequirements array returns 400 and does not call the service", async () => {
        const svc = makeService();
        const { putInputRequirements } = (0, projects_1.createInputRequirementsHandlers)(svc);
        const res = makeRes();
        await putInputRequirements({ params: { projectSlug: "app-a", caseId: "4171" }, body: {} }, res, () => { });
        node_assert_1.default.strictEqual(res.statusCode, 400);
        node_assert_1.default.strictEqual(svc.calls.length, 0);
    });
    test("unknown project maps to 404 via the router error pattern", async () => {
        const svc = makeService();
        const { getInputRequirements } = (0, projects_1.createInputRequirementsHandlers)(svc);
        const res = makeRes();
        await getInputRequirements({ params: { projectSlug: "missing", caseId: "4171" } }, res, () => { });
        node_assert_1.default.strictEqual(res.statusCode, 404);
    });
    test("PUT maps invalid namedProfileRef to 400 without exposing config", async () => {
        const svc = makeService();
        svc.replaceForProjectAndCase = async () => {
            const error = new Error("internal profile details");
            error.code = "named_profile_reference_not_configured";
            throw error;
        };
        const { putInputRequirements } = (0, projects_1.createInputRequirementsHandlers)(svc);
        const res = makeRes();
        let nextErr;
        await putInputRequirements({ params: { projectSlug: "app-a", caseId: "4171" }, body: { inputRequirements: [{ key: "auth.username", namedProfileRef: "missing" }] } }, res, (e) => { nextErr = e; });
        node_assert_1.default.strictEqual(nextErr, undefined);
        node_assert_1.default.strictEqual(res.statusCode, 400);
        node_assert_1.default.deepStrictEqual(res.body, { ok: false, error: "named_profile_reference_not_configured", message: "named profile reference is not configured for this project" });
    });
});
