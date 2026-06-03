"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
test_1.test.describe('Promoted Spec Timeout Configuration', () => {
    (0, test_1.test)('promotedSpecTimeoutMs default is 120000 in env config', () => {
        // Verify the default value is set in env.ts
        const envPath = path.join(__dirname, '../src/config/env.ts');
        const content = fs.readFileSync(envPath, 'utf-8');
        (0, test_1.expect)(content).toContain('promotedSpecTimeoutMs');
        (0, test_1.expect)(content).toContain('120000');
    });
    (0, test_1.test)('promotedSpecTimeoutMs is in execution config type', () => {
        const typesPath = path.join(__dirname, '../src/types/env.types.ts');
        const content = fs.readFileSync(typesPath, 'utf-8');
        (0, test_1.expect)(content).toContain('promotedSpecTimeoutMs');
    });
});
test_1.test.describe('Generated Spec Timeout Insertion', () => {
    (0, test_1.test)('generated spec includes test.setTimeout call', () => {
        const specGeneratorPath = path.join(__dirname, '../src/automations/spec-generator-pom.ts');
        const content = fs.readFileSync(specGeneratorPath, 'utf-8');
        const expectedPattern = 'test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 120000))';
        (0, test_1.expect)(content).toContain(expectedPattern);
    });
    (0, test_1.test)('timeout default is 120000 in spec-generator', () => {
        const specGeneratorPath = path.join(__dirname, '../src/automations/spec-generator-pom.ts');
        const content = fs.readFileSync(specGeneratorPath, 'utf-8');
        (0, test_1.expect)(content).toContain('120000');
    });
});
test_1.test.describe('test:promoted CLI Wrapper', () => {
    (0, test_1.test)('CLI wrapper file exists', () => {
        const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
        (0, test_1.expect)(fs.existsSync(cliPath)).toBe(true);
    });
    (0, test_1.test)('CLI wrapper includes --app flag parsing', () => {
        const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
        const content = fs.readFileSync(cliPath, 'utf-8');
        (0, test_1.expect)(content).toContain('--app');
    });
    (0, test_1.test)('CLI wrapper includes --section flag parsing', () => {
        const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
        const content = fs.readFileSync(cliPath, 'utf-8');
        (0, test_1.expect)(content).toContain('--section');
    });
    (0, test_1.test)('CLI wrapper includes --case-id flag parsing', () => {
        const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
        const content = fs.readFileSync(cliPath, 'utf-8');
        (0, test_1.expect)(content).toContain('--case-id');
    });
    (0, test_1.test)('CLI wrapper includes --headed flag', () => {
        const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
        const content = fs.readFileSync(cliPath, 'utf-8');
        (0, test_1.expect)(content).toContain('--headed');
    });
    (0, test_1.test)('CLI wrapper includes --parallel flag', () => {
        const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
        const content = fs.readFileSync(cliPath, 'utf-8');
        (0, test_1.expect)(content).toContain('--parallel');
    });
    (0, test_1.test)('CLI wrapper default timeout is 120000', () => {
        const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
        const content = fs.readFileSync(cliPath, 'utf-8');
        (0, test_1.expect)(content).toContain('timeout: 120000');
    });
    (0, test_1.test)('CLI wrapper default workers is 1 (serial)', () => {
        const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
        const content = fs.readFileSync(cliPath, 'utf-8');
        (0, test_1.expect)(content).toContain('workers: 1');
    });
    (0, test_1.test)('CLI wrapper respects PROMOTED_SPEC_TIMEOUT_MS env var', () => {
        const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
        const content = fs.readFileSync(cliPath, 'utf-8');
        (0, test_1.expect)(content).toContain('PROMOTED_SPEC_TIMEOUT_MS');
    });
    (0, test_1.test)('CLI wrapper includes help documentation', () => {
        const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
        const content = fs.readFileSync(cliPath, 'utf-8');
        (0, test_1.expect)(content).toContain('Usage:');
        (0, test_1.expect)(content).toContain('--help');
    });
    (0, test_1.test)('CLI wrapper uses shell:false to prevent pipe interpretation', () => {
        const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
        const content = fs.readFileSync(cliPath, 'utf-8');
        (0, test_1.expect)(content).toContain('shell: false');
        (0, test_1.expect)(content).toContain('process.execPath');
    });
    (0, test_1.test)('CLI wrapper spawns node directly with cli.js to avoid shell', () => {
        const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
        const content = fs.readFileSync(cliPath, 'utf-8');
        (0, test_1.expect)(content).toContain('cli.js');
        (0, test_1.expect)(content).toContain('spawnArgs');
    });
});
test_1.test.describe('CLI Grep Pattern Handling', () => {
    (0, test_1.test)('grep pattern with pipes is preserved as single argument', () => {
        const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
        const content = fs.readFileSync(cliPath, 'utf-8');
        // Verify grep is pushed as single argument with --grep= prefix
        (0, test_1.expect)(content).toMatch(/playwrightArgs\.push\(`--grep=/);
    });
    (0, test_1.test)('--case-id generates grep pattern correctly', () => {
        const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
        const content = fs.readFileSync(cliPath, 'utf-8');
        // Verify case-id generates grep with C prefix
        (0, test_1.expect)(content).toMatch(/--grep=C\$\{options\.caseId\}/);
    });
});
test_1.test.describe('package.json test:promoted script', () => {
    (0, test_1.test)('test:promoted script uses CLI wrapper', () => {
        const packageJsonPath = path.join(__dirname, '../package.json');
        const content = fs.readFileSync(packageJsonPath, 'utf-8');
        const packageJson = JSON.parse(content);
        (0, test_1.expect)(packageJson.scripts['test:promoted']).toBe('tsx src/cli/test-promoted.ts');
    });
});
