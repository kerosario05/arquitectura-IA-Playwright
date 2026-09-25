"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const scenario_data_policy_1 = require("./scenario-data-policy");
function requirement(overrides = {}) {
    return {
        key: "fixture.field",
        inputRole: "scenario",
        fieldCapability: { kind: "email" },
        ...overrides,
    };
}
(0, node_test_1.default)("resolves scenario data generation conservatively from structured metadata", () => {
    strict_1.default.equal((0, scenario_data_policy_1.resolveScenarioDataPolicy)(requirement()), "synthetic_allowed");
    strict_1.default.equal((0, scenario_data_policy_1.resolveScenarioDataPolicy)(requirement({ fieldCapability: { kind: "tel" } })), "synthetic_allowed");
    strict_1.default.equal((0, scenario_data_policy_1.resolveScenarioDataPolicy)(requirement({ fieldCapability: { kind: "number", constraints: { min: 1, max: 9 } } })), "synthetic_allowed");
    strict_1.default.equal((0, scenario_data_policy_1.resolveScenarioDataPolicy)(requirement({ fieldCapability: { kind: "date" } })), "synthetic_allowed");
    strict_1.default.equal((0, scenario_data_policy_1.resolveScenarioDataPolicy)(requirement({ fieldCapability: { kind: "datetime" } })), "synthetic_allowed");
    strict_1.default.equal((0, scenario_data_policy_1.resolveScenarioDataPolicy)(requirement({ fieldCapability: { kind: "text" } })), "manual_required");
    strict_1.default.equal((0, scenario_data_policy_1.resolveScenarioDataPolicy)(requirement({ fieldCapability: { kind: "select", allowedValues: ["A"] } })), "manual_required");
    strict_1.default.equal((0, scenario_data_policy_1.resolveScenarioDataPolicy)(requirement({ sensitive: true })), "trusted_required");
    strict_1.default.equal((0, scenario_data_policy_1.resolveScenarioDataPolicy)(requirement({ fieldCapability: { kind: "password" } })), "trusted_required");
    strict_1.default.equal((0, scenario_data_policy_1.resolveScenarioDataPolicy)(requirement({ inputIntent: { mode: "leave_unset" } })), "explicit_value");
    strict_1.default.equal((0, scenario_data_policy_1.resolveScenarioDataPolicy)(requirement({ inputIntent: { mode: "invalid_value" } })), "explicit_value");
    strict_1.default.equal((0, scenario_data_policy_1.resolveScenarioDataPolicy)(requirement({ inputIntent: { mode: "preserve_state" } })), "explicit_value");
    strict_1.default.equal((0, scenario_data_policy_1.resolveScenarioDataPolicy)(requirement({ inputIntent: { mode: "set_value" }, explicitValue: "known" })), "explicit_value");
    strict_1.default.equal((0, scenario_data_policy_1.resolveScenarioDataPolicy)(requirement({ fieldCapability: { kind: "unknown" } })), "unresolved");
    strict_1.default.equal((0, scenario_data_policy_1.resolveScenarioDataPolicy)(requirement({ inputRole: "supporting" })), "unresolved");
    strict_1.default.equal((0, scenario_data_policy_1.resolveScenarioDataPolicy)({ key: "different.key", label: "Different", source: "contract" }), "unresolved");
});
