"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const node_assert_1 = __importDefault(require("node:assert"));
function test(label, fn) {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    }
    catch (err) {
        console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
}
function describe(_name, fn) {
    console.log(`\n${_name}`);
    fn();
}
describe("resolveServerPort", () => {
    test("PORT=3002 → 3002", () => {
        node_assert_1.default.strictEqual((0, config_1.resolveServerPort)({ PORT: "3002" }), 3002);
    });
    test("SERVER_PORT=3003 → 3003 (API_PORT alias)", () => {
        node_assert_1.default.strictEqual((0, config_1.resolveServerPort)({ API_PORT: "3003" }), 3003);
    });
    test("PORT takes priority over API_PORT", () => {
        node_assert_1.default.strictEqual((0, config_1.resolveServerPort)({ PORT: "3002", API_PORT: "3001" }), 3002);
    });
    test("invalid PORT string → 3001 fallback", () => {
        node_assert_1.default.strictEqual((0, config_1.resolveServerPort)({ PORT: "abc" }), 3001);
    });
    test("empty PORT → 3001 fallback", () => {
        node_assert_1.default.strictEqual((0, config_1.resolveServerPort)({ PORT: "" }), 3001);
    });
    test("PORT=0 (invalid) → 3001 fallback", () => {
        node_assert_1.default.strictEqual((0, config_1.resolveServerPort)({ PORT: "0" }), 3001);
    });
    test("no env vars → 3001 default", () => {
        node_assert_1.default.strictEqual((0, config_1.resolveServerPort)({}), 3001);
    });
    test("PORT=-1 (invalid negative) → 3001 fallback", () => {
        node_assert_1.default.strictEqual((0, config_1.resolveServerPort)({ PORT: "-1" }), 3001);
    });
});
