import assert from "node:assert/strict";
import test from "node:test";
import { buildCaptureScriptV2Content } from "./capture-engine-v2.browser-instrumentation";

/**
 * FIRST_LOSS: CaptureEngine V2's browser instrumentation had NO grid/column-header awareness at
 * all -- `computeAccessibleName` (renamed here `computeStrongAccessibleName`+
 * `computeWeakAccessibleName`) folded `placeholder`/`title` into the SAME tier as a real
 * aria-label/label, and `toCandidate` skipped `associatedField` computation entirely whenever
 * ANY accessible name (including a bare placeholder) was present. So a grid cell editor created
 * with only a placeholder ("Indicar...", a phone-format mask "000-000-0000") or no name at all
 * ("control") never even attempted a structural relation, and downstream became
 * "Campo pendiente de identificar"/`unresolved_value_*` even when its column header was
 * perfectly certifiable by the SAME column-index alignment the (unrelated, legacy, non-V2)
 * `web-session-recorder.ts` capture script already proves works (`structuralContext`).
 *
 * Fixed by: (1) splitting accessible-name computation into a STRONG tier (aria-label/
 * aria-labelledby/label[for]/own text for button-like tags) and a WEAK tier (placeholder/title),
 * (2) adding `gridHeaderContext(el)` -- certified column-index alignment between a cell and its
 * table's header row, mirroring the already-proven legacy algorithm, (3) reordering `toCandidate`
 * so a certified grid header always outranks the weak placeholder/title tier: associatedField is
 * attempted (grid header first, then data-field-owner, then the generic ancestor walk) whenever
 * there is no STRONG name, and the weak name is only used when NEITHER a strong name NOR any
 * associatedField relation exists.
 *
 * These tests execute the REAL generated V2 browser script (`new Function`, matching this
 * session's established real-execution harness) against a minimal fake DOM implementing exactly
 * the tree/attribute/`closest`/`querySelectorAll` surface `toCandidate`/`gridHeaderContext` call
 * -- genuine behavioral coverage, not a source-text assertion.
 */

type FakeEl = {
  nodeType: 1;
  tagName: string;
  id: string;
  disabled: boolean;
  textContent: string;
  children: FakeEl[];
  parentElement: FakeEl | null;
  labels?: FakeEl[];
  attrs: Record<string, string>;
  getAttribute: (name: string) => string | null;
  getBoundingClientRect: () => { width: number; height: number };
  querySelectorAll: (selector: string) => FakeEl[];
  closest: (selector: string) => FakeEl | null;
  contains: (other: FakeEl) => boolean;
};

function matchesSimple(el: FakeEl, simple: string): boolean {
  const trimmed = simple.trim();
  const attrMatch = trimmed.match(/^\[([a-z-]+)(?:([*^$])?=("([^"]*)"|'([^']*)'))?\]$/i);
  if (attrMatch) {
    const [, name, op, , dq, sq] = attrMatch;
    const value = el.attrs[name];
    if (value === undefined) return false;
    const expected = dq ?? sq;
    if (expected === undefined) return true;
    if (op === "*") return value.includes(expected);
    if (op === "^") return value.startsWith(expected);
    if (op === "$") return value.endsWith(expected);
    return value === expected;
  }
  return el.tagName.toLowerCase() === trimmed.toLowerCase();
}

function hasAncestorMatching(el: FakeEl, simple: string): boolean {
  let node = el.parentElement;
  while (node) {
    if (matchesSimple(node, simple)) return true;
    node = node.parentElement;
  }
  return false;
}

/** Supports a single descendant combinator ("ancestor tag") on top of `matchesSimple`. */
function matchesCompound(el: FakeEl, compound: string): boolean {
  const parts = compound.trim().split(/\s+/);
  if (parts.length === 1) return matchesSimple(el, parts[0]);
  const [ancestorPart, ownPart] = parts;
  return matchesSimple(el, ownPart) && hasAncestorMatching(el, ancestorPart);
}

function matches(el: FakeEl, selector: string): boolean {
  return selector.split(",").some((part) => matchesCompound(el, part));
}

function collectAll(root: FakeEl, out: FakeEl[] = []): FakeEl[] {
  for (const child of root.children) {
    out.push(child);
    collectAll(child, out);
  }
  return out;
}

function fakeEl(opts: {
  tag: string;
  attrs?: Record<string, string>;
  id?: string;
  textContent?: string;
  hasLabels?: boolean;
}): FakeEl {
  const el: FakeEl = {
    nodeType: 1,
    tagName: opts.tag.toUpperCase(),
    id: opts.id ?? "",
    disabled: false,
    textContent: opts.textContent ?? "",
    children: [],
    parentElement: null,
    labels: opts.hasLabels === false ? undefined : [],
    attrs: opts.attrs ?? {},
    getAttribute: (name) => (opts.attrs ?? {})[name] ?? null,
    getBoundingClientRect: () => ({ width: 10, height: 10 }),
    querySelectorAll: (selector: string) => collectAll(el).filter((candidate) => matches(candidate, selector)),
    closest: (selector: string) => {
      let node: FakeEl | null = el;
      while (node) {
        if (matches(node, selector)) return node;
        node = node.parentElement;
      }
      return null;
    },
    contains: (other) => {
      let node: FakeEl | null = other;
      while (node) {
        if (node === el) return true;
        node = node.parentElement;
      }
      return false;
    },
  };
  return el;
}

function append(parent: FakeEl, ...children: FakeEl[]): FakeEl {
  for (const child of children) {
    child.parentElement = parent;
    parent.children.push(child);
  }
  return parent;
}

/** Builds a generic <table><thead><tr>[headers]</tr></thead><tbody>[rows]</tbody></table>. */
function buildGrid(headerLabels: string[], rows: FakeEl[][]): { table: FakeEl; rows: FakeEl[] } {
  const headerCells = headerLabels.map((label) => fakeEl({ tag: "th", textContent: label }));
  const headerRow = fakeEl({ tag: "tr" });
  append(headerRow, ...headerCells);
  const thead = fakeEl({ tag: "thead" });
  append(thead, headerRow);

  const bodyRows = rows.map((cells) => {
    const row = fakeEl({ tag: "tr" });
    append(row, ...cells);
    return row;
  });
  const tbody = fakeEl({ tag: "tbody" });
  append(tbody, ...bodyRows);

  const table = fakeEl({ tag: "table" });
  append(table, thead, tbody);
  return { table, rows: bodyRows };
}

/** Evaluates the REAL generated V2 script and fires a click on `target`. */
function evalCaptureScriptAndFireClick(target: FakeEl): { composedPath: Array<{ accessibleName?: string; associatedField?: string; tag: string }> } {
  const content = buildCaptureScriptV2Content("test-instance");
  const listeners: Record<string, (event: unknown) => void> = {};
  const fakeDocument = {
    addEventListener(type: string, handler: (event: unknown) => void) {
      listeners[type] = handler;
    },
    getElementById() {
      return null;
    },
  };
  const sent: Array<Record<string, unknown>> = [];
  const fakeWindow = {
    __qaRecordV2: (message: Record<string, unknown>) => {
      sent.push(message);
      return Promise.resolve();
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function("document", "window", content);
  run(fakeDocument, fakeWindow);
  listeners.click({ composedPath: () => [target], detail: 1 });
  return sent.find((message) => message.type === "click") as unknown as { composedPath: Array<{ accessibleName?: string; associatedField?: string; tag: string }> };
}

function cellCandidate(message: { composedPath: Array<{ accessibleName?: string; associatedField?: string }> }) {
  return message.composedPath[0];
}

test("1/genericPlaceholder. a grid editor's placeholder never wins over its certified column header", () => {
  const editor = fakeEl({ tag: "input", attrs: { placeholder: "Indicar..." } });
  const cell = fakeEl({ tag: "td" });
  append(cell, editor);
  buildGrid(["Empleado", "Cargo"], [[cell, fakeEl({ tag: "td" })]]);
  const message = evalCaptureScriptAndFireClick(editor);
  const candidate = cellCandidate(message);
  assert.equal(candidate.associatedField, "Empleado");
  assert.notEqual(candidate.accessibleName, "Indicar...");
});

test("2/phoneMask. a phone-format-mask placeholder never becomes the field identity when a header is certified", () => {
  const editor = fakeEl({ tag: "input", attrs: { placeholder: "000-000-0000" } });
  const cell = fakeEl({ tag: "td" });
  append(cell, editor);
  buildGrid(["Teléfono"], [[cell]]);
  const message = evalCaptureScriptAndFireClick(editor);
  const candidate = cellCandidate(message);
  assert.equal(candidate.associatedField, "Teléfono");
  assert.notEqual(candidate.associatedField, "000-000-0000");
});

test("3/controlSentinel. an editor with no name at all still resolves the certified column identity", () => {
  const editor = fakeEl({ tag: "input" });
  const cell = fakeEl({ tag: "td" });
  append(cell, editor);
  buildGrid(["Departamento"], [[cell]]);
  const message = evalCaptureScriptAndFireClick(editor);
  const candidate = cellCandidate(message);
  assert.equal(candidate.associatedField, "Departamento");
});

test("5/postActivation. an editor created only after cell activation (appended to the cell just before the event fires) still resolves the certified column identity -- toCandidate inspects the live DOM at event time, never a stale pre-activation snapshot", () => {
  const cell = fakeEl({ tag: "td" });
  const { rows } = buildGrid(["Cargo"], [[cell]]);
  void rows;
  // The editor is only appended to the cell HERE, simulating a grid that lazily creates its
  // <input> after the cell is activated -- there is no earlier snapshot to have gone stale.
  const editor = fakeEl({ tag: "input", attrs: { placeholder: "Indicar..." } });
  append(cell, editor);
  const message = evalCaptureScriptAndFireClick(editor);
  const candidate = cellCandidate(message);
  assert.equal(candidate.associatedField, "Cargo");
});

test("4/realAccessibleName. a genuinely named editor (real aria-label) keeps its own identity -- never overridden by the column header", () => {
  const editor = fakeEl({ tag: "input", attrs: { "aria-label": "Comentario libre" } });
  const cell = fakeEl({ tag: "td" });
  append(cell, editor);
  buildGrid(["Empleado"], [[cell]]);
  const message = evalCaptureScriptAndFireClick(editor);
  const candidate = cellCandidate(message);
  assert.equal(candidate.accessibleName, "Comentario libre");
  assert.equal(candidate.associatedField, undefined, "a strong own name is self-sufficient -- no structural relation is attached");
});

test("6/multiRow. two rows in the same column resolve the SAME column identity", () => {
  const editorA = fakeEl({ tag: "input" });
  const cellA = fakeEl({ tag: "td" });
  append(cellA, editorA);
  const editorB = fakeEl({ tag: "input" });
  const cellB = fakeEl({ tag: "td" });
  append(cellB, editorB);
  buildGrid(["Salario"], [[cellA], [cellB]]);
  const messageA = evalCaptureScriptAndFireClick(editorA);
  const messageB = evalCaptureScriptAndFireClick(editorB);
  assert.equal(cellCandidate(messageA).associatedField, "Salario");
  assert.equal(cellCandidate(messageB).associatedField, "Salario");
});

test("7/adjacentColumns. an editor never binds to the wrong header when several columns exist", () => {
  const editorFirst = fakeEl({ tag: "input" });
  const cellFirst = fakeEl({ tag: "td" });
  append(cellFirst, editorFirst);
  const editorSecond = fakeEl({ tag: "input" });
  const cellSecond = fakeEl({ tag: "td" });
  append(cellSecond, editorSecond);
  const editorThird = fakeEl({ tag: "input" });
  const cellThird = fakeEl({ tag: "td" });
  append(cellThird, editorThird);
  buildGrid(["Nombre", "Apellido", "Correo"], [[cellFirst, cellSecond, cellThird]]);
  assert.equal(cellCandidate(evalCaptureScriptAndFireClick(editorFirst)).associatedField, "Nombre");
  assert.equal(cellCandidate(evalCaptureScriptAndFireClick(editorSecond)).associatedField, "Apellido");
  assert.equal(cellCandidate(evalCaptureScriptAndFireClick(editorThird)).associatedField, "Correo");
});

test("8/noRelation. an editor with no grid/table ancestor at all falls back to the existing generic mechanism, never invents a header", () => {
  const editor = fakeEl({ tag: "input", attrs: { placeholder: "Cualquier texto" } });
  const container = fakeEl({ tag: "div" });
  append(container, editor);
  const message = evalCaptureScriptAndFireClick(editor);
  const candidate = cellCandidate(message);
  assert.equal(candidate.associatedField, undefined);
  assert.equal(candidate.accessibleName, "Cualquier texto");
});

test("9/noFakeRoleName. the column identity travels only as associatedField, never copied into accessibleName", () => {
  const editor = fakeEl({ tag: "input" });
  const cell = fakeEl({ tag: "td" });
  append(cell, editor);
  buildGrid(["Empleado"], [[cell]]);
  const message = evalCaptureScriptAndFireClick(editor);
  const candidate = cellCandidate(message);
  assert.equal(candidate.associatedField, "Empleado");
  assert.notEqual(candidate.accessibleName, "Empleado");
});

test("15/generic. no app/project/column-name hardcode: the mechanism generalizes to arbitrary header text", () => {
  const editor = fakeEl({ tag: "input", attrs: { placeholder: "Indicar valor" } });
  const cell = fakeEl({ tag: "td" });
  append(cell, editor);
  buildGrid(["Columna Totalmente Arbitraria"], [[cell]]);
  const message = evalCaptureScriptAndFireClick(editor);
  assert.equal(cellCandidate(message).associatedField, "Columna Totalmente Arbitraria");
});
