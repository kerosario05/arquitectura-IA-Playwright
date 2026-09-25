"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const oracle_authority_1 = require("./oracle-authority");
(0, node_test_1.default)("exact oracle authority remains pending and non-blocking", () => {
    strict_1.default.equal((0, oracle_authority_1.isPendingOracleAuthority)({ reason: "ORACLE_AUTHORITY_MISSING" }), true);
    strict_1.default.equal((0, oracle_authority_1.isPendingOracleAuthority)({ reason: "assertion_not_found" }), false);
    strict_1.default.equal((0, oracle_authority_1.isPendingOracleAuthority)({ reason: "target_not_found" }), false);
});
