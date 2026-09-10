import assert from "node:assert/strict";
import test from "node:test";
import {
  ensureSupportingCheckbox,
  ensureSupportingMultiselect,
  observeRuntimeFieldCapability,
  resolveSupportingDate,
  selectSupportingAutocomplete,
  selectSupportingCombobox,
  selectSupportingOption,
  selectSupportingRadio,
} from "./runtime-field-capability";

test("observes native select metadata and options", async () => {
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

  assert.deepEqual(await observeRuntimeFieldCapability(locator as any), {
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

test("selects the first valid observed supporting option", async () => {
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

  assert.equal(await selectSupportingOption(locator as any, { strategy: "first_valid" }), "valid");
});

test("fails explicitly when no supporting option is valid", async () => {
  const locator = {
    evaluate: async () => ({ observedAtRuntime: true, kind: "select", options: [{ value: "", text: "-", disabled: false, selected: true }] }),
  };

  await assert.rejects(
    () => selectSupportingOption(locator as any, { strategy: "first_valid" }),
    /No valid runtime option found for supporting select\./,
  );
});

test("keeps supportingStrategy declarative in serialized execution plans", () => {
  const step = {
    action: "select",
    supportingStrategy: { kind: "select_valid_option", strategy: "first_valid" },
  };

  const serialized = JSON.stringify(step);
  assert.match(serialized, /select_valid_option/);
  assert.doesNotMatch(serialized, /Casa|index/);
});

test("observes radio group and checkbox state", async () => {
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

  assert.equal((await observeRuntimeFieldCapability(radio as any)).groupName, "group");
  assert.equal((await observeRuntimeFieldCapability(radio as any)).options?.[0]?.checked, false);
  assert.equal((await observeRuntimeFieldCapability(checkbox as any)).required, true);
});

test("resolves a radio option and preserves an already checked valid option", async () => {
  const checked = {
    evaluate: async () => ({ observedAtRuntime: true, kind: "radio", groupName: "group", checked: true, disabled: false, options: [{ value: "one", checked: true, disabled: false }] }),
  };
  assert.equal(await selectSupportingRadio(checked as any, { strategy: "first_valid" }), false);

  let clicked = false;
  const unchecked = {
    evaluate: async () => {
      clicked = true;
      return { observedAtRuntime: true, kind: "radio", groupName: "group", checked: false, disabled: false, options: [{ value: "one", checked: false, disabled: false }] };
    },
  };
  assert.equal(await selectSupportingRadio(unchecked as any, { strategy: "first_valid" }), true);
  assert.equal(clicked, true);
});

test("ensures supporting checkbox only when needed", async () => {
  let checks = 0;
  const unchecked = {
    evaluate: async () => ({ observedAtRuntime: true, kind: "checkbox", checked: false, disabled: false }),
    check: async () => { checks += 1; },
  };
  assert.equal(await ensureSupportingCheckbox(unchecked as any, { strategy: "ensure_checked" }), true);
  assert.equal(checks, 1);

  const checked = { evaluate: async () => ({ observedAtRuntime: true, kind: "checkbox", checked: true, disabled: false }), check: async () => { checks += 1; } };
  assert.equal(await ensureSupportingCheckbox(checked as any, { strategy: "ensure_checked" }), false);
  assert.equal(checks, 1);

  const disabled = { evaluate: async () => ({ observedAtRuntime: true, kind: "checkbox", checked: false, disabled: true }), check: async () => { checks += 1; } };
  await assert.rejects(() => ensureSupportingCheckbox(disabled as any, { strategy: "ensure_checked" }), /Cannot resolve supporting checkbox: control is disabled\./);
});

test("observes combobox ARIA state and resolves its runtime option", async () => {
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

  assert.equal(await selectSupportingCombobox(locator as any, { strategy: "first_valid" }), true);
  assert.equal(opened, true);
  assert.equal(clicks, 3);
});

test("preserves selected custom option and fails on ambiguity or no valid options", async () => {
  const selected = {
    evaluate: async () => ({ observedAtRuntime: true, kind: "combobox", expanded: true, controlsId: "list", options: [{ value: "one", text: "One", disabled: false, selected: true }] }),
  };
  assert.equal(await selectSupportingCombobox(selected as any, { strategy: "first_valid" }), false);

  const ambiguous = {
    evaluate: async () => ({ observedAtRuntime: true, kind: "combobox", expanded: true, options: [], listboxAmbiguous: true }),
  };
  await assert.rejects(() => selectSupportingCombobox(ambiguous as any, { strategy: "first_valid" }), /Cannot resolve supporting combobox listbox unambiguously\./);

  const empty = {
    evaluate: async () => ({ observedAtRuntime: true, kind: "combobox", expanded: true, controlsId: "list", options: [{ value: "", text: "Placeholder", disabled: false, selected: false }] }),
  };
  await assert.rejects(() => selectSupportingCombobox(empty as any, { strategy: "first_valid" }), /No valid runtime option found for supporting combobox\./);
});

test("observes editable autocomplete metadata and resolves visible options without a query", async () => {
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

  assert.equal((await observeRuntimeFieldCapability(locator as any)).autocompleteMode, "list");
  assert.equal(await selectSupportingAutocomplete(locator as any, { strategy: "first_valid" }), true);
  assert.equal(clicks, 0);
});

test("preserves selected autocomplete and never invents a search query", async () => {
  const selected = {
    evaluate: async () => ({ observedAtRuntime: true, kind: "autocomplete", expanded: true, controlsId: "options", options: [{ value: "one", text: "One", disabled: false, selected: true }] }),
  };
  assert.equal(await selectSupportingAutocomplete(selected as any, { strategy: "first_valid" }), false);

  let typed = false;
  const unresolved = {
    evaluate: async () => ({ observedAtRuntime: true, kind: "autocomplete", expanded: true, controlsId: "options", options: [] }),
    fill: async () => { typed = true; },
  };
  await assert.rejects(() => selectSupportingAutocomplete(unresolved as any, { strategy: "first_valid" }), /No valid runtime option found for supporting autocomplete\./);
  assert.equal(typed, false);
});

test("observes native date metadata and resolves a date inside the range", async () => {
  let filled = "";
  const locator = {
    evaluate: async () => ({ observedAtRuntime: true, kind: "date", required: true, disabled: false, currentValue: "", constraints: { min: "2026-01-10", max: "2026-01-20" } }),
    fill: async (value: string) => { filled = value; },
  };

  const observed = await observeRuntimeFieldCapability(locator as any);
  assert.equal(observed.kind, "date");
  assert.equal(observed.constraints?.min, "2026-01-10");
  assert.equal(observed.currentValue, "");
  await resolveSupportingDate(locator as any, { strategy: "valid_in_range" });
  assert.ok(filled >= "2026-01-10" && filled <= "2026-01-20");
});

test("rejects invalid or disabled native date controls", async () => {
  const invalid = { evaluate: async () => ({ observedAtRuntime: true, kind: "date", required: false, disabled: false, constraints: { min: "2026-02-01", max: "2026-01-01" } }) };
  await assert.rejects(() => resolveSupportingDate(invalid as any, { strategy: "valid_in_range" }), /Invalid runtime date range\./);
  const disabled = { evaluate: async () => ({ observedAtRuntime: true, kind: "date", required: false, disabled: true }) };
  await assert.rejects(() => resolveSupportingDate(disabled as any, { strategy: "valid_in_range" }), /Cannot resolve supporting date: control is disabled\./);
});

test("observes and resolves a structured custom datepicker without inventing a date", async () => {
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

  assert.equal((await observeRuntimeFieldCapability(locator as any)).kind, "datepicker");
  assert.equal(await resolveSupportingDate(locator as any, { strategy: "valid_in_range" }), true);
  assert.equal(clicked, false);
});

test("preserves selected date and fails when custom datepicker structure is ambiguous", async () => {
  const selected = { evaluate: async () => ({ observedAtRuntime: true, kind: "datepicker", expanded: true, controlsId: "calendar", options: [{ value: "2026-01-11", text: "11", disabled: false, selected: true }] }) };
  assert.equal(await resolveSupportingDate(selected as any, { strategy: "valid_in_range" }), false);
  const ambiguous = { evaluate: async () => ({ observedAtRuntime: true, kind: "datepicker", expanded: true, datepickerAmbiguous: true, options: [] }) };
  await assert.rejects(() => resolveSupportingDate(ambiguous as any, { strategy: "valid_in_range" }), /Cannot resolve supporting datepicker structure\./);
});

test("keeps date supporting strategy declarative", () => {
  const serialized = JSON.stringify({ action: "fill", supportingStrategy: { kind: "date_valid_value", strategy: "valid_in_range" } });
  assert.match(serialized, /date_valid_value/);
  assert.doesNotMatch(serialized, /2026|index|September/);
});

test("observes and resolves native multiselect with one valid runtime option", async () => {
  let selected: string[] = [];
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
    selectOption: async (value: string[]) => { selected = value; },
  };
  const observed = await observeRuntimeFieldCapability(locator as any);
  assert.equal(observed.kind, "multiselect");
  assert.equal(await ensureSupportingMultiselect(locator as any, { strategy: "ensure_valid_selection" }), true);
  assert.deepEqual(selected, ["valid"]);
});

test("preserves selected native multiselect and rejects disabled or empty controls", async () => {
  const selected = { evaluate: async () => ({ observedAtRuntime: true, kind: "multiselect", native: true, required: false, disabled: false, options: [{ value: "one", disabled: false, selected: true }] }), selectOption: async () => { throw new Error("should not select"); } };
  assert.equal(await ensureSupportingMultiselect(selected as any, { strategy: "ensure_valid_selection" }), false);
  const empty = { evaluate: async () => ({ observedAtRuntime: true, kind: "multiselect", native: true, required: false, disabled: false, options: [{ value: "", disabled: false, selected: false }] }), selectOption: async () => undefined };
  await assert.rejects(() => ensureSupportingMultiselect(empty as any, { strategy: "ensure_valid_selection" }), /No valid runtime multiselect option found\./);
  const disabled = { evaluate: async () => ({ observedAtRuntime: true, kind: "multiselect", native: true, required: false, disabled: true, options: [] }), selectOption: async () => undefined };
  await assert.rejects(() => ensureSupportingMultiselect(disabled as any, { strategy: "ensure_valid_selection" }), /Cannot resolve supporting multiselect: control is disabled\./);
});

test("resolves ARIA multiselect enabled option and keeps strategy declarative", async () => {
  let clicked = false;
  let observed = false;
  const locator = {
    evaluate: async (callback: unknown) => {
      if (observed) {
        clicked = true;
        return undefined;
      }
      observed = true;
      return { observedAtRuntime: true, kind: "multiselect", native: false, required: false, disabled: false, options: [{ value: "one", text: "One", disabled: false, selected: false }] };
    },
  };
  assert.equal(await ensureSupportingMultiselect(locator as any, { strategy: "ensure_valid_selection" }), true);
  assert.equal(clicked, true);
  const serialized = JSON.stringify({ action: "select", supportingStrategy: { kind: "multiselect_valid_options", strategy: "ensure_valid_selection" } });
  assert.match(serialized, /multiselect_valid_options/);
  assert.doesNotMatch(serialized, /One|index/);
});
