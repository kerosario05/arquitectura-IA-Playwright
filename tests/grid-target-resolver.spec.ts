import { test, expect } from "@playwright/test";
import { captureGridCollectionSnapshot, compareGridCollection, resolveActionTarget, resolveFillTarget, resolveGridEditor } from "../src/discovery/target-resolver";

test("resolves and activates the scoped editable cell without using a page-wide index", async ({ page }) => {
  await page.setContent(`
    <table>
      <thead><tr><th>Name</th><th>Position</th><th>Currency</th></tr></thead>
      <tbody>
        <tr><td><div data-cell="name-1">first</div></td><td><div data-cell="position-1">old</div></td><td><div data-cell="currency-1">USD</div></td></tr>
        <tr><td><div data-cell="name-2">second</div></td><td><div data-cell="position-2">old</div></td><td><div data-cell="currency-2">USD</div></td></tr>
      </tbody>
    </table>
    <script>
      for (const cell of document.querySelectorAll('[data-cell]')) {
        cell.addEventListener('click', () => {
          if (cell.querySelector('input, select')) return;
          const editor = cell.dataset.cell.startsWith('currency')
            ? Object.assign(document.createElement('select'), { innerHTML: '<option>USD</option><option>EUR</option>' })
            : Object.assign(document.createElement('input'), { value: cell.textContent });
          cell.replaceChildren(editor);
        });
      }
    </script>
  `);

  const fill = await resolveFillTarget(page, {} as any, "Position", undefined, { rowScope: 2 });
  expect(fill.status).toBe("resolved");
  expect(fill.locatorStrategy).toBe("grid_cell_editor_after_activation");
  expect(fill.gridDiagnostics).toMatchObject({
    rowResolved: true,
    columnResolved: true,
    cellResolved: true,
    editorInitiallyPresent: false,
    cellActivationAttempted: true,
    editorResolvedAfterActivation: true,
    rowIndex: 1,
  });
  await fill.locator!.fill("new position");
  await expect(page.locator('[data-cell="position-1"]')).toHaveText("old");
  await expect(page.locator('[data-cell="position-2"] input')).toHaveValue("new position");
});

test("resolves a dynamic select editor in the requested grid row", async ({ page }) => {
  await page.setContent(`
    <table>
      <thead><tr><th>Name</th><th>Currency</th></tr></thead>
      <tbody>
        <tr><td>first</td><td><div data-cell="currency-1">USD</div></td></tr>
        <tr><td>second</td><td><div data-cell="currency-2">USD</div></td></tr>
      </tbody>
    </table>
    <script>
      for (const cell of document.querySelectorAll('[data-cell]')) {
        cell.addEventListener('click', () => {
          const editor = document.createElement('select');
          editor.innerHTML = '<option>USD</option><option>EUR</option>';
          cell.replaceChildren(editor);
        });
      }
    </script>
  `);

  const result = await resolveGridEditor(page, "Currency", { rowScope: 2 });
  expect(result.locator).toBeTruthy();
  expect(await result.locator!.evaluate((element) => element.tagName)).toBe("SELECT");
  expect(result.diagnostics).toMatchObject({
    rowResolved: true,
    columnResolved: true,
    cellResolved: true,
    cellActivationAttempted: true,
    editorResolvedAfterActivation: true,
    rowIndex: 1,
  });
  await result.locator!.selectOption({ label: "EUR" });
  await expect(page.locator('[data-cell="currency-1"]')).toHaveText("USD");
  await expect(page.locator('[data-cell="currency-2"] select')).toHaveValue("EUR");
});

test("resolves a selection through its declared associated grid field", async ({ page }) => {
  await page.setContent(`
    <table>
      <thead><tr><th>Tipo de ID</th><th>Colaborador</th><th>Ingresos</th></tr></thead>
      <tbody>
        <tr>
          <td>Cédula</td>
          <td>employee</td>
          <td data-cell="income-1"><button type="button">Indicar...</button></td>
        </tr>
      </tbody>
    </table>
    <script>
      document.querySelector('[data-cell="income-1"] button').addEventListener('click', (event) => {
        const cell = event.currentTarget.parentElement;
        cell.innerHTML = '<div role="listbox"><button role="option">DOP</button><button role="option">USD</button></div>';
        cell.querySelector('[role="option"]').addEventListener('click', () => { cell.textContent = 'DOP'; });
      });
    </script>
  `);

  const result = await resolveActionTarget(page, { elements: [] } as any, "moneda", {
    selectionField: "Moneda",
    selectionValue: "DOP",
    rowScope: 1,
    associatedField: "Ingresos",
  });

  expect(result.status).toBe("resolved");
  expect(result.locatorStrategy).toBe("selection_option_causal_surface");
  expect(result.selectionApplied).toBe(true);
  await expect(page.locator('[data-cell="income-1"]')).toHaveText("DOP");
});

test("prefers the selection control in a compound row cell over global controls and amount editors", async ({ page }) => {
  await page.setContent(`
    <label>Global currency <select><option>DOP</option></select></label>
    <table>
      <thead><tr><th>Colaborador</th><th>Ingresos</th></tr></thead>
      <tbody>
        <tr><td>first</td><td><select aria-label="row one currency"><option>USD</option><option>DOP</option></select><input aria-label="row one amount"></td></tr>
        <tr><td>second</td><td><select aria-label="row two currency"><option>USD</option><option>DOP</option></select><input aria-label="row two amount"></td></tr>
      </tbody>
    </table>
  `);

  const selection = await resolveActionTarget(page, { elements: [] } as any, "currency", {
    selectionField: "Moneda",
    selectionValue: "DOP",
    rowScope: 2,
    associatedField: "Ingresos",
  });
  expect(selection.status).toBe("resolved");
  expect(selection.locatorStrategy).toBe("grid_cell_selection_control");
  expect(await selection.locator!.getAttribute("aria-label")).toBe("row two currency");

  const amount = await resolveFillTarget(page, { elements: [] } as any, "Ingresos", undefined, { rowScope: 2 });
  expect(amount.status).toBe("resolved");
  expect(await amount.locator!.getAttribute("aria-label")).toBe("row two amount");
});

test("uses option compatibility to select one of multiple controls in a compound cell", async ({ page }) => {
  await page.setContent(`
    <table>
      <thead><tr><th>Colaborador</th><th>Ingresos</th></tr></thead>
      <tbody><tr><td>first</td><td>
        <select aria-label="tax selector"><option>USD</option></select>
        <select aria-label="currency selector"><option>DOP</option></select>
        <input aria-label="amount editor">
      </td></tr></tbody>
    </table>
  `);

  const result = await resolveActionTarget(page, { elements: [] } as any, "currency", {
    selectionField: "Moneda",
    selectionValue: "DOP",
    rowScope: 1,
    associatedField: "Ingresos",
  });
  expect(result.status).toBe("resolved");
  expect(await result.locator!.getAttribute("aria-label")).toBe("currency selector");
  expect(result.gridDiagnostics?.candidateCountAfterOptionCompatibility).toBe(1);
});

test("re-activates a surviving cell trigger before resolving its options", async ({ page }) => {
  await page.setContent(`
    <table>
      <thead><tr><th>Colaborador</th><th>Ingresos</th></tr></thead>
      <tbody><tr><td>first</td><td data-active="false">
        <button type="button">Indicar...</button>
      </td></tr></tbody>
    </table>
    <script>
      const cell = document.querySelector('[data-active]');
      const trigger = cell.querySelector('button');
      trigger.addEventListener('click', () => {
        if (cell.dataset.active !== 'true') {
          cell.dataset.active = 'true';
          return;
        }
        cell.innerHTML = '<div role="listbox"><button role="option">DOP</button></div>';
      });
    </script>
  `);

  const result = await resolveActionTarget(page, { elements: [] } as any, "currency", {
    selectionField: "Moneda",
    selectionValue: "DOP",
    rowScope: 1,
    associatedField: "Ingresos",
  });

  expect(result.status).toBe("resolved");
  expect(result.locatorStrategy).toBe("selection_option_causal_surface");
  expect(result.selectionApplied).toBe(true);
  await expect(page.locator('[data-active]')).toHaveText("DOP");
});

test("resolves a combobox surface rendered inside the cell and verifies its state", async ({ page }) => {
  await page.setContent(`
    <table><thead><tr><th>Worker</th><th>Compensation</th></tr></thead><tbody><tr>
      <td>first</td><td><div role="combobox" aria-expanded="false">Choose</div></td>
    </tr></tbody></table>
    <script>
      const trigger = document.querySelector('[role="combobox"]');
      trigger.addEventListener('click', () => {
        trigger.setAttribute('aria-expanded', 'true');
        trigger.innerHTML = '<div role="listbox"><div role="option">Choice A</div><div role="option">Choice B</div></div>';
        trigger.querySelector('[role="option"]').addEventListener('click', (event) => {
          event.stopPropagation();
          trigger.textContent = event.currentTarget.textContent;
          trigger.setAttribute('aria-expanded', 'false');
        });
      });
    </script>
  `);

  const result = await resolveActionTarget(page, { elements: [] } as any, "choice", {
    selectionField: "Compensation",
    selectionValue: "Choice A",
    rowScope: 1,
    associatedField: "Compensation",
  });
  expect(result.status).toBe("resolved");
  expect(result.selectionApplied).toBe(true);
  expect(result.selectionDiagnostics).toMatchObject({ surfaceType: "listbox", surfaceCausallyBound: true, stateVerified: true });
  await expect(page.locator('[role="combobox"]')).toHaveText("Choice A");
});

test("binds a portalized overlay to the activated grid trigger", async ({ page }) => {
  await page.setContent(`
    <table><thead><tr><th>Worker</th><th>Compensation</th></tr></thead><tbody><tr>
      <td>first</td><td><button type="button" aria-controls="portal-options">Choose</button></td>
    </tr></tbody></table>
    <script>
      document.querySelector('button').addEventListener('click', () => {
        const popup = document.createElement('div');
        popup.id = 'portal-options';
        popup.setAttribute('role', 'listbox');
        popup.innerHTML = '<button role="option">Choice A</button>';
        document.body.appendChild(popup);
        popup.querySelector('[role="option"]').addEventListener('click', () => {
          document.querySelector('td:last-child button').textContent = 'Choice A';
          popup.remove();
        });
      });
    </script>
  `);

  const result = await resolveActionTarget(page, { elements: [] } as any, "choice", {
    selectionField: "Compensation",
    selectionValue: "Choice A",
    rowScope: 1,
    associatedField: "Compensation",
  });
  expect(result.status).toBe("resolved");
  expect(result.selectionDiagnostics).toMatchObject({ ariaRelationshipFound: true, surfacePortalized: true, surfaceCausallyBound: true, stateVerified: true });
});

test("keeps semantically visible options when a related custom surface owns the geometry", async ({ page }) => {
  await page.setContent(`
    <table><thead><tr><th>Worker</th><th>Compensation</th></tr></thead><tbody><tr>
      <td>first</td><td><button type="button" role="combobox" aria-expanded="false" aria-controls="custom-surface">Choose</button></td>
    </tr></tbody></table>
    <script>
      const trigger = document.querySelector('[role="combobox"]');
      trigger.addEventListener('click', () => {
        trigger.setAttribute('aria-expanded', 'true');
        const surface = document.createElement('div');
        surface.id = 'custom-surface';
        surface.setAttribute('role', 'listbox');
        surface.style.width = '120px';
        surface.style.height = '20px';
        surface.innerHTML = '<div role="option" style="display:block">Choice A</div><div role="option" style="display:block">Choice B</div>';
        for (const option of surface.querySelectorAll('[role="option"]')) {
          Object.defineProperty(option, 'offsetWidth', { configurable: true, value: 0 });
          Object.defineProperty(option, 'offsetHeight', { configurable: true, value: 0 });
          Object.defineProperty(option, 'getClientRects', { configurable: true, value: () => [] });
        }
        document.body.appendChild(surface);
        surface.querySelector('[role="option"]').addEventListener('click', (event) => {
          trigger.textContent = event.currentTarget.textContent;
          trigger.setAttribute('aria-expanded', 'false');
          surface.remove();
        });
      });
    </script>
  `);
  const result = await resolveActionTarget(page, { elements: [] } as any, "choice", {
    selectionField: "Compensation",
    selectionValue: "Choice A",
    rowScope: 1,
    associatedField: "Compensation",
  });

  expect(result.status).toBe("resolved");
  expect(result.selectionDiagnostics?.ariaRelationshipFound).toBe(true);
  expect(result.selectionDiagnostics?.stateVerified).toBe(true);
  await expect(page.locator('[role="combobox"]')).toHaveText("Choice A");
});

test("advances a dynamic display editor to a portalized combobox before selecting", async ({ page }) => {
  await page.setContent(`
    <table><thead><tr><th>Worker</th><th>Compensation</th></tr></thead><tbody><tr>
      <td>first</td><td><button type="button" data-phase="display">Indicate...</button></td>
    </tr></tbody></table>
    <script>
      const cell = document.querySelector('td:last-child');
      const display = cell.querySelector('[data-phase="display"]');
      display.addEventListener('click', () => {
        const combo = document.createElement('button');
        combo.type = 'button';
        combo.dataset.phase = 'editor';
        combo.setAttribute('role', 'combobox');
        combo.setAttribute('aria-expanded', 'false');
        combo.setAttribute('aria-controls', 'runtime-selection-surface');
        combo.textContent = 'Moneda';
        combo.addEventListener('click', () => {
          combo.setAttribute('aria-expanded', 'true');
          const wrapper = document.createElement('div');
          wrapper.id = 'runtime-selection-surface';
          const listbox = document.createElement('div');
          listbox.setAttribute('role', 'listbox');
          listbox.innerHTML = '<div role="option">DOP</div><div role="option">USD</div>';
          wrapper.appendChild(listbox);
          document.body.appendChild(wrapper);
          listbox.querySelector('[role="option"]').addEventListener('click', (event) => {
            combo.textContent = event.currentTarget.textContent;
            combo.setAttribute('aria-expanded', 'false');
            wrapper.remove();
          });
        });
        cell.replaceChildren(combo);
      });
    </script>
  `);

  const result = await resolveActionTarget(page, { elements: [] } as any, "currency", {
    selectionField: "Compensation",
    selectionValue: "DOP",
    rowScope: 1,
    associatedField: "Compensation",
  });

  expect(result.status).toBe("resolved");
  expect(result.selectionApplied).toBe(true);
  expect(result.selectionDiagnostics).toMatchObject({
    initialState: "SELECTION_CONTROL_READY",
    surfaceCausallyBound: true,
    surfacePortalized: true,
    stateVerified: true,
    comboboxObserved: true,
  });
  expect(result.selectionDiagnostics?.transitionsObserved).toContain("OPTIONS_VISIBLE");
  await expect(page.locator('[role="combobox"]')).toHaveText("DOP");
});

test("uses one keyboard activation when an expanded combobox delays its surface", async ({ page }) => {
  await page.setContent(`
    <table><thead><tr><th>Worker</th><th>Compensation</th></tr></thead><tbody><tr>
      <td>first</td><td><button type="button" role="combobox" aria-expanded="false" aria-controls="delayed-surface">Moneda</button></td>
    </tr></tbody></table>
    <script>
      const combo = document.querySelector('[role="combobox"]');
      const open = () => {
        if (document.getElementById('delayed-surface')) return;
        const surface = document.createElement('div');
        surface.id = 'delayed-surface';
        surface.setAttribute('role', 'listbox');
        surface.innerHTML = '<div role="option">DOP</div>';
        document.body.appendChild(surface);
        surface.querySelector('[role="option"]').addEventListener('click', () => {
          combo.textContent = 'DOP';
          combo.setAttribute('aria-expanded', 'false');
          surface.remove();
        });
      };
      combo.addEventListener('click', () => combo.setAttribute('aria-expanded', 'true'));
      combo.addEventListener('keydown', (event) => { if (event.key === 'ArrowDown') open(); });
    </script>
  `);

  const result = await resolveActionTarget(page, { elements: [] } as any, "currency", {
    selectionField: "Compensation",
    selectionValue: "DOP",
    rowScope: 1,
    associatedField: "Compensation",
  });

  expect(result.status).toBe("resolved");
  expect(result.selectionDiagnostics?.stateVerified).toBe(true);
  expect(result.selectionDiagnostics?.surfaceCausallyBound).toBe(true);
});

test("ignores an unrelated visible surface and uses the one caused by this trigger", async ({ page }) => {
  await page.setContent(`
    <div role="listbox" id="unrelated"><button role="option">Choice A</button></div>
    <table><thead><tr><th>Worker</th><th>Compensation</th></tr></thead><tbody><tr>
      <td>first</td><td><button type="button">Choose</button></td>
    </tr></tbody></table>
    <script>
      document.querySelector('table button').addEventListener('click', () => {
        const popup = document.createElement('div');
        popup.setAttribute('role', 'listbox');
        popup.innerHTML = '<button role="option">Choice A</button>';
        document.body.appendChild(popup);
        popup.querySelector('[role="option"]').addEventListener('click', () => {
          document.querySelector('table td:last-child button').textContent = 'Choice A';
          popup.remove();
        });
      });
    </script>
  `);
  const result = await resolveActionTarget(page, { elements: [] } as any, "choice", {
    selectionField: "Compensation", selectionValue: "Choice A", rowScope: 1, associatedField: "Compensation"
  });
  expect(result.status).toBe("resolved");
  expect(result.selectionDiagnostics?.surfaceCausallyBound).toBe(true);
  await expect(page.locator('table td:last-child button')).toHaveText("Choice A");
});

test("reports option_not_supported when the causal surface lacks the desired option", async ({ page }) => {
  await page.setContent(`
    <table><thead><tr><th>Worker</th><th>Compensation</th></tr></thead><tbody><tr><td>first</td><td><button>Choose</button></td></tr></tbody></table>
    <script>document.querySelector('button').addEventListener('click', () => { const popup = document.createElement('div'); popup.setAttribute('role','listbox'); popup.innerHTML = '<button role="option">Choice B</button>'; document.body.appendChild(popup); });</script>
  `);
  const result = await resolveActionTarget(page, { elements: [] } as any, "choice", {
    selectionField: "Compensation", selectionValue: "Choice A", rowScope: 1, associatedField: "Compensation"
  });
  expect(result.status).toBe("not_found");
  expect(result.matchReason).toBe("option_not_supported");
});

test("reports ambiguous_option for indistinguishable compatible options", async ({ page }) => {
  await page.setContent(`
    <table><thead><tr><th>Worker</th><th>Compensation</th></tr></thead><tbody><tr><td>first</td><td><button>Choose</button></td></tr></tbody></table>
    <script>document.querySelector('button').addEventListener('click', () => { const popup = document.createElement('div'); popup.setAttribute('role','listbox'); popup.innerHTML = '<button role="option">Choice A</button><button role="option">Choice A</button>'; document.body.appendChild(popup); });</script>
  `);
  const result = await resolveActionTarget(page, { elements: [] } as any, "choice", {
    selectionField: "Compensation", selectionValue: "Choice A", rowScope: 1, associatedField: "Compensation"
  });
  expect(result.status).toBe("ambiguous");
  expect(result.matchReason).toBe("ambiguous_option");
});

test("fails safely when an option click does not change selection state", async ({ page }) => {
  await page.setContent(`
    <table><thead><tr><th>Worker</th><th>Compensation</th></tr></thead><tbody><tr><td>first</td><td><button>Choose</button></td></tr></tbody></table>
    <script>document.querySelector('button').addEventListener('click', () => { const popup = document.createElement('div'); popup.setAttribute('role','listbox'); popup.innerHTML = '<button role="option">Choice A</button>'; document.body.appendChild(popup); });</script>
  `);
  const result = await resolveActionTarget(page, { elements: [] } as any, "choice", {
    selectionField: "Compensation", selectionValue: "Choice A", rowScope: 1, associatedField: "Compensation"
  });
  expect(result.status).toBe("not_found");
  expect(result.matchReason).toBe("selection_state_not_verified");
});

test("keeps genuinely indistinguishable row controls ambiguous", async ({ page }) => {
  await page.setContent(`
    <table>
      <thead><tr><th>Colaborador</th><th>Ingresos</th></tr></thead>
      <tbody><tr><td>first</td><td>
        <select><option>DOP</option></select>
        <select><option>DOP</option></select>
      </td></tr></tbody>
    </table>
  `);

  const result = await resolveActionTarget(page, { elements: [] } as any, "currency", {
    selectionField: "Moneda",
    selectionValue: "DOP",
    rowScope: 1,
    associatedField: "Ingresos",
  });
  expect(result.status).toBe("ambiguous");
  expect(result.matchReason).toBe("ambiguous_grid_selection_control");
  expect(result.gridDiagnostics?.candidateCountAfterControlType).toBe(2);
});

test("observes row creation through structural identities", async ({ page }) => {
  await page.setContent(`<table><tbody><tr data-row-id="a"><td>a</td></tr></tbody></table>`);
  const before = await captureGridCollectionSnapshot(page);
  await page.locator("tbody").evaluate((body) => body.insertAdjacentHTML("beforeend", `<tr data-row-id="b"><td>b</td></tr>`));
  const after = await captureGridCollectionSnapshot(page);
  expect(compareGridCollection(before, after)).toEqual({ rowCountIncreased: true, newRowObserved: true, newRowIdentityDistinct: true });
});
