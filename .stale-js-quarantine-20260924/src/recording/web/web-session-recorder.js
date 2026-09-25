"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebSessionRecorder = exports.CAPTURE_SCRIPT = void 0;
exports.fingerprintSnapshot = fingerprintSnapshot;
exports.buildWebRecorderContextOptions = buildWebRecorderContextOptions;
exports.isSensitiveField = isSensitiveField;
exports.buildWebLocators = buildWebLocators;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const test_1 = require("@playwright/test");
const runtime_knowledge_extractor_1 = require("../../knowledge/runtime-knowledge-extractor");
/**
 * Structural identity of a page state.
 *
 * Built from the SHAPE of the controls (their roles and identities), never from their text
 * content: a list that renders different rows is the same screen, while a form that gains a
 * field is not. Sorting makes it order-independent, so a re-render that reshuffles the DOM
 * does not read as navigation.
 */
function fingerprintSnapshot(snapshot) {
    const canonical = snapshot.observedControls
        .map((c) => [c.role ?? "", c.locatorIdentity ?? "", c.href ?? ""].join("|"))
        .concat(snapshot.inputLabels.map((l) => `input|${l}`))
        .concat(snapshot.selectLabels.map((l) => `select|${l}`))
        .sort()
        .join(";");
    return (0, node_crypto_1.createHash)("sha256").update(canonical).digest("hex");
}
function buildWebRecorderContextOptions(ignoreHTTPSErrors) {
    return { ignoreHTTPSErrors: ignoreHTTPSErrors === true };
}
const SECRET_FIELD_TOKENS = [
    "clave", "contrasena", "contraseña", "password", "pin", "otp", "token", "cvv", "secret",
];
function normalizeLabel(raw) {
    return raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}
function isSensitiveField(interaction, extra = []) {
    if (interaction.inputType === "password")
        return true;
    const haystack = normalizeLabel([interaction.label, interaction.name, interaction.domId, interaction.ariaLabel, interaction.placeholder]
        .filter(Boolean)
        .join(" "));
    return [...SECRET_FIELD_TOKENS, ...extra.map(normalizeLabel)].some((needle) => needle.length > 0 && haystack.includes(needle));
}
/** Confidence for an identity the page reported as matching more than one element. */
const AMBIGUOUS_CONFIDENCE = 0.5;
/**
 * Ranks locators for a recorded element.
 *
 * Same order the framework's own resolver prefers, so a recorded step and a discovered step
 * are indistinguishable downstream: an explicit test id first, then the accessible name,
 * then structural fallbacks. Visible text ranks above CSS because the app's markup churns
 * far more often than its copy.
 *
 * That order is then re-sorted by what the page measured: an identity shared with other
 * elements is demoted below every identity that singled the element out, because a locator
 * that matches three buttons sends the generated step to whichever the runner finds first.
 *
 * Unlike Android — where UiSelector expresses `.instance(n)` natively — a shared identity is
 * reported here, not rewritten: the web plan schema has no index, so inventing one would
 * produce a step the promoter cannot emit. The flag drops the confidence below the threshold
 * that marks a scenario as uncertain, which is what surfaces it to the reviewer.
 */
function buildWebLocators(interaction) {
    const ranks = interaction.ranks ?? {};
    const candidates = [];
    if (interaction.testId) {
        candidates.push({ key: "testId", locator: { strategy: "data-testid", value: interaction.testId, confidence: 0.98 } });
    }
    if (interaction.ariaLabel) {
        candidates.push({ key: "ariaLabel", locator: { strategy: "aria-label", value: interaction.ariaLabel, confidence: 0.9 } });
    }
    if (interaction.role && interaction.label) {
        candidates.push({
            key: "role",
            locator: { strategy: "role", value: `${interaction.role}|${interaction.label}`, confidence: 0.85 },
        });
    }
    if (interaction.domId) {
        candidates.push({ key: "domId", locator: { strategy: "css", value: `#${interaction.domId}`, confidence: 0.8 } });
    }
    if (interaction.text && interaction.text.length <= 80) {
        candidates.push({ key: "text", locator: { strategy: "text", value: interaction.text, confidence: 0.7 } });
    }
    if (interaction.name) {
        candidates.push({ key: "name", locator: { strategy: "css", value: `[name="${interaction.name}"]`, confidence: 0.65 } });
    }
    // Dynamic compound editors often expose no durable label/id on the editable child. Keep a
    // structural candidate so a later runtime can re-resolve by grid/header/cell context rather
    // than falling back to a parent display value, position, or ephemeral popup id.
    const structural = interaction.technicalTargetCandidates?.flatMap((candidate) => candidate.locatorCandidates)
        .filter((locator) => locator.strategy === "structural") ?? [];
    if (structural.length > 0) {
        candidates.push(...structural.map((locator, index) => ({ key: `structural${index}`, locator })));
    }
    else if (interaction.compoundRole === "amount_or_text" && (interaction.cellRef || interaction.headerContext || interaction.gridRef)) {
        candidates.push({
            key: "structural",
            locator: {
                strategy: "structural",
                value: [
                    interaction.gridRef ? `grid=${interaction.gridRef}` : "",
                    interaction.rowIdentity || interaction.rowRef ? `row=${interaction.rowIdentity || interaction.rowRef}` : "",
                    interaction.cellRef ? `cell=${interaction.cellRef}` : "",
                    interaction.headerRef || interaction.headerContext ? `header=${interaction.headerRef || interaction.headerContext}` : "",
                    "role=amount_or_text",
                ].filter(Boolean).join("|"),
                confidence: 0.72,
            },
        });
    }
    const unique = [];
    const shared = [];
    for (const { key, locator } of candidates) {
        const rank = ranks[key];
        if (!rank || rank.count <= 1) {
            unique.push(locator);
            continue;
        }
        shared.push({ ...locator, confidence: AMBIGUOUS_CONFIDENCE, ambiguous: true, matchIndex: rank.index });
    }
    return [...unique, ...shared];
}
/**
 * The page-side capture script.
 *
 * Listeners are registered in the capture phase so an app that calls `stopPropagation` in its
 * own handler cannot hide the interaction from the recorder. Password values follow the
 * project-scoped QA recording policy: the page exposes them only when the recorder explicitly
 * enables persistence, and the recorder never writes them to interaction logs or console output.
 */
const CAPTURE_SCRIPT_LEGACY = `
(() => {
  if (window.__qaRecorderInstalled) return;
  window.__qaRecorderInstalled = true;

  const accessibleName = (el) => {
    const aria = el.getAttribute && el.getAttribute('aria-label');
    if (aria) return aria.trim();
    if (el.labels && el.labels.length) return (el.labels[0].textContent || '').trim();
    const placeholder = el.getAttribute && el.getAttribute('placeholder');
    if (placeholder) return placeholder.trim();
    const title = el.getAttribute && el.getAttribute('title');
    if (title) return title.trim();
    const text = (el.innerText || el.textContent || '').trim();
    return text.slice(0, 120);
  };

  const quote = (v) => String(v).replace(/["\\\\]/g, '\\\\$&');
  const clean = (value, max) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, max || 120);
  const attributesFor = (el) => {
    const names = ['id','name','type','aria-label','aria-labelledby','placeholder','data-testid','data-test-id','data-field','data-column','role'];
    const result = {};
    names.forEach((name) => { const value = el.getAttribute && el.getAttribute(name); if (value) result[name] = value; });
    return result;
  };
  const structuralContext = (el) => {
    const row = el.closest && el.closest('tr, [role="row"]');
    const cell = el.closest && el.closest('td, th, [role="gridcell"], [role="cell"]');
    const table = el.closest && el.closest('table, [role="grid"], [data-grid], [data-testid*="grid"], [data-testid*="table"]');
    let headerContext = '';
    let columnIdentity = '';
    if (cell && table) {
      const explicit = cell.getAttribute('aria-colindex');
      const cells = row ? Array.from(row.querySelectorAll('td, th, [role="gridcell"], [role="cell"], [data-cell], [data-column]')) : [];
      const cellIndex = cells.indexOf(cell);
      const headers = Array.from(table.querySelectorAll('thead th, thead td, [role="columnheader"], [data-header], [data-column-header]'));
      const header = explicit ? headers.find((candidate) => candidate.getAttribute('aria-colindex') === explicit) : headers[cellIndex];
      headerContext = clean(header && header.textContent);
      columnIdentity = clean(cell.getAttribute('data-column') || cell.getAttribute('data-field') || explicit || '');
    }
    const fieldset = el.closest && el.closest('fieldset');
    const form = el.closest && el.closest('form, [role="group"], [role="region"]');
    const legend = fieldset && fieldset.querySelector('legend');
    const containerContext = clean((legend && legend.textContent) || (form && (form.getAttribute('aria-label') || form.getAttribute('data-label'))) || '');
    const rowIdentity = clean((row && (row.getAttribute('aria-rowindex') || row.getAttribute('data-row-id') || row.getAttribute('data-rowindex') || row.getAttribute('data-id'))) || '');
    const rowContext = clean((row && (row.getAttribute('aria-label') || row.getAttribute('data-label'))) || '');
    return { headerContext, columnIdentity, containerContext, rowIdentity, rowContext };
  };

  const optionValues = (el) => {
    const owner = el.closest && el.closest('select, [role="combobox"], [role="listbox"], [data-options]');
    if (!owner) return [];
    return Array.from(owner.querySelectorAll('option, [role="option"], [data-option]'))
      .map((option) => clean(option.textContent || option.getAttribute('aria-label') || option.getAttribute('data-option') || option.value || '', 80))
      .filter(Boolean).slice(0, 20);
  };

  // How many elements this identity matches, and which one was interacted with. Measured
  // here because only the live document can answer it; reconstructing it later from the
  // recorded attributes would be a guess about a page that has since moved on.
  const rank = (el, selector, filter) => {
    try {
      var list = Array.prototype.slice.call(document.querySelectorAll(selector));
      if (filter) list = list.filter(filter);
      var index = list.indexOf(el);
      if (index < 0) return undefined;
      return { count: list.length, index: index };
    } catch (e) {
      return undefined;
    }
  };

  const ranksFor = (el) => {
    const ranks = {};
    const testId = el.getAttribute ? (el.getAttribute('data-testid') || el.getAttribute('data-test-id')) : null;
    if (testId) {
      ranks.testId = rank(el, '[data-testid="' + quote(testId) + '"], [data-test-id="' + quote(testId) + '"]');
    }
    const aria = el.getAttribute ? el.getAttribute('aria-label') : null;
    if (aria) ranks.ariaLabel = rank(el, '[aria-label="' + quote(aria) + '"]');
    const role = el.getAttribute ? el.getAttribute('role') : null;
    const label = accessibleName(el);
    if (role && label) {
      ranks.role = rank(el, '[role="' + quote(role) + '"]', (n) => accessibleName(n) === label);
    }
    if (el.id) ranks.domId = rank(el, '[id="' + quote(el.id) + '"]');
    const text = (el.innerText || el.textContent || '').trim().slice(0, 120);
    if (text && el.tagName) {
      ranks.text = rank(el, el.tagName.toLowerCase(), (n) => (n.innerText || n.textContent || '').trim().slice(0, 120) === text);
    }
    if (el.name) ranks.name = rank(el, '[name="' + quote(el.name) + '"]');
    return ranks;
  };

  const describe = (el, kind, value, valueSource) => ({
    kind,
    label: accessibleName(el),
    ranks: ranksFor(el),
    role: el.getAttribute ? (el.getAttribute('role') || undefined) : undefined,
    tagName: el.tagName ? el.tagName.toLowerCase() : undefined,
    inputType: el.type || undefined,
    disabled: el.disabled === true,
    value: (el.type === 'password' && !window.__qaRecorderPersistQaCredentials) ? undefined : value,
    valueSource,
    testId: el.getAttribute ? (el.getAttribute('data-testid') || el.getAttribute('data-test-id') || undefined) : undefined,
    domId: el.id || undefined,
    name: el.name || undefined,
    ariaLabel: el.getAttribute ? (el.getAttribute('aria-label') || undefined) : undefined,
    text: (el.innerText || el.textContent || '').trim().slice(0, 120) || undefined,
    placeholder: el.getAttribute ? (el.getAttribute('placeholder') || undefined) : undefined,
    attributes: attributesFor(el),
    ...structuralContext(el),
    associatedField: structuralContext(el).headerContext || undefined,
    afterValue: kind === 'input' && (el.tagName || '').toLowerCase() === 'select'
      ? (el.selectedOptions && el.selectedOptions[0] ? (el.selectedOptions[0].textContent || el.value) : el.value)
      : ((el.getAttribute && el.getAttribute('role') === 'option') ? (el.textContent || el.getAttribute('aria-label') || undefined) : undefined),
    observedOptions: optionValues(el),
    href: el.getAttribute ? (el.getAttribute('href') || undefined) : undefined,
  });

  const send = (payload) => {
    try { window.__qaRecord(payload); } catch (e) { /* binding not ready yet */ }
  };

  document.addEventListener('click', (e) => {
    const el = e.target && e.target.closest
      ? (e.target.closest('button, a, [role="button"], [role="option"], input, select, label, [onclick]') || e.target)
      : e.target;
    if (el) send(describe(el, 'click', undefined, 'user'));
  }, true);

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el) return;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      send(describe(el, 'input', el.value, e.isTrusted ? 'user' : 'application'));
    }
  }, true);

  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el) return;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      send(describe(el, 'input', el.value, e.isTrusted ? 'user' : 'application'));
    }
  }, true);

  document.addEventListener('submit', (e) => {
    if (e.target) send(describe(e.target, 'submit', undefined, e.isTrusted ? 'user' : 'application'));
  }, true);
})();
`;
/**
 * V1 technical capture. The page emits raw interaction evidence plus bounded, narrow
 * before/after observations. Focus, mutation and post-action records are notes, never user
 * steps; the semantic layer decides which observations become reusable technical knowledge.
 */
exports.CAPTURE_SCRIPT = String.raw `
(() => {
  if (window.__qaRecorderInstalledV1) return;
  window.__qaRecorderInstalledV1 = true;

  const clean = (value, max = 160) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const text = (el) => clean(el && (el.innerText || el.textContent || ''));
  const attr = (el, name) => el && el.getAttribute ? (el.getAttribute(name) || undefined) : undefined;
  const visible = (el) => {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  };
  const labelFor = (el) => {
    if (!el) return '';
    if (el.labels && el.labels.length) {
      const label = clean(Array.from(el.labels).map((item) => item.textContent || '').join(' '));
      if (label) return label;
    }
    const labelledBy = attr(el, 'aria-labelledby');
    if (labelledBy) {
      const label = clean(labelledBy.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((item) => item.textContent || '').join(' '));
      if (label) return label;
    }
    const aria = attr(el, 'aria-label');
    if (aria) return clean(aria);
    const placeholder = attr(el, 'placeholder');
    if (placeholder) return clean(placeholder);
    const title = attr(el, 'title');
    if (title) return clean(title);
    return text(el);
  };
  const valueOf = (el) => {
    if (!el) return undefined;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (el.type === 'password' && !window.__qaRecorderPersistQaCredentials) return undefined;
      if (tag === 'select' && el.selectedOptions && el.selectedOptions[0]) return clean(el.selectedOptions[0].textContent || el.value);
      return typeof el.value === 'string' ? el.value : undefined;
    }
    if (el.isContentEditable) return text(el);
    return undefined;
  };
  const boundsOf = (el) => {
    if (!el || !el.getBoundingClientRect) return undefined;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  };
  const ariaOf = (el) => {
    const result = {};
    if (!el || !el.attributes) return result;
    Array.from(el.attributes).forEach((item) => { if (item.name.indexOf('aria-') === 0) result[item.name] = clean(item.value, 120); });
    return result;
  };
  const identityOf = (el, fallback) => attr(el, 'data-testid') || attr(el, 'data-test-id') || attr(el, 'data-qa') || attr(el, 'id') || attr(el, 'name') || fallback;
  const closest = (el, selector) => el && el.closest ? el.closest(selector) : null;
  const gridRootOf = (el) => {
    const explicit = closest(el, 'table, [role="grid"], [data-grid], [data-testid*="grid"], [data-testid*="table"]');
    if (explicit) return explicit;
    let node = el && el.parentElement;
    while (node) {
      if (window.getComputedStyle(node).display === 'grid' && node.querySelector('input, textarea, [role="row"], [data-row-id], [data-rowindex]')) return node;
      node = node.parentElement;
    }
    return null;
  };
  const structural = (el) => {
    const row = closest(el, 'tr, [role="row"], [data-row-id], [data-rowindex]');
    const cell = closest(el, 'td, th, [role="gridcell"], [role="cell"], [data-cell], [data-column]');
    const grid = gridRootOf(el);
    let header = attr(cell, 'data-column') || attr(cell, 'data-field') || attr(cell, 'aria-colindex') || '';
    if (!header && grid) {
      const explicit = attr(cell, 'aria-colindex');
      const siblingCells = row ? Array.from(row.querySelectorAll('td, th, [role="gridcell"], [role="cell"], [data-cell], [data-column]')) : [];
      const cellIndex = siblingCells.indexOf(cell);
      const headers = Array.from(grid.querySelectorAll('thead th, thead td, [role="columnheader"], [data-header], [data-column-header]'));
      const headerNode = explicit ? headers.find((item) => attr(item, 'aria-colindex') === explicit) : headers[cellIndex];
      header = labelFor(headerNode);
    }
    if (!header) header = labelFor(el);
    const rowNodes = grid ? Array.from(grid.querySelectorAll('tr, [role="row"], [data-row-id], [data-rowindex]')) : [];
    const rowIndex = row ? rowNodes.indexOf(row) : -1;
    const rowRef = row ? identityOf(row, 'row:' + (rowIndex >= 0 ? String(rowIndex + 1) : 'unknown')) : undefined;
    const gridRef = grid ? identityOf(grid, 'grid:' + (grid.getAttribute('role') || grid.tagName.toLowerCase())) : undefined;
    const rect = boundsOf(cell || el);
    const cellRef = cell ? identityOf(cell, 'cell:' + clean(header, 80) + ':' + (rowRef || 'unknown')) : undefined;
    const container = closest(el, 'fieldset, form, [role="dialog"], [role="region"], [role="group"]');
    return {
      gridRef,
      rowRef,
      cellRef,
      headerRef: header ? 'header:' + clean(header, 100) : undefined,
      headerContext: header || undefined,
      rowIdentity: rowRef,
      rowContext: row ? clean(attr(row, 'aria-label') || attr(row, 'data-label') || '') : undefined,
      columnIdentity: attr(cell, 'data-column') || attr(cell, 'data-field') || attr(cell, 'aria-colindex') || undefined,
      containerIdentity: container ? identityOf(container, 'container:' + (container.getAttribute('role') || container.tagName.toLowerCase())) : undefined,
      containerContext: container ? clean(attr(container, 'aria-label') || attr(container, 'data-label') || (container.querySelector('legend') && container.querySelector('legend').textContent) || '') : undefined,
    };
  };
  const optionsFor = (el) => {
    const expanded = closest(el, '[aria-expanded="true"]');
    const controlId = expanded && attr(expanded, 'aria-controls');
    const controlled = controlId ? document.getElementById(controlId) : null;
    const root = controlled
      || closest(el, '[role="listbox"], [role="combobox"], [data-options], [aria-controls]')
      || (expanded && expanded.parentElement)
      || document.querySelector('[role="listbox"], [data-options]');
    if (!root) return [];
    return Array.from(root.querySelectorAll('option, [role="option"], [data-option], [data-value], li[aria-selected], li'))
      .filter(visible)
      .map((item) => clean(item.textContent || attr(item, 'aria-label') || attr(item, 'data-option') || attr(item, 'data-value') || item.value, 100))
      .filter(Boolean)
      .filter((item, index, all) => all.indexOf(item) === index)
      .slice(0, 30);
  };
  const optionSurfaceFor = (el) => {
    const control = closest(el, '[aria-controls]');
    const controlled = control && attr(control, 'aria-controls') ? document.getElementById(attr(control, 'aria-controls')) : null;
    const surface = controlled || closest(el, '[role="listbox"], [data-options]') || document.querySelector('[role="listbox"], [data-options]');
    if (!surface || !visible(surface)) return undefined;
    return snapshotOf(surface);
  };
  const snapshotOf = (el) => {
    if (!el) return undefined;
    const tag = (el.tagName || '').toLowerCase();
    return {
      tag,
      role: attr(el, 'role') || tag,
      id: attr(el, 'id'),
      name: attr(el, 'name'),
      label: labelFor(el),
      placeholder: attr(el, 'placeholder'),
      value: valueOf(el),
      inputValue: valueOf(el),
      committedValue: valueOf(el),
      displayValue: attr(el, 'data-display-value') || attr(el, 'aria-valuetext') || undefined,
      text: text(el, 120),
      aria: ariaOf(el),
      selected: attr(el, 'aria-selected') === 'true' || el.selected === true,
      bounds: boundsOf(el),
    };
  };
  const targetRefOf = (el, context) => identityOf(el, [context.gridRef, context.rowRef, context.cellRef, labelFor(el)].filter(Boolean).join('|'));
  const elementOf = (node) => node && node.nodeType === 1 ? node : node && node.parentElement;
  const isEditable = (el) => {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable
      || ['textbox', 'combobox'].includes(attr(el, 'role'));
  };
  const stableAttributesFor = (el) => {
    const names = ['data-testid', 'data-test-id', 'name', 'type', 'aria-label', 'aria-labelledby', 'role', 'data-field', 'data-column'];
    return Object.fromEntries(names.map((name) => [name, attr(el, name)]).filter((entry) => entry[1]));
  };
  const targetCandidatesFor = (el, observedKind) => {
    if (!el) return [];
    const context = structural(el);
    const tag = (el.tagName || '').toLowerCase();
    const role = attr(el, 'role') || '';
    const editable = isEditable(el);
    const selection = role === 'combobox' || role === 'option' || tag === 'select' || Boolean(attr(el, 'aria-haspopup'));
    const semanticRole = selection ? (role === 'combobox' || tag === 'select' ? 'selection' : 'selection') : editable ? 'amount_or_text' : 'display';
    const locatorCandidates = [];
    const testId = attr(el, 'data-testid') || attr(el, 'data-test-id');
    const ariaLabel = attr(el, 'aria-label');
    const name = attr(el, 'name');
    if (testId) locatorCandidates.push({ strategy: 'data-testid', value: testId, confidence: 0.98 });
    if (ariaLabel) locatorCandidates.push({ strategy: 'aria-label', value: ariaLabel, confidence: 0.9 });
    if (name) locatorCandidates.push({ strategy: 'css', value: '[name="' + name.replace(/"/g, '\\"') + '"]', confidence: 0.65 });
    if (editable && (context.gridRef || context.cellRef || context.headerRef)) {
      const structuralValue = [
        context.gridRef ? 'grid=' + context.gridRef : '',
        context.rowIdentity ? 'row=' + context.rowIdentity : '',
        context.cellRef ? 'cell=' + context.cellRef : '',
        context.headerRef || context.headerContext ? 'header=' + (context.headerRef || context.headerContext) : '',
        'role=' + semanticRole,
      ].filter(Boolean).join('|');
      locatorCandidates.push({ strategy: 'structural', value: structuralValue, confidence: 0.72 });
    }
    return [{
      targetType: editable ? 'editable' : selection ? 'selection' : 'display',
      semanticRole,
      locatorCandidates,
      structuralContext: {
        gridRef: context.gridRef,
        rowRef: context.rowRef,
        cellRef: context.cellRef,
        headerRef: context.headerRef,
        containerRef: context.containerIdentity,
      },
      stableAttributes: stableAttributesFor(el),
      interactionEvidence: [observedKind, targetRefOf(el, context)].filter(Boolean),
      lifecycleRef: targetRefOf(el, context) + ':' + semanticRole,
      confidence: locatorCandidates.length > 0 ? 0.9 : 0.45,
      validatedByInteraction: observedKind === 'input' || observedKind === 'click',
    }];
  };
  const deepestEditableFromEvent = (event) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    return path.map(elementOf).find(isEditable);
  };
  const eventContext = (event, fallback) => {
    const path = (typeof event.composedPath === 'function' ? event.composedPath() : [event.target])
      .map(elementOf).filter(Boolean);
    const refs = path.map((node) => {
      try { return targetRefOf(node, structural(node)); } catch (e) { return undefined; }
    }).filter(Boolean);
    const eventElement = elementOf(event.target) || fallback;
    const currentElement = elementOf(event.currentTarget) || fallback;
    const deepest = deepestEditableFromEvent(event) || fallback;
    return {
      eventTargetRef: eventElement ? targetRefOf(eventElement, structural(eventElement)) : undefined,
      currentTargetRef: currentElement ? targetRefOf(currentElement, structural(currentElement)) : undefined,
      composedPathRefs: refs.slice(0, 16),
      deepestEditableTargetRef: deepest ? targetRefOf(deepest, structural(deepest)) : undefined,
    };
  };
  const mutationLog = [];
  const mutationObserver = new MutationObserver((records) => {
    records.slice(0, 12).forEach((record) => {
      const target = record.target && record.target.nodeType === 1 ? record.target : null;
      mutationLog.push({ type: record.type, target: target ? targetRefOf(target, structural(target)) : undefined, attributeName: record.attributeName || undefined, added: record.addedNodes ? record.addedNodes.length : 0, removed: record.removedNodes ? record.removedNodes.length : 0 });
    });
    while (mutationLog.length > 32) mutationLog.shift();
  });
  try { mutationObserver.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded', 'aria-controls', 'aria-selected', 'class', 'value'] }); } catch (e) { /* page may not have a documentElement yet */ }

  const describe = (el, kind, valueSource, interactionType) => {
    const context = structural(el);
    const beforeState = snapshotOf(el);
    const activeBefore = snapshotOf(document.activeElement);
    const targetRef = targetRefOf(el, context);
    const role = attr(el, 'role') || (el.tagName || '').toLowerCase();
    const optionValue = role === 'option' ? clean(el.textContent || attr(el, 'aria-label') || el.value) : undefined;
    const isSelection = role === 'option' || role === 'combobox' || (el.tagName || '').toLowerCase() === 'select' || Boolean(attr(el, 'aria-haspopup'));
    const compoundRole = isSelection ? 'selection' : ((el.tagName || '').toLowerCase() === 'input' || (el.tagName || '').toLowerCase() === 'textarea' || el.isContentEditable ? 'amount_or_text' : undefined);
    return {
      kind,
      label: labelFor(el),
      role,
      tagName: (el.tagName || '').toLowerCase(),
      inputType: el.type || undefined,
      disabled: el.disabled === true,
      value: valueOf(el),
      inputValue: valueOf(el),
      displayValue: attr(el, 'data-display-value') || attr(el, 'aria-valuetext') || undefined,
      valueSource,
      interactionType: interactionType || (optionValue ? 'select' : 'click'),
      compoundRole,
      testId: attr(el, 'data-testid') || attr(el, 'data-test-id'),
      domId: attr(el, 'id'),
      name: attr(el, 'name'),
      ariaLabel: attr(el, 'aria-label'),
      text: text(el),
      placeholder: attr(el, 'placeholder'),
      attributes: Object.fromEntries(Array.from(el.attributes || []).filter((item) => ['id','name','type','aria-label','aria-labelledby','placeholder','data-testid','data-test-id','data-field','data-column','role','aria-expanded','aria-controls','aria-haspopup'].indexOf(item.name) >= 0).map((item) => [item.name, item.value])),
      ...context,
      associatedField: context.headerContext || labelFor(el),
      beforeValue: beforeState && beforeState.value,
      afterValue: optionValue || ((el.tagName || '').toLowerCase() === 'select' ? valueOf(el) : undefined),
      observedOptions: optionsFor(el),
      beforeState,
      activeElementBefore: activeBefore,
      stateDelta: { value: beforeState && beforeState.value, ariaExpanded: attr(el, 'aria-expanded'), ariaSelected: attr(el, 'aria-selected') },
      dynamicLifecycle: isSelection ? { activatedTechnicalTarget: targetRef, options: optionsFor(el), selectedOption: optionValue, committedState: valueOf(el) } : undefined,
      targetRef,
      technicalTargetCandidates: targetCandidatesFor(el, kind),
    };
  };
  const send = (payload) => { try { window.__qaRecord(payload); } catch (e) { /* binding not ready */ } };
  const schedulePostAction = (el, before, activeBefore, triggerRef) => {
    const started = performance.now();
    setTimeout(() => {
      const after = snapshotOf(el);
      const activeAfter = snapshotOf(document.activeElement);
      const context = structural(el);
      const optionSurface = optionSurfaceFor(el);
      const options = optionsFor(el);
      send({ kind: 'observation', observationType: 'post_action', label: labelFor(el), role: attr(el, 'role') || (el.tagName || '').toLowerCase(), tagName: (el.tagName || '').toLowerCase(), ...context, beforeState: before, afterState: after, activeElementBefore: activeBefore, activeElementAfter: activeAfter, dynamicLifecycle: { triggerTechnicalTarget: triggerRef, activatedTechnicalTarget: targetRefOf(document.activeElement, structural(document.activeElement)), optionSurface, options, selectedOption: after && after.selected ? after.label : undefined, committedState: after && after.value !== undefined ? after.value : undefined, focusTransfer: { from: activeBefore && activeBefore.id, to: activeAfter && activeAfter.id }, mutationSummary: mutationLog.slice(-12).map((item) => item.type + (item.attributeName ? ':' + item.attributeName : '')), observationWindowMs: Math.round(performance.now() - started) } });
    }, 180);
  };
  const interactive = (node) => {
    const element = elementOf(node);
    return element && element.closest ? element.closest('button, a, input, textarea, select, label, [role="button"], [role="option"], [role="combobox"], [role="textbox"], [contenteditable="true"], [onclick]') : null;
  };
  // A real user click can land on a decorative descendant (e.g. an image inside a card)
  // whose functional control is an ancestor that is not a native interactive element.
  // Walk up to the nearest ancestor that is either natively actionable or carries a
  // stable technical identity, so the functional target is captured instead of noise.
  const actionableAncestor = (node) => {
    let element = elementOf(node);
    let depth = 0;
    while (element && depth < 6) {
      if (element.matches && element.matches('button, a, input, textarea, select, label, [role="button"], [role="link"], [role="option"], [role="tab"], [contenteditable="true"], [onclick]')) {
        return element;
      }
      const hasStableIdentity = Boolean(attr(element, 'data-testid') || attr(element, 'data-test-id') || attr(element, 'data-qa') || attr(element, 'id') || attr(element, 'name') || attr(element, 'href') || attr(element, 'aria-label'));
      if (hasStableIdentity && element !== elementOf(node))
        return element;
      element = element.parentElement;
      depth += 1;
    }
    return null;
  };
  const lastValues = new Map();
  // Keep the user's logical input separate from a mask/currency display value. This is a
  // best-effort event reconstruction; the committed DOM value remains evidence, never its
  // replacement. In particular, no separator-stripping heuristic is applied here.
  const rawValues = new Map();
  const beforeInputs = new Map();
  let lastSelectionContext;

  const logicalInputAfter = (previous, event) => {
    const type = event && event.inputType || '';
    const data = event && event.data != null ? String(event.data) : '';
    if (type === 'deleteContentBackward') return String(previous || '').slice(0, -1);
    if (type === 'deleteContentForward') return String(previous || '').slice(1);
    if (type === 'insertReplacementText') return data;
    if (type.indexOf('insert') === 0) return String(previous || '') + data;
    return undefined;
  };

  document.addEventListener('focusin', (event) => {
    const el = deepestEditableFromEvent(event) || interactive(event.target) || elementOf(event.target);
    if (el) send({ ...describe(el, 'observation', 'application'), ...eventContext(event, el), kind: 'observation', observationType: 'focus' });
  }, true);
  document.addEventListener('focusout', (event) => {
    const el = deepestEditableFromEvent(event) || interactive(event.target) || elementOf(event.target);
    if (el) send({ ...describe(el, 'observation', 'application'), ...eventContext(event, el), kind: 'observation', observationType: 'focus' });
  }, true);
  document.addEventListener('beforeinput', (event) => {
    const el = deepestEditableFromEvent(event) || elementOf(event.target);
    if (el && (el.value !== undefined || el.isContentEditable)) {
      const before = snapshotOf(el);
      const key = targetRefOf(el, structural(el));
      beforeInputs.set(key, before);
      if (!rawValues.has(key) && before && before.value) rawValues.set(key, before.value);
      const rawBefore = rawValues.get(key);
      send({ ...describe(el, 'observation', 'user'), ...eventContext(event, el), kind: 'observation', observationType: 'before_input', beforeState: before, activeElementBefore: snapshotOf(document.activeElement), rawTypedValue: rawBefore, inputEventData: event.data == null ? [] : [String(event.data)], inputTypes: event.inputType ? [event.inputType] : [] });
    }
  }, true);
  document.addEventListener('pointerdown', (event) => {
    const el = deepestEditableFromEvent(event) || interactive(event.target) || actionableAncestor(event.target) || elementOf(event.target);
    if (el) send({ ...describe(el, 'observation', event.isTrusted ? 'user' : 'application'), ...eventContext(event, el), kind: 'observation', observationType: 'pointer', userInitiated: event.isTrusted === true });
  }, true);
  document.addEventListener('click', (event) => {
    const el = interactive(event.target) || actionableAncestor(event.target);
    if (!el) {
      send({ kind: 'observation', observationType: 'technical_noise', label: text(event.target), role: (event.target && event.target.getAttribute && event.target.getAttribute('role')) || undefined, tagName: event.target && event.target.tagName ? event.target.tagName.toLowerCase() : undefined, text: text(event.target) });
      return;
    }
    const role = attr(el, 'role') || (el.tagName || '').toLowerCase();
    const selection = role === 'option' || role === 'combobox' || (el.tagName || '').toLowerCase() === 'select' || Boolean(attr(el, 'aria-haspopup'));
    const payload = { ...describe(el, 'click', 'user', selection ? 'select' : 'click'), ...eventContext(event, el) };
    if (role === 'option' && lastSelectionContext) {
      ['gridRef','rowRef','cellRef','headerRef','headerContext','rowIdentity','columnIdentity','containerIdentity','associatedField'].forEach((key) => {
        if (!payload[key] && lastSelectionContext[key]) payload[key] = lastSelectionContext[key];
      });
      payload.dynamicLifecycle = { ...(payload.dynamicLifecycle || {}), triggerTechnicalTarget: lastSelectionContext.targetRef, activatedTechnicalTarget: payload.targetRef, selectedOption: payload.afterValue, committedState: payload.afterValue };
    } else if (selection && role !== 'option') {
      lastSelectionContext = payload;
    }
    send(payload);
    schedulePostAction(el, payload.beforeState, payload.activeElementBefore, payload.targetRef);
  }, true);
  document.addEventListener('input', (event) => {
    const el = deepestEditableFromEvent(event) || elementOf(event.target);
    if (!el || (el.value === undefined && !el.isContentEditable)) return;
    const payload = { ...describe(el, 'input', event.isTrusted ? 'user' : 'application', (el.tagName || '').toLowerCase() === 'select' ? 'select' : undefined), ...eventContext(event, el) };
    const key = payload.targetRef;
    payload.beforeState = beforeInputs.get(key) || { value: lastValues.get(key) };
    payload.beforeValue = payload.beforeState && payload.beforeState.value;
    payload.afterState = snapshotOf(el);
    payload.afterValue = payload.afterState && payload.afterState.value;
    payload.inputValue = valueOf(el);
    payload.committedValue = undefined;
    payload.displayValue = attr(el, 'data-display-value') || attr(el, 'aria-valuetext') || undefined;
    const rawBefore = rawValues.get(key) ?? payload.beforeValue ?? '';
    const rawAfter = event.isTrusted ? logicalInputAfter(rawBefore, event) : undefined;
    if (rawAfter !== undefined) rawValues.set(key, rawAfter);
    payload.rawTypedValue = event.isTrusted ? (rawAfter ?? rawBefore) : undefined;
    payload.inputEventData = event.data == null ? [] : [String(event.data)];
    payload.inputTypes = event.inputType ? [event.inputType] : [];
    lastValues.set(key, payload.afterValue);
    send(payload);
  }, true);
  document.addEventListener('change', (event) => {
    const el = deepestEditableFromEvent(event) || elementOf(event.target);
    if (!el || !['input','textarea','select'].includes((el.tagName || '').toLowerCase())) return;
    const payload = { ...describe(el, 'input', event.isTrusted ? 'user' : 'application', 'select'), ...eventContext(event, el) };
    const key = payload.targetRef;
    payload.beforeState = beforeInputs.get(key) || payload.beforeState;
    payload.afterState = snapshotOf(el);
    payload.afterValue = payload.afterState && payload.afterState.value;
    payload.inputValue = valueOf(el);
    payload.committedValue = valueOf(el);
    payload.displayValue = attr(el, 'data-display-value') || attr(el, 'aria-valuetext') || undefined;
    payload.rawTypedValue = rawValues.get(key);
    send(payload);
    schedulePostAction(el, payload.beforeState, payload.activeElementBefore, payload.targetRef);
  }, true);
  document.addEventListener('submit', (event) => {
    const el = event.target;
    if (el) send({ ...describe(el, 'observation', event.isTrusted ? 'user' : 'application'), kind: 'observation', observationType: 'technical_noise' });
  }, true);
})();
`;
class WebSessionRecorder {
    options;
    browser = null;
    context = null;
    page = null;
    startedAt = Date.now();
    events = [];
    screens = new Map();
    seq = 0;
    stopped = false;
    lastScreenKey = "inicio";
    lastFingerprint = "";
    constructor(options) {
        this.options = options;
    }
    log(line) {
        this.options.onLog?.(line);
    }
    now() {
        return Date.now() - this.startedAt;
    }
    pushEvent(event) {
        const full = { ...event, seq: this.seq++ };
        this.events.push(full);
        this.options.onEvent?.(full);
        return full;
    }
    async captureFrame(tag) {
        if (!this.page)
            return undefined;
        const file = path.join(this.options.framesDir, `${String(this.seq).padStart(4, "0")}-${tag}.png`);
        try {
            await this.page.screenshot({ path: file });
            return file;
        }
        catch {
            return undefined;
        }
    }
    /**
     * Records the page as a screen, emitting a transition when its structure changed.
     *
     * URL alone is not the identity: a single-page app rewrites its whole view without
     * navigating, and a paginated list changes URL without being a different screen. The
     * structural fingerprint is what actually distinguishes states.
     */
    async absorbScreen() {
        if (!this.page)
            return { changed: false, screenKey: this.lastScreenKey };
        const snapshot = await (0, runtime_knowledge_extractor_1.extractRuntimeUiSnapshot)(this.page);
        const fingerprint = fingerprintSnapshot(snapshot);
        const screenKey = snapshot.screenKey || fingerprint.slice(0, 16);
        const changed = fingerprint !== this.lastFingerprint;
        const controls = snapshot.observedControls.map((c) => ({
            label: c.businessLabel ?? c.label,
            role: c.role,
            tag: c.tag,
            placeholder: c.placeholder,
            attributes: c.attributes,
            containerContext: c.containerContext,
            headerContext: c.headerContext,
            rowContext: c.rowContext,
            rowIdentity: c.rowIdentity,
            columnIdentity: c.columnIdentity,
            associatedField: c.associatedField,
            locators: c.locatorIdentity
                ? [{ strategy: "aria-label", value: c.locatorIdentity, confidence: 0.9 }]
                : [{ strategy: "text", value: c.label, confidence: 0.7 }],
        }));
        const previousScreen = this.screens.get(screenKey);
        const recordedScreen = {
            screenKey,
            title: snapshot.headings[0] ?? screenKey,
            fingerprint,
            url: snapshot.url,
            firstSeenAt: previousScreen?.firstSeenAt ?? this.now(),
            controls,
            texts: snapshot.assertionTargets.slice(0, 40),
            gridMetadata: snapshot.gridMetadata,
            headerRelationships: snapshot.gridMetadata?.headerRelationships,
        };
        this.screens.set(screenKey, recordedScreen);
        this.options.onScreen?.(recordedScreen);
        this.lastFingerprint = fingerprint;
        return { changed, screenKey };
    }
    async onInteraction(raw) {
        if (this.stopped)
            return;
        const sensitive = isSensitiveField(raw, this.options.sensitiveLabels);
        const locators = raw.kind === "observation" ? [] : buildWebLocators(raw);
        const framePath = raw.kind === "observation" ? undefined : await this.captureFrame(raw.kind);
        const commonTarget = {
            label: raw.label || raw.name || raw.text || "control",
            role: raw.role,
            tag: raw.tagName,
            inputType: raw.inputType,
            placeholder: raw.placeholder,
            attributes: raw.attributes,
            containerContext: raw.containerContext,
            headerContext: raw.headerContext,
            rowContext: raw.rowContext,
            rowIdentity: raw.rowIdentity,
            columnIdentity: raw.columnIdentity,
            associatedField: raw.associatedField,
            locators,
            enabled: raw.disabled === true ? false : undefined,
            beforeValue: raw.beforeValue,
            afterValue: raw.afterValue,
            observedOptions: raw.observedOptions,
            interactionType: raw.interactionType,
            compoundRole: raw.compoundRole,
            gridRef: raw.gridRef,
            rowRef: raw.rowRef,
            cellRef: raw.cellRef,
            headerRef: raw.headerRef,
            containerIdentity: raw.containerIdentity,
            beforeState: raw.beforeState,
            afterState: raw.afterState,
            activeElementBefore: raw.activeElementBefore,
            activeElementAfter: raw.activeElementAfter,
            stateDelta: raw.stateDelta,
            dynamicLifecycle: raw.dynamicLifecycle,
            editingSessionRef: undefined,
            inputValue: raw.inputValue,
            committedValue: raw.committedValue,
            displayValue: raw.displayValue,
            eventTargetRef: raw.eventTargetRef,
            currentTargetRef: raw.currentTargetRef,
            composedPathRefs: raw.composedPathRefs,
            deepestEditableTargetRef: raw.deepestEditableTargetRef,
            rawTypedValue: raw.rawTypedValue,
            inputEventData: raw.inputEventData,
            inputTypes: raw.inputTypes,
            beforeInputValue: raw.beforeInputValue,
            afterInputValue: raw.afterInputValue,
            technicalTargetCandidates: raw.technicalTargetCandidates,
        };
        if (raw.kind === "observation") {
            this.pushEvent({
                t: this.now(),
                kind: "note",
                screenKey: this.lastScreenKey,
                fingerprint: this.lastFingerprint,
                url: this.page?.url(),
                target: commonTarget,
                note: `Observación técnica (${raw.observationType ?? "post_action"}) sobre "${commonTarget.label}"`,
                observationType: raw.observationType ?? "post_action",
            });
            return;
        }
        if (raw.kind === "input") {
            this.pushEvent({
                t: this.now(),
                kind: "fill",
                screenKey: this.lastScreenKey,
                fingerprint: this.lastFingerprint,
                url: this.page?.url(),
                target: {
                    ...commonTarget,
                    label: raw.label || raw.name || "campo",
                    role: "input",
                    sensitive,
                },
                // Password values are allowed only for the QA recording contract. They are persisted
                // in the trace/dataset but never written to the recorder log or console.
                value: raw.value,
                redactedKey: sensitive ? normalizeLabel(raw.label || raw.name || "campo").replace(/\s+/g, "_") : undefined,
                valueSource: raw.valueSource ?? "user",
                framePath,
            });
            return;
        }
        this.pushEvent({
            t: this.now(),
            kind: "tap",
            screenKey: this.lastScreenKey,
            fingerprint: this.lastFingerprint,
            url: this.page?.url(),
            target: commonTarget,
            framePath,
        });
        this.log(`[recording] clic -> "${raw.label || raw.text || "(sin etiqueta)"}"`);
        // Bounded post-action observation: dynamic editors get a short chance to materialize,
        // without imposing a long fixed sleep on every click.
        for (const delay of [60, 120, 180]) {
            await this.page?.waitForTimeout(delay).catch(() => undefined);
            const current = await this.absorbScreen();
            if (current.screenKey !== this.lastScreenKey)
                break;
        }
        const from = this.lastScreenKey;
        const { changed, screenKey } = await this.absorbScreen();
        if (changed && screenKey !== from) {
            this.lastScreenKey = screenKey;
            this.pushEvent({
                t: this.now(),
                kind: "screen_change",
                screenKey: from,
                toScreenKey: screenKey,
                fingerprint: this.lastFingerprint,
                url: this.page?.url(),
                framePath: await this.captureFrame("screen"),
            });
            this.log(`[recording] pantalla -> ${this.screens.get(screenKey)?.title ?? screenKey}`);
        }
    }
    async start() {
        fs.mkdirSync(this.options.framesDir, { recursive: true });
        const engine = this.options.browserName === "firefox" ? test_1.firefox : this.options.browserName === "webkit" ? test_1.webkit : test_1.chromium;
        this.browser = await engine.launch({ headless: false });
        this.context = await this.browser.newContext(buildWebRecorderContextOptions(this.options.ignoreHTTPSErrors));
        await this.context.exposeBinding("__qaRecord", async (_source, payload) => {
            await this.onInteraction(payload).catch((err) => this.log(`[recording] error procesando interacción: ${err instanceof Error ? err.message : String(err)}`));
        });
        await this.context.addInitScript({
            content: `window.__qaRecorderPersistQaCredentials = true;\n${exports.CAPTURE_SCRIPT}`,
        });
        this.page = await this.context.newPage();
        this.page.on("framenavigated", (frame) => {
            if (frame !== this.page?.mainFrame() || this.stopped)
                return;
            this.pushEvent({
                t: this.now(),
                kind: "navigate",
                screenKey: this.lastScreenKey,
                url: frame.url(),
            });
        });
        await this.page.goto(this.options.baseUrl, { waitUntil: "domcontentloaded" });
        const { screenKey } = await this.absorbScreen();
        this.lastScreenKey = screenKey;
        this.pushEvent({
            t: 0,
            kind: "launch",
            screenKey,
            url: this.options.baseUrl,
            framePath: await this.captureFrame("launch"),
        });
        this.log("[recording] navegador abierto: realiza el recorrido y pulsa Detener cuando termines");
        return true;
    }
    async stop() {
        this.stopped = true;
        await this.context?.close().catch(() => undefined);
        await this.browser?.close().catch(() => undefined);
        this.context = null;
        this.browser = null;
        this.page = null;
        return { events: [...this.events], screens: [...this.screens.values()] };
    }
    snapshotProgress() {
        return {
            events: this.events.length,
            screens: this.screens.size,
            currentScreen: this.screens.get(this.lastScreenKey)?.title ?? this.lastScreenKey,
        };
    }
}
exports.WebSessionRecorder = WebSessionRecorder;
