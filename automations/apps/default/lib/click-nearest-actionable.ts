import { Page } from '@playwright/test';

export type ClickNearestActionableOptions = {
  exact?: boolean;
  timeout?: number;
  maxAncestorDepth?: number;
};

const CLICKABLE_TAGS = new Set(['button', 'a', 'input', 'label']);
const CLICKABLE_ROLES = new Set(['button', 'link', 'option', 'radio', 'checkbox', 'tab', 'menuitem', 'treeitem']);
const CLICKABLE_CLASS_PATTERNS = ['card', 'cursor-pointer', 'clickable', 'btn', 'interactive', 'selectable'];

function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function buildFlexibleRegex(target: string): RegExp {
  const normalized = normalizeText(target);
  const tokens = normalized.split(/\s+/).filter(t => t.length > 2);
  if (tokens.length === 0) {
    return new RegExp(normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
  const escaped = tokens.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('.*'), 'i');
}

function buildExactRegex(target: string): RegExp {
  const normalized = normalizeText(target);
  return new RegExp('^' + normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');
}

async function findNearestActionableAncestor(element: HTMLElement, maxDepth: number): Promise<HTMLElement | null> {
  let current: HTMLElement | null = element;
  let depth = 0;

  while (current && depth < maxDepth) {
    const tagName = current.tagName.toLowerCase();
    const role = current.getAttribute('role');
    const hasOnClick = !!(current as any).onclick || current.getAttribute('onclick');
    const tabIndex = current.getAttribute('tabindex');
    const isFocusable = tabIndex !== null || current.tagName === 'A' || current.tagName === 'BUTTON';
    const hasClickableClass = CLICKABLE_CLASS_PATTERNS.some(pattern => {
      const className = current.className || '';
      return typeof className === 'string' && className.includes(pattern);
    });

    if (CLICKABLE_TAGS.has(tagName) || CLICKABLE_ROLES.has(role || '') || hasOnClick || hasClickableClass) {
      return current;
    }

    if (isFocusable && depth > 0) {
      return current;
    }

    current = current.parentElement;
    depth++;
  }

  return null;
}

export async function clickNearestActionableByText(
  page: Page,
  target: string,
  options: ClickNearestActionableOptions = {}
): Promise<{ clicked: boolean; method: string }> {
  const { exact = false, timeout = 10000, maxAncestorDepth = 5 } = options;
  const regex = exact ? buildExactRegex(target) : buildFlexibleRegex(target);

  // Priority 1: Try getByRole for common actionable roles
  const rolesToTry = ['button', 'link', 'option', 'radio', 'checkbox', 'menuitem'] as const;

  for (const role of rolesToTry) {
    try {
      const locator = page.getByRole(role, { name: regex, exact: false });
      if (await locator.count() > 0) {
        await locator.first().click({ timeout });
        return { clicked: true, method: `getByRole(${role})` };
      }
    } catch {
      // Continue to next role
    }
  }

  // Priority 2: Try getByText and find nearest actionable ancestor
  try {
    const textLocator = page.getByText(regex).first();
    const elementHandle = await textLocator.elementHandle({ timeout });

    if (elementHandle) {
      const ancestor = await elementHandle.evaluateHandle(
        (el, maxDepth) => {
          let current: HTMLElement | null = el as HTMLElement;
          let depth = 0;

          const clickableTags = ['button', 'a', 'input', 'label'];
          const clickableRoles = ['button', 'link', 'option', 'radio', 'checkbox', 'tab', 'menuitem', 'treeitem'];
          const clickableClassPatterns = ['card', 'cursor-pointer', 'clickable', 'btn', 'interactive', 'selectable'];

          while (current && depth < maxDepth) {
            const tagName = current.tagName.toLowerCase();
            const role = current.getAttribute('role');
            const hasOnClick = !!(current as any).onclick || current.getAttribute('onclick');
            const tabIndex = current.getAttribute('tabindex');
            const isFocusable = tabIndex !== null || current.tagName === 'A' || current.tagName === 'BUTTON';
            const hasClickableClass = clickableClassPatterns.some(pattern => {
              const className = current.className || '';
              return typeof className === 'string' && className.includes(pattern);
            });

            if (clickableTags.includes(tagName) || clickableRoles.includes(role || '') || hasOnClick || hasClickableClass) {
              return current;
            }

            if (isFocusable && depth > 0) {
              return current;
            }

            current = current.parentElement;
            depth++;
          }

          return null;
        },
        maxAncestorDepth
      );

      const ancestorElement = ancestor.asElement();
      if (ancestorElement) {
        await ancestorElement.click({ timeout });
        return { clicked: true, method: 'getByText + ancestor' };
      }

      // No actionable ancestor found, click the text element itself
      await textLocator.click({ timeout });
      return { clicked: true, method: 'getByText (direct)' };
    }
  } catch {
    // Continue to fallback
  }

  // Priority 3: Try heading-based search (for cards with heading inside)
  try {
    const headingRegex = exact ? buildExactRegex(target) : buildFlexibleRegex(target);
    const headingLocator = page.locator('h1, h2, h3, h4, h5, h6').filter({ hasText: headingRegex }).first();

    if (await headingLocator.count() > 0) {
      const headingHandle = await headingLocator.elementHandle({ timeout });

      if (headingHandle) {
        const ancestor = await headingHandle.evaluateHandle(
          (el, maxDepth) => {
            let current: HTMLElement | null = el as HTMLElement;
            let depth = 0;

            const clickableTags = ['button', 'a', 'input', 'label'];
            const clickableRoles = ['button', 'link', 'option', 'radio', 'checkbox', 'tab', 'menuitem', 'treeitem'];
            const clickableClassPatterns = ['card', 'cursor-pointer', 'clickable', 'btn', 'interactive', 'selectable'];

            while (current && depth < maxDepth) {
              const tagName = current.tagName.toLowerCase();
              const role = current.getAttribute('role');
              const hasOnClick = !!(current as any).onclick || current.getAttribute('onclick');
              const hasClickableClass = clickableClassPatterns.some(pattern => {
                const className = current.className || '';
                return typeof className === 'string' && className.includes(pattern);
              });

              if (clickableTags.includes(tagName) || clickableRoles.includes(role || '') || hasOnClick || hasClickableClass) {
                return current;
              }

              current = current.parentElement;
              depth++;
            }

            return null;
          },
          maxAncestorDepth
        );

        const ancestorElement = ancestor.asElement();
        if (ancestorElement) {
          await ancestorElement.click({ timeout });
          return { clicked: true, method: 'heading + ancestor' };
        }

        // Click the heading itself
        await headingLocator.click({ timeout });
        return { clicked: true, method: 'heading (direct)' };
      }
    }
  } catch {
    // Continue to final fallback
  }

  // Priority 4: Final fallback - try any element containing the text
  try {
    const fallbackLocator = page.locator(`:has-text("${target.replace(/"/g, '\\"')}")`).first();
    if (await fallbackLocator.count() > 0) {
      await fallbackLocator.click({ timeout });
      return { clicked: true, method: 'has-text fallback' };
    }
  } catch {
    // All methods failed
  }

  return { clicked: false, method: 'none' };
}
