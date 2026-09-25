"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const testrail_recording_payload_1 = require("./testrail-recording-payload");
(0, node_test_1.default)("shared TestRail payload accepts the configured text and separated step representations", () => {
    const payload = { title: "Scenario", custom_steps_separated: [{ content: "Abrir", expected: "" }] };
    strict_1.default.deepEqual((0, testrail_recording_payload_1.validateTestRailRecordingPayload)(payload), []);
    strict_1.default.equal((0, testrail_recording_payload_1.describeTestRailRecordingPayload)(payload).stepsFieldType, "array<object{content:string,expected:string}>");
});
(0, node_test_1.default)("shared TestRail payload blocks malformed step entries locally", () => {
    strict_1.default.ok((0, testrail_recording_payload_1.validateTestRailRecordingPayload)({
        title: "Scenario",
        custom_steps_separated: [{ content: "Abrir", expected: null }],
    }).some((error) => error.includes("expected must be a string")));
});
