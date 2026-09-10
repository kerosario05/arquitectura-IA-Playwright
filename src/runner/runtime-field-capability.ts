import type { Locator } from "@playwright/test";

export type RuntimeFieldOption = {
  value?: string;
  text?: string;
  disabled: boolean;
  selected: boolean;
  checked?: boolean;
};

export type RuntimeFieldCapability = {
  observedAtRuntime: true;
  kind: "text" | "number" | "email" | "tel" | "date" | "datetime" | "select" | "multiselect" | "checkbox" | "radio" | "combobox" | "autocomplete" | "listbox" | "datepicker" | "unknown";
  required: boolean;
  disabled: boolean;
  groupName?: string;
  value?: string;
  checked?: boolean;
  expanded?: boolean;
  controlsId?: string;
  listboxAmbiguous?: boolean;
  autocompleteMode?: string;
  currentValue?: string;
  datepickerAmbiguous?: boolean;
  native?: boolean;
  constraints?: {
    min?: number | string;
    max?: number | string;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
  };
  options?: RuntimeFieldOption[];
};

export async function observeRuntimeFieldCapability(locator: Locator): Promise<RuntimeFieldCapability> {
  return locator.evaluate((element) => {
    const htmlElement = element as HTMLElement;
    const tagName = htmlElement.tagName.toLowerCase();
    const inputType = (htmlElement as HTMLInputElement).type?.toLowerCase();
    const role = htmlElement.getAttribute("role")?.toLowerCase();
    let kind: RuntimeFieldCapability["kind"] = "unknown";

    const autocompleteMode = htmlElement.getAttribute("aria-autocomplete") || undefined;
    const isEditable = tagName === "input" || tagName === "textarea" || htmlElement.isContentEditable;
    const ariaHasPopup = htmlElement.getAttribute("aria-haspopup")?.toLowerCase();
    const ariaControls = htmlElement.getAttribute("aria-controls") || undefined;
    const hasGrid = Boolean(htmlElement.querySelector('[role="grid"]'));
    if (tagName === "select") kind = (htmlElement as HTMLSelectElement).multiple ? "multiselect" : "select";
    else if (role === "dialog" && hasGrid) kind = "datepicker";
    else if (ariaHasPopup === "dialog" && ariaControls) kind = "datepicker";
    else if (role === "combobox") kind = autocompleteMode || isEditable ? "autocomplete" : "combobox";
    else if (role === "listbox") kind = htmlElement.getAttribute("aria-multiselectable") === "true" ? "multiselect" : "listbox";
    else if (inputType === "checkbox" || role === "checkbox") kind = "checkbox";
    else if (inputType === "radio" || role === "radio") kind = "radio";
    else if (tagName === "textarea" || inputType === "text" || inputType === "") kind = "text";
    else if (["number", "email", "tel", "date"].includes(inputType)) kind = inputType as RuntimeFieldCapability["kind"];
    else if (inputType === "datetime-local") kind = "datetime";

    const parseAttributeNumber = (value: string | undefined): number | undefined => {
      if (!value || value.trim() === "") return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const constraints: NonNullable<RuntimeFieldCapability["constraints"]> = {};
    const rawMin = htmlElement.getAttribute("min") ?? undefined;
    const rawMax = htmlElement.getAttribute("max") ?? undefined;
    const min = (kind === "date" || kind === "datetime") ? rawMin : parseAttributeNumber(rawMin);
    const max = (kind === "date" || kind === "datetime") ? rawMax : parseAttributeNumber(rawMax);
    const minLength = parseAttributeNumber(htmlElement.getAttribute("minlength") ?? undefined);
    const maxLength = parseAttributeNumber(htmlElement.getAttribute("maxlength") ?? undefined);
    const pattern = htmlElement.getAttribute("pattern") ?? undefined;
    if (min !== undefined) constraints.min = min;
    if (max !== undefined) constraints.max = max;
    if (minLength !== undefined) constraints.minLength = minLength;
    if (maxLength !== undefined) constraints.maxLength = maxLength;
    if (pattern !== undefined) constraints.pattern = pattern;

    const options = (kind === "select" || kind === "multiselect") && tagName === "select"
      ? Array.from((htmlElement as HTMLSelectElement).options).map((option) => ({
        value: option.value,
        text: option.text,
        disabled: option.disabled,
        selected: option.selected,
      }))
      : undefined;
    const groupName = kind === "radio" ? ((htmlElement as HTMLInputElement).name || undefined) : undefined;
    const radioOptions = kind === "radio" && groupName
      ? Array.from(document.querySelectorAll('input[type="radio"]'))
        .filter((candidate) => (candidate as HTMLInputElement).name === groupName)
        .map((candidate) => {
          const radio = candidate as HTMLInputElement;
          const label = radio.id ? document.querySelector(`label[for="${radio.id}"]`)?.textContent?.trim() : undefined;
          return { value: radio.value, text: label ?? "", disabled: radio.disabled, selected: radio.checked, checked: radio.checked };
        })
      : undefined;
    const controlsId = (kind === "combobox" || kind === "autocomplete" || kind === "datepicker") ? ariaControls : undefined;
    const controlledListboxes = (kind === "combobox" || kind === "autocomplete")
      ? (controlsId
        ? Array.from(document.querySelectorAll('[role="listbox"]')).filter((candidate) => candidate.id === controlsId)
        : Array.from(document.querySelectorAll('[role="listbox"]')))
      : [];
    const listbox = controlledListboxes.length === 1 ? controlledListboxes[0] : undefined;
    const customOptions = (kind === "listbox" || kind === "multiselect" ? htmlElement : listbox)
      ? Array.from((kind === "listbox" || kind === "multiselect" ? htmlElement : listbox!).querySelectorAll('[role="option"]')).map((option) => ({
        value: option.getAttribute("data-value") ?? option.getAttribute("value") ?? undefined,
        text: (option.textContent ?? "").replace(/\s+/g, " ").trim() || undefined,
        disabled: option.getAttribute("aria-disabled") === "true" || option.hasAttribute("disabled"),
        selected: option.getAttribute("aria-selected") === "true",
      }))
      : undefined;
    const controlledGrids = kind === "datepicker"
      ? (controlsId
        ? Array.from(document.querySelectorAll('[role="grid"]')).filter((candidate) => candidate.id === controlsId)
        : Array.from(document.querySelectorAll('[role="grid"]')))
      : [];
    const grid = controlledGrids.length === 1 ? controlledGrids[0] : (kind === "datepicker" && hasGrid ? htmlElement.querySelector('[role="grid"]') : undefined);
    const dateOptions = grid
      ? Array.from(grid.querySelectorAll('[role="gridcell"]')).map((cell) => ({
        value: cell.getAttribute("data-value") ?? cell.getAttribute("value") ?? undefined,
        text: (cell.textContent ?? "").replace(/\s+/g, " ").trim() || undefined,
        disabled: cell.getAttribute("aria-disabled") === "true" || cell.hasAttribute("disabled"),
        selected: cell.getAttribute("aria-selected") === "true",
      }))
      : undefined;

    return {
      observedAtRuntime: true,
      kind,
      ...(tagName === "select" ? { native: true } : {}),
      required: (htmlElement as HTMLInputElement).required,
      disabled: (htmlElement as HTMLInputElement).disabled,
      ...(groupName ? { groupName } : {}),
      ...((kind === "combobox" || kind === "autocomplete") ? {
        expanded: htmlElement.getAttribute("aria-expanded") === "true",
        ...(controlsId ? { controlsId } : {}),
        ...(autocompleteMode ? { autocompleteMode } : {}),
        ...(controlledListboxes.length > 1 ? { listboxAmbiguous: true } : {}),
      } : {}),
      ...(kind === "datepicker" ? {
        expanded: htmlElement.getAttribute("aria-expanded") === "true",
        ...(controlsId ? { controlsId } : {}),
        ...(controlledGrids.length > 1 ? { datepickerAmbiguous: true } : {}),
      } : {}),
      ...((kind === "date" || kind === "datetime" || kind === "datepicker") ? {
        ...(kind === "datepicker" && controlledGrids.length === 0 && !hasGrid ? { datepickerAmbiguous: true } : {}),
        currentValue: (htmlElement as HTMLInputElement).value || htmlElement.getAttribute("data-value") || undefined,
      } : {}),
      ...((kind === "radio" || kind === "checkbox") ? {
        value: (htmlElement as HTMLInputElement).value,
        checked: (htmlElement as HTMLInputElement).checked,
      } : {}),
      ...(Object.keys(constraints).length > 0 ? { constraints } : {}),
      ...(options ? { options } : {}),
      ...(radioOptions ? { options: radioOptions } : {}),
      ...(customOptions ? { options: customOptions } : {}),
      ...(dateOptions ? { options: dateOptions } : {}),
    };
  });
}

export async function selectSupportingRadio(
  locator: Locator,
  input: { strategy: "first_valid" },
): Promise<boolean> {
  const capability = await observeRuntimeFieldCapability(locator);
  if (input.strategy !== "first_valid") throw new Error(`Unsupported supporting radio strategy: ${input.strategy}`);
  if (capability.kind !== "radio") throw new Error("Supporting radio strategy requires a native radio.");
  if (!capability.groupName) throw new Error("Cannot resolve supporting radio group: missing name.");
  if (capability.checked && !capability.disabled) return false;
  const hasValidOption = (capability.options ?? []).some((option) => !option.disabled);
  if (!hasValidOption) throw new Error("No valid runtime radio option found for supporting group.");

  await locator.evaluate((element) => {
    const current = element as HTMLInputElement;
    const group = Array.from(document.querySelectorAll('input[type="radio"]'))
      .filter((candidate) => (candidate as HTMLInputElement).name === current.name)
      .map((candidate) => candidate as HTMLInputElement)
      .find((candidate) => !candidate.disabled);
    if (!group) throw new Error("No valid runtime radio option found for supporting group.");
    group.click();
  });
  return true;
}

export async function ensureSupportingCheckbox(
  locator: Locator,
  input: { strategy: "ensure_checked" },
): Promise<boolean> {
  const capability = await observeRuntimeFieldCapability(locator);
  if (input.strategy !== "ensure_checked") throw new Error(`Unsupported supporting checkbox strategy: ${input.strategy}`);
  if (capability.kind !== "checkbox") throw new Error("Supporting checkbox strategy requires a native checkbox.");
  if (capability.checked) return false;
  if (capability.disabled) throw new Error("Cannot resolve supporting checkbox: control is disabled.");
  await locator.check();
  return true;
}

export async function selectSupportingOption(
  locator: Locator,
  input: { strategy: "first_valid" },
): Promise<string> {
  const capability = await observeRuntimeFieldCapability(locator);
  if (capability.kind !== "select") {
    throw new Error("Supporting option strategy requires a native select.");
  }
  if (input.strategy !== "first_valid") {
    throw new Error(`Unsupported supporting select strategy: ${input.strategy}`);
  }
   const option = (capability.options ?? []).find((candidate) => !candidate.disabled && candidate.value?.trim() !== "");
   if (!option) throw new Error("No valid runtime option found for supporting select.");
  return option.value as string;
}

async function selectSupportingAriaOption(
  locator: Locator,
  input: { strategy: "first_valid" },
  expectedKind: "combobox" | "autocomplete",
  label: "combobox" | "autocomplete",
): Promise<boolean> {
  if (input.strategy !== "first_valid") throw new Error(`Unsupported supporting ${label} strategy: ${input.strategy}`);
  let capability = await observeRuntimeFieldCapability(locator);
  if (capability.kind !== expectedKind) throw new Error(`Supporting ${label} strategy requires a compatible ARIA control.`);
  if (capability.disabled) throw new Error(`Cannot resolve supporting ${label}: control is disabled.`);
  if (!capability.controlsId || capability.listboxAmbiguous) {
    throw new Error(`Cannot resolve supporting ${label} listbox unambiguously.`);
  }
  if (!capability.expanded) {
    await locator.click();
    capability = await observeRuntimeFieldCapability(locator);
  }
  const validOptions = (capability.options ?? []).filter((option) => !option.disabled && Boolean(option.value?.trim()));
  if (validOptions.length === 0) throw new Error(`No valid runtime option found for supporting ${label}.`);
  if (validOptions.some((option) => option.selected)) return false;

  await locator.evaluate((element) => {
    const controlsId = element.getAttribute("aria-controls");
    const listbox = controlsId ? document.getElementById(controlsId) : null;
    if (!listbox || listbox.getAttribute("role") !== "listbox") {
      throw new Error("Cannot resolve supporting listbox unambiguously.");
    }
    const option = Array.from(listbox.querySelectorAll('[role="option"]'))
      .find((candidate) => candidate.getAttribute("aria-disabled") !== "true" && !candidate.hasAttribute("disabled") && Boolean((candidate.getAttribute("data-value") ?? candidate.getAttribute("value") ?? "").trim()));
    if (!option) throw new Error("No valid runtime option found for supporting control.");
    (option as HTMLElement).click();
  });
  return true;
}

export async function selectSupportingCombobox(
  locator: Locator,
  input: { strategy: "first_valid" },
): Promise<boolean> {
  return selectSupportingAriaOption(locator, input, "combobox", "combobox");
}

export async function selectSupportingAutocomplete(
  locator: Locator,
  input: { strategy: "first_valid" },
): Promise<boolean> {
  return selectSupportingAriaOption(locator, input, "autocomplete", "autocomplete");
}

function isValidRuntimeDate(value: string | undefined, kind: "date" | "datetime"): boolean {
  if (!value) return false;
  const pattern = kind === "date" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
  if (!pattern.test(value)) return false;
  return Number.isFinite(Date.parse(kind === "date" ? `${value}T00:00:00Z` : value));
}

export async function resolveSupportingDate(
  locator: Locator,
  input: { strategy: "valid_in_range" },
): Promise<boolean> {
  if (input.strategy !== "valid_in_range") throw new Error(`Unsupported supporting date strategy: ${input.strategy}`);
  let capability = await observeRuntimeFieldCapability(locator);
  if (capability.disabled) throw new Error("Cannot resolve supporting date: control is disabled.");

  if (capability.kind === "date" || capability.kind === "datetime") {
    const kind = capability.kind;
    const min = typeof capability.constraints?.min === "string" ? capability.constraints.min : undefined;
    const max = typeof capability.constraints?.max === "string" ? capability.constraints.max : undefined;
    if (min && max && min > max) throw new Error("Invalid runtime date range.");
    const current = capability.currentValue;
    if (current && isValidRuntimeDate(current, kind) && (!min || current >= min) && (!max || current <= max)) return false;
    const today = new Date().toISOString().slice(0, kind === "date" ? 10 : 16);
    const candidate = min && isValidRuntimeDate(min, kind) ? min : today;
    if (!isValidRuntimeDate(candidate, kind) || (min && candidate < min) || (max && candidate > max)) {
      throw new Error("No valid runtime date found within range.");
    }
    await locator.fill(candidate);
    return true;
  }

  if (capability.kind !== "datepicker") throw new Error("Supporting date strategy requires a date control.");
  if (capability.datepickerAmbiguous || !capability.controlsId) {
    throw new Error("Cannot resolve supporting datepicker structure.");
  }
  if (!capability.expanded) {
    await locator.click();
    capability = await observeRuntimeFieldCapability(locator);
  }
  const validCells = (capability.options ?? []).filter((option) => !option.disabled && isValidRuntimeDate(option.value, "date"));
  if (validCells.length === 0) throw new Error("No valid runtime date cell found.");
  if (validCells.some((cell) => cell.selected)) return false;

  await locator.evaluate((element) => {
    const controlsId = element.getAttribute("aria-controls");
    const grid = controlsId ? document.getElementById(controlsId) : null;
    if (!grid || grid.getAttribute("role") !== "grid") throw new Error("Cannot resolve supporting datepicker structure.");
    const cell = Array.from(grid.querySelectorAll('[role="gridcell"]'))
      .find((candidate) => candidate.getAttribute("aria-disabled") !== "true" && !candidate.hasAttribute("disabled") && /^\d{4}-\d{2}-\d{2}$/.test(candidate.getAttribute("data-value") ?? candidate.getAttribute("value") ?? ""));
    if (!cell) throw new Error("No valid runtime date cell found.");
    (cell as HTMLElement).click();
  });
  return true;
}

export async function ensureSupportingMultiselect(
  locator: Locator,
  input: { strategy: "ensure_valid_selection" },
): Promise<boolean> {
  if (input.strategy !== "ensure_valid_selection") throw new Error(`Unsupported supporting multiselect strategy: ${input.strategy}`);
  const capability = await observeRuntimeFieldCapability(locator);
  if (capability.kind !== "multiselect") throw new Error("Supporting multiselect strategy requires a multiselect control.");
  if (capability.disabled) throw new Error("Cannot resolve supporting multiselect: control is disabled.");
  const validOptions = (capability.options ?? []).filter((option) => !option.disabled && Boolean(option.value?.trim()));
  if (validOptions.length === 0) throw new Error("No valid runtime multiselect option found.");
  if (validOptions.some((option) => option.selected)) return false;

  if (capability.native) {
    await locator.selectOption([validOptions[0].value as string]);
  } else {
    await locator.evaluate((element) => {
      const option = Array.from(element.querySelectorAll('[role="option"]'))
        .find((candidate) => candidate.getAttribute("aria-disabled") !== "true" && !candidate.hasAttribute("disabled") && Boolean((candidate.getAttribute("data-value") ?? candidate.getAttribute("value") ?? "").trim()));
      if (!option) throw new Error("No valid runtime multiselect option found.");
      (option as HTMLElement).click();
    });
  }
  return true;
}
