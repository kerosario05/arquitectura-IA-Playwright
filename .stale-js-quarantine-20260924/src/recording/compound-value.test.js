"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const compound_value_1 = require("./compound-value");
(0, node_test_1.default)("compound logical child is separated only from a confirmed selection", () => {
    strict_1.default.equal((0, compound_value_1.logicalCompoundChildValue)("DOP 15000", "DOP"), "15000");
    strict_1.default.equal((0, compound_value_1.logicalCompoundChildValue)("USD 75", "USD"), "75");
    strict_1.default.equal((0, compound_value_1.logicalCompoundChildValue)("15000", "DOP"), undefined);
    strict_1.default.equal((0, compound_value_1.logicalCompoundChildValue)("DOP 15000", undefined), undefined);
});
(0, node_test_1.default)("compound selection lineage uses structural context instead of event position", () => {
    const events = [
        {
            seq: 10,
            t: 1,
            kind: "tap",
            screenKey: "screen",
            target: { compoundRole: "selection", associatedField: "Ingresos", cellRef: "cell:income", rowIdentity: "row:1", afterValue: "DOP" },
        },
        {
            seq: 11,
            t: 2,
            kind: "fill",
            screenKey: "screen",
            target: { compoundRole: "amount_or_text", associatedField: "Ingresos", cellRef: "cell:income", rowIdentity: "row:1" },
        },
    ];
    strict_1.default.equal((0, compound_value_1.confirmedCompoundSelectionBefore)(events, 1, events[1].target), "DOP");
});
