"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractRuntimeUiSnapshot = extractRuntimeUiSnapshot;
const node_crypto_1 = require("node:crypto");
/**
 * Extract a lightweight UI snapshot from the current page.
 * No discovery — just captures visible navigation elements.
 */
async function extractRuntimeUiSnapshot(page) {
    const raw = await page.evaluate(String.raw `(() => {
    const els = Array.from(document.querySelectorAll("*")).filter(e => {
      const style = window.getComputedStyle(e);
      return style.display !== "none" && style.visibility !== "hidden" && e.getBoundingClientRect().width > 0;
    });

    const headings = [];
    const clickTargets = [];
    const businessLabels = [];
    const controls = [];
    const inputs = [];
    const selects = [];

    const clean = (value, max = 120) => (value || '').replace(/\s+/g, ' ').trim().slice(0, max);
    const attributesFor = (element) => {
      const names = ['id', 'name', 'type', 'aria-label', 'aria-labelledby', 'placeholder', 'data-testid', 'data-test-id', 'data-field', 'data-column', 'role'];
      return Object.fromEntries(names.flatMap((name) => {
        const value = element.getAttribute(name);
        return value ? [[name, value]] : [];
      }));
    };
    const structuralContext = (element) => {
      const row = element.closest('tr, [role="row"]');
      const cell = element.closest('td, th, [role="gridcell"], [role="cell"]');
      const table = element.closest('table, [role="grid"], [data-grid], [data-testid*="grid"], [data-testid*="table"]')
        || Array.from(document.querySelectorAll('*')).find((candidate) => {
          const style = window.getComputedStyle(candidate);
          return style.display === 'grid' && candidate.contains(element) && Boolean(candidate.querySelector('input, select, [role="row"], [data-row-id], [data-rowindex]'));
        });
      let headerContext = '';
      let columnIdentity = '';
      if (cell && table) {
        const explicit = cell.getAttribute('aria-colindex');
        const cells = row ? Array.from(row.querySelectorAll('td, th, [role="gridcell"], [role="cell"], [data-cell], [data-column]')) : [];
        const cellIndex = cells.indexOf(cell);
        const headers = Array.from(table.querySelectorAll('thead th, thead td, [role="columnheader"], [data-header], [data-column-header]'));
        const header = explicit ? headers.find((candidate) => candidate.getAttribute('aria-colindex') === explicit) : headers[cellIndex];
        headerContext = clean(header?.textContent);
        columnIdentity = clean(cell.getAttribute('data-column') || cell.getAttribute('data-field') || explicit || '');
      }
      const fieldset = element.closest('fieldset');
      const form = element.closest('form, [role="group"], [role="region"]');
      const legend = fieldset?.querySelector('legend');
      const containerContext = clean(
        legend?.textContent || form?.getAttribute('aria-label') || form?.getAttribute('data-label') || '',
      );
      const rowIdentity = clean(row?.getAttribute('aria-rowindex') || row?.getAttribute('data-row-id') || row?.getAttribute('data-rowindex') || row?.getAttribute('data-id') || '');
      const rowContext = clean(row?.getAttribute('aria-label') || row?.getAttribute('data-label') || '');
      const gridRef = table
        ? (table.getAttribute('data-testid') || table.getAttribute('data-test-id') || table.id || ('grid:' + (table.getAttribute('role') || table.tagName.toLowerCase())))
        : '';
      const rowRef = row
        ? (row.getAttribute('data-row-id') || row.getAttribute('data-id') || row.getAttribute('aria-rowindex') || row.getAttribute('data-rowindex') || clean(row.getAttribute('aria-label') || row.getAttribute('data-label') || ''))
        : '';
      const cellRef = cell
        ? (cell.getAttribute('data-cell-id') || cell.getAttribute('data-field') || cell.getAttribute('data-column') || [headerContext, rowRef, cell.getAttribute('aria-colindex') || 'cell'].filter(Boolean).join(':'))
        : '';
      const headerRef = headerContext ? 'header:' + headerContext : '';
      const containerIdentity = form
        ? (form.getAttribute('data-testid') || form.getAttribute('data-test-id') || form.id || ('container:' + (form.getAttribute('role') || form.tagName.toLowerCase())))
        : '';
      return { headerContext, columnIdentity, containerContext, rowIdentity, rowContext, gridRef, rowRef, cellRef, headerRef, containerIdentity };
    };

    const seenClick = new Set();
    const seenHeading = new Set();

    // Flat-string approximation of the accessible name: textContent concatenates
    // child text without separators (primary label + descriptive child become one
    // unresolvable token). Inserting a separator between element contributions
    // mirrors role/name matching so observed click targets stay localizable.
    // NOTE: no named function expressions — tsx wraps them with __name()
    // which does not exist in browser context.
    for (const el of els) {
      const tag = el.tagName.toLowerCase();
      const rawText = (el.textContent ?? "").trim();
      const role = el.getAttribute("role") ?? "";
      const ariaLabel = el.getAttribute("aria-label") ?? "";
      const placeholder = el.getAttribute("placeholder") ?? "";
      let accessibleName = '';
      let businessLabel = '';
      const associatedLabel = el.labels && el.labels.length
        ? Array.from(el.labels).map((label) => label.textContent || '').join(' ').replace(/\s+/g, ' ').trim()
        : '';
      const labelledBy = el.getAttribute('aria-labelledby')
        ? el.getAttribute('aria-labelledby').split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((node) => node.textContent || '').join(' ').replace(/\s+/g, ' ').trim()
        : '';
      if (associatedLabel) {
        accessibleName = associatedLabel;
        businessLabel = associatedLabel;
      } else if (labelledBy) {
        accessibleName = labelledBy;
        businessLabel = labelledBy;
      } else if (ariaLabel) {
        accessibleName = ariaLabel;
        businessLabel = ariaLabel;
      } else if (placeholder) {
        accessibleName = placeholder;
        businessLabel = placeholder;
      } else if (!accessibleName) {
        let flat = "";
        let primary = "";
        const stack = [el];
        while (stack.length > 0) {
          const node = stack.pop();
          if (node.nodeType === Node.TEXT_NODE) {
            flat += node.textContent ?? "";
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (flat) {
              if (!primary) primary = flat;
              flat += " ";
            }
            const kids = node.childNodes;
            for (let j = kids.length - 1; j >= 0; j--) stack.push(kids[j]);
          }
        }
        accessibleName = flat;
        businessLabel = primary || flat;
      }
      const text = accessibleName.replace(/\s+/g, " ").trim() || rawText;
      const cleanBusiness = businessLabel.replace(/\s+/g, " ").trim();

      // Headings
      if (/^h[1-6]$/.test(tag) && text.length > 1 && text.length < 100 && !seenHeading.has(text)) {
        seenHeading.add(text);
        headings.push(text);
      }

      // Clickable elements (buttons, links, roles)
      const isClickable = tag === "button" || tag === "a" || role === "button" || role === "link" || role === "menuitem";
      const isEditor = tag === 'input' || tag === 'textarea' || tag === 'select' || role === 'textbox' || role === 'combobox';
      if ((isClickable || isEditor) && accessibleName.length > 1 && accessibleName.length < 120 && !seenClick.has(tag + ':' + accessibleName)) {
        seenClick.add(tag + ':' + accessibleName);
        if (isClickable) clickTargets.push(accessibleName);
        const cleanBiz = cleanBusiness || accessibleName;
        businessLabels.push(cleanBiz);
        // Per-control identity — only genuinely observed signals, never invented.
        const href = tag === "a" ? (el.getAttribute("href") ?? undefined) : undefined;
        const stableId =
          el.getAttribute("data-testid") ||
          el.getAttribute("data-test-id") ||
          el.getAttribute("data-qa") ||
          (el.id ? el.id : undefined);
        const dataToggle = el.getAttribute("data-toggle") ?? undefined;
        const ariaSelected = el.getAttribute("aria-selected");
        const ariaPressed = el.getAttribute("aria-pressed");
        const parentRole = el.parentElement?.getAttribute("role") ?? undefined;
        const context = structuralContext(el);
        controls.push({
          label: accessibleName,
          businessLabel: cleanBiz,
          ...(stableId ? { locatorIdentity: stableId } : {}),
          ...(href ? { href } : {}),
          role: role || tag,
          ...(dataToggle ? { dataToggle } : {}),
          ...(ariaSelected !== null ? { ariaSelected } : {}),
          ...(ariaPressed !== null ? { ariaPressed } : {}),
          ...(parentRole ? { parentRole } : {}),
          tag,
          ...(placeholder ? { placeholder } : {}),
          attributes: attributesFor(el),
          ...(context.containerContext ? { containerContext: context.containerContext } : {}),
          ...(context.headerContext ? { headerContext: context.headerContext, associatedField: context.headerContext } : {}),
          ...(context.rowContext ? { rowContext: context.rowContext } : {}),
          ...(context.rowIdentity ? { rowIdentity: context.rowIdentity } : {}),
          ...(context.columnIdentity ? { columnIdentity: context.columnIdentity } : {}),
          ...(context.gridRef ? { gridRef: context.gridRef } : {}),
          ...(context.rowRef ? { rowRef: context.rowRef } : {}),
          ...(context.cellRef ? { cellRef: context.cellRef } : {}),
          ...(context.headerRef ? { headerRef: context.headerRef } : {}),
          ...(context.containerIdentity ? { containerIdentity: context.containerIdentity } : {}),
        });
      }

      // Input labels
      if ((tag === "input" || tag === "textarea") && (ariaLabel || text)) {
        inputs.push(ariaLabel || text);
      }

      // Select labels
      if (tag === "select" && (ariaLabel || text)) {
        selects.push(ariaLabel || text);
      }
    }

    // Also look for labels associated with inputs
    for (const el of els) {
      if (el.tagName.toLowerCase() === "label") {
        const forAttr = el.htmlFor;
        if (forAttr && document.getElementById(forAttr)) {
          const labelText = (el.textContent ?? "").trim();
          if (labelText && !inputs.includes(labelText)) inputs.push(labelText);
        }
      }
    }

    const explicitGrids = Array.from(document.querySelectorAll('table, [role="grid"], [data-grid], [data-testid*="grid"], [data-testid*="table"]'));
    const layoutGrids = Array.from(document.querySelectorAll('*')).filter((element) => {
      const style = window.getComputedStyle(element);
      return style.display === 'grid' && Boolean(element.querySelector('input, select, [role="row"], [data-row-id], [data-rowindex]'));
    });
    const grids = Array.from(new Set([...explicitGrids, ...layoutGrids]));
    const headers = Array.from(document.querySelectorAll('thead th, thead td, [role="columnheader"], [data-header], [data-column-header]')).map((header) => clean(header.textContent)).filter(Boolean);
    const relationships = [];
    for (const control of controls) {
      if (control.headerContext) relationships.push({ header: control.headerContext, field: control.associatedField || control.label });
    }
    const gridMetadata = {
      detected: grids.length > 0,
      grids: grids.length,
      rows: grids.reduce((total, grid) => total + grid.querySelectorAll('tr, [role="row"], [data-row-id], [data-rowindex]').length, 0),
      cells: grids.reduce((total, grid) => total + grid.querySelectorAll('td, th, [role="gridcell"], [role="cell"], [data-cell], [data-column]').length, 0),
      headers: Array.from(new Set(headers)),
      headerRelationships: relationships,
    };
    return { headings, clickTargets, businessLabels, controls, inputs, selects, gridMetadata };
  })()`);
    const url = page.url().split("?")[0]; // Strip query params
    const clickKey = raw.clickTargets.slice(0, 8).join("|").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const screenKey = (0, node_crypto_1.createHash)("sha256").update(`ui:${url}:${raw.headings[0] ?? ""}:${clickKey}`).digest("hex").slice(0, 12);
    console.log(`[runtime-knowledge] snapshot captured screen=${screenKey} clicks=${raw.clickTargets.length} inputs=${raw.inputs.length}`);
    // Attach the observing screen to each structured control. No destination is
    // ever inferred here — destinationScreenKey comes only from real transitions.
    const observedControls = raw.controls.slice(0, 20).map((c) => ({ ...c, sourceScreenKey: screenKey }));
    return {
        screenKey,
        url,
        headings: raw.headings.slice(0, 5),
        clickTargets: raw.clickTargets.slice(0, 20),
        businessLabels: (raw.businessLabels ?? []).slice(0, 20),
        observedControls,
        assertionTargets: raw.headings.slice(0, 3),
        inputLabels: raw.inputs.slice(0, 10),
        selectLabels: raw.selects.slice(0, 5),
        gridMetadata: raw.gridMetadata,
        capturedAt: new Date().toISOString(),
    };
}
