"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const proposed_object_builder_1 = require("../src/discovery/proposed-object-builder");
function makeElement(base) {
    return {
        id: base.id,
        type: base.type,
        text: base.text,
        label: base.label,
        placeholder: base.placeholder,
        name: base.name,
        role: base.role,
        tagName: base.tagName,
        inputType: base.inputType,
        required: base.required,
        disabled: base.disabled,
        visible: base.visible,
        nearbyText: base.nearbyText,
        candidateLocators: base.candidateLocators || [],
        dataHints: base.dataHints || []
    };
}
(0, test_1.test)("buildProposedObject creates button object with high confidence", () => {
    const element = makeElement({
        id: "el-1",
        type: "button",
        text: "Consultar",
        tagName: "button",
        candidateLocators: [{ strategy: "text", value: "Consultar", confidence: 0.75 }],
        visible: true
    });
    const result = (0, proposed_object_builder_1.buildProposedObject)(element);
    (0, test_1.expect)(result.type).toBe("button");
    (0, test_1.expect)(result.key).toBe("button_consultar");
    (0, test_1.expect)(result.name).toBe("Consultar");
    (0, test_1.expect)(result.confidence).toBeGreaterThanOrEqual(0.7);
    (0, test_1.expect)(result.locator.strategy).toBe("text");
});
(0, test_1.test)("buildProposedObject creates input object from placeholder", () => {
    const element = makeElement({
        id: "el-2",
        type: "input",
        placeholder: "Ingrese su cédula",
        tagName: "input",
        inputType: "text",
        candidateLocators: [{ strategy: "placeholder", value: "Ingrese su cédula", confidence: 0.8 }],
        visible: true
    });
    const result = (0, proposed_object_builder_1.buildProposedObject)(element);
    (0, test_1.expect)(result.type).toBe("input");
    (0, test_1.expect)(result.key).toContain("input");
    (0, test_1.expect)(result.confidence).toBeGreaterThanOrEqual(0.8);
});
(0, test_1.test)("buildProposedObject creates table object", () => {
    const element = makeElement({
        id: "el-3",
        type: "table",
        tagName: "table",
        candidateLocators: [{ strategy: "css", value: "table", confidence: 0.55 }],
        visible: true
    });
    const result = (0, proposed_object_builder_1.buildProposedObject)(element);
    (0, test_1.expect)(result.type).toBe("table");
    (0, test_1.expect)(result.key).toBe("table_table");
});
(0, test_1.test)("buildProposedObject handles disabled element", () => {
    const element = makeElement({
        id: "el-4",
        type: "button",
        text: "Submit",
        tagName: "button",
        disabled: true,
        candidateLocators: [{ strategy: "text", value: "Submit", confidence: 0.75 }],
        visible: true
    });
    const result = (0, proposed_object_builder_1.buildProposedObject)(element);
    (0, test_1.expect)(result.reason).toContain("disabled");
});
(0, test_1.test)("buildProposedObject handles required element", () => {
    const element = makeElement({
        id: "el-5",
        type: "input",
        placeholder: "Email",
        tagName: "input",
        required: true,
        candidateLocators: [{ strategy: "placeholder", value: "Email", confidence: 0.8 }],
        visible: true
    });
    const result = (0, proposed_object_builder_1.buildProposedObject)(element);
    (0, test_1.expect)(result.reason).toContain("Required");
});
(0, test_1.test)("buildProposedObjects filters to actionable types only", () => {
    const elements = [
        makeElement({ id: "el-1", type: "button", text: "Click", tagName: "button", visible: true }),
        makeElement({ id: "el-2", type: "text", text: "Some paragraph", tagName: "p", visible: true }),
        makeElement({ id: "el-3", type: "input", placeholder: "Name", tagName: "input", visible: true })
    ];
    const results = (0, proposed_object_builder_1.buildProposedObjects)(elements);
    (0, test_1.expect)(results).toHaveLength(2);
    (0, test_1.expect)(results[0].type).toBe("button");
    (0, test_1.expect)(results[1].type).toBe("input");
});
(0, test_1.test)("buildProposedObjects deduplicates keys", () => {
    const elements = [
        makeElement({ id: "el-1", type: "button", text: "Submit", tagName: "button", visible: true }),
        makeElement({ id: "el-2", type: "button", text: "Submit", tagName: "button", visible: true })
    ];
    const results = (0, proposed_object_builder_1.buildProposedObjects)(elements);
    (0, test_1.expect)(results).toHaveLength(2);
    (0, test_1.expect)(results[0].key).toBe("button_submit");
    (0, test_1.expect)(results[1].key).toBe("button_submit_1");
});
(0, test_1.test)("buildProposedObjects handles empty elements array", () => {
    const results = (0, proposed_object_builder_1.buildProposedObjects)([]);
    (0, test_1.expect)(results).toHaveLength(0);
});
(0, test_1.test)("buildProposedObject sanitizes key with special characters", () => {
    const element = makeElement({
        id: "el-1",
        type: "button",
        text: "Consultar Saldo (Cuenta de Ahorros)",
        tagName: "button",
        candidateLocators: [{ strategy: "text", value: "Consultar Saldo", confidence: 0.75 }],
        visible: true
    });
    const result = (0, proposed_object_builder_1.buildProposedObject)(element);
    (0, test_1.expect)(result.key).not.toContain("(");
    (0, test_1.expect)(result.key).not.toContain(")");
    (0, test_1.expect)(result.key).not.toContain("á");
});
(0, test_1.test)("buildProposedObject uses label when text is missing", () => {
    const element = makeElement({
        id: "el-1",
        type: "input",
        label: "Número de cuenta",
        tagName: "input",
        candidateLocators: [{ strategy: "label", value: "Número de cuenta", confidence: 0.85 }],
        visible: true
    });
    const result = (0, proposed_object_builder_1.buildProposedObject)(element);
    (0, test_1.expect)(result.name).toBe("Número de cuenta");
    (0, test_1.expect)(result.key).toContain("input");
});
