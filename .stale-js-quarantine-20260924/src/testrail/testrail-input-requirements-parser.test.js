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
const vitest_1 = require("vitest");
const testrail_input_requirements_parser_1 = require("./testrail-input-requirements-parser");
(0, vitest_1.describe)('TestRail input requirements parser', () => {
    (0, vitest_1.it)('parses multiple generic declarations into structured requirements', () => {
        const result = (0, testrail_input_requirements_parser_1.parseTestRailInputRequirements)('- Company identifier (business.id, text)\n- Access token (session.token, secret)');
        (0, vitest_1.expect)(result.requirements).toEqual([
            { key: 'business.id', label: 'Company identifier', controlType: 'text', required: true, sensitive: false, allowedValues: [] },
            { key: 'session.token', label: 'Access token', controlType: 'secret', required: true, sensitive: true, allowedValues: [] },
        ]);
        (0, vitest_1.expect)(result.unresolvedPlaceholders).toEqual([]);
        (0, vitest_1.expect)(result.conflicts).toEqual([]);
    });
    (0, vitest_1.it)('validates declared and undeclared placeholders without creating implicit requirements', () => {
        const result = (0, testrail_input_requirements_parser_1.parseTestRailInputRequirements)('Identifier (account.id, text)\nUse [account.id] and [account.missing]');
        (0, vitest_1.expect)(result.requirements).toHaveLength(1);
        (0, vitest_1.expect)(result.unresolvedPlaceholders).toEqual(['account.missing']);
        (0, vitest_1.expect)(result.conflicts).toEqual([]);
    });
    (0, vitest_1.it)('deduplicates identical declarations and reports conflicting metadata', () => {
        const result = (0, testrail_input_requirements_parser_1.parseTestRailInputRequirements)('User (account.value, text)\nUser (account.value, text)\nSecret user (account.value, secret)');
        (0, vitest_1.expect)(result.requirements).toHaveLength(1);
        (0, vitest_1.expect)(result.requirements[0].label).toBe('User');
        (0, vitest_1.expect)(result.conflicts).toEqual([
            {
                key: 'account.value',
                existing: { key: 'account.value', label: 'User', controlType: 'text', required: true, sensitive: false, allowedValues: [] },
                incoming: { key: 'account.value', label: 'Secret user', controlType: 'secret', required: true, sensitive: true, allowedValues: [] },
            },
        ]);
    });
    (0, vitest_1.it)('preserves declared labels and secret metadata when declarations arrive as TestRail HTML', async () => {
        const { extractTestRailInputRequirements } = await Promise.resolve().then(() => __importStar(require('./testrail-input-requirements-adapter')));
        const result = extractTestRailInputRequirements({
            id: 44759,
            title: 'fixture',
            custom_preconds: '<ol><li>- Cédula empleado 1 (employee_1.document, text)</li><li>- Contraseña (auth.password, secret) [SECRETO]</li></ol>',
        });
        (0, vitest_1.expect)(result.requirements).toEqual([
            { key: 'employee_1.document', label: 'Cédula empleado 1', controlType: 'text', required: true, sensitive: false, allowedValues: [] },
            { key: 'auth.password', label: 'Contraseña', controlType: 'secret', required: true, sensitive: true, allowedValues: [] },
        ]);
    });
    (0, vitest_1.it)('accepts declarative markers after the control type without losing sensitivity', () => {
        const result = (0, testrail_input_requirements_parser_1.parseTestRailInputRequirements)('Contraseña (auth.password, secret) [SECRETO]');
        (0, vitest_1.expect)(result.requirements[0]).toMatchObject({
            key: 'auth.password',
            label: 'Contraseña',
            controlType: 'secret',
            sensitive: true,
        });
    });
});
