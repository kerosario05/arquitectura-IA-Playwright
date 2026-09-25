"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const pom_classification_1 = require("./pom-classification");
(0, node_test_1.test)("visibility assertion patterns remain valid when a primary action is visible", () => {
    const intent = (0, pom_classification_1.deriveMethodIntentFromStep)({
        action: "assertVisible",
        target: { strategy: "text", value: "Validar que el botón Continuar esté visible" },
        description: ""
    });
    strict_1.default.equal(intent, "expect_primary_action_visible");
});
