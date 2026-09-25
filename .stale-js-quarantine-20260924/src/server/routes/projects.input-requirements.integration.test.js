"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const express_1 = __importDefault(require("express"));
const node_test_1 = require("node:test");
const project_repository_1 = require("../../db/project-repository");
const sql_connection_1 = require("../../db/sql-connection");
const project_service_1 = require("../../db/project-service");
const projects_1 = require("./projects");
const requirementsA = [
    {
        key: "customer.email",
        label: "Customer email",
        controlType: "email",
        required: true,
        sensitive: false,
    },
    {
        key: "customer.country",
        label: "Country",
        controlType: "select",
        required: false,
        sensitive: false,
        allowedValues: ["CO", "MX"],
    },
];
const requirementsB = [
    {
        key: "account.phone",
        label: "Phone",
        controlType: "tel",
        required: true,
        sensitive: true,
    },
];
function semanticRequirements(value) {
    strict_1.default.ok(Array.isArray(value));
    return value
        .map((requirement) => JSON.stringify(requirement))
        .sort()
        .map((requirement) => JSON.parse(requirement));
}
async function request(baseUrl, method, projectSlug, caseId, body) {
    const response = await fetch(`${baseUrl}/api/projects/${projectSlug}/cases/${caseId}/input-requirements`, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { response, body: await response.json() };
}
(0, node_test_1.test)("input requirements API round-trips and replaces persisted SQL state", async () => {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    app.use("/api/projects", projects_1.projectsRouter);
    app.use((err, _req, res, _next) => {
        res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    });
    const server = await new Promise((resolve) => {
        const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
    });
    const address = server.address();
    strict_1.default.ok(address && typeof address === "object");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const projectSlug = `input-requirements-it-${crypto.randomUUID()}`;
    const caseId = 900001;
    try {
        await (0, project_repository_1.createProject)({ slug: projectSlug, name: "Input requirements integration fixture", projectType: 1 });
        const firstPut = await request(baseUrl, "PUT", projectSlug, caseId, { inputRequirements: requirementsA });
        strict_1.default.equal(firstPut.response.status, 200, JSON.stringify(firstPut.body));
        strict_1.default.deepEqual(semanticRequirements(firstPut.body.inputRequirements), semanticRequirements(requirementsA));
        await (0, sql_connection_1.closeConnection)();
        const firstGet = await request(baseUrl, "GET", projectSlug, caseId);
        strict_1.default.equal(firstGet.response.status, 200);
        strict_1.default.deepEqual(semanticRequirements(firstGet.body.inputRequirements), semanticRequirements(requirementsA));
        const secondPut = await request(baseUrl, "PUT", projectSlug, caseId, { inputRequirements: requirementsB });
        strict_1.default.equal(secondPut.response.status, 200);
        strict_1.default.deepEqual(semanticRequirements(secondPut.body.inputRequirements), semanticRequirements(requirementsB));
        const secondGet = await request(baseUrl, "GET", projectSlug, caseId);
        strict_1.default.equal(secondGet.response.status, 200);
        strict_1.default.deepEqual(semanticRequirements(secondGet.body.inputRequirements), semanticRequirements(requirementsB));
        strict_1.default.equal(secondGet.body.inputRequirements.some((item) => item.key === requirementsA[0].key), false);
        strict_1.default.equal(secondGet.body.inputRequirements.some((item) => item.key === requirementsA[1].key), false);
    }
    finally {
        await (0, project_service_1.deleteProject)(projectSlug).catch(() => undefined);
        await (0, sql_connection_1.closeConnection)();
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});
