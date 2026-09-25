"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const env_1 = require("../config/env");
const testrail_client_1 = require("../clients/testrail.client");
async function main() {
    const client = new testrail_client_1.TestRailClient((0, env_1.requireTestRailConfig)(env_1.config));
    const testRail = env_1.config.integrations.testRail;
    const cases = await client.getCases(String(testRail.projectId), String(testRail.suiteId), String(testRail.sectionId));
    for (const item of cases) {
        const text = [item.custom_preconds, item.custom_steps, item.custom_expected]
            .filter((value) => typeof value === "string")
            .join("\n");
        console.log(JSON.stringify({ caseId: item.id, title: item.title, hasContractDeclaration: /^\s*(?:[-*]\s*)?.+\s*\([^(),]+,\s*[^()]+\)/m.test(text) }));
    }
}
void main();
