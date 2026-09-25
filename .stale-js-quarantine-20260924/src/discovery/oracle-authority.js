"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPendingOracleAuthority = isPendingOracleAuthority;
function isPendingOracleAuthority(input) {
    return input.reason === "ORACLE_AUTHORITY_MISSING";
}
