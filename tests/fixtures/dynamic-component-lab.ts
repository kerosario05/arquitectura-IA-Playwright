export type DynamicComponentFixtureOptions = {
  portal?: boolean;
  ariaControls?: boolean;
  initiallyEnabled?: boolean;
  labels?: { left: string; right: string };
  options?: string[];
};

/**
 * Local reproduction of a display->editor compound grid cell. The fixture deliberately avoids
 * business labels and durable popup ids; tests exercise the structural relationship instead.
 */
export function dynamicComponentLabHtml(options: DynamicComponentFixtureOptions = {}): string {
  const portal = options.portal === true;
  const ariaControls = options.ariaControls !== false;
  const initiallyEnabled = options.initiallyEnabled === true;
  const labels = options.labels ?? { left: "Measure A", right: "Measure B" };
  const values = options.options ?? ["Option One", "Option Two", "Option Three"];
  const optionsMarkup = values.map((value) => `<div role="option" data-option-value="${value}" aria-selected="false">${value}</div>`).join("");
  return `
    <table data-grid-key="reproduction-grid">
      <thead><tr><th>${labels.left}</th><th>${labels.right}</th></tr></thead>
      <tbody>
        ${["row-a", "row-b"].map((rowId) => `
          <tr data-row-id="${rowId}">
            ${["left", "right"].map((side) => `<td data-column="${side === "left" ? labels.left : labels.right}" data-cell="${rowId}-${side}">
              <button type="button" data-display="${rowId}-${side}">Summary</button>
            </td>`).join("")}
          </tr>`).join("")}
      </tbody>
    </table>
    <script>
      let surfaceSerial = 0;
      const optionsMarkup = ${JSON.stringify(optionsMarkup)};
      const usePortal = ${JSON.stringify(portal)};
      const useAriaControls = ${JSON.stringify(ariaControls)};
      const inputInitiallyEnabled = ${JSON.stringify(initiallyEnabled)};
      const surfaceFor = (cell, combo) => {
        const surface = document.createElement('div');
        surface.setAttribute('role', 'listbox');
        surface.dataset.surface = 'dynamic';
        surface.id = 'surface-' + (++surfaceSerial);
        surface.innerHTML = optionsMarkup;
        if (usePortal) document.body.appendChild(surface); else combo.parentElement.appendChild(surface);
        combo.setAttribute('aria-expanded', 'true');
        if (useAriaControls) combo.setAttribute('aria-controls', surface.id);
        surface.querySelectorAll('[role="option"]').forEach((option) => option.addEventListener('focus', () => {
          option.dataset.focused = 'true';
        }));
        surface.querySelectorAll('[role="option"]').forEach((option) => option.addEventListener('click', () => {
          surface.querySelectorAll('[role="option"]').forEach((item) => item.setAttribute('aria-selected', 'false'));
          option.setAttribute('aria-selected', 'true');
          combo.textContent = option.textContent;
          combo.dataset.selected = option.dataset.optionValue;
          combo.setAttribute('aria-expanded', 'false');
          const input = cell.querySelector('input[data-child-role="amount_or_text"]');
          if (input) input.disabled = false;
          surface.remove();
        }));
      };
      document.querySelectorAll('[data-display]').forEach((display) => display.addEventListener('click', () => {
        const cell = display.parentElement;
        const editor = document.createElement('div');
        editor.dataset.editor = 'materialized';
        const combo = document.createElement('button');
        combo.type = 'button'; combo.setAttribute('role', 'combobox'); combo.setAttribute('aria-expanded', 'false'); combo.textContent = 'Choose';
        const input = document.createElement('input');
        input.type = 'text'; input.dataset.childRole = 'amount_or_text'; input.disabled = !inputInitiallyEnabled;
        combo.addEventListener('click', () => surfaceFor(cell, combo));
        input.addEventListener('blur', () => {
          if (!input.value) return;
          const selected = combo.dataset.selected || 'none';
          const displayAgain = document.createElement('button');
          displayAgain.type = 'button'; displayAgain.dataset.display = display.dataset.display; displayAgain.dataset.displayValue = selected + ' ' + input.value; displayAgain.textContent = selected + ' ' + input.value;
          cell.replaceChildren(displayAgain);
          displayAgain.addEventListener('click', () => displayAgain.dispatchEvent(new Event('reopen', { bubbles: true })));
        });
        editor.append(combo, input); cell.replaceChildren(editor);
      }));
    </script>`;
}
