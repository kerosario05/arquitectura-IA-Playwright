"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const project_repository_1 = require("./project-repository");
const sql_connection_1 = require("./sql-connection");
const project_case_input_requirement_service_1 = require("./project-case-input-requirement-service");
(0, node_test_1.test)("two input-requirements reads can run concurrently", async () => {
    const projects = await (0, project_repository_1.listProjects)();
    strict_1.default.ok(projects.length > 0, "QA_LAB must contain a project fixture");
    const projectSlug = projects[0].slug;
    await (0, sql_connection_1.closeConnection)();
    const firstCaseId = Math.floor(Date.now() / 1000);
    const results = await Promise.allSettled([
        (0, project_case_input_requirement_service_1.getByProjectAndCase)(projectSlug, firstCaseId),
        (0, project_case_input_requirement_service_1.getByProjectAndCase)(projectSlug, firstCaseId + 1),
    ]);
    await (0, sql_connection_1.closeConnection)();
    strict_1.default.equal(results[0].status, "fulfilled", results[0].status === "rejected" ? results[0].reason?.message : undefined);
    strict_1.default.equal(results[1].status, "fulfilled", results[1].status === "rejected" ? results[1].reason?.message : undefined);
});
