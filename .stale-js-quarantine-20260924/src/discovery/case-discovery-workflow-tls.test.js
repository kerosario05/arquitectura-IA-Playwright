"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const case_discovery_workflow_1 = require("./case-discovery-workflow");
(0, node_test_1.default)("uses only the project TLS setting for the discovery context", () => {
    strict_1.default.deepEqual((0, case_discovery_workflow_1.buildDiscoveryBrowserContextOptions)({ app: { ignoreHTTPSErrors: true } }), { ignoreHTTPSErrors: true });
    strict_1.default.deepEqual((0, case_discovery_workflow_1.buildDiscoveryBrowserContextOptions)({ app: { ignoreHTTPSErrors: false } }), { ignoreHTTPSErrors: false });
    strict_1.default.deepEqual((0, case_discovery_workflow_1.buildDiscoveryBrowserContextOptions)({ app: {} }), { ignoreHTTPSErrors: false });
});
