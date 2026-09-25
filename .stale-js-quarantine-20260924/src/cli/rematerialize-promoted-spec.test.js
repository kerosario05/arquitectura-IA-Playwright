"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const rematerialize_promoted_spec_1 = require("./rematerialize-promoted-spec");
(0, node_test_1.default)("parses only technical rematerialization identity", () => {
    strict_1.default.deepEqual((0, rematerialize_promoted_spec_1.parseRematerializationArgs)([
        "--case-id", "44757", "--app", "portalempresarial", "--section", "automatizacion-1",
    ]), { caseId: 44757, appSlug: "portalempresarial", sectionSlug: "automatizacion-1" });
});
(0, node_test_1.default)("rejects missing or invalid case identity", () => {
    strict_1.default.throws(() => (0, rematerialize_promoted_spec_1.parseRematerializationArgs)(["--app", "portalempresarial", "--section", "automatizacion-1"]), /Missing --case-id/);
    strict_1.default.throws(() => (0, rematerialize_promoted_spec_1.parseRematerializationArgs)(["--case-id", "0", "--app", "portalempresarial", "--section", "automatizacion-1"]), /Invalid --case-id/);
});
