"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const project_service_1 = require("./project-service");
function test(label, fn) {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    }
    catch (err) {
        console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
}
function describe(_name, fn) {
    console.log(`\n${_name}`);
    fn();
}
describe("deleteProject cleanup order", () => {
    test("optional tables are retained when the capability is present", () => {
        const statements = (0, project_service_1.buildProjectDeleteStatements)("project-1", [
            "ProjectConfigurationHistory", "ProjectJiraConfiguration", "ProjectTestRailConfiguration",
            "ProjectOtpConfiguration", "ProjectKnowledge", "WebProjectConfiguration", "MobileProjectConfiguration",
            "ProjectCaseInputRequirement", "ProjectCaseRuntimeValue", "ProjectGenerationConfig", "Projects",
        ]);
        const caseIdx = statements.findIndex((s) => s.includes("ProjectCaseInputRequirement"));
        const projectsIdx = statements.findIndex((s) => s.trim().startsWith("DELETE FROM dbo.Projects"));
        node_assert_1.default.ok(caseIdx >= 0, "missing DELETE for dbo.ProjectCaseInputRequirement");
        node_assert_1.default.ok(projectsIdx >= 0, "missing DELETE for dbo.Projects");
        node_assert_1.default.ok(caseIdx < projectsIdx, "ProjectCaseInputRequirement must be cleaned before deleting dbo.Projects");
    });
    test("optional tables absent from the active schema are omitted", () => {
        const statements = (0, project_service_1.buildProjectDeleteStatements)("project-1", [
            "ProjectConfigurationHistory", "ProjectJiraConfiguration", "ProjectTestRailConfiguration",
            "ProjectOtpConfiguration", "ProjectKnowledge", "WebProjectConfiguration", "MobileProjectConfiguration", "Projects",
        ]);
        node_assert_1.default.equal(statements.some((s) => /ProjectCaseInputRequirement|ProjectCaseRuntimeValue|ProjectGenerationConfig/.test(s)), false);
        node_assert_1.default.ok(statements.some((s) => s.includes("ProjectKnowledge")));
        node_assert_1.default.ok(statements.some((s) => s.includes("dbo.Projects")));
    });
    test("existing child-table deletes are preserved unchanged", () => {
        const statements = (0, project_service_1.buildProjectDeleteStatements)("project-1");
        node_assert_1.default.ok(statements.some((s) => s.includes("ProjectKnowledge")));
        node_assert_1.default.ok(statements.some((s) => s.includes("WebProjectConfiguration")));
        node_assert_1.default.ok(statements.some((s) => s.includes("MobileProjectConfiguration")));
        node_assert_1.default.ok(statements.some((s) => s.includes("ProjectConfigurationHistory")));
    });
});
