"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const runtime_field_capability_1 = require("./runtime-field-capability");
(0, node_test_1.default)("observes native select metadata and options", async () => {
    const locator = {
        evaluate: async () => ({
            observedAtRuntime: true,
            kind: "select",
            required: true,
            disabled: false,
            options: [
                { value: "", text: "Seleccione", disabled: false, selected: true },
                { value: "one", text: "One", disabled: false, selected: false },
                { value: "two", text: "Two", disabled: true, selected: false },
            ],
        }),
    };
    strict_1.default.deepEqual(await (0, runtime_field_capability_1.observeRuntimeFieldCapability)(locator), {
        observedAtRuntime: true,
        kind: "select",
        required: true,
        disabled: false,
        options: [
            { value: "", text: "Seleccione", disabled: false, selected: true },
            { value: "one", text: "One", disabled: false, selected: false },
            { value: "two", text: "Two", disabled: true, selected: false },
        ],
    });
});
(0, node_test_1.default)("selects the first valid observed supporting option", async () => {
    const locator = {
        evaluate: async () => ({
            observedAtRuntime: true,
            kind: "select",
            options: [
                { value: "", text: "Seleccione", disabled: false, selected: true },
                { value: "disabled", text: "Disabled", disabled: true, selected: false },
                { value: "valid", text: "Valid", disabled: false, selected: false },
            ],
        }),
    };
    strict_1.default.equal(await (0, runtime_field_capability_1.selectSupportingOption)(locator, { strategy: "first_valid" }), "valid");
});
(0, node_test_1.default)("fails explicitly when no supporting option is valid", async () => {
    const locator = {
        evaluate: async () => ({ observedAtRuntime: true, kind: "select", options: [{ value: "", text: "-", disabled: false, selected: true }] }),
    };
    await strict_1.default.rejects(() => (0, runtime_field_capability_1.selectSupportingOption)(locator, { strategy: "first_valid" }), /No valid runtime option found for supporting select\./);
});
(0, node_test_1.default)("keeps supportingStrategy declarative in serialized execution plans", () => {
    const step = {
        action: "select",
        supportingStrategy: { kind: "select_valid_option", strategy: "first_valid" },
    };
    const serialized = JSON.stringify(step);
    strict_1.default.match(serialized, /select_valid_option/);
    strict_1.default.doesNotMatch(serialized, /Casa|index/);
});
(0, node_test_1.default)("observes radio group and checkbox state", async () => {
    const radio = {
        evaluate: async () => ({
            observedAtRuntime: true,
            kind: "radio",
            groupName: "group",
            value: "one",
            checked: false,
            disabled: false,
            required: true,
            options: [{ value: "one", text: "One", checked: false, disabled: false }],
        }),
    };
    const checkbox = {
        evaluate: async () => ({ observedAtRuntime: true, kind: "checkbox", checked: false, disabled: false, required: true, value: "on" }),
    };
    strict_1.default.equal((await (0, runtime_field_capability_1.observeRuntimeFieldCapability)(radio)).groupName, "group");
    strict_1.default.equal((await (0, runtime_field_capability_1.observeRuntimeFieldCapability)(radio)).options?.[0]?.checked, false);
    strict_1.default.equal((await (0, runtime_field_capability_1.observeRuntimeFieldCapability)(checkbox)).required, true);
});
(0, node_test_1.default)("resolves a radio option and preserves an already checked valid option", async () => {
    const checked = {
        evaluate: async () => ({ observedAtRuntime: true, kind: "radio", groupName: "group", checked: true, disabled: false, options: [{ value: "one", checked: true, disabled: false }] }),
    };
    strict_1.default.equal(await (0, runtime_field_capability_1.selectSupportingRadio)(checked, { strategy: "first_valid" }), false);
    let clicked = false;
    const unchecked = {
        evaluate: async () => {
            clicked = true;
            return { observedAtRuntime: true, kind: "radio", groupName: "group", checked: false, disabled: false, options: [{ value: "one", checked: false, disabled: false }] };
        },
    };
    strict_1.default.equal(await (0, runtime_field_capability_1.selectSupportingRadio)(unchecked, { strategy: "first_valid" }), true);
    strict_1.default.equal(clicked, true);
});
(0, node_test_1.default)("ensures supporting checkbox only when needed", async () => {
    let checks = 0;
    const unchecked = {
        evaluate: async () => ({ observedAtRuntime: true, kind: "checkbox", checked: false, disabled: false }),
        check: async () => { checks += 1; },
    };
    strict_1.default.equal(await (0, runtime_field_capability_1.ensureSupportingCheckbox)(unchecked, { strategy: "ensure_checked" }), true);
    strict_1.default.equal(checks, 1);
    const checked = { evaluate: async () => ({ observedAtRuntime: true, kind: "checkbox", checked: true, disabled: false }), check: async () => { checks += 1; } };
    strict_1.default.equal(await (0, runtime_field_capability_1.ensureSupportingCheckbox)(checked, { strategy: "ensure_checked" }), false);
    strict_1.default.equal(checks, 1);
    const disabled = { evaluate: async () => ({ observedAtRuntime: true, kind: "checkbox", checked: false, disabled: true }), check: async () => { checks += 1; } };
    await strict_1.default.rejects(() => (0, runtime_field_capability_1.ensureSupportingCheckbox)(disabled, { strategy: "ensure_checked" }), /Cannot resolve supporting checkbox: control is disabled\./);
});
(0, node_test_1.default)("observes combobox ARIA state and resolves its runtime option", async () => {
    let opened = false;
    let clicks = 0;
    const locator = {
        click: async () => { opened = true; },
        evaluate: async () => {
            clicks += 1;
            return opened
                ? {
                    observedAtRuntime: true,
                    kind: "combobox",
                    expanded: true,
                    controlsId: "runtime-list",
                    options: [
                        { text: "Disabled", value: "disabled", disabled: true, selected: false },
                        { text: "Valid", value: "valid", disabled: false, selected: false },
                    ],
                }
                : { observedAtRuntime: true, kind: "combobox", expanded: false, controlsId: "runtime-list", options: [] };
        },
    };
    strict_1.default.equal(await (0, runtime_field_capability_1.selectSupportingCombobox)(locator, { strategy: "first_valid" }), true);
    strict_1.default.equal(opened, true);
    strict_1.default.equal(clicks, 3);
});
(0, node_test_1.default)("preserves selected custom option and fails on ambiguity or no valid options", async () => {
    const selected = {
        evaluate: async () => ({ observedAtRuntime: true, kind: "combobox", expanded: true, controlsId: "list", options: [{ value: "one", text: "One", disabled: false, selected: true }] }),
    };
    strict_1.default.equal(await (0, runtime_field_capability_1.selectSupportingCombobox)(selected, { strategy: "first_valid" }), false);
    const ambiguous = {
        evaluate: async () => ({ observedAtRuntime: true, kind: "combobox", expanded: true, options: [], listboxAmbiguous: true }),
    };
    await strict_1.default.rejects(() => (0, runtime_field_capability_1.selectSupportingCombobox)(ambiguous, { strategy: "first_valid" }), /Cannot resolve supporting combobox listbox unambiguously\./);
    const empty = {
        evaluate: async () => ({ observedAtRuntime: true, kind: "combobox", expanded: true, controlsId: "list", options: [{ value: "", text: "Placeholder", disabled: false, selected: false }] }),
    };
    await strict_1.default.rejects(() => (0, runtime_field_capability_1.selectSupportingCombobox)(empty, { strategy: "first_valid" }), /No valid runtime option found for supporting combobox\./);
});
(0, node_test_1.default)("observes editable autocomplete metadata and resolves visible options without a query", async () => {
    let clicks = 0;
    const locator = {
        click: async () => { clicks += 1; },
        evaluate: async () => ({
            observedAtRuntime: true,
            kind: "autocomplete",
            autocompleteMode: "list",
            expanded: true,
            controlsId: "options",
            options: [
                { value: "disabled", text: "Disabled", disabled: true, selected: false },
                { value: "valid", text: "Valid", disabled: false, selected: false },
            ],
        }),
    };
    strict_1.default.equal((await (0, runtime_field_capability_1.observeRuntimeFieldCapability)(locator)).autocompleteMode, "list");
    strict_1.default.equal(await (0, runtime_field_capability_1.selectSupportingAutocomplete)(locator, { strategy: "first_valid" }), true);
    strict_1.default.equal(clicks, 0);
});
(0, node_test_1.default)("preserves selected autocomplete and never invents a search query", async () => {
    const selected = {
        evaluate: async () => ({ observedAtRuntime: true, kind: "autocomplete", expanded: true, controlsId: "options", options: [{ value: "one", text: "One", disabled: false, selected: true }] }),
    };
    strict_1.default.equal(await (0, runtime_field_capability_1.selectSupportingAutocomplete)(selected, { strategy: "first_valid" }), false);
    let typed = false;
    const unresolved = {
        evaluate: async () => ({ observedAtRuntime: true, kind: "autocomplete", expanded: true, controlsId: "options", options: [] }),
        fill: async () => { typed = true; },
    };
    await strict_1.default.rejects(() => (0, runtime_field_capability_1.selectSupportingAutocomplete)(unresolved, { strategy: "first_valid" }), /No valid runtime option found for supporting autocomplete\./);
    strict_1.default.equal(typed, false);
});
(0, node_test_1.default)("observes native date metadata and resolves a date inside the range", async () => {
    let filled = "";
    const locator = {
        evaluate: async () => ({ observedAtRuntime: true, kind: "date", required: true, disabled: false, currentValue: "", constraints: { min: "2026-01-10", max: "2026-01-20" } }),
        fill: async (value) => { filled = value; },
    };
    const observed = await (0, runtime_field_capability_1.observeRuntimeFieldCapability)(locator);
    strict_1.default.equal(observed.kind, "date");
    strict_1.default.equal(observed.constraints?.min, "2026-01-10");
    strict_1.default.equal(observed.currentValue, "");
    await (0, runtime_field_capability_1.resolveSupportingDate)(locator, { strategy: "valid_in_range" });
    strict_1.default.ok(filled >= "2026-01-10" && filled <= "2026-01-20");
});
(0, node_test_1.default)("rejects invalid or disabled native date controls", async () => {
    const invalid = { evaluate: async () => ({ observedAtRuntime: true, kind: "date", required: false, disabled: false, constraints: { min: "2026-02-01", max: "2026-01-01" } }) };
    await strict_1.default.rejects(() => (0, runtime_field_capability_1.resolveSupportingDate)(invalid, { strategy: "valid_in_range" }), /Invalid runtime date range\./);
    const disabled = { evaluate: async () => ({ observedAtRuntime: true, kind: "date", required: false, disabled: true }) };
    await strict_1.default.rejects(() => (0, runtime_field_capability_1.resolveSupportingDate)(disabled, { strategy: "valid_in_range" }), /Cannot resolve supporting date: control is disabled\./);
});
(0, node_test_1.default)("observes and resolves a structured custom datepicker without inventing a date", async () => {
    let clicked = false;
    const locator = {
        evaluate: async () => ({
            observedAtRuntime: true,
            kind: "datepicker",
            expanded: true,
            controlsId: "calendar",
            options: [
                { value: "2026-01-10", text: "10", disabled: true, selected: false },
                { value: "2026-01-11", text: "11", disabled: false, selected: false },
            ],
        }),
        click: async () => { clicked = true; },
    };
    strict_1.default.equal((await (0, runtime_field_capability_1.observeRuntimeFieldCapability)(locator)).kind, "datepicker");
    strict_1.default.equal(await (0, runtime_field_capability_1.resolveSupportingDate)(locator, { strategy: "valid_in_range" }), true);
    strict_1.default.equal(clicked, false);
});
(0, node_test_1.default)("preserves selected date and fails when custom datepicker structure is ambiguous", async () => {
    const selected = { evaluate: async () => ({ observedAtRuntime: true, kind: "datepicker", expanded: true, controlsId: "calendar", options: [{ value: "2026-01-11", text: "11", disabled: false, selected: true }] }) };
    strict_1.default.equal(await (0, runtime_field_capability_1.resolveSupportingDate)(selected, { strategy: "valid_in_range" }), false);
    const ambiguous = { evaluate: async () => ({ observedAtRuntime: true, kind: "datepicker", expanded: true, datepickerAmbiguous: true, options: [] }) };
    await strict_1.default.rejects(() => (0, runtime_field_capability_1.resolveSupportingDate)(ambiguous, { strategy: "valid_in_range" }), /Cannot resolve supporting datepicker structure\./);
});
(0, node_test_1.default)("keeps date supporting strategy declarative", () => {
    const serialized = JSON.stringify({ action: "fill", supportingStrategy: { kind: "date_valid_value", strategy: "valid_in_range" } });
    strict_1.default.match(serialized, /date_valid_value/);
    strict_1.default.doesNotMatch(serialized, /2026|index|September/);
});
(0, node_test_1.default)("observes and resolves native multiselect with one valid runtime option", async () => {
    let selected = [];
    const locator = {
        evaluate: async () => ({
            observedAtRuntime: true,
            kind: "multiselect",
            native: true,
            required: false,
            disabled: false,
            options: [
                { value: "", text: "Placeholder", disabled: false, selected: false },
                { value: "disabled", text: "Disabled", disabled: true, selected: false },
                { value: "valid", text: "Valid", disabled: false, selected: false },
            ],
        }),
        selectOption: async (value) => { selected = value; },
    };
    const observed = await (0, runtime_field_capability_1.observeRuntimeFieldCapability)(locator);
    strict_1.default.equal(observed.kind, "multiselect");
    strict_1.default.equal(await (0, runtime_field_capability_1.ensureSupportingMultiselect)(locator, { strategy: "ensure_valid_selection" }), true);
    strict_1.default.deepEqual(selected, ["valid"]);
});
(0, node_test_1.default)("preserves selected native multiselect and rejects disabled or empty controls", async () => {
    const selected = { evaluate: async () => ({ observedAtRuntime: true, kind: "multiselect", native: true, required: false, disabled: false, options: [{ value: "one", disabled: false, selected: true }] }), selectOption: async () => { throw new Error("should not select"); } };
    strict_1.default.equal(await (0, runtime_field_capability_1.ensureSupportingMultiselect)(selected, { strategy: "ensure_valid_selection" }), false);
    const empty = { evaluate: async () => ({ observedAtRuntime: true, kind: "multiselect", native: true, required: false, disabled: false, options: [{ value: "", disabled: false, selected: false }] }), selectOption: async () => undefined };
    await strict_1.default.rejects(() => (0, runtime_field_capability_1.ensureSupportingMultiselect)(empty, { strategy: "ensure_valid_selection" }), /No valid runtime multiselect option found\./);
    const disabled = { evaluate: async () => ({ observedAtRuntime: true, kind: "multiselect", native: true, required: false, disabled: true, options: [] }), selectOption: async () => undefined };
    await strict_1.default.rejects(() => (0, runtime_field_capability_1.ensureSupportingMultiselect)(disabled, { strategy: "ensure_valid_selection" }), /Cannot resolve supporting multiselect: control is disabled\./);
});
(0, node_test_1.default)("resolves ARIA multiselect enabled option and keeps strategy declarative", async () => {
    let clicked = false;
    let observed = false;
    const locator = {
        evaluate: async (callback) => {
            if (observed) {
                clicked = true;
                return undefined;
            }
            observed = true;
            return { observedAtRuntime: true, kind: "multiselect", native: false, required: false, disabled: false, options: [{ value: "one", text: "One", disabled: false, selected: false }] };
        },
    };
    strict_1.default.equal(await (0, runtime_field_capability_1.ensureSupportingMultiselect)(locator, { strategy: "ensure_valid_selection" }), true);
    strict_1.default.equal(clicked, true);
    const serialized = JSON.stringify({ action: "select", supportingStrategy: { kind: "multiselect_valid_options", strategy: "ensure_valid_selection" } });
    strict_1.default.match(serialized, /multiselect_valid_options/);
    strict_1.default.doesNotMatch(serialized, /One|index/);
});
