"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const web_session_recorder_1 = require("./web-session-recorder");
(0, node_test_1.default)("passes the project HTTPS policy to the recording context", () => {
    strict_1.default.deepEqual((0, web_session_recorder_1.buildWebRecorderContextOptions)(true), { ignoreHTTPSErrors: true });
    strict_1.default.deepEqual((0, web_session_recorder_1.buildWebRecorderContextOptions)(false), { ignoreHTTPSErrors: false });
    strict_1.default.deepEqual((0, web_session_recorder_1.buildWebRecorderContextOptions)(undefined), { ignoreHTTPSErrors: false });
});
(0, node_test_1.default)("keeps identifiers as action inputs and detects actual secrets", () => {
    strict_1.default.equal((0, web_session_recorder_1.isSensitiveField)({ label: "Nombre de usuario", inputType: "text" }), false);
    strict_1.default.equal((0, web_session_recorder_1.isSensitiveField)({ label: "RNC de la empresa", inputType: "text" }), false);
    strict_1.default.equal((0, web_session_recorder_1.isSensitiveField)({ label: "Clave de acceso", inputType: "password" }), true);
    strict_1.default.equal((0, web_session_recorder_1.isSensitiveField)({ label: "Ingresos", inputType: "text" }), false);
});
