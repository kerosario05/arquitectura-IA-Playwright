"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.observeRuntimeFieldCapability = observeRuntimeFieldCapability;
exports.selectSupportingRadio = selectSupportingRadio;
exports.ensureSupportingCheckbox = ensureSupportingCheckbox;
exports.selectSupportingOption = selectSupportingOption;
exports.selectSupportingCombobox = selectSupportingCombobox;
exports.selectSupportingAutocomplete = selectSupportingAutocomplete;
exports.resolveSupportingDate = resolveSupportingDate;
exports.ensureSupportingMultiselect = ensureSupportingMultiselect;
async function observeRuntimeFieldCapability(locator) {
    return locator.evaluate((element) => {
        const htmlElement = element;
        const tagName = htmlElement.tagName.toLowerCase();
        const inputType = htmlElement.type?.toLowerCase();
        const role = htmlElement.getAttribute("role")?.toLowerCase();
        let kind = "unknown";
        const autocompleteMode = htmlElement.getAttribute("aria-autocomplete") || undefined;
        const isEditable = tagName === "input" || tagName === "textarea" || htmlElement.isContentEditable;
        const ariaHasPopup = htmlElement.getAttribute("aria-haspopup")?.toLowerCase();
        const ariaControls = htmlElement.getAttribute("aria-controls") || undefined;
        const hasGrid = Boolean(htmlElement.querySelector('[role="grid"]'));
        if (tagName === "select")
            kind = htmlElement.multiple ? "multiselect" : "select";
        else if (role === "dialog" && hasGrid)
            kind = "datepicker";
        else if (ariaHasPopup === "dialog" && ariaControls)
            kind = "datepicker";
        else if (role === "combobox")
            kind = autocompleteMode || isEditable ? "autocomplete" : "combobox";
        else if (role === "listbox")
            kind = htmlElement.getAttribute("aria-multiselectable") === "true" ? "multiselect" : "listbox";
        else if (inputType === "checkbox" || role === "checkbox")
            kind = "checkbox";
        else if (inputType === "radio" || role === "radio")
            kind = "radio";
        else if (tagName === "textarea" || inputType === "text" || inputType === "")
            kind = "text";
        else if (["number", "email", "tel", "date"].includes(inputType))
            kind = inputType;
        else if (inputType === "datetime-local")
            kind = "datetime";
        const parseAttributeNumber = (value) => {
            if (!value || value.trim() === "")
                return undefined;
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : undefined;
        };
        const constraints = {};
        const rawMin = htmlElement.getAttribute("min") ?? undefined;
        const rawMax = htmlElement.getAttribute("max") ?? undefined;
        const min = (kind === "date" || kind === "datetime") ? rawMin : parseAttributeNumber(rawMin);
        const max = (kind === "date" || kind === "datetime") ? rawMax : parseAttributeNumber(rawMax);
        const minLength = parseAttributeNumber(htmlElement.getAttribute("minlength") ?? undefined);
        const maxLength = parseAttributeNumber(htmlElement.getAttribute("maxlength") ?? undefined);
        const pattern = htmlElement.getAttribute("pattern") ?? undefined;
        if (min !== undefined)
            constraints.min = min;
        if (max !== undefined)
            constraints.max = max;
        if (minLength !== undefined)
            constraints.minLength = minLength;
        if (maxLength !== undefined)
            constraints.maxLength = maxLength;
        if (pattern !== undefined)
            constraints.pattern = pattern;
        const options = (kind === "select" || kind === "multiselect") && tagName === "select"
            ? Array.from(htmlElement.options).map((option) => ({
                value: option.value,
                text: option.text,
                disabled: option.disabled,
                selected: option.selected,
            }))
            : undefined;
        const groupName = kind === "radio" ? (htmlElement.name || undefined) : undefined;
        const radioOptions = kind === "radio" && groupName
            ? Array.from(document.querySelectorAll('input[type="radio"]'))
                .filter((candidate) => candidate.name === groupName)
                .map((candidate) => {
                const radio = candidate;
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
            ? Array.from((kind === "listbox" || kind === "multiselect" ? htmlElement : listbox).querySelectorAll('[role="option"]')).map((option) => ({
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
            required: htmlElement.required,
            disabled: htmlElement.disabled,
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
                currentValue: htmlElement.value || htmlElement.getAttribute("data-value") || undefined,
            } : {}),
            ...((kind === "radio" || kind === "checkbox") ? {
                value: htmlElement.value,
                checked: htmlElement.checked,
            } : {}),
            ...(Object.keys(constraints).length > 0 ? { constraints } : {}),
            ...(options ? { options } : {}),
            ...(radioOptions ? { options: radioOptions } : {}),
            ...(customOptions ? { options: customOptions } : {}),
            ...(dateOptions ? { options: dateOptions } : {}),
        };
    });
}
async function selectSupportingRadio(locator, input) {
    const capability = await observeRuntimeFieldCapability(locator);
    if (input.strategy !== "first_valid")
        throw new Error(`Unsupported supporting radio strategy: ${input.strategy}`);
    if (capability.kind !== "radio")
        throw new Error("Supporting radio strategy requires a native radio.");
    if (!capability.groupName)
        throw new Error("Cannot resolve supporting radio group: missing name.");
    if (capability.checked && !capability.disabled)
        return false;
    const hasValidOption = (capability.options ?? []).some((option) => !option.disabled);
    if (!hasValidOption)
        throw new Error("No valid runtime radio option found for supporting group.");
    await locator.evaluate((element) => {
        const current = element;
        const group = Array.from(document.querySelectorAll('input[type="radio"]'))
            .filter((candidate) => candidate.name === current.name)
            .map((candidate) => candidate)
            .find((candidate) => !candidate.disabled);
        if (!group)
            throw new Error("No valid runtime radio option found for supporting group.");
        group.click();
    });
    return true;
}
async function ensureSupportingCheckbox(locator, input) {
    const capability = await observeRuntimeFieldCapability(locator);
    if (input.strategy !== "ensure_checked")
        throw new Error(`Unsupported supporting checkbox strategy: ${input.strategy}`);
    if (capability.kind !== "checkbox")
        throw new Error("Supporting checkbox strategy requires a native checkbox.");
    if (capability.checked)
        return false;
    if (capability.disabled)
        throw new Error("Cannot resolve supporting checkbox: control is disabled.");
    await locator.check();
    return true;
}
async function selectSupportingOption(locator, input) {
    const capability = await observeRuntimeFieldCapability(locator);
    if (capability.kind !== "select") {
        throw new Error("Supporting option strategy requires a native select.");
    }
    if (input.strategy !== "first_valid") {
        throw new Error(`Unsupported supporting select strategy: ${input.strategy}`);
    }
    const option = (capability.options ?? []).find((candidate) => !candidate.disabled && candidate.value?.trim() !== "");
    if (!option)
        throw new Error("No valid runtime option found for supporting select.");
    return option.value;
}
async function selectSupportingAriaOption(locator, input, expectedKind, label) {
    if (input.strategy !== "first_valid")
        throw new Error(`Unsupported supporting ${label} strategy: ${input.strategy}`);
    let capability = await observeRuntimeFieldCapability(locator);
    if (capability.kind !== expectedKind)
        throw new Error(`Supporting ${label} strategy requires a compatible ARIA control.`);
    if (capability.disabled)
        throw new Error(`Cannot resolve supporting ${label}: control is disabled.`);
    if (!capability.controlsId || capability.listboxAmbiguous) {
        throw new Error(`Cannot resolve supporting ${label} listbox unambiguously.`);
    }
    if (!capability.expanded) {
        await locator.click();
        capability = await observeRuntimeFieldCapability(locator);
    }
    const validOptions = (capability.options ?? []).filter((option) => !option.disabled && Boolean(option.value?.trim()));
    if (validOptions.length === 0)
        throw new Error(`No valid runtime option found for supporting ${label}.`);
    if (validOptions.some((option) => option.selected))
        return false;
    await locator.evaluate((element) => {
        const controlsId = element.getAttribute("aria-controls");
        const listbox = controlsId ? document.getElementById(controlsId) : null;
        if (!listbox || listbox.getAttribute("role") !== "listbox") {
            throw new Error("Cannot resolve supporting listbox unambiguously.");
        }
        const option = Array.from(listbox.querySelectorAll('[role="option"]'))
            .find((candidate) => candidate.getAttribute("aria-disabled") !== "true" && !candidate.hasAttribute("disabled") && Boolean((candidate.getAttribute("data-value") ?? candidate.getAttribute("value") ?? "").trim()));
        if (!option)
            throw new Error("No valid runtime option found for supporting control.");
        option.click();
    });
    return true;
}
async function selectSupportingCombobox(locator, input) {
    return selectSupportingAriaOption(locator, input, "combobox", "combobox");
}
async function selectSupportingAutocomplete(locator, input) {
    return selectSupportingAriaOption(locator, input, "autocomplete", "autocomplete");
}
function isValidRuntimeDate(value, kind) {
    if (!value)
        return false;
    const pattern = kind === "date" ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
    if (!pattern.test(value))
        return false;
    return Number.isFinite(Date.parse(kind === "date" ? `${value}T00:00:00Z` : value));
}
async function resolveSupportingDate(locator, input) {
    if (input.strategy !== "valid_in_range")
        throw new Error(`Unsupported supporting date strategy: ${input.strategy}`);
    let capability = await observeRuntimeFieldCapability(locator);
    if (capability.disabled)
        throw new Error("Cannot resolve supporting date: control is disabled.");
    if (capability.kind === "date" || capability.kind === "datetime") {
        const kind = capability.kind;
        const min = typeof capability.constraints?.min === "string" ? capability.constraints.min : undefined;
        const max = typeof capability.constraints?.max === "string" ? capability.constraints.max : undefined;
        if (min && max && min > max)
            throw new Error("Invalid runtime date range.");
        const current = capability.currentValue;
        if (current && isValidRuntimeDate(current, kind) && (!min || current >= min) && (!max || current <= max))
            return false;
        const today = new Date().toISOString().slice(0, kind === "date" ? 10 : 16);
        const candidate = min && isValidRuntimeDate(min, kind) ? min : today;
        if (!isValidRuntimeDate(candidate, kind) || (min && candidate < min) || (max && candidate > max)) {
            throw new Error("No valid runtime date found within range.");
        }
        await locator.fill(candidate);
        return true;
    }
    if (capability.kind !== "datepicker")
        throw new Error("Supporting date strategy requires a date control.");
    if (capability.datepickerAmbiguous || !capability.controlsId) {
        throw new Error("Cannot resolve supporting datepicker structure.");
    }
    if (!capability.expanded) {
        await locator.click();
        capability = await observeRuntimeFieldCapability(locator);
    }
    const validCells = (capability.options ?? []).filter((option) => !option.disabled && isValidRuntimeDate(option.value, "date"));
    if (validCells.length === 0)
        throw new Error("No valid runtime date cell found.");
    if (validCells.some((cell) => cell.selected))
        return false;
    await locator.evaluate((element) => {
        const controlsId = element.getAttribute("aria-controls");
        const grid = controlsId ? document.getElementById(controlsId) : null;
        if (!grid || grid.getAttribute("role") !== "grid")
            throw new Error("Cannot resolve supporting datepicker structure.");
        const cell = Array.from(grid.querySelectorAll('[role="gridcell"]'))
            .find((candidate) => candidate.getAttribute("aria-disabled") !== "true" && !candidate.hasAttribute("disabled") && /^\d{4}-\d{2}-\d{2}$/.test(candidate.getAttribute("data-value") ?? candidate.getAttribute("value") ?? ""));
        if (!cell)
            throw new Error("No valid runtime date cell found.");
        cell.click();
    });
    return true;
}
async function ensureSupportingMultiselect(locator, input) {
    if (input.strategy !== "ensure_valid_selection")
        throw new Error(`Unsupported supporting multiselect strategy: ${input.strategy}`);
    const capability = await observeRuntimeFieldCapability(locator);
    if (capability.kind !== "multiselect")
        throw new Error("Supporting multiselect strategy requires a multiselect control.");
    if (capability.disabled)
        throw new Error("Cannot resolve supporting multiselect: control is disabled.");
    const validOptions = (capability.options ?? []).filter((option) => !option.disabled && Boolean(option.value?.trim()));
    if (validOptions.length === 0)
        throw new Error("No valid runtime multiselect option found.");
    if (validOptions.some((option) => option.selected))
        return false;
    if (capability.native) {
        await locator.selectOption([validOptions[0].value]);
    }
    else {
        await locator.evaluate((element) => {
            const option = Array.from(element.querySelectorAll('[role="option"]'))
                .find((candidate) => candidate.getAttribute("aria-disabled") !== "true" && !candidate.hasAttribute("disabled") && Boolean((candidate.getAttribute("data-value") ?? candidate.getAttribute("value") ?? "").trim()));
            if (!option)
                throw new Error("No valid runtime multiselect option found.");
            option.click();
        });
    }
    return true;
}
