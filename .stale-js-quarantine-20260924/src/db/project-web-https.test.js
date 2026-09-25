"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const project_reader_1 = require("./project-reader");
const project_materializer_1 = require("./project-materializer");
const project = {
    id: "project-1",
    slug: "web-project",
    name: "Web project",
    projectType: 1,
    status: 1,
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
};
function connectionWithWebRow(ignoreHTTPSErrors) {
    return {
        query: async (sql) => sql.includes("WebProjectConfiguration")
            ? [{
                    baseUrl: "https://example.test",
                    loginMode: 2,
                    username: null,
                    passwordSecretRef: null,
                    missingInputBehavior: 1,
                    testDataJson: null,
                    testDataAliasesJson: null,
                    extraLoginFieldsJson: null,
                    ignoreHTTPSErrors,
                }]
            : [],
    };
}
(0, node_test_1.default)("reads and normalizes the project HTTPS option", async () => {
    const enabled = await (0, project_reader_1.readProjectConfigurationOnConnection)(connectionWithWebRow(1), project);
    const disabled = await (0, project_reader_1.readProjectConfigurationOnConnection)(connectionWithWebRow(0), project);
    const legacy = await (0, project_reader_1.readProjectConfigurationOnConnection)(connectionWithWebRow(null), project);
    strict_1.default.equal(enabled.web?.ignoreHTTPSErrors, true);
    strict_1.default.equal(disabled.web?.ignoreHTTPSErrors, false);
    strict_1.default.equal(legacy.web?.ignoreHTTPSErrors, false);
});
(0, node_test_1.default)("selects the BIT before NVARCHAR(MAX) columns for ODBC", async () => {
    let sql = "";
    const conn = {
        query: async (statement) => {
            if (statement.includes("WebProjectConfiguration"))
                sql = statement;
            return [{
                    baseUrl: "https://example.test",
                    loginMode: 2,
                    username: null,
                    passwordSecretRef: null,
                    missingInputBehavior: 1,
                    testDataJson: null,
                    testDataAliasesJson: null,
                    extraLoginFieldsJson: null,
                    ignoreHTTPSErrors: 0,
                }];
        },
    };
    await (0, project_reader_1.readProjectConfigurationOnConnection)(conn, project);
    strict_1.default.ok(sql.indexOf("ignoreHTTPSErrors") < sql.indexOf("testDataJson"));
    strict_1.default.ok(sql.indexOf("ignoreHTTPSErrors") < sql.indexOf("testDataAliasesJson"));
    strict_1.default.ok(sql.indexOf("ignoreHTTPSErrors") < sql.indexOf("extraLoginFieldsJson"));
});
(0, node_test_1.default)("materializes the project HTTPS option with a safe legacy default", () => {
    const warnings = [];
    const base = {
        ...project,
        web: {
            baseUrl: "https://example.test",
            loginMode: 2,
            username: null,
            passwordSecretRef: null,
            testDataJson: null,
            testDataAliasesJson: null,
            missingInputBehavior: 1,
            extraLoginFieldsJson: null,
        },
    };
    strict_1.default.equal((0, project_materializer_1.buildWebAppConfig)({ ...base, web: { ...base.web, ignoreHTTPSErrors: true } }, warnings).ignoreHTTPSErrors, true);
    strict_1.default.equal((0, project_materializer_1.buildWebAppConfig)(base, warnings).ignoreHTTPSErrors, false);
});
