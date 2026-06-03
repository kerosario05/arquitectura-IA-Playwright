"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const node_path_1 = __importDefault(require("node:path"));
test_1.test.describe('AuthFlow Import Path Calculation', () => {
    (0, test_1.test)('buildPortablePathFromSpec calculates correct AuthFlow import for section cases', () => {
        // Spec path: automations/apps/<appSlug>/sections/<sectionSlug>/cases/<caseFolder>/case.spec.ts
        const specPath = node_path_1.default.join(process.cwd(), 'automations/apps/test-app/sections/test-section/cases/c12345-test/case.spec.ts');
        // AuthFlow path: automations/apps/<appSlug>/flows/auth.flow.ts
        const authFlowPath = node_path_1.default.join(process.cwd(), 'automations/apps/test-app/flows/auth.flow.ts');
        // Calculate relative path
        const relativePath = node_path_1.default.relative(node_path_1.default.dirname(specPath), authFlowPath).replace(/\\/g, '/');
        // Expected: ../../../../flows/auth.flow.ts
        // spec is at: automations/apps/test-app/sections/test-section/cases/c12345-test/case.spec.ts
        // auth.flow is at: automations/apps/test-app/flows/auth.flow.ts
        // Need to go up 4 levels: cases -> section -> apps -> flows
        (0, test_1.expect)(relativePath).toBe('../../../../flows/auth.flow.ts');
    });
    (0, test_1.test)('buildPortablePathFromSpec calculates correct AuthFlow import for legacy app cases', () => {
        // Spec path: automations/apps/<appSlug>/cases/<caseFolder>/case.spec.ts
        const specPath = node_path_1.default.join(process.cwd(), 'automations/apps/test-app/cases/c12345-test/case.spec.ts');
        // AuthFlow path: automations/apps/<appSlug>/flows/auth.flow.ts
        const authFlowPath = node_path_1.default.join(process.cwd(), 'automations/apps/test-app/flows/auth.flow.ts');
        // Calculate relative path
        const relativePath = node_path_1.default.relative(node_path_1.default.dirname(specPath), authFlowPath).replace(/\\/g, '/');
        // Expected: ../../flows/auth.flow.ts
        // spec is at: automations/apps/test-app/cases/c12345-test/case.spec.ts
        // auth.flow is at: automations/apps/test-app/flows/auth.flow.ts
        // Need to go up 2 levels: cases/c12345-test -> cases -> apps -> flows
        (0, test_1.expect)(relativePath).toBe('../../flows/auth.flow.ts');
    });
    (0, test_1.test)('AuthFlow and auth.flow.helpers use same import depth for section cases', () => {
        const specPath = node_path_1.default.join(process.cwd(), 'automations/apps/test-app/sections/test-section/cases/c12345-test/case.spec.ts');
        const authFlowPath = node_path_1.default.join(process.cwd(), 'automations/apps/test-app/flows/auth.flow.ts');
        const authHelpersPath = node_path_1.default.join(process.cwd(), 'automations/apps/test-app/flows/auth.flow.helpers.ts');
        const authFlowRelative = node_path_1.default.relative(node_path_1.default.dirname(specPath), authFlowPath).replace(/\\/g, '/');
        const authHelpersRelative = node_path_1.default.relative(node_path_1.default.dirname(specPath), authHelpersPath).replace(/\\/g, '/');
        // Both should have same depth
        const authFlowDepth = authFlowRelative.split('../').length - 1;
        const authHelpersDepth = authHelpersRelative.split('../').length - 1;
        (0, test_1.expect)(authFlowDepth).toBe(authHelpersDepth);
        (0, test_1.expect)(authFlowDepth).toBe(4); // ../../../../
    });
    (0, test_1.test)('AuthFlow and auth.flow.helpers use same import depth for legacy cases', () => {
        const specPath = node_path_1.default.join(process.cwd(), 'automations/apps/test-app/cases/c12345-test/case.spec.ts');
        const authFlowPath = node_path_1.default.join(process.cwd(), 'automations/apps/test-app/flows/auth.flow.ts');
        const authHelpersPath = node_path_1.default.join(process.cwd(), 'automations/apps/test-app/flows/auth.flow.helpers.ts');
        const authFlowRelative = node_path_1.default.relative(node_path_1.default.dirname(specPath), authFlowPath).replace(/\\/g, '/');
        const authHelpersRelative = node_path_1.default.relative(node_path_1.default.dirname(specPath), authHelpersPath).replace(/\\/g, '/');
        // Both should have same depth
        const authFlowDepth = authFlowRelative.split('../').length - 1;
        const authHelpersDepth = authHelpersRelative.split('../').length - 1;
        (0, test_1.expect)(authFlowDepth).toBe(authHelpersDepth);
        (0, test_1.expect)(authFlowDepth).toBe(2); // ../../
    });
    (0, test_1.test)('Generated spec import statement is correct for section cases', () => {
        const specPath = node_path_1.default.join(process.cwd(), 'automations/apps/test-app/sections/test-section/cases/c12345-test/case.spec.ts');
        const authFlowPath = node_path_1.default.join(process.cwd(), 'automations/apps/test-app/flows/auth.flow.ts');
        const relativePath = node_path_1.default.relative(node_path_1.default.dirname(specPath), authFlowPath).replace(/\\/g, '/').replace(/\.ts$/, '');
        const importStatement = `import { AuthFlow, setAuthFlowTestData } from '${relativePath}';`;
        // ../../../../flows/auth.flow (4 levels up from cases/c12345-test to flows)
        (0, test_1.expect)(importStatement).toBe("import { AuthFlow, setAuthFlowTestData } from '../../../../flows/auth.flow';");
        // Should NOT be only 2 levels up (which would be wrong for section cases)
        (0, test_1.expect)(importStatement).not.toBe("import { AuthFlow, setAuthFlowTestData } from '../../flows/auth.flow';");
    });
    (0, test_1.test)('Generated spec import statement is correct for legacy cases', () => {
        const specPath = node_path_1.default.join(process.cwd(), 'automations/apps/test-app/cases/c12345-test/case.spec.ts');
        const authFlowPath = node_path_1.default.join(process.cwd(), 'automations/apps/test-app/flows/auth.flow.ts');
        const relativePath = node_path_1.default.relative(node_path_1.default.dirname(specPath), authFlowPath).replace(/\\/g, '/').replace(/\.ts$/, '');
        const importStatement = `import { AuthFlow, setAuthFlowTestData } from '${relativePath}';`;
        // ../../flows/auth.flow (2 levels up from cases/c12345-test to flows)
        (0, test_1.expect)(importStatement).toBe("import { AuthFlow, setAuthFlowTestData } from '../../flows/auth.flow';");
    });
});
