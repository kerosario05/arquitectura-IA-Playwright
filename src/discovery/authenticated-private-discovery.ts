/**
 * Authenticated Private Discovery - Microfase 2 & 2.1
 *
 * Orchestrates authenticated private catalog discovery with real login.
 * - Phase 1: Infrastructure validation (dryRun=true)
 * - Phase 2: Authenticate and reach landing page (dryRun=false)
 * - Phase 2.1: Auto-discover auth steps from login page if not configured
 * - Phase 3+: Discover private routes and controls (future)
 *
 * This is app-agnostic and works with any appSlug.
 * DO NOT hardcode project-specific logic, routes, products, or labels.
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

/**
 * Load app config synchronously from file
 */
function loadAppConfigSync(appSlug: string): Record<string, unknown> | null {
  try {
    const fs = require("node:fs");
    const path = require("node:path");
    const appsDir = path.join(process.cwd(), "automations", "apps");
    const appConfigPath = path.join(appsDir, appSlug, "app.config.json");
    if (!fs.existsSync(appConfigPath)) return null;
    const content = fs.readFileSync(appConfigPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Resolve private entry target (module to click to enter private area)
 * Priority: suggestedRoute → privateRoutes[0].module → privateRoutes[0].path[0]
 */
function resolvePrivateEntryTarget(
  appConfig: Record<string, unknown> | undefined,
  suggestedRoute?: string
): string | null {
  // 1. Check suggested route from input
  if (suggestedRoute) {
    return suggestedRoute;
  }

  // 2. Check privateRoutes configuration
  const privateRoutes = appConfig?.privateRoutes as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(privateRoutes) && privateRoutes.length > 0) {
    const firstRoute = privateRoutes[0];

    // Try to get module property
    const module = firstRoute.module as string | undefined;
    if (module) {
      return module;
    }

    // Try to get first path segment
    const path = firstRoute.path as string[] | string | undefined;
    if (Array.isArray(path) && path.length > 0) {
      return path[0];
    }
    if (typeof path === "string") {
      return path;
    }
  }

  return null;
}

/**
 * Detect if credential value was observable/applied (without exposing value)
 */
async function detectCredentialValueObserved(page: Page): Promise<{
  observed: boolean;
  visibleLength?: number;
  reason: string;
}> {
  try {
    // Look for input/display elements that might show masked/filled value
    const inputs = await page.locator("input[type='text'], input[type='password'], input[type='email'], input[type='tel'], [contenteditable], .input-field, .credential-display").all();

    for (const input of inputs) {
      const value = await input.inputValue().catch(() => "");
      const text = await input.textContent().catch(() => "");
      const placeholder = await input.getAttribute("placeholder").catch(() => "");

      // Check if element has visible value/content
      if (value && value.trim().length > 0) {
        return { observed: true, visibleLength: value.length, reason: `Input field has value length=${value.length}` };
      }

      // Check for masked display (dots, asterisks, etc.)
      if (text && /[\*•●□]/.test(text) && text.trim().length >= 3) {
        const maskCount = (text.match(/[\*•●□]/g) || []).length;
        return { observed: true, visibleLength: maskCount, reason: `Masked display detected with ${maskCount} characters` };
      }

      // Check for text display showing length
      if (text && text.match(/\d+/) && text.toLowerCase().includes("digit")) {
        const match = text.match(/(\d+)/);
        if (match) {
          return { observed: true, visibleLength: parseInt(match[1], 10), reason: `Display shows character count: ${match[1]}` };
        }
      }
    }

    // No observable value found
    return { observed: false, reason: "No input field or value display detected" };
  } catch {
    return { observed: false, reason: "Error detecting value state" };
  }
}

/**
 * Detect functional advance (not just DOM change)
 */
async function detectFunctionalAdvance(
  page: Page,
  beforeSnapshot: Awaited<ReturnType<typeof capturePageSnapshot>>,
  afterSnapshot: Awaited<ReturnType<typeof capturePageSnapshot>>
): Promise<{ advanced: boolean; reason: string }> {
  // Rule 1: URL changed
  const urlChanged = beforeSnapshot.url !== afterSnapshot.url;
  if (urlChanged) {
    return { advanced: true, reason: "URL changed" };
  }

  // Rule 2: OTP/verification screen detected
  const hasOtpPattern = /otp|token|código|verificación|one-time|code|pin|challenge/i.test(afterSnapshot.bodyTextPreview);
  if (hasOtpPattern && afterSnapshot.counts.inputs > 0) {
    return { advanced: true, reason: "OTP/verification stage appeared" };
  }

  // Rule 3: Success/completion message
  const hasSuccessPattern = /success|enviado|completad|confirma/i.test(afterSnapshot.bodyTextPreview);
  if (hasSuccessPattern) {
    return { advanced: true, reason: "Success/completion message detected" };
  }

  // Rule 4: Significant clickables change (more than 30% difference)
  const beforeClickableCount = beforeSnapshot.clickablesSample.length;
  const afterClickableCount = afterSnapshot.clickablesSample.length;
  const changePercent = Math.abs((afterClickableCount - beforeClickableCount) / (beforeClickableCount || 1));

  if (changePercent > 0.3) {
    return { advanced: true, reason: `Clickables changed significantly ${beforeClickableCount} → ${afterClickableCount}` };
  }

  // Rule 5: Input count changed (new stage likely)
  if (beforeSnapshot.counts.inputs !== afterSnapshot.counts.inputs) {
    return { advanced: true, reason: `Input fields changed ${beforeSnapshot.counts.inputs} → ${afterSnapshot.counts.inputs}` };
  }

  // No functional advance detected
  return { advanced: false, reason: "No functional stage change detected" };
}

async function captureCredentialInputState(page: Page): Promise<{
  visibleLength?: number;
  activeElement?: string;
  buttonDisabled?: boolean;
  buttonAriaDisabled?: boolean;
  validationMessages: string[];
  bodyTextPreview: string;
}> {
  const state = {
    visibleLength: undefined as number | undefined,
    activeElement: undefined as string | undefined,
    buttonDisabled: false,
    buttonAriaDisabled: false,
    validationMessages: [] as string[],
    bodyTextPreview: "",
  };

  try {
    // Get active element
    const activeTag = await page.evaluate(() => {
      const el = document.activeElement;
      if (el) {
        return `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[${el.getAttribute("role")}]` : ""}`;
      }
      return "none";
    });
    state.activeElement = activeTag;

    // Check continue button state
    const continuePatterns = [/continuar/i, /siguiente/i, /next/i, /submit/i, /aceptar/i];
    const buttons = await page.locator("button").all();
    for (const button of buttons) {
      const text = (await button.textContent()) || "";
      if (continuePatterns.some((p) => p.test(text))) {
        state.buttonDisabled = await button.isDisabled();
        const ariaDisabled = await button.getAttribute("aria-disabled");
        state.buttonAriaDisabled = ariaDisabled === "true";
        break;
      }
    }

    // Look for validation messages
    const validationElements = await page.locator("[role='alert'], .error, .validation-error, .message-error, [aria-invalid='true']").all();
    for (const el of validationElements) {
      const text = (await el.textContent()) || "";
      if (text.trim()) {
        state.validationMessages.push(text.trim().substring(0, 50));
      }
    }

    // Get body text preview
    const bodyText = await page.evaluate(() => document.body.innerText || "");
    state.bodyTextPreview = bodyText.substring(0, 150);

    return state;
  } catch {
    return state;
  }
}

async function executeVirtualKeyboardFill(
  page: Page,
  envVar: string,
  charCountOnly: boolean = false
): Promise<{
  success: boolean;
  charCount: number;
  successfulKeyClicks: number;
  missingKeys: string[];
  reason: string;
  diagnostics?: {
    activeElement?: string;
    focusedElements?: Array<{ tag: string; role?: string; classes: string; dataAttrs: string[] }>;
    hiddenInputs?: Array<{ name?: string; valueLength: number; valueHash: string }>;
    formControls?: Array<{ tag: string; name?: string; type?: string }>;
  };
}> {
  const value = process.env[envVar.replace("$", "")] || "";
  if (!value) {
    return { success: false, charCount: 0, successfulKeyClicks: 0, missingKeys: [], reason: `No value for ${envVar}` };
  }

  const charCount = value.length;
  const missingKeys: string[] = [];
  let successfulKeyClicks = 0;

  console.log(`[auth-discovery] virtualKeyboardFill ${envVar} charCount=${charCount}`);

  try {
    // Capture initial DOM state before keyboard fill
    const initialDomState = await page.evaluate(() => {
      const activeEl = document.activeElement;
      const activeInfo = activeEl ? `${activeEl.tagName.toLowerCase()}${(activeEl as any).className ? `.${(activeEl as any).className.split(' ')[0]}` : ''}` : "none";

      // Find hidden inputs and form controls
      const hiddenInputs: any[] = [];
      const formControls: any[] = [];

      document.querySelectorAll('input[type="hidden"]').forEach(inp => {
        const el = inp as HTMLInputElement;
        const hash = (el.value || "").split("").reduce((h: number, c: string) => h + c.charCodeAt(0), 0).toString(16);
        hiddenInputs.push({
          name: el.name || el.id || "unnamed",
          valueLength: el.value ? el.value.length : 0,
          valueHash: hash
        });
      });

      document.querySelectorAll('input[type="text"], input[type="password"], textarea, input[data-model], input[data-bind], input[ng-model]').forEach(inp => {
        const el = inp as HTMLInputElement;
        if (el.offsetParent !== null) { // visible
          formControls.push({
            tag: el.tagName.toLowerCase(),
            name: el.name || el.id || el.getAttribute("data-model") || el.getAttribute("ng-model") || "unnamed",
            type: el.type || "text"
          });
        }
      });

      return { activeInfo, hiddenInputs, formControls };
    });

    for (let i = 0; i < value.length; i++) {
      const char = value[i];
      // Find button by text, data-key, data-value, or aria-label containing the character
      const button = await page.locator(`button:has-text("${char}"), button[data-key="${char}"], button[data-value="${char}"], button[aria-label*="${char}"]`).first();

      if (await button.isVisible().catch(() => false)) {
        try {
          await button.click({ timeout: 2000 });
          successfulKeyClicks++;
          await page.waitForTimeout(100); // Brief pause between keystrokes
        } catch {
          missingKeys.push(char);
        }
      } else {
        missingKeys.push(char);
      }
    }

    // Capture final DOM state after keyboard fill
    const finalDomState = await page.evaluate(() => {
      const activeEl = document.activeElement;
      const activeInfo = activeEl ? `${activeEl.tagName.toLowerCase()}${(activeEl as any).className ? `.${(activeEl as any).className.split(' ')[0]}` : ''}` : "none";

      const hiddenInputs: any[] = [];
      const formControls: any[] = [];

      document.querySelectorAll('input[type="hidden"]').forEach(inp => {
        const el = inp as HTMLInputElement;
        const hash = (el.value || "").split("").reduce((h: number, c: string) => h + c.charCodeAt(0), 0).toString(16);
        hiddenInputs.push({
          name: el.name || el.id || "unnamed",
          valueLength: el.value ? el.value.length : 0,
          valueHash: hash
        });
      });

      document.querySelectorAll('input[type="text"], input[type="password"], textarea, input[data-model], input[data-bind], input[ng-model]').forEach(inp => {
        const el = inp as HTMLInputElement;
        if (el.offsetParent !== null) { // visible
          formControls.push({
            tag: el.tagName.toLowerCase(),
            name: el.name || el.id || el.getAttribute("data-model") || el.getAttribute("ng-model") || "unnamed",
            type: el.type || "text"
          });
        }
      });

      return { activeInfo, hiddenInputs, formControls };
    });

    const allKeysSuccessful = missingKeys.length === 0;
    return {
      success: allKeysSuccessful,
      charCount,
      successfulKeyClicks,
      missingKeys,
      reason: allKeysSuccessful ? "All characters entered" : `Missing ${missingKeys.length} keys: ${missingKeys.join(",")}`,
      diagnostics: {
        activeElement: finalDomState.activeInfo,
        focusedElements: finalDomState.formControls,
        hiddenInputs: finalDomState.hiddenInputs,
        formControls: finalDomState.formControls
      }
    };
  } catch (err) {
    return {
      success: false,
      charCount,
      successfulKeyClicks,
      missingKeys,
      reason: (err instanceof Error ? err.message : String(err))
    };
  }
}

/**
 * Detect OTP keypad by visual grid rows
 */
async function detectKeypadByGridRows(page: Page, digitBearingElements: Array<any>): Promise<{
  keypadContainers: Array<any>;
  rowsDetected: Array<{ size: number; y: number; elements: Array<any> }>;
  resolvedKeys: Map<string, boolean>;
  diagnostics: {
    containersFound: number;
    rowsDetected: number;
    rowSizes: number[];
    resolvedKeysCount: number;
    uniqueDigitsResolved: number;
    missingDigits: string[];
    reasonCodes: string[];
  };
}> {
  const resolvedKeys = new Map<string, boolean>();
  const keypadContainers: Array<any> = [];
  const rowsDetected: Array<any> = [];
  const reasonCodes: Set<string> = new Set();
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  const viewportHeight = await page.evaluate(() => window.innerHeight);

  try {
    // Find potential keypad containers: visible, mediano-sized, with multiple digit-bearing children
    for (const item of digitBearingElements) {
      if (item.digitsFound.length < 6) continue; // At least 6 digits
      if (item.bbox.w > viewportWidth * 0.8 || item.bbox.h > viewportHeight * 0.8) continue; // Not full screen
      if (item.bbox.w < 100 || item.bbox.h < 100) continue; // Reasonable size

      try {
        // Check if this element has visual rows
        const rowInfo = await item.el.evaluate((e: HTMLElement) => {
          const children = Array.from(e.children) as HTMLElement[];
          const visibleChildren = children.filter(c => {
            const rect = c.getBoundingClientRect();
            return rect.height > 0 && rect.width > 0;
          });

          if (visibleChildren.length < 9) return null;

          // Group by Y position (rows)
          const yGroups = new Map<number, HTMLElement[]>();
          const yTolerance = 5;

          for (const child of visibleChildren) {
            const rect = child.getBoundingClientRect();
            let found = false;

            for (const [y] of yGroups.entries()) {
              if (Math.abs(rect.y - y) < yTolerance) {
                yGroups.get(y)!.push(child);
                found = true;
                break;
              }
            }

            if (!found) {
              yGroups.set(Math.round(rect.y), [child]);
            }
          }

          // Convert to array of rows sorted by Y
          const rows = Array.from(yGroups.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([y, children]) => ({
              y,
              size: children.length,
              children,
              elements: children.map(c => ({
                tag: c.tagName.toLowerCase(),
                text: (c.textContent || "").trim(),
                bbox: {
                  x: Math.round(c.getBoundingClientRect().x),
                  y: Math.round(c.getBoundingClientRect().y),
                  w: Math.round(c.getBoundingClientRect().width),
                  h: Math.round(c.getBoundingClientRect().height)
                }
              }))
            }));

          // Check if rows match keypad pattern (3-3-3-1 or similar grid)
          if (rows.length >= 3 && rows.length <= 5) {
            const sizes = rows.map(r => r.size);
            const isValidPattern =
              (sizes.join(',') === '3,3,3,1') ||
              (sizes.join(',') === '3,3,3') ||
              (sizes.some(s => s >= 3) && rows.length >= 3);

            if (isValidPattern) {
              return { rows, sizes };
            }
          }

          return null;
        });

        if (rowInfo) {
          keypadContainers.push({
            tag: item.tag,
            digitsFound: item.digitsFound.join(''),
            bbox: item.bbox,
            rowCount: rowInfo.rows.length,
            rowSizes: rowInfo.sizes
          });

          // Resolve keys from rows
          for (const row of rowInfo.rows) {
            for (const element of row.elements) {
              const text = element.text;
              const digitMatch = text.match(/[0-9]/);
              if (digitMatch && /^[0-9]$/.test(text.trim())) {
                try {
                  // Find the actual element in DOM and check if clickable
                  const elementInPage = await item.el.evaluate((parent: HTMLElement, targetText: string, x: number, y: number) => {
                    const el = document.elementFromPoint(x, y);
                    if (el && el.textContent?.trim() === targetText) {
                      let current: HTMLElement | null = el as HTMLElement;
                      for (let i = 0; i < 3 && current; i++) {
                        if (
                          current.onclick !== null ||
                          getComputedStyle(current).cursor === "pointer" ||
                          current.getAttribute("tabindex") !== null ||
                          current.getAttribute("role") === "button" ||
                          ["BUTTON", "A", "LI", "DIV"].includes(current.tagName)
                        ) {
                          return true;
                        }
                        current = current.parentElement;
                      }
                    }
                    return false;
                  }, text, element.bbox.x + element.bbox.w / 2, element.bbox.y + element.bbox.h / 2);

                  if (elementInPage) {
                    resolvedKeys.set(text.trim(), true);
                  }
                } catch {
                  // Continue
                }
              }
            }
          }

          rowsDetected.push(...rowInfo.rows);
        } else {
          reasonCodes.add("keypad_grid_pattern_not_matched");
        }
      } catch {
        reasonCodes.add("keypad_row_analysis_failed");
      }
    }

    if (keypadContainers.length === 0) {
      reasonCodes.add("no_keypad_container_found");
    }
  } catch (err) {
    reasonCodes.add("grid_detection_failed");
  }

  // Find missing digits
  const allDigits = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  const missingDigits = Array.from(allDigits).filter(d => !resolvedKeys.has(d));

  return {
    keypadContainers,
    rowsDetected,
    resolvedKeys,
    diagnostics: {
      containersFound: keypadContainers.length,
      rowsDetected: rowsDetected.length,
      rowSizes: keypadContainers.flatMap(k => k.rowSizes),
      resolvedKeysCount: resolvedKeys.size,
      uniqueDigitsResolved: resolvedKeys.size,
      missingDigits,
      reasonCodes: Array.from(reasonCodes)
    }
  };
}

/**
 * Scan visual keypad containers by layout (geometry, children structure, rows)
 */
async function scanVisualKeypadLayout(page: Page): Promise<{
  containerScan: Array<any>;
  rowPatternScan: Array<any>;
  diagnostics: {
    scannedContainers: number;
    containersByTag: Record<string, number>;
    potentialKeypadPatterns: number;
  };
}> {
  const containerScan: Array<any> = [];
  const rowPatternScan: Array<any> = [];
  const containersByTag: Record<string, number> = {};
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  const viewportArea = viewportWidth * viewportHeight;

  try {
    // Use same universal element collection as forensic snapshot
    const allElements = await page.locator("*").all();

    // Filter to container tags and collect visible ones
    const visibleBase: Array<any> = [];
    const containerTags = new Set(["DIV", "SECTION", "ARTICLE", "UL", "OL"]);
    let visibleDivs = 0, visibleSections = 0, visibleArticles = 0, visibleUls = 0, visibleOls = 0;

    for (const el of allElements.slice(0, 500)) {
      try {
        const isVisible = await el.isVisible().catch(() => false);
        if (!isVisible) continue;

        const tag = await el.evaluate(e => e.tagName);
        if (!containerTags.has(tag)) continue;

        // Count by tag
        if (tag === "DIV") visibleDivs++;
        else if (tag === "SECTION") visibleSections++;
        else if (tag === "ARTICLE") visibleArticles++;
        else if (tag === "UL") visibleUls++;
        else if (tag === "OL") visibleOls++;

        const bbox = await el.boundingBox();
        if (!bbox || bbox.width === 0 || bbox.height === 0) continue;

        const childCount = await el.evaluate(e => Array.from(e.children).filter(c => {
          const r = (c as HTMLElement).getBoundingClientRect();
          return r.height > 0 && r.width > 0;
        }).length);

        visibleBase.push({
          el,
          tag: tag.toLowerCase(),
          bbox,
          childCount
        });
      } catch {
        // Skip problematic elements
      }
    }

    // Filter candidates by geometry and structure
    let rejectedByArea = 0, rejectedByChildren = 0, rejectedByVisibility = 0;
    const candidates: Array<any> = [];

    for (const item of visibleBase) {
      const area = item.bbox.width * item.bbox.height;
      if (area > viewportArea * 0.6) {
        rejectedByArea++;
        continue;
      }
      if (item.childCount < 1) {
        rejectedByChildren++;
        continue;
      }
      candidates.push(item);
    }

    // Process candidates
    const maxContainers = Math.min(candidates.length, 10);
    for (let i = 0; i < maxContainers; i++) {
      const cand = candidates[i];
      const el = cand.el;
      const tag = cand.tag;

      try {
        const descendantCount = await el.evaluate(e => {
          let count = 0;
          e.querySelectorAll("*").forEach(() => count++);
          return count;
        });

        const digitCount = await el.evaluate(e => {
          let count = 0;
          e.querySelectorAll("*").forEach(desc => {
            if (/[0-9]/.test(desc.textContent || "")) count++;
          });
          return count;
        });

        const descendantGridAnalysis = await el.evaluate((el: HTMLElement, containerBbox: any) => {
          const containerRect = el.getBoundingClientRect();
          const containerArea = containerRect.width * containerRect.height;

          // Collect visible descendants: div, button, span, role=button, tabindex, svg, path
          const keypadTags = new Set(["DIV", "BUTTON", "SPAN", "SVG", "PATH"]);
          const descendants: any[] = [];

          el.querySelectorAll("div, button, span, [role='button'], [tabindex], svg, path").forEach((desc: any) => {
            const r = desc.getBoundingClientRect();
            if (r.height === 0 || r.width === 0) return;
            if (r.height > containerRect.height * 0.8) return; // Not too large
            if (r.width > containerRect.width * 0.8) return;

            const relX = r.x - containerRect.x;
            const relY = r.y - containerRect.y;

            descendants.push({
              tag: desc.tagName.toLowerCase(),
              bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
              relPos: { x: Math.round(relX), y: Math.round(relY) },
              text: (desc.textContent || "").trim(),
              hasDigit: /[0-9]/.test(desc.textContent || ""),
              role: desc.getAttribute("role"),
              tabindex: desc.getAttribute("tabindex")
            });
          });

          // Group descendants by Y coordinate
          if (descendants.length < 3) return null;

          const yGroups = new Map<number, any[]>();
          const yTolerance = Math.max(5, containerRect.height / 10);

          for (const desc of descendants) {
            let found = false;
            for (const [y] of yGroups.entries()) {
              if (Math.abs(desc.bbox.y - y) < yTolerance) {
                yGroups.get(y)!.push(desc);
                found = true;
                break;
              }
            }
            if (!found) {
              yGroups.set(Math.round(desc.bbox.y), [desc]);
            }
          }

          const descendantRowSizes = Array.from(yGroups.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([_, items]) => items.length);

          // Strict keypad pattern validation
          const totalDescendants = descendantRowSizes.reduce((s, r) => s + r, 0);
          const maxRowSize = Math.max(...descendantRowSizes, 0);
          const hasAnyRowTooLarge = descendantRowSizes.some(r => r > 4);
          const isValidPatternCount = totalDescendants >= 9 && totalDescendants <= 11;
          const isValidRowDistribution = descendantRowSizes.length >= 3 && descendantRowSizes.length <= 4 && !hasAnyRowTooLarge;

          const hasKeypadPattern =
            (descendantRowSizes.join(',') === '3,3,3,1') ||
            (descendantRowSizes.join(',') === '3,3,3' && totalDescendants === 9) ||
            (descendantRowSizes[descendantRowSizes.length - 1] === 1 && descendantRowSizes.length === 4 && descendantRowSizes.slice(0, 3).every(r => r === 3)) ||
            (isValidPatternCount && isValidRowDistribution);

          return {
            descendantCandidates: descendants.length,
            descendantRowSizes,
            matchedPattern: hasKeypadPattern,
            digitLikeDescendants: descendants.filter(d => d.hasDigit).length
          };
        }, { width: cand.bbox.width, height: cand.bbox.height });

        const childSample = await el.evaluate((el: HTMLElement) => {
          const children = Array.from(el.children) as HTMLElement[];
          const visibleChildren = children.filter(c => {
            const r = c.getBoundingClientRect();
            return r.height > 0 && r.width > 0;
          });
          return visibleChildren.slice(0, 8).map(c => {
            const r = c.getBoundingClientRect();
            return {
              tag: c.tagName.toLowerCase(),
              bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
            };
          });
        });

        // Group by Y coordinate for row detection
        const yGroups = new Map<number, any[]>();
        const yTolerance = 8;

        for (const child of childSample) {
          let found = false;
          for (const [y] of yGroups) {
            if (Math.abs(child.bbox.y - y) < yTolerance) {
              yGroups.get(y)!.push(child);
              found = true;
              break;
            }
          }
          if (!found) {
            yGroups.set(Math.round(child.bbox.y), [child]);
          }
        }

        const rowSizes = Array.from(yGroups.entries())
          .sort((a, b) => a[0] - b[0])
          .map(([_, children]) => children.length);

        const hasPattern =
          rowSizes.join(',') === '3,3,3,1' ||
          (rowSizes.join(',') === '3,3,3' && rowSizes.reduce((s, r) => s + r, 0) === 9) ||
          (rowSizes.length >= 3 && rowSizes.length <= 4 && rowSizes.every(r => r >= 2 && r <= 4) && rowSizes.reduce((s, r) => s + r, 0) >= 9);

        // Use descendant pattern if available and better
        const finalRowSizes = descendantGridAnalysis && descendantGridAnalysis.matchedPattern ? descendantGridAnalysis.descendantRowSizes : rowSizes;
        const finalPattern = descendantGridAnalysis && descendantGridAnalysis.matchedPattern ? true : hasPattern;

        containerScan.push({
          el: cand.el,
          tag,
          bbox: cand.bbox,
          visibleChildrenCount: cand.childCount,
          directVisibleChildrenCount: cand.childCount,
          descendantVisibleCount: descendantCount,
          descendantDigitTextCount: digitCount,
          rowSizes,
          descendantRowSizes: descendantGridAnalysis?.descendantRowSizes || [],
          matchedPattern: finalPattern,
          descendantGridAnalysis
        });

        containersByTag[tag] = (containersByTag[tag] || 0) + 1;

        if (finalPattern) {
          rowPatternScan.push({
            rowCount: finalRowSizes.length,
            rowSizes: finalRowSizes,
            candidatePattern: true,
            isDescendantBased: descendantGridAnalysis && descendantGridAnalysis.matchedPattern
          });
        }
      } catch {
        // Skip problematic candidates
      }
    }

    return {
      containerScan,
      rowPatternScan,
      diagnostics: {
        scannedContainers: candidates.length,
        containersByTag,
        potentialKeypadPatterns: rowPatternScan.filter(p => p.candidatePattern).length,
        visibleBase: {
          visibleTotal: visibleBase.length,
          visibleDivs,
          visibleSections,
          visibleArticles,
          visibleUls,
          visibleOls,
          rawCandidates: visibleBase.length,
          rejectedByArea,
          rejectedByChildren,
          rejectedByVisibility
        }
      }
    };
  } catch (err) {
    return { containerScan: [], rowPatternScan: [], diagnostics: { scannedContainers: 0, containersByTag: {}, potentialKeypadPatterns: 0 } };
  }
}

/**
 * Refine OTP numeric key candidates, excluding global containers and resolving from keypad structure
 */
async function refineOtpNumericKeyCandidates(page: Page, digitBearingElements: Array<any>): Promise<{
  refinedKeys: Map<string, boolean>;
  diagnostics: {
    ignoredGlobalContainers: string[];
    keypadContainers: Array<any>;
    resolvedByAncestor: number;
    resolvedByLeaf: number;
    unresolvedAggregatedText: boolean;
    uniqueDigitsResolved: number;
    missingDigits: string[];
    reasonCodes: string[];
    coordinatePlan?: any;
  };
}> {
  const refinedKeys = new Map<string, boolean>();
  const ignoredGlobalContainers: string[] = [];
  const keypadContainers: Array<any> = [];
  const reasonCodes: Set<string> = new Set();
  let leafCandidateCount = 0;
  let resolvedByAncestor = 0;
  let resolvedByLeaf = 0;
  let unresolvedAggregatedText = false;
  let coordinatePlan: any = undefined;

  // Global/container exclusion patterns
  const excludeTags = new Set(["HTML", "BODY", "MAIN", "ARTICLE", "SECTION", "NAV", "FOOTER", "HEADER"]);
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  const viewportArea = viewportWidth * viewportHeight;

  // Identify keypad containers: multi-digit elements with clickable ancestors
  const keypadCandidates: Array<any> = [];
  for (const item of digitBearingElements) {
    if (item.digitsFound.length >= 6 && item.bbox.w > 50 && item.bbox.h > 50 && item.bbox.w * item.bbox.h < viewportArea * 0.6) {
      keypadCandidates.push(item);
    }
  }

  // Process leaf candidates first
  for (const item of digitBearingElements) {
    try {
      const tag = item.tag.toUpperCase();

      // Exclude global containers
      if (excludeTags.has(tag)) {
        ignoredGlobalContainers.push(tag);
        continue;
      }

      // Exclude elements that span most of viewport
      const bboxArea = item.bbox.w * item.bbox.h;
      if (bboxArea > viewportArea * 0.5) {
        reasonCodes.add("geometry_too_large");
        continue;
      }

      // Prefer single-digit elements (leaf candidates)
      if (item.digitsFound.length === 1) {
        const digit = item.digitsFound[0];
        leafCandidateCount++;

        // Check if clickable or has clickable ancestor
        const isClickable = await item.el.evaluate((e: HTMLElement) => {
          let current: HTMLElement | null = e;
          for (let i = 0; i < 4 && current; i++) {
            if (
              current.onclick !== null ||
              getComputedStyle(current).cursor === "pointer" ||
              current.getAttribute("tabindex") !== null ||
              current.getAttribute("role") === "button" ||
              ["BUTTON", "A", "LI"].includes(current.tagName)
            ) {
              return true;
            }
            current = current.parentElement;
          }
          return false;
        });

        if (isClickable) {
          refinedKeys.set(digit, true);
          resolvedByLeaf++;
        } else {
          reasonCodes.add("ancestor_not_clickable");
        }
      }
    } catch {
      reasonCodes.add("element_evaluation_failed");
    }
  }

  // If leaf resolution insufficient, try keypad structure resolution
  if (refinedKeys.size < 10 && keypadCandidates.length > 0) {
    for (const keypadItem of keypadCandidates) {
      try {
        keypadContainers.push({
          tag: keypadItem.tag,
          digitsFound: keypadItem.digitsFound.join(''),
          bbox: keypadItem.bbox
        });

        // Try to resolve each digit within keypad structure
        const allDigits = keypadItem.digitsFound;

        // Check if keypad has per-digit elements or aggregated text
        const hasPerDigitStructure = await keypadItem.el.evaluate((e: HTMLElement) => {
          // Look for li, div, span, button children
          const children = Array.from(e.children) as HTMLElement[];
          const elementChildren = children.filter(c => {
            const tag = c.tagName.toLowerCase();
            return ["li", "div", "span", "button", "a"].includes(tag);
          });
          return elementChildren.length >= allDigits.length * 0.5;
        });

        if (hasPerDigitStructure) {
          // Try to map digits to child elements
          for (const digit of allDigits) {
            try {
              const found = await keypadItem.el.evaluate((e: HTMLElement, d: string) => {
                const children = Array.from(e.querySelectorAll("li, div, span, button")) as HTMLElement[];
                for (const child of children) {
                  if (child.textContent?.trim() === d) {
                    const rect = child.getBoundingClientRect();
                    if (rect.height > 0 && rect.width > 0) {
                      return true;
                    }
                  }
                }
                return false;
              }, digit);

              if (found && !refinedKeys.has(digit)) {
                refinedKeys.set(digit, true);
                resolvedByAncestor++;
              }
            } catch {
              // Skip
            }
          }
        } else {
          unresolvedAggregatedText = true;
          reasonCodes.add("keypad_text_aggregated_no_per_digit_nodes");
        }

        // Build coordinate plan if keypad structure is regular and has reasonable size
        if (allDigits.length >= 10 && !coordinatePlan) {
          const cellWidth = keypadItem.bbox.w / 3;
          const cellHeight = keypadItem.bbox.h / 4;
          const plan: any = {
            keypadBbox: keypadItem.bbox,
            gridDims: { cols: 3, rows: 4 },
            estimatedCellSize: { w: cellWidth, h: cellHeight },
            digitGrid: {}
          };

          const digitPositions = [
            { digit: "1", row: 0, col: 0 },
            { digit: "2", row: 0, col: 1 },
            { digit: "3", row: 0, col: 2 },
            { digit: "4", row: 1, col: 0 },
            { digit: "5", row: 1, col: 1 },
            { digit: "6", row: 1, col: 2 },
            { digit: "7", row: 2, col: 0 },
            { digit: "8", row: 2, col: 1 },
            { digit: "9", row: 2, col: 2 },
            { digit: "0", row: 3, col: 1 }
          ];

          for (const pos of digitPositions) {
            if (allDigits.includes(pos.digit)) {
              plan.digitGrid[pos.digit] = {
                estimatedX: keypadItem.bbox.x + pos.col * cellWidth + cellWidth / 2,
                estimatedY: keypadItem.bbox.y + pos.row * cellHeight + cellHeight / 2
              };
            }
          }

          coordinatePlan = plan;
          reasonCodes.add("digit_coordinate_plan_available");
        }
      } catch {
        reasonCodes.add("keypad_structure_evaluation_failed");
      }
    }
  }

  // If still insufficient, try grid row detection
  if (refinedKeys.size < 10) {
    try {
      const gridResult = await detectKeypadByGridRows(page, digitBearingElements);
      if (gridResult.resolvedKeys.size > refinedKeys.size) {
        // Use grid-resolved keys
        for (const [digit, val] of gridResult.resolvedKeys) {
          if (!refinedKeys.has(digit)) {
            refinedKeys.set(digit, val);
          }
        }
        // Add grid diagnostics
        keypadContainers.push(...gridResult.keypadContainers);
        reasonCodes.delete("keypad_container_not_found");
        reasonCodes.add("keypad_resolved_by_grid_rows");
      }
    } catch {
      reasonCodes.add("grid_row_detection_failed");
    }
  }

  if (keypadCandidates.length === 0 && refinedKeys.size === 0) {
    reasonCodes.add("keypad_container_not_found");
  }

  // Find missing digits
  const allDigits = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  const missingDigits = Array.from(allDigits).filter(d => !refinedKeys.has(d));

  return {
    refinedKeys,
    diagnostics: {
      ignoredGlobalContainers,
      keypadContainers,
      resolvedByAncestor,
      resolvedByLeaf,
      unresolvedAggregatedText,
      uniqueDigitsResolved: refinedKeys.size,
      missingDigits,
      reasonCodes: Array.from(reasonCodes),
      coordinatePlan
    }
  };
}


/**
 * Build OTP virtual keypad map using Playwright locators
 * Returns map of digit -> locator for each numeric button
 */
async function buildOtpVirtualKeypadMap(page: Page): Promise<{ map: Record<string, any>; uniqueDigits: string[]; missingDigits: string[]; buttonCount: number; digitButtonCount: number }> {
  const digitMap: Record<string, any> = {};
  const foundDigits = new Set<string>();
  const allDigits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

  try {
    // Get all buttons
    const buttons = await page.locator('button').all();
    let buttonCount = buttons.length;

    for (const button of buttons) {
      try {
        const isVisible = await button.isVisible({ timeout: 100 }).catch(() => false);
        if (!isVisible) continue;

        // Get accessible text or visible text
        const textContent = (await button.textContent()) || "";
        const ariaLabel = (await button.getAttribute("aria-label")) || "";
        const buttonText = (textContent || ariaLabel).trim();

        // Only accept single digit
        if (/^[0-9]$/.test(buttonText)) {
          foundDigits.add(buttonText);
          if (!digitMap[buttonText]) {
            digitMap[buttonText] = button; // Store first locator for each digit
          }
        }
      } catch {
        // Skip button if error
      }
    }

    const uniqueDigits = Array.from(foundDigits).sort();
    const missingDigits = allDigits.filter(d => !foundDigits.has(d));

    return {
      map: digitMap,
      uniqueDigits,
      missingDigits,
      buttonCount,
      digitButtonCount: foundDigits.size
    };
  } catch (err) {
    return {
      map: {},
      uniqueDigits: [],
      missingDigits: allDigits,
      buttonCount: 0,
      digitButtonCount: 0
    };
  }
}

/**
 * Fill OTP by clicking virtual keypad buttons
 */
async function fillOtpVirtualKeypad(page: Page, otpSecret: string, diagnostics: any[]): Promise<boolean> {
  try {
    const keypadMap = await buildOtpVirtualKeypadMap(page);

    diagnostics.push({
      level: "info",
      code: "otp_virtual_keyboard_detected",
      message: `Virtual keyboard detected with ${keypadMap.digitButtonCount} unique digits`,
    });

    diagnostics.push({
      level: "info",
      code: "otp_virtual_keyboard_key_map",
      message: `UniqueDigits=${keypadMap.uniqueDigits.join("")} Missing=[${keypadMap.missingDigits.join(",")}] ButtonCount=${keypadMap.buttonCount}`,
    });

    // Check if all OTP digits are available
    const otpDigits = otpSecret.split("");
    let hasAllDigits = true;
    for (const digit of otpDigits) {
      if (!keypadMap.map[digit]) {
        diagnostics.push({
          level: "warning",
          code: "otp_virtual_keyboard_missing_key",
          message: `Missing OTP key: ${digit}`,
        });
        hasAllDigits = false;
      }
    }

    if (!hasAllDigits) {
      return false;
    }

    diagnostics.push({
      level: "info",
      code: "otp_virtual_keyboard_fill_started",
      message: `Starting OTP fill with ${otpDigits.length} digits`,
    });

    // Click each digit
    for (const digit of otpDigits) {
      try {
        const digitButton = keypadMap.map[digit];
        await digitButton.click();
        diagnostics.push({
          level: "info",
          code: "otp_virtual_keyboard_key_click",
          message: `Clicked digit: ${digit}`,
        });
        await page.waitForTimeout(100); // Brief wait after click
      } catch (clickErr) {
        diagnostics.push({
          level: "warning",
          code: "otp_virtual_keyboard_key_click",
          message: `Failed to click digit ${digit}: ${clickErr instanceof Error ? clickErr.message : String(clickErr)}`,
        });
        return false;
      }
    }

    diagnostics.push({
      level: "info",
      code: "otp_virtual_keyboard_fill_completed",
      message: `OTP fill completed for ${otpDigits.length} digits`,
    });

    return true;
  } catch (err) {
    diagnostics.push({
      level: "error",
      code: "otp_virtual_keyboard_fill_error",
      message: `Virtual keyboard fill failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return false;
  }
}

/**
 * Collect elements bearing digits using consistent criteria
 */
async function collectDigitBearingElements(page: Page, maxElements: number = 200): Promise<Array<{
  el: any;
  digitsFound: string[];
  sources: string[];
  text: string;
  ariaLabel: string | null;
  tag: string;
  role: string | null;
  isVisible: boolean;
  bbox: { x: number; y: number; w: number; h: number };
}>> {
  const elements = await page.locator("*").all();
  const digitBearing: Array<any> = [];

  for (const el of elements.slice(0, maxElements)) {
    try {
      const isVisible = await el.isVisible().catch(() => false);
      if (!isVisible) continue;

      const tag = await el.evaluate(e => e.tagName.toLowerCase());
      const role = await el.getAttribute("role");
      const text = await el.textContent().catch(() => "");
      const ariaLabel = await el.getAttribute("aria-label");
      const title = await el.getAttribute("title");

      const digitsFound = new Set<string>();
      const sources: string[] = [];

      // Check all possible sources for digits
      if (/[0-9]/.test(text)) {
        text.split('').forEach(c => /[0-9]/.test(c) && digitsFound.add(c));
        sources.push("textContent");
      }
      if (ariaLabel && /[0-9]/.test(ariaLabel)) {
        ariaLabel.split('').forEach(c => /[0-9]/.test(c) && digitsFound.add(c));
        sources.push("aria-label");
      }
      if (title && /[0-9]/.test(title)) {
        title.split('').forEach(c => /[0-9]/.test(c) && digitsFound.add(c));
        sources.push("title");
      }

      // Check SVG text nodes
      const svgText = await el.evaluate(e => {
        if (e.tagName.toLowerCase() === 'svg' || e.tagName.toLowerCase() === 'text') {
          return e.textContent || '';
        }
        return '';
      });
      if (svgText && /[0-9]/.test(svgText)) {
        svgText.split('').forEach(c => /[0-9]/.test(c) && digitsFound.add(c));
        sources.push("svg-text");
      }

      if (digitsFound.size > 0) {
        const rect = await el.boundingBox().catch(() => null);
        digitBearing.push({
          el,
          digitsFound: Array.from(digitsFound).sort(),
          sources,
          text,
          ariaLabel,
          tag,
          role,
          isVisible: true,
          bbox: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : { x: 0, y: 0, w: 0, h: 0 }
        });
      }
    } catch {
      // Skip problematic elements
    }
  }

  return digitBearing;
}

/**
 * Forensic snapshot of OTP page elements for diagnosis (no sensitive data)
 */
async function captureOtpForensicSnapshot(page: Page): Promise<{
  elementSample: Array<any>;
  counts: Record<string, number>;
  shadowIframeSummary: string;
}> {
  try {
    const elements = await page.locator("*").all();
    const elementSample: any[] = [];
    const counts: Record<string, number> = {
      totalVisibleElements: 0,
      visibleDigitTextElements: 0,
      visibleSingleCharElements: 0,
      clickableLikeElements: 0,
      roleButtonElements: 0,
      nativeButtonElements: 0,
      nativeDivElements: 0,
      nativeSpanElements: 0,
      shadowRootHosts: 0,
      iframeCount: 0
    };

    for (const el of elements.slice(0, 200)) {
      try {
        const isVisible = await el.isVisible().catch(() => false);
        if (!isVisible) continue;

        counts.totalVisibleElements++;

        const tag = await el.evaluate(e => e.tagName.toLowerCase());
        const role = await el.getAttribute("role");
        const ariaLabel = await el.getAttribute("aria-label");
        const text = await el.textContent().catch(() => "");
        const classList = await el.evaluate(e => Array.from(e.classList).slice(0, 3));
        const hasOnClick = await el.evaluate(e => !!e.onclick || !!(e as any).__vue__);
        const tabIndex = await el.getAttribute("tabindex");
        const dataKeys = await el.evaluate(e => Object.keys(e.dataset).slice(0, 3));
        const parent = await el.evaluate(e => e.parentElement?.tagName.toLowerCase());

        // Count specific types
        if (/button|click|submit/i.test(tag + role + ariaLabel + text)) counts.clickableLikeElements++;
        if (role === "button") counts.roleButtonElements++;
        if (tag === "button") counts.nativeButtonElements++;
        if (tag === "div") counts.nativeDivElements++;
        if (tag === "span") counts.nativeSpanElements++;
        if (/[0-9]/.test(text)) counts.visibleDigitTextElements++;
        if (text.trim().length === 1) counts.visibleSingleCharElements++;

        // Sample up to 40 elements
        if (elementSample.length < 40) {
          elementSample.push({
            tag,
            role: role || undefined,
            ariaLabelLen: ariaLabel?.length || 0,
            textLen: text.length,
            textIsDigit: /^[0-9]$/.test(text.trim()),
            classCount: classList.length,
            hasOnClick,
            tabIndex: tabIndex ? parseInt(tabIndex) : undefined,
            dataKeys,
            parentTag: parent,
            bbox: { x: Math.floor(Math.random() * 100), y: Math.floor(Math.random() * 100) } // placeholder for privacy
          });
        }
      } catch {
        // Skip problematic elements
      }
    }

    // Check for shadow roots and iframes
    const shadowCount = await page.evaluate(() => document.querySelectorAll('*').length - 0);
    const iframeCount = await page.locator("iframe").count();

    let shadowSummary = "";
    try {
      const shadowHosts = await page.locator("[data-shadow]").count();
      counts.shadowRootHosts = shadowHosts;
      shadowSummary = `shadowHosts=${shadowHosts}`;
    } catch {
      shadowSummary = "unknown";
    }
    counts.iframeCount = iframeCount;

    return {
      elementSample,
      counts,
      shadowIframeSummary: `${shadowSummary} iframes=${iframeCount}`
    };
  } catch (err) {
    return { elementSample: [], counts: {}, shadowIframeSummary: "forensic_capture_failed" };
  }
}

/**
 * Capture digit-bearing elements with source tracking
 */
async function captureOtpDigitCandidatesSample(page: Page): Promise<{
  digitBearingElements: Array<any>;
  sourceStats: {
    digitBearingCount: number;
    uniqueDigitsSeen: Set<string>;
    singleDigitElementCount: number;
    multiDigitElementCount: number;
    svgOrPathDigitCount: number;
    clickableAncestorCount: number;
  };
}> {
  try {
    // Use common collection function
    const digitBearing = await collectDigitBearingElements(page, 200);

    // Categorize elements
    let singleDigitCount = 0;
    let multiDigitCount = 0;
    let svgDigitCount = 0;
    let clickableAncestorCount = 0;
    const uniqueDigits = new Set<string>();

    // Sample max 12 elements for detailed inspection
    const sample = digitBearing.slice(0, 12);

    for (const item of sample) {
      item.digitsFound.forEach(d => uniqueDigits.add(d));

      if (item.digitsFound.length === 1) singleDigitCount++;
      else if (item.digitsFound.length > 1) multiDigitCount++;

      if (item.sources.includes("svg-text")) svgDigitCount++;

      // Check if element or ancestor is clickable
      try {
        const isClickable = await item.el.evaluate((e: HTMLElement) => {
          let current: HTMLElement | null = e;
          for (let i = 0; i < 4 && current; i++) {
            if (current.onclick !== null || getComputedStyle(current).cursor === "pointer" || current.getAttribute("tabindex") !== null) {
              return true;
            }
            current = current.parentElement;
          }
          return false;
        });
        if (isClickable) clickableAncestorCount++;
      } catch {
        // Skip
      }
    }

    // Build detailed sample for diagnostics
    const detailedSample = sample.map(item => ({
      tag: item.tag,
      role: item.role,
      digitsFound: item.digitsFound.join(''),
      sources: item.sources.join('|'),
      textLength: item.text.length,
      textHash: item.text.split('').reduce((s, c) => s + c.charCodeAt(0), 0).toString(16),
      bbox: item.bbox,
      ariaLabelLen: item.ariaLabel?.length || 0
    }));

    return {
      digitBearingElements: detailedSample,
      sourceStats: {
        digitBearingCount: digitBearing.length,
        uniqueDigitsSeen: uniqueDigits,
        singleDigitElementCount: singleDigitCount,
        multiDigitElementCount: multiDigitCount,
        svgOrPathDigitCount: svgDigitCount,
        clickableAncestorCount
      }
    };
  } catch (err) {
    return {
      digitBearingElements: [],
      sourceStats: {
        digitBearingCount: 0,
        uniqueDigitsSeen: new Set(),
        singleDigitElementCount: 0,
        multiDigitElementCount: 0,
        svgOrPathDigitCount: 0,
        clickableAncestorCount: 0
      }
    };
  }
}


/**
 * Detect custom OTP control
 */
async function detectCredentialActivationCandidates(page: Page): Promise<{
  candidates: Array<{ selector: string; reason: string; confidence: "high" | "medium" | "low" }>;
  bestCandidate?: { selector: string; confidence: "high" | "medium" | "low"; reason: string };
}> {
  const candidates: Array<{ selector: string; reason: string; confidence: "high" | "medium" | "low" }> = [];

  try {
    // Check for visible form inputs (primary targets)
    const visibleInputs = await page.locator("input[type='text'], input[type='password'], textarea").all();
    for (const inp of visibleInputs) {
      const isVisible = await inp.isVisible({ timeout: 100 }).catch(() => false);
      if (isVisible) {
        const name = await inp.getAttribute("name");
        const dataModel = await inp.getAttribute("data-model");
        const ariaLabel = await inp.getAttribute("aria-label");
        const reason = [name || dataModel || ariaLabel || "input"].filter(Boolean).join("|");
        const selector = name ? `input[name="${name}"]` : (dataModel ? `input[data-model]` : "input[type='text'], input[type='password'], textarea");
        candidates.push({ selector, reason: `form-input:${reason}`, confidence: "high" });
        break; // Take first visible input as high confidence
      }
    }

    // Check for elements with role, tabindex, aria-* suggesting interactivity
    const interactiveElements = await page.locator("[role], [tabindex], [aria-label], [data-model], [data-bind], [ng-model]").all();
    for (const el of interactiveElements) {
      const isVisible = await el.isVisible({ timeout: 100 }).catch(() => false);
      if (!isVisible) continue;

      const role = await el.getAttribute("role");
      const ariaLabel = await el.getAttribute("aria-label");
      const tabIndex = await el.getAttribute("tabindex");
      const dataModel = await el.getAttribute("data-model");
      const dataAttr = await el.getAttribute("data-bind") || await el.getAttribute("ng-model");

      // Credential/identification/document related keywords
      const isCredentialRelated = [ariaLabel, dataModel, dataAttr]
        .some((v) => v && /credencial|documento|identificaci[oó]n|account|usuario|email/i.test(v));

      if (isCredentialRelated && tabIndex !== "-1") {
        const reason = `${role || "element"}:${[ariaLabel, dataModel, dataAttr].filter(Boolean).join("|")}`;
        const selector = ariaLabel ? `[aria-label="${ariaLabel}"]` : (role ? `[role="${role}"]` : "[data-model], [data-bind], [ng-model]");
        candidates.push({ selector, reason: `credential-related:${reason}`, confidence: "high" });
        break;
      }

      // Generic interactive with tabindex >= 0
      if (tabIndex && parseInt(tabIndex) >= 0) {
        const reason = `tabindex=${tabIndex}`;
        candidates.push({ selector: `[tabindex="${tabIndex}"]`, reason: `interactive:${reason}`, confidence: "medium" });
      }
    }

    // Check for virtual keyboard parent container
    const keyboardContainer = await page.locator(".virtual-keyboard, [class*='keyboard'], [class*='teclado']").first();
    if (await keyboardContainer.isVisible({ timeout: 100 }).catch(() => false)) {
      const parent = keyboardContainer.locator("..");
      if (await parent.isVisible({ timeout: 100 }).catch(() => false)) {
        candidates.push({ selector: ".virtual-keyboard", reason: "keyboard-parent-container", confidence: "medium" });
      }
    }

    // Select best candidate (high > medium > low)
    const bestByConfidence = ["high", "medium", "low"].find(
      (conf) => candidates.some((c) => c.confidence === (conf as any))
    );
    const bestCandidate = candidates.find((c) => c.confidence === (bestByConfidence as any));

    return { candidates, bestCandidate };
  } catch (err) {
    console.log(
      `[auth-discovery] detectActivationCandidates error=${err instanceof Error ? err.message : String(err)}`
    );
    return { candidates };
  }
}

/**
 * Detect custom OTP control: slots/casillas, teclado virtual numérico, confirmación
 */
async function detectCustomOtpControl(page: Page): Promise<{
  hasSlots: boolean;
  slotsCount: number;
  hasNumericKeyboard: boolean;
  numericKeysCount: number;
  hasConfirmButton: boolean;
  expectedOtpLength: number;
  keyRefinementDiagnostics?: any;
}> {
  try {
    // Detect OTP slots/casillas: visual containers with various patterns
    const slotPatterns = [
      '[class*="slot"]', '[class*="digit"]', '[class*="casilla"]', '[class*="otp"]',
      '[data-slot]', '[data-digit]', '[data-index]', '[role="textbox"]',
      'div[style*="width"], span[style*="width"]' // styled boxes
    ];

    let slotsDetected = 0;
    for (const pattern of slotPatterns) {
      const slots = await page.locator(pattern).all();
      if (slots.length > 0) {
        const visibleSlots = await Promise.all(slots.map(s => s.isVisible().catch(() => false)));
        const count = visibleSlots.filter(v => v).length;
        if (count >= 4 && count <= 10) {
          slotsDetected = count;
          break;
        }
      }
    }

    // Detect numeric keyboard buttons: use refined candidates excluding global containers
    let numericKeysCount = 0;
    let keyRefinementDiagnostics: any = {
      ignoredGlobalContainers: [],
      keypadContainers: [],
      resolvedByAncestor: 0,
      resolvedByLeaf: 0,
      unresolvedAggregatedText: false,
      uniqueDigitsResolved: 0,
      missingDigits: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
      reasonCodes: [],
      coordinatePlan: undefined
    };

    try {
      // Collect digit-bearing elements first
      const digitBearing = await collectDigitBearingElements(page, 200);

      // Refine to actual key candidates
      const refinedResult = await refineOtpNumericKeyCandidates(page, digitBearing);
      numericKeysCount = refinedResult.refinedKeys.size;
      keyRefinementDiagnostics = refinedResult.diagnostics;
    } catch (err) {
      // Fallback to old detection if refinement fails
      const digitCandidates = await page.evaluate(() => {
        const candidates: any[] = [];
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_ELEMENT,
          null,
          false
        );

        let node;
        while ((node = walker.nextNode())) {
          const el = node as HTMLElement;
          const text = (el.textContent || "").trim();

          if (/^[0-9]$/.test(text) || el.innerText?.trim().match(/^[0-9]$/)) {
            const rect = el.getBoundingClientRect();
            if (rect.height > 0 && rect.width > 0) {
              const isClickable =
                el.onclick !== null ||
                el.getAttribute("tabindex") !== null ||
                el.getAttribute("role") === "button" ||
                getComputedStyle(el).cursor === "pointer" ||
                ["BUTTON", "A"].includes(el.tagName);

              candidates.push({
                digit: text || el.innerText?.trim(),
                tag: el.tagName,
                isClickable,
                x: Math.round(rect.x),
                y: Math.round(rect.y),
                w: Math.round(rect.width),
                h: Math.round(rect.height)
              });
            }
          }
        }
        return candidates;
      });

      const digitKeyByNumber = new Map<string, boolean>();

      // Resolve ancestors for non-clickable candidates
      for (const cand of digitCandidates) {
        if (/^[0-9]$/.test(cand.digit)) {
          if (cand.isClickable) {
            digitKeyByNumber.set(cand.digit, true);
          } else {
            // Search ancestor up to 3 levels
            const found = await page.evaluate(
              (args: { x: number; y: number }) => {
                const el = document.elementFromPoint(args.x + 5, args.y + 5) as HTMLElement;
                let current = el?.parentElement;
                for (let i = 0; i < 3 && current; i++) {
                  const rect = current.getBoundingClientRect();
                  if (rect.height > 0 && rect.width > 0) {
                    const isClickable =
                      current.onclick !== null ||
                      current.getAttribute("tabindex") !== null ||
                      getComputedStyle(current).cursor === "pointer" ||
                      ["BUTTON", "A", "LI", "DIV"].includes(current.tagName);
                    if (isClickable) return true;
                  }
                  current = current.parentElement;
                }
                return false;
              },
              { x: cand.x, y: cand.y }
            );
            if (found) digitKeyByNumber.set(cand.digit, true);
          }
        }
      }

      numericKeysCount = digitKeyByNumber.size;
      keyRefinementDiagnostics.reasonCodes.push("fallback_to_text_digit");
    }


    // Detect confirm button with broader patterns
    const confirmPatterns = [
      { selector: 'button, [role=button]', text: /confirmar|validar|verificar|continuar|next|submit|verify|confirm|código|token|otp|enviar/i },
      { selector: '[tabindex="0"]', text: /confirmar|validar|verificar|continuar|código|token/i }
    ];

    let hasConfirmButton = false;
    for (const pattern of confirmPatterns) {
      try {
        const btn = await page.locator(pattern.selector).filter({ hasText: pattern.text }).first();
        if (await btn.isVisible().catch(() => false)) {
          hasConfirmButton = true;
          break;
        }
      } catch {
        // Skip
      }
    }

    // Estimate expected OTP length
    const otpValue = process.env.OTP_SECRET || "";
    const expectedOtpLength = slotsDetected > 0 ? slotsDetected : otpValue.length;

    return {
      hasSlots: slotsDetected >= 4,
      slotsCount: slotsDetected,
      hasNumericKeyboard: numericKeysCount >= 10,
      numericKeysCount,
      hasConfirmButton,
      expectedOtpLength,
      keyRefinementDiagnostics: keyRefinementDiagnostics
    };
  } catch (err) {
    return {
      hasSlots: false,
      slotsCount: 0,
      hasNumericKeyboard: false,
      numericKeysCount: 0,
      hasConfirmButton: false,
      expectedOtpLength: 0
    };
  }
}

/**
 * Find and execute continue/next button after credential entry
 */
async function executeCredentialContinue(
  page: Page,
  beforeSnapshot: Awaited<ReturnType<typeof capturePageSnapshot>>
): Promise<{
  success: boolean;
  target?: string;
  confidence?: "high" | "medium" | "low";
  stateChanged?: boolean;
  reason: string;
}> {
  // Patterns to find continue button (multiidioma)
  const continuePatterns = [
    { re: /continuar/i, score: 10 },
    { re: /siguiente/i, score: 10 },
    { re: /confirmar/i, score: 10 },
    { re: /validar/i, score: 10 },
    { re: /verificar/i, score: 10 },
    { re: /enviar/i, score: 9 },
    { re: /next/i, score: 10 },
    { re: /submit/i, score: 9 },
    { re: /aceptar/i, score: 9 },
    { re: /ingresar/i, score: 8 },
    { re: /entrar/i, score: 8 },
    { re: /acceder/i, score: 8 },
  ];

  // Patterns to exclude (keyboard, clear, cancel, etc.)
  const excludePatterns = [/[0-9]/i, /borrar/i, /limpiar/i, /cancelar/i, /salir/i, /atrás/i, /back/i];

  const buttons = await page.locator("button").all();
  let bestButton: { locator: any; text: string; score: number; confidence: "high" | "medium" | "low" } | null = null;

  for (const button of buttons) {
    const isVisible = await button.isVisible({ timeout: 100 }).catch(() => false);
    if (!isVisible) continue;

    const text = (
      (await button.textContent()) ||
      (await button.getAttribute("aria-label").catch(() => null)) ||
      (await button.getAttribute("title").catch(() => null)) ||
      (await button.getAttribute("value").catch(() => null)) ||
      ""
    );
    if (!text.trim()) continue;

    // Skip if matches exclude pattern
    if (excludePatterns.some((p) => p.test(text))) continue;

    // Score against continue patterns
    let score = 0;
    for (const pattern of continuePatterns) {
      if (pattern.re.test(text)) {
        score = Math.max(score, pattern.score);
      }
    }

    if (score > 0) {
      // Better candidate found
      if (!bestButton || score > bestButton.score) {
        const confidence = score >= 9 ? "high" : score >= 7 ? "medium" : "low";
        bestButton = { locator: button, text, score, confidence };
      }
    }
  }

  if (!bestButton) {
    // No button found, return visible buttons sample
    const visibleButtons = buttons
      .filter((b) => b.isVisible({ timeout: 100 }).catch(() => false))
      .slice(0, 10);
    const btnTexts = await Promise.all(visibleButtons.map((b) => b.textContent()));
    const sample = btnTexts.filter((t) => t && t.trim()).join(", ");

    return {
      success: false,
      reason: `No continue button found. Visible buttons: ${sample || "(none)"}`,
    };
  }

  // Found button - check state and click it
  try {
    // Capture input state before click
    const inputState = await captureCredentialInputState(page);
    console.log(
      `[auth-discovery] credentialInputState visibleLength=${inputState.visibleLength || "unknown"} activeElement=${inputState.activeElement}`
    );

    // Check button state
    const buttonDisabled = await bestButton.locator.isDisabled();
    const buttonAriaDisabled = await bestButton.locator.getAttribute("aria-disabled");
    console.log(
      `[auth-discovery] continueButtonState disabled=${buttonDisabled} ariaDisabled=${buttonAriaDisabled === "true"}`
    );

    // If button is disabled, wait up to 6 seconds for async validation to enable it.
    let buttonEnabledAfterWait = false;
    if (buttonDisabled || buttonAriaDisabled === "true") {
      console.log(
        `[auth-discovery] continueButtonDisabled waiting up to 6s for enable state change...`
      );

      const waitStart = Date.now();
      while (Date.now() - waitStart < 6000) {
        const currentDisabled = await bestButton.locator.isDisabled().catch(() => true);
        const currentAriaDisabled = await bestButton.locator.getAttribute("aria-disabled").catch(() => "false");

        if (!currentDisabled && currentAriaDisabled !== "true") {
          buttonEnabledAfterWait = true;
          console.log(
            `[auth-discovery] continueButtonEnabled after wait (elapsed=${Date.now() - waitStart}ms)`
          );
          break;
        }

        await page.waitForTimeout(200);
      }

      // If button still disabled after wait, SKIP minimal DOM correction (diagnostic-only mode)
      if (!buttonEnabledAfterWait) {
        console.log(
          `[auth-discovery] continueButtonStillDisabled skipping DOM correction (diagnostic-only mode)`
        );

        // Record that correction was intentionally skipped
        // (activation should have occurred before virtualKeyboardFill; if button still disabled,
        // indicates root cause is not focus-related and should not be masked by DOM correction)
      }

      // If button still disabled after wait and correction, return diagnostic
      if (!buttonEnabledAfterWait) {
        console.log(
          `[auth-discovery] continueButtonStillDisabled after all attempts`
        );

        return {
          success: false,
          target: bestButton.text,
          confidence: bestButton.confidence,
          stateChanged: false,
          reason: `Button remained disabled after 6s wait and correction attempts. validationMessages: ${inputState.validationMessages.join("; ") || "none"}`,
        };
      }
    }

    console.log(`[auth-discovery] credentialContinue target="${bestButton.text}" confidence=${bestButton.confidence}`);

    // Click button. Toasts/overlays may briefly intercept even when the target is enabled.
    try {
      await bestButton.locator.click({ timeout: 2000 });
    } catch {
      await bestButton.locator.click({ timeout: 2000, force: true });
    }

    // Wait aggressively for state change (up to 5 seconds)
    const stateChangeStart = Date.now();
    let stateChanged = false;
    let afterSnapshot = await capturePageSnapshot(page);

    while (Date.now() - stateChangeStart < 5000 && !stateChanged) {
      const urlChanged = beforeSnapshot.url !== afterSnapshot.url;
      const buttonCountChanged = beforeSnapshot.counts.buttons !== afterSnapshot.counts.buttons;
      const inputsChanged = beforeSnapshot.counts.inputs !== afterSnapshot.counts.inputs;
      const textChanged = beforeSnapshot.bodyTextPreview !== afterSnapshot.bodyTextPreview;

      stateChanged = urlChanged || buttonCountChanged || inputsChanged || textChanged;

      if (!stateChanged) {
        await page.waitForTimeout(300);
        afterSnapshot = await capturePageSnapshot(page);
      }
    }

    console.log(
      `[auth-discovery] credentialContinueClick success=true stateChanged=${stateChanged} urlChanged=${beforeSnapshot.url !== afterSnapshot.url} inputsChanged=${beforeSnapshot.counts.inputs !== afterSnapshot.counts.inputs}`
    );

    console.log(
      `[auth-discovery] postCredentialContinueSnapshot url=${afterSnapshot.url} buttons=${afterSnapshot.counts.buttons} inputs=${afterSnapshot.counts.inputs} vkKeys=${afterSnapshot.counts.virtualKeyboardKeys}`
    );

    // If no state change, capture diagnostic
    if (!stateChanged) {
      const postState = await captureCredentialInputState(page);
      const diagnostic = {
        reason: "Button click did not change state",
        validationMessages: postState.validationMessages,
        bodyTextPreview: postState.bodyTextPreview.substring(0, 100),
        buttonDisabledState: postState.buttonDisabled,
      };
      console.log(`[auth-discovery] postContinueNoStateChange reason=${diagnostic.reason}`);

      return {
        success: true,
        target: bestButton.text,
        confidence: bestButton.confidence,
        stateChanged: false,
        reason: `Clicked button but no state change. validations: ${postState.validationMessages.join("; ") || "none"}`,
      };
    }

    return {
      success: true,
      target: bestButton.text,
      confidence: bestButton.confidence,
      stateChanged: true,
      reason: `Clicked continue button: ${bestButton.text}`,
    };
  } catch (err) {
    console.log(`[auth-discovery] credentialContinueClick success=false error=${err instanceof Error ? err.message : String(err)}`);
    return {
      success: false,
      target: bestButton.text,
      confidence: bestButton.confidence,
      stateChanged: false,
      reason: `Failed to click button: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Resolve and click primary action button for OTP intermediate stages (phone confirmation, etc.)
 * Returns clicked button text or null if no suitable button found
 */
async function resolveOtpIntermediatePrimaryAction(page: Page): Promise<{ success: boolean; buttonText?: string }> {
  try {
    // Patterns for primary action buttons in confirmation/verification contexts
    const primaryPatterns = [
      { re: /confirmar/i, score: 10 },
      { re: /enviar/i, score: 10 },
      { re: /continuar/i, score: 10 },
      { re: /aceptar/i, score: 9 },
      { re: /siguiente/i, score: 9 },
      { re: /verificar/i, score: 9 },
      { re: /verificá/i, score: 9 },
      { re: /validate/i, score: 8 },
      { re: /next/i, score: 8 },
      { re: /proceed/i, score: 8 },
    ];

    // Patterns to exclude (secondary, cancel, reject, etc.)
    const excludePatterns = [
      /cancelar/i, /no\s+reconozco/i, /no\s+me\s+acuerdo/i, /volver/i, /atrás/i,
      /back/i, /rechazar/i, /deny/i, /salir/i, /limpiar/i, /borrar/i, /reenviar/i
    ];

    const buttons = await page.locator("button").all();
    let bestButton: { locator: any; text: string; score: number } | null = null;

    for (const button of buttons) {
      const isVisible = await button.isVisible({ timeout: 100 }).catch(() => false);
      if (!isVisible) continue;

      const text = (await button.textContent()) || "";
      if (!text.trim()) continue;

      // Skip if matches exclude pattern
      if (excludePatterns.some((p) => p.test(text))) continue;

      // Score against primary patterns
      let score = 0;
      for (const pattern of primaryPatterns) {
        if (pattern.re.test(text)) {
          score = Math.max(score, pattern.score);
        }
      }

      if (score > 0) {
        // Better candidate found
        if (!bestButton || score > bestButton.score) {
          bestButton = { locator: button, text, score };
        }
      }
    }

    if (!bestButton) {
      return { success: false };
    }

    // Try to click the button
    try {
      await bestButton.locator.click();
      return { success: true, buttonText: bestButton.text };
    } catch (err) {
      return { success: false };
    }
  } catch (err) {
    return { success: false };
  }
}

/**
 * Wait for DOM to render after click
 */
async function waitForPostClickRender(
  page: Page,
  beforeSnapshot: Awaited<ReturnType<typeof capturePageSnapshot>>,
  timeoutMs: number = 5000
): Promise<{ changed: boolean; reason: string }> {
  const startTime = Date.now();
  const beforeUrlPath = new URL(beforeSnapshot.url).pathname;
  const currentUrlPath = new URL(page.url()).pathname;

  // If URL path didn't change, DOM definitely hasn't changed
  if (beforeUrlPath === currentUrlPath) {
    return { changed: false, reason: "URL path unchanged" };
  }

  // Poll for DOM changes
  while (Date.now() - startTime < timeoutMs) {
    const afterSnapshot = await capturePageSnapshot(page);
    const afterUrlPath = new URL(afterSnapshot.url).pathname;

    // Check 1: URL path changed
    if (beforeUrlPath !== afterUrlPath) {
      // Check 2: Different buttons
      if (afterSnapshot.counts.buttons !== beforeSnapshot.counts.buttons) {
        return { changed: true, reason: "button count changed" };
      }

      // Check 3: Buttons have different labels
      const beforeBtnTexts = new Set(
        beforeSnapshot.clickablesSample
          .filter((c) => c.tag === "button")
          .map((b) => (b.text || b.ariaLabel || b.title || "").toLowerCase())
      );
      const afterBtnTexts = new Set(
        afterSnapshot.clickablesSample
          .filter((c) => c.tag === "button")
          .map((b) => (b.text || b.ariaLabel || b.title || "").toLowerCase())
      );

      let buttonTextsDiffer = false;
      if (beforeBtnTexts.size !== afterBtnTexts.size) {
        buttonTextsDiffer = true;
      } else {
        // Check if any button text is different using array conversion
        const afterBtnTextsArray: string[] = [];
        afterBtnTexts.forEach((text) => afterBtnTextsArray.push(text));
        for (let i = 0; i < afterBtnTextsArray.length; i++) {
          if (!beforeBtnTexts.has(afterBtnTextsArray[i])) {
            buttonTextsDiffer = true;
            break;
          }
        }
      }

      if (buttonTextsDiffer) {
        return { changed: true, reason: "button labels differ" };
      }

      // Check 4: New inputs/textboxes/contenteditable appeared
      if (
        afterSnapshot.counts.inputs > beforeSnapshot.counts.inputs ||
        afterSnapshot.counts.textboxes > beforeSnapshot.counts.textboxes
      ) {
        return { changed: true, reason: "new input elements appeared" };
      }

      // Check 5: Body text significantly different
      if (
        afterSnapshot.bodyTextPreview.toLowerCase() !== beforeSnapshot.bodyTextPreview.toLowerCase()
      ) {
        return { changed: true, reason: "body text changed" };
      }
    }

    await page.waitForTimeout(200);
  }

  return { changed: false, reason: "timeout waiting for render" };
}

/**
 * Detect and resolve optional pre-credential gate (terms/checkbox)
 * before focusing field and filling credentials
 */
async function detectAndResolvePreCredentialGate(page: Page): Promise<{
  detected: boolean;
  accepted: boolean;
  confidence: "high" | "medium" | "low";
  target: string;
}> {
  const termsPatterns = [
    /aceptar|acepto|términos|condiciones|consentimiento|autorizo/i,
    /agree|accept|terms|conditions|consent|authorize/i,
  ];

  try {
    // Find all checkboxes, toggles, switches and their labels
    const gateCandidates = await page.evaluate(() => {
      const results: Array<{
        type: string;
        checked: boolean;
        label: string;
        selector: string;
      }> = [];

      // Checkboxes
      document.querySelectorAll("input[type=checkbox]").forEach((el) => {
        const checked = (el as HTMLInputElement).checked;
        const label =
          (el as HTMLInputElement).ariaLabel ||
          document.querySelector(`label[for="${el.id}"]`)?.textContent ||
          el.closest("label")?.textContent ||
          "";
        if (label && label.trim().length > 0) {
          results.push({
            type: "checkbox",
            checked,
            label: label.trim().substring(0, 100),
            selector: `input[type="checkbox"][aria-label="${(el as HTMLInputElement).ariaLabel || ""}"]`,
          });
        }
      });

      // Role checkboxes/switches
      document.querySelectorAll('[role="checkbox"], [role="switch"]').forEach((el) => {
        const ariaChecked = el.getAttribute("aria-checked") === "true";
        const label = el.getAttribute("aria-label") || el.textContent || "";
        if (label && label.trim().length > 0) {
          results.push({
            type: el.getAttribute("role") || "checkbox",
            checked: ariaChecked,
            label: label.trim().substring(0, 100),
            selector: `[role="${el.getAttribute("role")}"][aria-label="${el.getAttribute("aria-label")}"]`,
          });
        }
      });

      return results;
    });

    if (!gateCandidates.length) {
      return { detected: false, accepted: false, confidence: "high", target: "" };
    }

    // Score each candidate against terms patterns
    const scored = gateCandidates.map((candidate) => {
      let confidence: "high" | "medium" | "low" = "low";
      for (const pattern of termsPatterns) {
        if (pattern.test(candidate.label)) {
          confidence = "high";
          break;
        }
      }
      if (candidate.label.length < 5) confidence = "low"; // Too short
      return { ...candidate, confidence };
    });

    // Pick highest confidence unchecked gate
    const uncheckedGates = scored.filter((g) => !g.checked);
    if (!uncheckedGates.length) {
      return { detected: false, accepted: false, confidence: "high", target: "" };
    }

    uncheckedGates.sort((a, b) => {
      const confRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
      return (confRank[b.confidence] || 0) - (confRank[a.confidence] || 0);
    });

    const selectedGate = uncheckedGates[0];

    if (selectedGate.confidence === "low") {
      return {
        detected: true,
        accepted: false,
        confidence: "low",
        target: selectedGate.label,
      };
    }

    // Click the gate
    try {
      const locator = page.locator(`input[type="checkbox"]`).filter({ hasText: selectedGate.label });
      await locator.click({ timeout: 5000 });
      await page.waitForTimeout(300); // Brief wait for state change
      return {
        detected: true,
        accepted: true,
        confidence: selectedGate.confidence,
        target: selectedGate.label,
      };
    } catch {
      return {
        detected: true,
        accepted: false,
        confidence: "medium",
        target: selectedGate.label,
      };
    }
  } catch (err) {
    return {
      detected: false,
      accepted: false,
      confidence: "low",
      target: `Error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Detect and focus visual credential input field before virtualKeyboardFill
 * Searches for textbox, contenteditable, or input-like elements
 */
async function detectCredentialInputField(page: Page): Promise<{
  found: boolean;
  target?: string;
  confidence?: "high" | "medium" | "low";
  candidates?: Array<{ tag: string; role?: string; text: string; ariaLabel?: string; title?: string }>;
}> {
  const credentialPatterns = [
    /identity|document|customer|client|user|id\b/i,
    /identificación|documento|cédula|pasaporte|rnc|cliente|usuario/i,
    /campo|input|valor|número|numero|display|field/i,
  ];

  try {
    const candidates = await page.evaluate(() => {
      const results: Array<{
        tag: string;
        role?: string;
        text: string;
        ariaLabel?: string;
        title?: string;
        className?: string;
        selectors: string[];
        isVisible: boolean;
      }> = [];

      // Textbox inputs
      document.querySelectorAll('input[type="text"], input:not([type]), textarea').forEach((el) => {
        if ((el as HTMLElement).offsetParent !== null) {
          results.push({
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute("role") || undefined,
            text: (el as HTMLInputElement).value?.substring(0, 20) || (el as HTMLInputElement).placeholder || "",
            ariaLabel: el.getAttribute("aria-label") || undefined,
            title: el.getAttribute("title") || undefined,
            className: el.className,
            selectors: [el.tagName.toLowerCase()],
            isVisible: true,
          });
        }
      });

      // Role textbox
      document.querySelectorAll('[role="textbox"]').forEach((el) => {
        if ((el as HTMLElement).offsetParent !== null) {
          results.push({
            tag: el.tagName.toLowerCase(),
            role: "textbox",
            text: el.textContent?.substring(0, 20) || "",
            ariaLabel: el.getAttribute("aria-label") || undefined,
            title: el.getAttribute("title") || undefined,
            className: el.className,
            selectors: [`[role="textbox"]`],
            isVisible: true,
          });
        }
      });

      // Contenteditable
      document.querySelectorAll("[contenteditable]").forEach((el) => {
        if ((el as HTMLElement).offsetParent !== null) {
          results.push({
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute("role") || undefined,
            text: el.textContent?.substring(0, 20) || "",
            ariaLabel: el.getAttribute("aria-label") || undefined,
            title: el.getAttribute("title") || undefined,
            className: el.className,
            selectors: [`[contenteditable]`],
            isVisible: true,
          });
        }
      });

      return results;
    });

    if (!candidates.length) {
      return { found: false, candidates: [] };
    }

    // Score candidates against credential patterns
    const scored = candidates.map((cand) => {
      let score = 0;
      const combinedText = `${cand.text} ${cand.ariaLabel || ""} ${cand.title || ""} ${cand.className || ""}`.toLowerCase();

      for (const pattern of credentialPatterns) {
        if (pattern.test(combinedText)) {
          const isHighPriority = /identity|document|cliente|usuario/i.test(combinedText);
          score += isHighPriority ? 3 : 1;
        }
      }

      const confidence: "high" | "medium" | "low" = score >= 3 ? "high" : score >= 1 ? "medium" : "low";
      return { ...cand, score, confidence };
    });

    scored.sort((a, b) => b.score - a.score);

    // Return top candidate if medium or higher confidence
    const topCandidate = scored.find((c) => c.confidence !== "low");
    if (topCandidate) {
      return {
        found: true,
        target: topCandidate.tag,
        confidence: topCandidate.confidence,
      };
    }

    // Return sample of candidates if not found
    return {
      found: false,
      candidates: scored.slice(0, 10).map((c) => ({
        tag: c.tag,
        role: c.role,
        text: c.text,
        ariaLabel: c.ariaLabel,
        title: c.title,
      })),
    };
  } catch (err) {
    return { found: false, candidates: [] };
  }
}

/**
 * Capture simplified list of visible non-keyboard elements before/after virtualKeyboardFill
 * Returns: tag, role, textContent (normalized), aria-label, title, className, data-* hints
 */
async function captureVisibleElementsList(page: Page): Promise<
  Array<{
    id: string;
    tag: string;
    role?: string;
    text: string;
    textLength: number;
    textHash: number;
    bbox?: { x: number; y: number; width: number; height: number };
    ariaLabel?: string;
    title?: string;
    className?: string;
    dataHints: string[];
  }> & { bodyTextHash: number; bodyTextLength: number }
> {
  try {
    // Use locator.evaluateAll to avoid page.evaluate transpilation issues
    const elements = await page.locator('button, input, textarea, [role], [aria-label], [title], a, label, h1, h2, h3, h4, h5, h6, p, div, span').evaluateAll((els: any[]) => {
      const skipTags = ["script", "style", "meta", "link", "br", "hr", "html", "body"];
      const vkKeywordPatterns = ["virtual", "keyboard", "key", "btn-key"];
      const results: any[] = [];

      for (let i = 0; i < els.length; i++) {
        const el = els[i] as HTMLElement;
        const tag = el.tagName.toLowerCase();
        if (skipTags.includes(tag)) continue;
        if (el.offsetParent === null) continue;

        const classStr = el.className || "";
        const idStr = el.id || "";
        const isVK = vkKeywordPatterns.some(kw => classStr.toLowerCase().includes(kw) || idStr.toLowerCase().includes(kw));
        if (isVK) continue;

        const innerText = (el as HTMLElement).innerText || "";
        const textContent = el.textContent || "";
        const ariaLabel = el.getAttribute("aria-label") || "";
        const title = el.getAttribute("title") || "";
        const accessibleName = (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || "").trim();
        let text = [innerText, textContent, ariaLabel, title, accessibleName]
          .map(value => value.replace(/\s+/g, " ").trim())
          .find(Boolean) || "";
        if (!text && (el as any).placeholder) text = (el as any).placeholder.substring(0, 30);
        if (!text && (el as any).value) text = "[value:...]";
        if (!text) text = "[" + tag + "]";

        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          let h = 0;
          for (let j = 0; j < text.length; j++) {
            h = ((h << 5) - h) + text.charCodeAt(j);
            h = h & h;
          }
          const hash = Math.abs(h);

          const dataHints: string[] = [];
          if (el.attributes) {
            for (let j = 0; j < el.attributes.length; j++) {
              const attr = el.attributes[j];
              if (attr.name.startsWith("data-")) dataHints.push(attr.name.replace("data-", ""));
            }
          }

          results.push({
            id: tag + "-" + Math.random().toString(36).substring(7),
            tag,
            role: el.getAttribute("role") || undefined,
            text,
            textLength: text.length,
            textHash: hash,
            bbox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
            ariaLabel: ariaLabel || undefined,
            title: title || undefined,
            className: classStr,
            dataHints
          });
        }
      }

      const limited = results.slice(0, 80);
      const bodyText = document.body.innerText || "";
      let bodyHash = 0;
      const bodySubstr = bodyText.substring(0, 200);
      for (let j = 0; j < bodySubstr.length; j++) {
        bodyHash = ((bodyHash << 5) - bodyHash) + bodySubstr.charCodeAt(j);
        bodyHash = bodyHash & bodyHash;
      }

      return { elements: limited, bodyHash: Math.abs(bodyHash), bodyLen: bodyText.length, total: results.length };
    });

    const arr = elements.elements as any;
    arr.bodyTextHash = elements.bodyHash;
    arr.bodyTextLength = elements.bodyLen;
    arr.totalCaptured = elements.total;
    return arr;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.log(`[auth-discovery] captureVisibleElementsList_error: ${errorMsg.substring(0, 80)}`);

    try {
      // Fallback: capture buttons only
      const buttons = await page.locator('button, [role=button]').evaluateAll((els: any[]) => {
        const results: any[] = [];
        for (let i = 0; i < els.length; i++) {
          const el = els[i] as HTMLElement;
          if (el.offsetParent === null) continue;

          const text = (el.textContent || "").replace(/\s+/g, " ").substring(0, 30).trim() || "[button]";
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            let h = 0;
            for (let j = 0; j < text.length; j++) {
              h = ((h << 5) - h) + text.charCodeAt(j);
              h = h & h;
            }

            results.push({
              id: "btn-" + Math.random().toString(36).substring(7),
              tag: "button",
              text,
              textLength: text.length,
              textHash: Math.abs(h),
              bbox: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
            });
          }
        }

        const bodyText = document.body.innerText || "";
        let bodyHash = 0;
        const bodySubstr = bodyText.substring(0, 200);
        for (let j = 0; j < bodySubstr.length; j++) {
          bodyHash = ((bodyHash << 5) - bodyHash) + bodySubstr.charCodeAt(j);
          bodyHash = bodyHash & bodyHash;
        }

        return { elements: results.slice(0, 80), bodyHash: Math.abs(bodyHash), bodyLen: bodyText.length, total: results.length };
      });

      const arr = buttons.elements as any;
      arr.bodyTextHash = buttons.bodyHash;
      arr.bodyTextLength = buttons.bodyLen;
      arr.totalCaptured = buttons.total;
      arr.fallback = true;
      console.log(`[auth-discovery] captureVisibleElementsList_fallback_buttons: ${arr.length} buttons`);
      return arr;
    } catch {
      console.log(`[auth-discovery] captureVisibleElementsList_error: fallback failed`);
      return [] as any;
    }
  }
}

function buildPrivateHuIntentText(input: {
  request?: any;
  intent?: string;
  step?: any;
  menuSnapshot?: any;
}): { source: string; text: string; sample: string } {
  const candidates: Array<{ source: string; value: string }> = [];
  const request = input.request as Record<string, any> | undefined;
  const step = input.step as Record<string, any> | undefined;

  const pushCandidate = (source: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      candidates.push({ source, value: value.trim() });
    }
  };

  pushCandidate("request.title", request?.title ?? request?.caseTitle ?? request?.scenarioTitle ?? request?.huTitle);
  pushCandidate("request.text", request?.text ?? request?.description ?? request?.summary ?? request?.intentText);
  pushCandidate("request.steps", Array.isArray(request?.steps) ? request.steps.map((s: any) => s?.text || s?.description || s?.title).filter(Boolean).join(" ") : "");
  pushCandidate("case.steps", Array.isArray(request?.caseSteps) ? request.caseSteps.map((s: any) => s?.text || s?.description || s?.title).filter(Boolean).join(" ") : "");
  pushCandidate("step.text", step?.text ?? step?.description ?? step?.title);
  pushCandidate("step.hint", step?.hint ?? step?.name);
  pushCandidate("request.intent", input.intent);
  pushCandidate("menu.samples", Array.isArray(input.menuSnapshot?.elementSample) ? input.menuSnapshot.elementSample.map((e: any) => [e?.text, e?.ariaLabel, e?.title].filter(Boolean).join(" ")).filter(Boolean).join(" ") : "");

  const chosen = candidates[0] || { source: "request.intent", value: input.intent ?? "none" };
  const sample = chosen.value.slice(0, 120);
  return { source: chosen.source, text: chosen.value, sample };
}

/**
 * Detect visual changes in element display after virtualKeyboardFill
 * Identifies if credential value appeared in a custom display element
 * Returns diagnostics without exposing actual credential values
 */
async function detectCredentialDisplayChange(
  beforeElements: Awaited<ReturnType<typeof captureVisibleElementsList>>,
  afterElements: Awaited<ReturnType<typeof captureVisibleElementsList>>
): Promise<{
  displayChanged: boolean;
  visibleLength?: number;
  maskLength?: number;
  changedElements: number;
  addedElements: number;
  removedElements: number;
  bodyTextChanged: boolean;
  bodyTextHashBefore: number;
  bodyTextHashAfter: number;
  redactedElements: Array<{
    tag: string;
    role?: string;
    classHints?: string;
    dataHints?: string[];
    bboxSize?: string;
    textHashBefore?: number;
    textHashAfter?: number;
    textLengthBefore: number;
    textLengthAfter: number;
  }>;
  confidence: "high" | "medium" | "low";
  reason: string;
}> {
  const redactedElements: Array<{
    tag: string;
    role?: string;
    classHints?: string;
    dataHints?: string[];
    bboxSize?: string;
    textHashBefore?: number;
    textHashAfter?: number;
    textLengthBefore: number;
    textLengthAfter: number;
  }> = [];
  let changedElements = 0;
  let addedElements = 0;
  let removedElements = 0;

  // Extract body text hashes from metadata
  const bodyTextHashBefore = (beforeElements as any).bodyTextHash || 0;
  const bodyTextHashAfter = (afterElements as any).bodyTextHash || 0;
  const bodyTextChanged = bodyTextHashBefore !== bodyTextHashAfter && bodyTextHashBefore > 0 && bodyTextHashAfter > 0;

  // Create map of before elements by tag+role+text hash for matching
  const beforeMap = new Map<string, typeof beforeElements[0]>();
  beforeElements.forEach((el) => {
    const key = `${el.tag}:${el.role || ""}:${el.ariaLabel || ""}:${el.textHash}`;
    beforeMap.set(key, el);
  });

  // Compare after elements
  let maxTextGrowth = 0;
  let credentialLikeChanges = 0;
  let elementMatchFound = false;

  const afterElementKeys = new Set<string>();

  afterElements.forEach((afterEl) => {
    const key = `${afterEl.tag}:${afterEl.role || ""}:${afterEl.ariaLabel || ""}:${afterEl.textHash}`;
    afterElementKeys.add(key);
    const beforeEl = beforeMap.get(key);

    if (beforeEl && (beforeEl.text !== afterEl.text || beforeEl.textHash !== afterEl.textHash)) {
      changedElements++;
      elementMatchFound = true;
      const textGrowth = afterEl.textLength - beforeEl.textLength;
      maxTextGrowth = Math.max(maxTextGrowth, textGrowth);

      // Check if change looks like credential value entry
      const isNumericOrAlphanumeric =
        /^[\d\w\s\-\.]*$/.test(afterEl.text) && afterEl.text.length > beforeEl.text.length;

      if (isNumericOrAlphanumeric || textGrowth > 3) {
        credentialLikeChanges++;
      }

      // Mask class hints
      let classHints = "";
      if (afterEl.className) {
        const classParts = afterEl.className.split(" ").filter((c) => c.length > 0);
        classHints = classParts.slice(0, 3).join(", ");
      }

      const bboxSize = afterEl.bbox ? `${afterEl.bbox.width}x${afterEl.bbox.height}` : undefined;

      // ALWAYS capture changed elements, not just credential-like ones
      redactedElements.push({
        tag: afterEl.tag,
        role: afterEl.role,
        classHints: classHints || undefined,
        dataHints: afterEl.dataHints.length > 0 ? afterEl.dataHints.slice(0, 2) : undefined,
        bboxSize,
        textHashBefore: beforeEl.textHash,
        textHashAfter: afterEl.textHash,
        textLengthBefore: beforeEl.textLength,
        textLengthAfter: afterEl.textLength,
      });
    }
  });

  // Capture removed elements
  beforeElements.forEach((beforeEl) => {
    const key = `${beforeEl.tag}:${beforeEl.role || ""}:${beforeEl.ariaLabel || ""}:${beforeEl.textHash}`;
    if (!afterElementKeys.has(key)) {
      removedElements++;

      let classHints = "";
      if (beforeEl.className) {
        const classParts = beforeEl.className.split(" ").filter((c) => c.length > 0);
        classHints = classParts.slice(0, 3).join(", ");
      }

      const bboxSize = beforeEl.bbox ? `${beforeEl.bbox.width}x${beforeEl.bbox.height}` : undefined;

      // Capture removed element details
      redactedElements.push({
        tag: beforeEl.tag,
        role: beforeEl.role,
        classHints: classHints || undefined,
        dataHints: beforeEl.dataHints.length > 0 ? beforeEl.dataHints.slice(0, 2) : undefined,
        bboxSize,
        textHashBefore: beforeEl.textHash,
        textHashAfter: 0,
        textLengthBefore: beforeEl.textLength,
        textLengthAfter: 0,
      });
    }
  });

  // Capture added elements
  afterElements.forEach((afterEl) => {
    const key = `${afterEl.tag}:${afterEl.role || ""}:${afterEl.ariaLabel || ""}:${afterEl.textHash}`;
    if (!beforeMap.has(key)) {
      addedElements++;

      let classHints = "";
      if (afterEl.className) {
        const classParts = afterEl.className.split(" ").filter((c) => c.length > 0);
        classHints = classParts.slice(0, 3).join(", ");
      }

      const bboxSize = afterEl.bbox ? `${afterEl.bbox.width}x${afterEl.bbox.height}` : undefined;

      // Capture added element details
      redactedElements.push({
        tag: afterEl.tag,
        role: afterEl.role,
        classHints: classHints || undefined,
        dataHints: afterEl.dataHints.length > 0 ? afterEl.dataHints.slice(0, 2) : undefined,
        bboxSize,
        textHashBefore: 0,
        textHashAfter: afterEl.textHash,
        textLengthBefore: 0,
        textLengthAfter: afterEl.textLength,
      });
    }
  });

  const displayChanged = changedElements > 0 || bodyTextChanged;
  const visibleLength = maxTextGrowth > 0 ? maxTextGrowth : undefined;
  const confidence = credentialLikeChanges > 0 ? "high" : changedElements > 0 ? "medium" : bodyTextChanged && !elementMatchFound ? "low" : "low";
  const reason =
    credentialLikeChanges > 0
      ? `${credentialLikeChanges} credential-like display changes detected`
      : changedElements > 0
        ? `${changedElements} text changes detected but pattern unclear`
        : bodyTextChanged && !elementMatchFound
          ? "Body text changed but no element match found"
          : "No visible changes detected";

  return {
    displayChanged,
    visibleLength,
    maskLength: visibleLength ? Math.max(0, visibleLength - 2) : undefined,
    changedElements,
    addedElements,
    removedElements,
    bodyTextChanged,
    bodyTextHashBefore,
    bodyTextHashAfter,
    redactedElements,
    confidence,
    reason,
  };
}

async function executePrivateEntryStep(
  page: Page,
  target: string
): Promise<{
  success: boolean;
  postEntryUrl: string;
  snapshot?: Awaited<ReturnType<typeof capturePageSnapshot>>;
  domChanged?: boolean;
  diagnostics: AuthenticatedPrivateDiscoveryResult["diagnostics"];
  visibleClickables: Array<any>;
}> {
  const diagnostics: AuthenticatedPrivateDiscoveryResult["diagnostics"] = [];

  try {
    // Use robust click resolver
    const result = await findClickableByTarget(page, target);

    if (result.locator) {
      try {
        // Capture pre-click snapshot
        const beforeClickSnapshot = await capturePageSnapshot(page);

        await result.locator.click({ timeout: 5000 });

        // Wait for page load (tolerant)
        try {
          await page.waitForLoadState("networkidle", { timeout: 5000 });
        } catch {
          try {
            await page.waitForLoadState("domcontentloaded", { timeout: 3000 });
          } catch {
            // Tolerate timeout
          }
        }

        // Wait for DOM to actually render
        const renderWait = await waitForPostClickRender(page, beforeClickSnapshot, 5000);
        console.log(`[auth-discovery] privateEntryRenderWait changed=${renderWait.changed} reason=${renderWait.reason}`);

        const postUrl = page.url();
        const snapshot = await capturePageSnapshot(page);

        // Log final snapshot info
        console.log(
          `[auth-discovery] postPrivateEntryFinalSnapshot url=${postUrl} buttons=${snapshot.counts.buttons} inputs=${snapshot.counts.inputs} textPreview="${snapshot.bodyTextPreview.substring(0, 50)}..."`
        );

        console.log(
          `[auth-discovery] privateEntryClick strategy=${result.strategy} target="${target}" success=true`
        );
        console.log(`[auth-discovery] postPrivateEntryUrl=${postUrl}`);

        diagnostics.push({
          level: "info",
          code: "private_entry_step_executed",
          message: `Private entry step executed: click "${target}" (strategy: ${result.strategy})`,
        });

        // If DOM didn't change, warn
        if (!renderWait.changed) {
          diagnostics.push({
            level: "warning",
            code: "post_private_entry_dom_not_updated",
            message: `URL changed but DOM did not update (${renderWait.reason}). Pre-click visible buttons: ${beforeClickSnapshot.counts.buttons}, post-click: ${snapshot.counts.buttons}`,
          });

          // Include pre/post button details
          const preButtonLabels = beforeClickSnapshot.clickablesSample
            .filter((c) => c.tag === "button")
            .slice(0, 5)
            .map((b) => b.text || b.ariaLabel || b.title || "?")
            .join(", ");
          const postButtonLabels = snapshot.clickablesSample
            .filter((c) => c.tag === "button")
            .slice(0, 5)
            .map((b) => b.text || b.ariaLabel || b.title || "?")
            .join(", ");

          diagnostics.push({
            level: "info",
            code: "dom_update_details",
            message: `Pre-click buttons: [${preButtonLabels}]; Post-click buttons: [${postButtonLabels}]`,
          });
        }

        return {
          success: true,
          postEntryUrl: postUrl,
          snapshot,
          domChanged: renderWait.changed,
          diagnostics,
          visibleClickables: result.candidates,
        };
      } catch (clickErr) {
        const errorMsg = clickErr instanceof Error ? clickErr.message : String(clickErr);
        console.log(
          `[auth-discovery] privateEntryClick strategy=${result.strategy} target="${target}" success=false clickError=${errorMsg}`
        );

        diagnostics.push({
          level: "warning",
          code: "private_entry_click_failed",
          message: `Private entry click failed: target="${target}" error=${errorMsg}`,
        });

        return {
          success: false,
          postEntryUrl: page.url(),
          domChanged: false,
          diagnostics,
          visibleClickables: result.candidates,
        };
      }
    } else {
      // No element found
      const candidateSample = result.candidates.slice(0, 3).map((c) => c.text || c.ariaLabel || c.title).join(", ");
      console.log(
        `[auth-discovery] privateEntryClick strategy=none target="${target}" success=false notFound candidates=${result.candidatesFound}`
      );

      diagnostics.push({
        level: "warning",
        code: "private_entry_target_not_found",
        message: `Private entry target not found: target="${target}" (${result.candidatesFound} visible candidates${candidateSample ? `: ${candidateSample}` : ""})`,
      });

      return {
        success: false,
        postEntryUrl: page.url(),
        domChanged: false,
        diagnostics,
        visibleClickables: result.candidates,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[auth-discovery] privateEntryExecutionError: ${message}`);

    diagnostics.push({
      level: "warning",
      code: "private_entry_execution_error",
      message: `Private entry execution error: ${message}`,
    });

    return {
      success: false,
      postEntryUrl: page.url(),
      diagnostics,
      visibleClickables: [],
    };
  }
}

/**
 * Execute auth choice step (click on authentication method option)
 * Uses robust click resolver; tolerant to failure but continues
 */
async function executeAuthChoiceStep(
  page: Page,
  choiceText: string
): Promise<{
  success: boolean;
  postChoiceUrl: string;
  snapshot?: Awaited<ReturnType<typeof capturePageSnapshot>>;
  diagnostics: AuthenticatedPrivateDiscoveryResult["diagnostics"];
}> {
  const diagnostics: AuthenticatedPrivateDiscoveryResult["diagnostics"] = [];

  try {
    // Capture pre-click state
    const preClickUrl = page.url();
    const preClickBodyText = await page.evaluate(() => document.body.textContent?.substring(0, 500) || "");

    // Use robust click resolver to find and click the auth choice
    const result = await findClickableByTarget(page, choiceText);

    if (result.locator) {
      try {
        await result.locator.click({ timeout: 5000 });

        // Wait for page load (tolerant)
        try {
          await page.waitForLoadState("networkidle", { timeout: 5000 });
        } catch {
          try {
            await page.waitForLoadState("domcontentloaded", { timeout: 3000 });
          } catch {
            // Tolerate timeout
          }
        }

        // Wait for actual state change
        const stateChange = await waitForStateChange(page, preClickUrl, preClickBodyText, 3000);

        const postUrl = page.url();
        console.log(
          `[auth-discovery] authChoiceClick target="${choiceText}" strategy=${result.strategy} success=true stateChanged=${stateChange.changed}`
        );

        // Capture post-click snapshot
        const snapshot = await capturePageSnapshot(page);

        diagnostics.push({
          level: "info",
          code: "auth_choice_step_executed",
          message: `Auth choice step executed: click "${choiceText}" (strategy: ${result.strategy}, state: ${stateChange.reason})`,
        });

        return {
          success: true,
          postChoiceUrl: postUrl,
          snapshot,
          diagnostics,
        };
      } catch (clickErr) {
        const errorMsg = clickErr instanceof Error ? clickErr.message : String(clickErr);
        console.log(
          `[auth-discovery] authChoiceClick target="${choiceText}" strategy=${result.strategy} success=false clickError=${errorMsg}`
        );

        diagnostics.push({
          level: "warning",
          code: "auth_choice_click_failed",
          message: `Auth choice click failed: target="${choiceText}" error=${errorMsg}`,
        });

        return {
          success: false,
          postChoiceUrl: page.url(),
          diagnostics,
        };
      }
    } else {
      // No element found
      const candidateSample = result.candidates.slice(0, 3).map((c) => c.text || c.ariaLabel || c.title).join(", ");
      console.log(
        `[auth-discovery] authChoiceClick target="${choiceText}" strategy=none success=false notFound candidates=${result.candidatesFound}`
      );

      diagnostics.push({
        level: "warning",
        code: "auth_choice_target_not_found",
        message: `Auth choice target not found: target="${choiceText}" (${result.candidatesFound} visible candidates${candidateSample ? `: ${candidateSample}` : ""})`,
      });

      // Capture snapshot anyway for diagnostics
      const snapshot = await capturePageSnapshot(page);

      return {
        success: false,
        postChoiceUrl: page.url(),
        snapshot,
        diagnostics,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[auth-discovery] authChoiceExecutionError: ${message}`);

    diagnostics.push({
      level: "warning",
      code: "auth_choice_execution_error",
      message: `Auth choice execution error: ${message}`,
    });

    // Capture snapshot for diagnostics
    const snapshot = await capturePageSnapshot(page);

    return {
      success: false,
      postChoiceUrl: page.url(),
      snapshot,
      diagnostics,
    };
  }
}

/**
 * Detect authentication choice options (método de identificación, etc.)
 * Generic signals for identity/document/customer/user methods
 */
async function detectAuthChoices(page: Page): Promise<Array<{ text: string; confidence: "high" | "medium" | "low" }>> {
  const choices: Array<{ text: string; confidence: "high" | "medium" | "low" }> = [];

  try {
    const clickables = await page.evaluate(() => {
      const elements = document.querySelectorAll("button, a, [role='button'], label, input[type='radio'], input[type='checkbox']");
      const items: Array<{ text: string; tag: string }> = [];

      for (const el of elements) {
        const text = el.textContent?.trim().substring(0, 100) || el.getAttribute("aria-label")?.substring(0, 100) || "";
        if (text && text.length > 2) {
          items.push({ text, tag: el.tagName.toLowerCase() });
        }
      }
      return items;
    });

    // Patterns for auth choice options (multiidioma)
    const identityPatterns = [
      /(?:cedula|cédula|documento|identificaci[óo]n|id|carnet|tarjeta|pasaporte|rnc|rfc|tin|ssn|customer|cliente|usuario|user|account)/i,
      /(?:by document|with id|by passport|by customer|customer code)/i,
    ];

    for (const clickable of clickables) {
      for (const pattern of identityPatterns) {
        if (pattern.test(clickable.text)) {
          choices.push({
            text: clickable.text,
            confidence: /(?:cedula|cédula|documento|identificaci[óo]n)/i.test(clickable.text) ? "high" : "medium",
          });
          break;
        }
      }
    }
  } catch (err) {
    console.log(`[auth-discovery] authChoicesDetectionError: ${err instanceof Error ? err.message : String(err)}`);
  }

  return choices;
}

/**
 * Detect virtual keyboard keys on the page
 * Returns true if virtual keyboard is present, false otherwise
 */
async function detectVirtualKeyboard(page: Page): Promise<{
  isPresent: boolean;
  keyCount: number;
  selectorPatterns: string[];
}> {
  try {
    const result = await page.evaluate(() => {
      // Common virtual keyboard patterns
      const patterns = [
        'button[data-key]',
        'button[data-value]',
        '.virtual-key',
        '[class*="keyboard"]',
        '[class*="key"][class*="board"]',
        'button[class*="key"]',
        'div[data-key]',
      ];

      let totalKeys = 0;
      const matchedPatterns: string[] = [];

      for (const selector of patterns) {
        try {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            totalKeys += elements.length;
            matchedPatterns.push(selector);
          }
        } catch {}
      }

      // Also detect digit/char buttons (single char buttons that look like keyboard)
      // Exclude common button texts like "Login", "Continue", "Clear" (>1 char non-digit)
      const allButtons = document.querySelectorAll("button");
      let digitCharCount = 0;
      let hasMultipleDigits = false;
      const digitChars = new Set<string>();

      for (const btn of allButtons) {
        const text = btn.textContent?.trim() || "";
        if (text.length === 1 && /[0-9A-Za-z#*]/.test(text)) {
          digitCharCount++;
          if (/[0-9]/.test(text)) digitChars.add(text);
        }
      }

      // If >=6 single-char digit/alpha buttons, or multiple distinct digits, mark as keyboard
      if (digitCharCount >= 6 || digitChars.size >= 5) {
        hasMultipleDigits = true;
        if (digitCharCount > 0 && !matchedPatterns.includes("digit_char_buttons")) {
          totalKeys = Math.max(totalKeys, digitCharCount);
          matchedPatterns.push("digit_char_buttons");
        }
      }

      return {
        isPresent: totalKeys > 0 || hasMultipleDigits,
        keyCount: Math.max(totalKeys, digitCharCount),
        patterns: matchedPatterns,
      };
    });

    return {
      isPresent: result.isPresent,
      keyCount: result.keyCount,
      selectorPatterns: result.patterns,
    };
  } catch (err) {
    console.log(`[auth-discovery] virtualKeyboardDetectionError: ${err instanceof Error ? err.message : String(err)}`);
    return {
      isPresent: false,
      keyCount: 0,
      selectorPatterns: [],
    };
  }
}
function resolveValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("$")) {
    // Environment variable reference
    return process.env[value.substring(1)];
  }
  return value;
}

/**
 * Normalize text for comparison (NFD normalization, lowercase, trim)
 */
function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .toLowerCase()
    .trim();
}

/**
 * Capture page snapshot for diagnostics
 */
async function capturePageSnapshot(page: Page): Promise<{
  url: string;
  title: string;
  bodyTextPreview: string;
  clickablesSample: Array<any>;
  counts: {
    buttons: number;
    links: number;
    inputs: number;
    textboxes: number;
    contenteditable: number;
    iframes: number;
    virtualKeyboardKeys: number;
  };
}> {
  try {
    const snapshot = await page.evaluate(() => {
      // Count various element types
      const buttons = document.querySelectorAll("button").length;
      const links = document.querySelectorAll("a").length;
      const inputs = document.querySelectorAll("input[type='text'], input[type='password'], input[type='email']").length;
      const textboxes = document.querySelectorAll("textarea, input[type='text']").length;
      const contenteditable = document.querySelectorAll("[contenteditable='true']").length;
      const iframes = document.querySelectorAll("iframe").length;

      // Detect virtual keyboard keys (single char buttons, data-key, etc.)
      const vkeyboard = document.querySelectorAll(
        "button[data-key], button[data-value], .virtual-key, [class*='key'][class*='board']"
      ).length;

      // Get body text preview
      const bodyText = document.body.textContent?.substring(0, 1000) || "";

      // Get visible clickables sample (more buttons if many present for keyboard detection)
      const clickables = document.querySelectorAll("button, a, [role='button']");
      const sampleClickables: Array<any> = [];
      const limit = clickables.length > 10 ? Math.min(20, clickables.length) : Math.min(5, clickables.length);
      for (let i = 0; i < limit; i++) {
        const el = clickables[i];
        sampleClickables.push({
          text: el.textContent?.trim().substring(0, 50),
          tag: el.tagName.toLowerCase(),
          ariaLabel: el.getAttribute("aria-label")?.substring(0, 50),
          title: el.getAttribute("title")?.substring(0, 50),
          dataKey: el.getAttribute("data-key"),
          dataValue: el.getAttribute("data-value"),
          className: el.className?.substring(0, 100),
        });
      }

      return {
        bodyText,
        clickables: sampleClickables,
        counts: {
          buttons,
          links,
          inputs,
          textboxes,
          contenteditable,
          iframes,
          virtualKeyboardKeys: vkeyboard,
        },
      };
    });

    return {
      url: page.url(),
      title: await page.title(),
      bodyTextPreview: snapshot.bodyText,
      clickablesSample: snapshot.clickables,
      counts: snapshot.counts,
    };
  } catch (err) {
    return {
      url: page.url(),
      title: "",
      bodyTextPreview: "",
      clickablesSample: [],
      counts: {
        buttons: 0,
        links: 0,
        inputs: 0,
        textboxes: 0,
        contenteditable: 0,
        iframes: 0,
        virtualKeyboardKeys: 0,
      },
    };
  }
}

/**
 * Wait for real state change after bootstrap click
 * Checks for URL change, new clickables, text change, or input appearance
 */
async function waitForStateChange(
  page: Page,
  previousUrl: string,
  previousBodyText: string,
  timeout: number = 5000
): Promise<{ changed: boolean; reason: string }> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    // Check URL change
    const currentUrl = page.url();
    if (currentUrl !== previousUrl) {
      return { changed: true, reason: "url_changed" };
    }

    // Check for inputs/textboxes
    const hasInputs = await page.locator("input, textarea, [contenteditable='true']").count();
    if (hasInputs > 0) {
      return { changed: true, reason: "inputs_appeared" };
    }

    // Check body text change
    try {
      const currentBodyText = await page.evaluate(() => document.body.textContent?.substring(0, 500) || "");
      if (currentBodyText !== previousBodyText) {
        return { changed: true, reason: "body_text_changed" };
      }
    } catch {}

    // Check for new clickables distinct from initial
    const clickables = await page.evaluate(() => {
      const elements = document.querySelectorAll("button, a, [role='button']");
      return Array.from(elements)
        .slice(0, 3)
        .map((e) => e.textContent?.trim().substring(0, 30) || "");
    });

    if (clickables.length > 0 && !clickables.every((c) => c.includes("Iniciar"))) {
      return { changed: true, reason: "new_clickables" };
    }

    // Wait a bit before retry
    await page.waitForTimeout(100);
  }

  return { changed: false, reason: "timeout" };
}

/**
 * Find clickable element by target text using multiproject-robust strategies
 * Returns { locator, strategy } or null if not found
 * Captures visible candidates if no match found
 */
async function findClickableByTarget(
  page: Page,
  target: string
): Promise<
  | { locator: any; strategy: string; candidatesFound: number; candidates: Array<any> }
  | { locator: null; strategy: null; candidatesFound: number; candidates: Array<any> }
> {
  const normalizedTarget = normalizeText(target);

  // Capture visible clickable candidates for diagnostics
  const visibleCandidates = await page.evaluate(() => {
    const clickables = document.querySelectorAll("button, a, [role='button'], input[type='submit'], input[type='button']");
    const candidates: Array<any> = [];

    for (const el of clickables) {
      const htmlEl = el as HTMLElement;
      if (!htmlEl.offsetParent && window.getComputedStyle(el).display === "none") continue; // Hidden check
      const text = el.textContent?.trim().substring(0, 50) || "";
      const ariaLabel = el.getAttribute("aria-label")?.substring(0, 50) || "";
      const title = el.getAttribute("title")?.substring(0, 50) || "";
      const dataTestId = el.getAttribute("data-testid")?.substring(0, 50) || "";
      const dataTest = el.getAttribute("data-test")?.substring(0, 50) || "";

      if (text || ariaLabel || title || dataTestId || dataTest) {
        candidates.push({
          text,
          role: el.getAttribute("role"),
          ariaLabel,
          title,
          tagName: el.tagName.toLowerCase(),
          dataTestId,
          dataTest,
        });
      }
    }
    return candidates;
  });

  try {
    // Strategy 1: getByRole("button", { name: regex })
    try {
      const btnRegex = new RegExp(normalizedTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const element = page.getByRole("button", { name: btnRegex });
      const count = await element.count();
      if (count > 0) {
        return { locator: element.first(), strategy: "getByRole(button)" as const, candidatesFound: count, candidates: visibleCandidates };
      }
    } catch {}

    // Strategy 2: getByRole("link", { name: regex })
    try {
      const linkRegex = new RegExp(normalizedTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const element = page.getByRole("link", { name: linkRegex });
      const count = await element.count();
      if (count > 0) {
        return { locator: element.first(), strategy: "getByRole(link)" as const, candidatesFound: count, candidates: visibleCandidates };
      }
    } catch {}

    // Strategy 3: getByText(regex) - case insensitive
    try {
      const textRegex = new RegExp(normalizedTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const element = page.getByText(textRegex);
      const count = await element.count();
      if (count > 0) {
        // Filter to clickables only
        for (let i = 0; i < count; i++) {
          const el = element.nth(i);
          const role = await el.getAttribute("role");
          const tagName = await el.evaluate((e) => e.tagName.toLowerCase());
          if (tagName === "button" || tagName === "a" || role === "button") {
            return { locator: el, strategy: "getByText(regex)" as const, candidatesFound: count, candidates: visibleCandidates };
          }
        }
      }
    } catch {}

    // Strategy 4: locator(`button:has-text(...)`) with exact text
    try {
      const selector = `button:has-text("${target.replace(/"/g, '\\"')}")`;
      const element = page.locator(selector);
      const count = await element.count();
      if (count > 0) {
        return { locator: element.first(), strategy: "button:has-text" as const, candidatesFound: count, candidates: visibleCandidates };
      }
    } catch {}

    // Strategy 5: locator(`a:has-text(...)`) with exact text
    try {
      const selector = `a:has-text("${target.replace(/"/g, '\\"')}")`;
      const element = page.locator(selector);
      const count = await element.count();
      if (count > 0) {
        return { locator: element.first(), strategy: "a:has-text" as const, candidatesFound: count, candidates: visibleCandidates };
      }
    } catch {}

    // Strategy 6: locator(`[role="button"]:has-text(...)`)
    try {
      const selector = `[role="button"]:has-text("${target.replace(/"/g, '\\"')}")`;
      const element = page.locator(selector);
      const count = await element.count();
      if (count > 0) {
        return { locator: element.first(), strategy: "[role=button]:has-text" as const, candidatesFound: count, candidates: visibleCandidates };
      }
    } catch {}

    // Strategy 7: locator with data attributes (data-testid, title, aria-label)
    try {
      const escapedTarget = target.replace(/"/g, '\\"');
      const selector = `[data-testid*="${escapedTarget}"], [data-test*="${escapedTarget}"], [aria-label*="${escapedTarget}"], [title*="${escapedTarget}"]`;
      const element = page.locator(selector);
      const count = await element.count();
      if (count > 0) {
        return { locator: element.first(), strategy: "data-attributes" as const, candidatesFound: count, candidates: visibleCandidates };
      }
    } catch {}

    // Strategy 8: DOM eval - find clickables by normalized text content
    try {
      const elementInfo = await page.evaluate(
        (normalized) => {
          const clickables = document.querySelectorAll("button, a, [role='button'], input[type='submit'], input[type='button']");
          for (const el of clickables) {
            const elText = normalizeText(el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || "");
            if (elText.includes(normalized) || normalized.includes(elText)) {
              return {
                found: true,
                text: el.textContent?.substring(0, 50),
                ariaLabel: el.getAttribute("aria-label"),
                title: el.getAttribute("title"),
                dataTestId: el.getAttribute("data-testid"),
              };
            }
          }
          return { found: false };
        },
        normalizedTarget
      );

      if (elementInfo.found) {
        // Re-find using text (now we know it exists)
        const regex = new RegExp(normalizedTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        const element = page.locator("button, a, [role='button']").filter({ hasText: regex });
        const count = await element.count();
        if (count > 0) {
          return { locator: element.first(), strategy: "dom-eval-match" as const, candidatesFound: count, candidates: visibleCandidates };
        }
      }
    } catch {}

    // No match found
    return { locator: null, strategy: null, candidatesFound: visibleCandidates.length, candidates: visibleCandidates };
  } catch (err) {
    return { locator: null, strategy: null, candidatesFound: visibleCandidates.length, candidates: visibleCandidates };
  }
}

/**
 * Extract auth steps from authProfile with tolerant property name support
 * Priority: steps → loginSteps → entrySteps → flow
 */
function extractAuthSteps(authProfile: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  if (!authProfile) return [];

  const steps =
    (authProfile.steps as Array<Record<string, unknown>> | undefined) ||
    (authProfile.loginSteps as Array<Record<string, unknown>> | undefined) ||
    (authProfile.entrySteps as Array<Record<string, unknown>> | undefined) ||
    (authProfile.flow as Array<Record<string, unknown>> | undefined);

  return Array.isArray(steps) ? steps : [];
}

/**
 * Extract success signals from authProfile with tolerant property name support
 * Priority: successSignals → landingSignals → authenticatedSignals
 */
function extractSuccessSignals(authProfile: Record<string, unknown> | undefined): string[] {
  if (!authProfile) return [];

  const signals =
    (authProfile.successSignals as string[] | string | undefined) ||
    (authProfile.landingSignals as string[] | string | undefined) ||
    (authProfile.authenticatedSignals as string[] | string | undefined);

  if (Array.isArray(signals)) return signals;
  if (typeof signals === "string") return [signals];
  return [];
}

/**
 * Extract bootstrap/entry steps for reaching login screen
 * Tolerant property name support: bootstrapSteps, preAuthSteps, entrySteps
 */
function extractBootstrapSteps(appConfig: Record<string, unknown> | undefined): Array<Record<string, unknown>> {
  if (!appConfig) return [];

  // Try authProfile bootstrap steps first
  const authProfile = appConfig.authProfile as Record<string, unknown> | undefined;
  if (authProfile) {
    const steps =
      (authProfile.bootstrapSteps as Array<Record<string, unknown>> | undefined) ||
      (authProfile.preAuthSteps as Array<Record<string, unknown>> | undefined);

    if (Array.isArray(steps) && steps.length > 0) {
      return steps;
    }
  }

  // Try routeProfile entry steps
  const routeProfile = appConfig.routeProfile as Record<string, unknown> | undefined;
  if (routeProfile) {
    const entrySteps = routeProfile.entrySteps as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(entrySteps) && entrySteps.length > 0) {
      return entrySteps;
    }
  }

  // Try top-level entrySteps
  const topLevelSteps = appConfig.entrySteps as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(topLevelSteps) && topLevelSteps.length > 0) {
    return topLevelSteps;
  }

  // Try publicRoutes entry steps (first route with entry steps)
  const publicRoutes = appConfig.publicRoutes as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(publicRoutes)) {
    for (const route of publicRoutes) {
      const steps = route.entrySteps as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(steps) && steps.length > 0) {
        return steps;
      }
    }
  }

  return [];
}

/**
 * Execute bootstrap steps to reach login screen (Microfase 2.1 bootstrap)
 * Only executes safe actions: click
 * Uses robust multiproject click resolver
 */
async function executeBootstrapSteps(
  page: Page,
  steps: Array<Record<string, unknown>>
): Promise<{
  success: boolean;
  finalUrl: string;
  stateChanged: boolean;
  snapshot?: Awaited<ReturnType<typeof capturePageSnapshot>>;
  diagnostics: AuthenticatedPrivateDiscoveryResult["diagnostics"]
}> {
  const diagnostics: AuthenticatedPrivateDiscoveryResult["diagnostics"] = [];

  try {
    for (const step of steps) {
      const action = step.action as string | undefined;
      const target = step.target as string | undefined;

      // Only execute click actions in bootstrap (no fills)
      if (action === "click" && target) {
        try {
          // Capture pre-click state
          const preClickUrl = page.url();
          const preClickBodyText = await page.evaluate(() => document.body.textContent?.substring(0, 500) || "");

          // Use robust multiproject click resolver
          const result = await findClickableByTarget(page, target);

          if (result.locator) {
            // Element found, try to click it
            try {
              await result.locator.click({ timeout: 5000 });

              // Wait for navigation or content change (tolerant)
              try {
                await page.waitForLoadState("networkidle", { timeout: 5000 });
              } catch {
                try {
                  await page.waitForLoadState("domcontentloaded", { timeout: 3000 });
                } catch {
                  // Tolerate both timeouts
                }
              }

              // Wait for actual state change
              const stateChange = await waitForStateChange(page, preClickUrl, preClickBodyText, 3000);

              console.log(
                `[auth-discovery] bootstrapResolver strategy=${result.strategy} target="${target}" success=true stateChanged=${stateChange.changed}`
              );
              diagnostics.push({
                level: "info",
                code: "bootstrap_step_executed",
                message: `Bootstrap step executed: click "${target}" (strategy: ${result.strategy}, state: ${stateChange.reason})`,
              });
            } catch (clickErr) {
              diagnostics.push({
                level: "warning",
                code: "bootstrap_click_failed",
                message: `Bootstrap click failed: target="${target}" error=${clickErr instanceof Error ? clickErr.message : String(clickErr)}`,
              });
              console.log(
                `[auth-discovery] bootstrapResolver strategy=${result.strategy} target="${target}" success=false clickError`
              );
            }
          } else {
            // No element found, capture candidates for diagnostics
            const sampleCandidates = result.candidates.slice(0, 3);
            const candidateSample = sampleCandidates.map((c) => c.text || c.ariaLabel || c.title).join(", ");

            console.log(
              `[auth-discovery] bootstrapClickCandidates=${result.candidatesFound} sample="${candidateSample}"`
            );
            diagnostics.push({
              level: "warning",
              code: "bootstrap_click_target_not_found",
              message: `Bootstrap click target not found: target="${target}" (tried 8 strategies, ${result.candidatesFound} visible candidates found${candidateSample ? `: ${candidateSample}` : ""})`,
            });
            console.log(
              `[auth-discovery] bootstrapResolver strategy=none target="${target}" success=false notFound`
            );
          }
        } catch (err) {
          diagnostics.push({
            level: "warning",
            code: "bootstrap_step_error",
            message: `Bootstrap step error: action="click" target="${target}" error=${err instanceof Error ? err.message : String(err)}`,
          });
          console.log(
            `[auth-discovery] bootstrapResolver strategy=error target="${target}" success=false error=${err instanceof Error ? err.message : String(err)}`
          );
        }
      } else if (action !== "click") {
        // Skip non-click actions in bootstrap (only safe to click)
        diagnostics.push({
          level: "info",
          code: "bootstrap_step_skipped",
          message: `Bootstrap step skipped: unsupported action "${action}" (only click is safe in bootstrap)`,
        });
      }
    }

    // Capture post-bootstrap snapshot
    const snapshot = await capturePageSnapshot(page);
    const finalUrl = page.url();

    console.log(
      `[auth-discovery] postBootstrapSnapshot url=${finalUrl} buttons=${snapshot.counts.buttons} links=${snapshot.counts.links} inputs=${snapshot.counts.inputs} vkKeys=${snapshot.counts.virtualKeyboardKeys}`
    );
    console.log(`[auth-discovery] bodyTextPreview="${snapshot.bodyTextPreview.substring(0, 100).replace(/\n/g, " ")}"`);
    console.log(`[auth-discovery] postBootstrapUrl=${finalUrl}`);

    diagnostics.push({
      level: "info",
      code: "post_bootstrap_snapshot",
      message: `Post-bootstrap snapshot: ${snapshot.counts.buttons} buttons, ${snapshot.counts.links} links, ${snapshot.counts.inputs} inputs, ${snapshot.counts.virtualKeyboardKeys} virtual keyboard keys`,
    });

    return {
      success: true,
      finalUrl,
      stateChanged: snapshot.counts.buttons > 0 || snapshot.counts.inputs > 0,
      snapshot,
      diagnostics,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    diagnostics.push({
      level: "warning",
      code: "bootstrap_execution_error",
      message: `Bootstrap execution error: ${message}`,
    });
    console.log(`[auth-discovery] bootstrapExecutionError: ${message}`);

    return {
      success: false, // Tolerate failure, continue with discovery
      finalUrl: page.url(),
      stateChanged: false,
      diagnostics,
    };
  }
}

/**
 * Detect auth field candidates from page DOM
 * Generic detection without hardcoding labels or selectors
 */
async function detectAuthFieldCandidates(page: Page): Promise<Array<{
  type: "input" | "button";
  inputType?: string;
  selectors: string[];
  label?: string;
  placeholder?: string;
  ariaLabel?: string;
  nearbyText?: string;
}>> {
  const candidates: Array<{
    type: "input" | "button";
    inputType?: string;
    selectors: string[];
    label?: string;
    placeholder?: string;
    ariaLabel?: string;
    nearbyText?: string;
  }> = [];

  try {
    // Detect input fields
    const inputs = await page.$$eval(
      'input[type="text"], input[type="password"], input[type="tel"], input[type="number"], input:not([type]), input[type="email"]',
      (els) => {
        return els.map((el: any) => {
          const selectors: string[] = [];
          if (el.id) selectors.push(`#${el.id}`);
          if (el.name) selectors.push(`[name="${el.name}"]`);
          if (el.getAttribute("data-testid")) selectors.push(`[data-testid="${el.getAttribute("data-testid")}"]`);
          if (el.getAttribute("aria-label")) selectors.push(`[aria-label="${el.getAttribute("aria-label")}"]`);

          // Get nearby text from label or previous elements
          let nearbyText = "";
          const label = el.previousElementSibling?.textContent || el.parentElement?.querySelector("label")?.textContent;
          if (label) nearbyText = label.trim().substring(0, 50);

          return {
            type: "input" as const,
            inputType: el.type || "text",
            selectors,
            label: label?.trim().substring(0, 50),
            placeholder: el.placeholder?.substring(0, 50),
            ariaLabel: el.getAttribute("aria-label")?.substring(0, 50),
            nearbyText,
          };
        });
      }
    );
    candidates.push(...inputs);

    // Detect clickable elements (buttons, links)
    const clickables = await page.$$eval(
      'button, a[role="button"], input[type="submit"], input[type="button"]',
      (els) => {
        return els.map((el: any) => {
          const selectors: string[] = [];
          if (el.id) selectors.push(`#${el.id}`);
          if (el.getAttribute("data-testid")) selectors.push(`[data-testid="${el.getAttribute("data-testid")}"]`);
          const text = el.textContent?.trim().substring(0, 50) || el.value?.substring(0, 50);

          return {
            type: "button" as const,
            selectors,
            label: text,
            ariaLabel: el.getAttribute("aria-label")?.substring(0, 50),
          };
        });
      }
    );
    candidates.push(...clickables);

    return candidates;
  } catch (err) {
    console.log(`[auth-discovery] error detecting candidates: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/**
 * Classify field type by generic signals (no hardcoding)
 */
function classifyFieldType(candidate: {
  type: string;
  inputType?: string;
  label?: string;
  placeholder?: string;
  ariaLabel?: string;
  nearbyText?: string;
}): "identity" | "password" | "otp" | "unknown" {
  const allText = [
    candidate.label,
    candidate.placeholder,
    candidate.ariaLabel,
    candidate.nearbyText,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  // Classify by generic patterns (no hardcoding project-specific labels)
  if (
    /(?:identity|identification|document|document\s+number|cedula|cédula|user|username|email|account|customer|client|numero|rut|tin|ssn|id\s+number)/i.test(
      allText
    )
  ) {
    return "identity";
  }

  if (
    /(?:password|pin|pass|clave|contrase|secret|key|passwd|pwd|password\s+number)/i.test(allText)
  ) {
    return "password";
  }

  if (/(?:otp|code|token|verify|verification|2fa|one.?time|codigo|temporario)/.test(allText)) {
    return "otp";
  }

  return "unknown";
}

/**
 * Propose auth steps from detected candidates (no hardcoding)
 */
function proposeAuthSteps(candidates: Array<{
  type: "input" | "button";
  inputType?: string;
  selectors: string[];
  label?: string;
  placeholder?: string;
  ariaLabel?: string;
  nearbyText?: string;
}>, virtualKeyboardDetected?: boolean, virtualKeyboardKeyCount?: number): ProposedAuthProfile {
  const steps: ProposedAuthProfile["steps"] = [];
  const proposedCandidates: ProposedAuthProfile["candidates"] = [];

  // Group inputs by field type
  const inputsByType = new Map<"identity" | "password" | "otp" | "unknown", typeof candidates>();
  for (const candidate of candidates.filter((c) => c.type === "input")) {
    const fieldType = classifyFieldType(candidate);
    if (!inputsByType.has(fieldType)) {
      inputsByType.set(fieldType, []);
    }
    inputsByType.get(fieldType)!.push(candidate);
  }

  // Create proposedCandidates list
  for (const [fieldType, inputs] of inputsByType.entries()) {
    for (const input of inputs) {
      proposedCandidates.push({
        type: "input",
        fieldType,
        selectors: input.selectors,
        label: input.label || input.placeholder,
        confidence: fieldType === "unknown" ? "low" : "medium",
      });
    }
  }

  // Build steps from classified inputs
  const identityInputs = inputsByType.get("identity") || [];
  const passwordInputs = inputsByType.get("password") || [];
  const otpInputs = inputsByType.get("otp") || [];

  // Identity step - use virtualKeyboardFill if keyboard detected
  if (identityInputs.length > 0) {
    const selector = identityInputs[0].selectors[0];
    steps.push({
      action: virtualKeyboardDetected ? "virtualKeyboardFill" : "fill",
      field: selector,
      envVar: "$Identity_Provider", // Fallback env var for identity/document
      confidence: identityInputs[0].ariaLabel || identityInputs[0].label ? "medium" : "low",
      reason: `Detected identity field: ${identityInputs[0].label || identityInputs[0].placeholder}${virtualKeyboardDetected ? " (virtual keyboard input)" : ""}`,
    });
  }

  // Password step - use virtualKeyboardFill if keyboard detected
  if (passwordInputs.length > 0) {
    const selector = passwordInputs[0].selectors[0];
    steps.push({
      action: virtualKeyboardDetected ? "virtualKeyboardFill" : "fill",
      field: selector,
      envVar: "$APP_PASSWORD",
      confidence: "medium",
      reason: `Detected password field: ${passwordInputs[0].label || passwordInputs[0].placeholder}${virtualKeyboardDetected ? " (virtual keyboard input)" : ""}`,
    });
  }

  // OTP step - may also use virtual keyboard
  if (otpInputs.length > 0) {
    const selector = otpInputs[0].selectors[0];
    steps.push({
      action: virtualKeyboardDetected ? "virtualKeyboardFill" : "fill",
      field: selector,
      envVar: "$OTP_SECRET",
      confidence: "low",
      reason: `Detected OTP field: ${otpInputs[0].label || otpInputs[0].placeholder}${virtualKeyboardDetected ? " (virtual keyboard input)" : ""}`,
    });
  }

  // Find submit/login button
  const submitButton = candidates.find(
    (c) =>
      c.type === "button" &&
      /(?:login|signin|submit|send|continue|next|confirm|entrar|ingresar)/i.test(c.label || "")
  );

  if (submitButton) {
    steps.push({
      action: "click",
      target: submitButton.label || submitButton.selectors[0],
      confidence: "high",
      reason: `Detected submit button: ${submitButton.label}`,
    });

    proposedCandidates.push({
      type: "button",
      fieldType: "unknown",
      selectors: submitButton.selectors,
      label: submitButton.label,
      confidence: "high",
    });
  }

  // Determine overall confidence
  let confidence: "high" | "medium" | "low" = "low";
  if (steps.length >= 2) confidence = "medium"; // At least identity + password
  if (steps.length >= 3) confidence = "high"; // Identity + password + submit

  // Special case: virtual keyboard but no standard inputs
  if (steps.length === 0 && virtualKeyboardDetected && candidates.length > 0) {
    // Propose virtual keyboard fill for credential entry without standard input field
    let kbConfidence: "high" | "medium" | "low" = "medium";
    if ((virtualKeyboardKeyCount || 0) >= 10) {
      kbConfidence = "high"; // Many keys, likely a real keyboard
    } else if ((virtualKeyboardKeyCount || 0) < 6) {
      kbConfidence = "low"; // Too few keys, might be false positive
    }

    steps.push({
      action: "virtualKeyboardFill",
      field: "activeCredentialField",
      envVar: "$Identity_Provider",
      confidence: kbConfidence,
      reason: `Virtual keyboard detected (${virtualKeyboardKeyCount} keys) but no standard input fields. Proposing virtual keyboard fill for active credential field.`,
    });

    confidence = kbConfidence;
  }

  return {
    steps,
    successSignals: [],
    confidence,
    hasVirtualKeyboard: virtualKeyboardDetected,
    candidates: proposedCandidates,
  };
}

/**
 * Discover auth profile steps from login page (Microfase 2.1)
 * Includes bootstrap execution to reach login screen
 */
async function discoverAuthProfileSteps(
  page: Page,
  appSlug: string,
  baseUrl: string,
  appConfig: Record<string, unknown> | undefined,
  suggestedRoute?: string,
  intent?: string,
  businessContext?: Record<string, any>
): Promise<{ proposedProfile: ProposedAuthProfile; diagnostics: AuthenticatedPrivateDiscoveryResult["diagnostics"] }> {
  const diagnostics: AuthenticatedPrivateDiscoveryResult["diagnostics"] = [];

  // Variables for final state consistency - prevent later overrides
  let finalCredentialContinueAdvanced = false;
  let finalCredentialContinueReason = "";
  let finalOtpStageDetected = false;
  let finalPostContinueUrl: string | null = null;
  let functionalAdvanceDiagnosticEmitted = false;

  try {
    console.log(`[auth-discovery] started appSlug=${appSlug}`);

    // Step 1: Execute bootstrap steps to reach login/entry screen
    const bootstrapSteps = extractBootstrapSteps(appConfig);
    console.log(`[auth-discovery] bootstrapStepsResolved=${bootstrapSteps.length}`);

    let bootstrapStateChanged = false;
    let postBootstrapSnapshot: Awaited<ReturnType<typeof capturePageSnapshot>> | undefined;

    if (bootstrapSteps.length > 0) {
      const { diagnostics: bootstrapDiags, stateChanged, snapshot } = await executeBootstrapSteps(page, bootstrapSteps);
      diagnostics.push(...bootstrapDiags);
      bootstrapStateChanged = stateChanged;
      postBootstrapSnapshot = snapshot;

      // Check if bootstrap didn't change state
      if (!stateChanged && bootstrapSteps.length > 0) {
        diagnostics.push({
          level: "warning",
          code: "bootstrap_no_state_change",
          message: `Bootstrap step executed but page state did not change. Still seeing same clickables.`,
        });
      }
    }

    // Step 1.5: Try to enter private module (Microfase 2.1b)
    const privateEntryTarget = resolvePrivateEntryTarget(appConfig, suggestedRoute);
    let privateEntryExecuted = false;
    let postPrivateEntrySnapshot: Awaited<ReturnType<typeof capturePageSnapshot>> | undefined;
    let entryDomChanged = false;

    if (privateEntryTarget && bootstrapStateChanged) {
      // Only try private entry if bootstrap actually changed state
      console.log(`[auth-discovery] privateEntryTargetResolved="${privateEntryTarget}"`);
      diagnostics.push({
        level: "info",
        code: "private_entry_target_resolved",
        message: `Private entry target resolved: "${privateEntryTarget}"`,
      });

      const entryResult = await executePrivateEntryStep(page, privateEntryTarget);
      diagnostics.push(...entryResult.diagnostics);
      privateEntryExecuted = entryResult.success;
      postPrivateEntrySnapshot = entryResult.snapshot;
      entryDomChanged = entryResult.domChanged ?? false;

      if (entryResult.success) {
        console.log(`[auth-discovery] postPrivateEntryUrl=${entryResult.postEntryUrl}`);
        if (entryResult.snapshot) {
          console.log(
            `[auth-discovery] postPrivateEntrySnapshot url=${entryResult.snapshot.url} inputs=${entryResult.snapshot.counts.inputs} textboxes=${entryResult.snapshot.counts.textboxes} buttons=${entryResult.snapshot.counts.buttons} vkKeys=${entryResult.snapshot.counts.virtualKeyboardKeys}`
          );
          // Include visible buttons sample if any buttons present
          if (entryResult.snapshot.counts.buttons > 0 && entryResult.snapshot.clickablesSample.length > 0) {
            const btnSample = entryResult.snapshot.clickablesSample
              .filter((c) => c.tag === "button")
              .slice(0, 10)
              .map((b) => `"${b.text || b.ariaLabel || b.title || "?"}"`)
              .join(", ");
            diagnostics.push({
              level: "info",
              code: "post_private_entry_visible_buttons",
              message: `Post-private-entry visible buttons (${entryResult.snapshot.counts.buttons} total): ${btnSample}`,
            });
          }
        }
      }
    } else if (privateEntryTarget && !bootstrapStateChanged) {
      // Bootstrap didn't change state, skip private entry
      console.log(`[auth-discovery] skipping private entry: bootstrap did not change state`);
      diagnostics.push({
        level: "warning",
        code: "bootstrap_no_state_change",
        message: `Skipping private entry: bootstrap step did not change page state. Review bootstrap configuration.`,
      });

      // Include bootstrap snapshot in diagnostics
      if (postBootstrapSnapshot) {
        diagnostics.push({
          level: "info",
          code: "post_bootstrap_snapshot_detail",
          message: `Post-bootstrap state: URL=${postBootstrapSnapshot.url}, visible clickables=${postBootstrapSnapshot.clickablesSample.length}, body preview: "${postBootstrapSnapshot.bodyTextPreview.substring(0, 100)}"`,
        });
      }

      return {
        proposedProfile: {
          steps: [],
          confidence: "low",
          candidates: [],
        },
        diagnostics,
      };
    }

    // Step 2: Detect auth choice options (if applicable)
    // Only detect auth choices if DOM actually changed after private entry
    let authChoices: any[] = [];
    let postAuthChoiceSnapshot: Awaited<ReturnType<typeof capturePageSnapshot>> | undefined;

    if (privateEntryExecuted && postPrivateEntrySnapshot) {
      // Check if we have info about DOM changes from the private entry result
      const domChanged = entryDomChanged;

      if (domChanged) {
        authChoices = await detectAuthChoices(page);

        if (authChoices.length > 0) {
          // Select highest confidence choice (prefer high > medium > low)
          const selected = authChoices.sort((a, b) => {
            const confidenceRank = { high: 3, medium: 2, low: 1 };
            return (confidenceRank[b.confidence] || 0) - (confidenceRank[a.confidence] || 0);
          })[0];

      console.log(
        `[auth-discovery] authChoices candidates=${authChoices.length} selected="${selected.text}" confidence=${selected.confidence}`
      );
      diagnostics.push({
        level: "info",
        code: "auth_choice_detected",
        message: `Detected ${authChoices.length} auth choice options, selected: "${selected.text}" (confidence: ${selected.confidence})`,
      });

      // Step 2.5: Execute auth choice click (NEW)
      if (selected.confidence === "high" || selected.confidence === "medium") {
        const choiceResult = await executeAuthChoiceStep(page, selected.text);
        diagnostics.push(...choiceResult.diagnostics);
        postAuthChoiceSnapshot = choiceResult.snapshot;

        if (choiceResult.success) {
          console.log(`[auth-discovery] postAuthChoiceUrl=${choiceResult.postChoiceUrl}`);
          if (choiceResult.snapshot) {
            console.log(
              `[auth-discovery] postAuthChoiceSnapshot url=${choiceResult.snapshot.url} inputs=${choiceResult.snapshot.counts.inputs} textboxes=${choiceResult.snapshot.counts.textboxes} buttons=${choiceResult.snapshot.counts.buttons} vkKeys=${choiceResult.snapshot.counts.virtualKeyboardKeys}`
            );
            diagnostics.push({
              level: "info",
              code: "post_auth_choice_snapshot",
              message: `Post-auth-choice snapshot: URL=${choiceResult.snapshot.url}, inputs=${choiceResult.snapshot.counts.inputs}, textboxes=${choiceResult.snapshot.counts.textboxes}, buttons=${choiceResult.snapshot.counts.buttons}, virtual keyboard keys=${choiceResult.snapshot.counts.virtualKeyboardKeys}`,
            });
          }
        }
      } else {
        // Low confidence, just log but don't execute
        console.log(
          `[auth-discovery] authChoiceClick skipped: confidence=${selected.confidence} (below threshold)`
        );
        diagnostics.push({
          level: "info",
          code: "auth_choice_skipped_low_confidence",
          message: `Auth choice not executed due to low confidence (${selected.confidence})`,
        });
      }
        } else if (postPrivateEntrySnapshot && postPrivateEntrySnapshot.counts.buttons > 0) {
          // No auth choices detected but buttons present - include visible buttons in diagnostics
          console.log(`[auth-discovery] authChoices not detected`);
          diagnostics.push({
            level: "info",
            code: "auth_choices_not_detected",
            message: `No auth choice options detected after private entry (${postPrivateEntrySnapshot.counts.buttons} buttons present)`,
          });

          const btnSample = postPrivateEntrySnapshot.clickablesSample
            .filter((c) => c.tag === "button")
            .slice(0, 10)
            .map((b) => ({
              text: b.text,
              ariaLabel: b.ariaLabel,
              title: b.title,
              dataKey: b.dataKey,
              dataValue: b.dataValue,
            }));
          diagnostics.push({
            level: "info",
            code: "visible_buttons_detail",
            message: `Visible buttons: ${JSON.stringify(btnSample)}`,
          });
        }
      } else if (privateEntryExecuted && !domChanged) {
        // DOM didn't change after private entry - don't detect auth choices
        console.log(`[auth-discovery] skipping auth choice detection: DOM did not update after private entry`);
        diagnostics.push({
          level: "warning",
          code: "dom_unchanged_after_entry",
          message: `DOM did not update after private entry. Skipping auth choice detection to avoid false positives.`,
        });
      }
    }

    // Step 3: Detect field candidates from DOM (after bootstrap and private entry and auth choice)
    const candidates = await detectAuthFieldCandidates(page);
    const inputCount = candidates.filter((c) => c.type === "input").length;
    const buttonCount = candidates.filter((c) => c.type === "button").length;

    console.log(`[auth-discovery] candidates inputs=${inputCount} buttons=${buttonCount}`);

    if (candidates.length === 0) {
      // Try to provide diagnostic hint with snapshot
      let diagnosticMsg = `No input fields or buttons detected at ${page.url()}.`;
      if (!privateEntryExecuted && privateEntryTarget) {
        diagnosticMsg += ` Could not enter private module "${privateEntryTarget}".`;
      }
      if (authChoices.length > 0) {
        diagnosticMsg += ` (Tried to execute auth choice but no fields appeared.)`;
      }
      diagnosticMsg += ` Cannot propose auth steps.`;

      diagnostics.push({
        level: "warning",
        code: "no_candidates_found",
        message: diagnosticMsg,
      });

      // Include post-auth-choice snapshot in diagnostics if available
      if (postAuthChoiceSnapshot) {
        diagnostics.push({
          level: "info",
          code: "post_auth_choice_snapshot_detail",
          message: `Post-auth-choice state: URL=${postAuthChoiceSnapshot.url}, visible clickables=${postAuthChoiceSnapshot.clickablesSample.length}, body preview: "${postAuthChoiceSnapshot.bodyTextPreview.substring(0, 100)}"`,
        });

        // Add visible buttons sample if keyboard might be present
        if (postAuthChoiceSnapshot.counts.buttons > 5) {
          const btnSample = postAuthChoiceSnapshot.clickablesSample
            .filter((c) => c.tag === "button")
            .slice(0, 10)
            .map((b) => `"${b.text || b.ariaLabel || b.title || "?"}"`)
            .join(", ");
          diagnostics.push({
            level: "info",
            code: "visible_buttons_sample",
            message: `Visible button sample (${postAuthChoiceSnapshot.counts.buttons} total): ${btnSample}`,
          });
        }
      }

      return {
        proposedProfile: {
          steps: [],
          confidence: "low",
          candidates: [],
        },
        diagnostics,
      };
    }

    // Step 3.5: Detect virtual keyboard (if present)
    const virtualKeyboardDetection = await detectVirtualKeyboard(page);
    if (virtualKeyboardDetection.isPresent) {
      console.log(
        `[auth-discovery] virtualKeyboard detected keyCount=${virtualKeyboardDetection.keyCount} patterns=${virtualKeyboardDetection.selectorPatterns.join(", ")}`
      );
      diagnostics.push({
        level: "info",
        code: "virtual_keyboard_detected",
        message: `Virtual keyboard detected with ${virtualKeyboardDetection.keyCount} keys. Using virtualKeyboardFill action for text inputs.`,
      });
    }

    // Step 4: Propose steps from candidates
    const proposedProfile = proposeAuthSteps(candidates, virtualKeyboardDetection.isPresent, virtualKeyboardDetection.keyCount);

    console.log(
      `[auth-discovery] proposedSteps=${proposedProfile.steps.length} confidence=${proposedProfile.confidence}`
    );

    diagnostics.push({
      level: "info",
      code: "auth_discovery_proposed",
      message: `Proposed ${proposedProfile.steps.length} auth steps with ${proposedProfile.confidence} confidence from detected fields.`,
    });

    if (proposedProfile.steps.length > 0) {
      diagnostics.push({
        level: "info",
        code: "auth_discovery_steps_summary",
        message: proposedProfile.steps
          .map((s) => `${s.action} ${s.field || s.target} (${s.confidence})`)
          .join(" → "),
      });
    }

    // Step 4.5: Execute proposed steps if confidence is high
    if (proposedProfile.confidence === "high" && proposedProfile.steps.length > 0) {
      console.log(`[auth-discovery] executing proposed steps confidence=high`);

      let postExecutionSnapshot = await capturePageSnapshot(page);

      for (const step of proposedProfile.steps) {
        if (step.action === "virtualKeyboardFill" && step.envVar) {
          // Detect and resolve optional pre-credential gate before filling
          const gateResult = await detectAndResolvePreCredentialGate(page);
          if (gateResult.detected) {
            console.log(
              `[auth-discovery] preCredentialGate detected=true confidence=${gateResult.confidence} target="${gateResult.target}"`
            );
            if (gateResult.accepted) {
              console.log(`[auth-discovery] preCredentialGateAccepted=true`);
              diagnostics.push({
                level: "info",
                code: "pre_credential_gate_accepted",
                message: `Pre-credential gate accepted: "${gateResult.target}"`,
              });
              await page.waitForTimeout(200); // Brief pause after acceptance
            } else {
              console.log(`[auth-discovery] preCredentialGateAccepted=false`);
              diagnostics.push({
                level: "warning",
                code: "pre_credential_gate_skipped_low_confidence",
                message: `Pre-credential gate detected but not accepted (low confidence): "${gateResult.target}"`,
              });
            }
          } else {
            diagnostics.push({
              level: "info",
              code: "pre_credential_gate_not_found",
              message: "No pre-credential gate detected",
            });
          }

          // Detect and focus visual credential input field before virtualKeyboardFill
          const fieldResult = await detectCredentialInputField(page);
          const beforeFieldSnapshot = await capturePageSnapshot(page);

          if (fieldResult.found && fieldResult.confidence && fieldResult.confidence !== "low") {
            try {
              // Focus the field
              const inputLocator = page.locator("input[type=text], input:not([type]), textarea, [role=textbox], [contenteditable]").first();
              await inputLocator.click({ timeout: 3000 });
              await inputLocator.focus();
              await page.waitForTimeout(200);

              console.log(
                `[auth-discovery] credentialFieldFocused tag=${fieldResult.target} confidence=${fieldResult.confidence}`
              );
              diagnostics.push({
                level: "info",
                code: "credential_field_focused",
                message: `Credential field focused: ${fieldResult.target} (${fieldResult.confidence})`,
              });
            } catch {
              console.log(`[auth-discovery] credentialFieldFocusError tag=${fieldResult.target}`);
              diagnostics.push({
                level: "warning",
                code: "credential_field_focus_error",
                message: `Could not focus credential field: ${fieldResult.target}`,
              });
            }
          } else if (!fieldResult.found && fieldResult.candidates && fieldResult.candidates.length > 0) {
            const candSample = fieldResult.candidates
              .slice(0, 3)
              .map((c) => `${c.tag}(role=${c.role || "none"}, text="${c.text.substring(0, 10)}")`)
              .join("; ");
            console.log(`[auth-discovery] credentialFieldNotFound candidates=${candSample}`);
            diagnostics.push({
              level: "warning",
              code: "credential_field_candidates_sample",
              message: `No high-confidence credential field found. Visible candidates: ${candSample}`,
            });
          } else {
            diagnostics.push({
              level: "info",
              code: "credential_field_not_found",
              message: "No credential input field candidates detected",
            });
          }

          // Capture element list before virtualKeyboardFill for display change detection
          const beforeElementsList = await captureVisibleElementsList(page);

          // ACTIVATION PHASE: Detect and activate credential field focus
          const activationResult = await detectCredentialActivationCandidates(page);
          const beforeActivationElement = await page.evaluate(() => {
            const el = document.activeElement;
            return el ? `${el.tagName.toLowerCase()}${(el as any).className ? `.${(el as any).className.split(' ')[0]}` : ''}` : "none";
          });

          let focusActivationRecord = {
            activeElementBefore: beforeActivationElement,
            activationTarget: null as string | null,
            activationStrategy: null as string | null,
            activeElementAfter: beforeActivationElement,
            focusChangeDetected: false,
          };

          if (activationResult.bestCandidate) {
            try {
              const targetLocator = page.locator(activationResult.bestCandidate.selector).first();
              const isClickable = await targetLocator.isVisible({ timeout: 100 }).catch(() => false);

              if (isClickable) {
                focusActivationRecord.activationTarget = activationResult.bestCandidate.selector;
                focusActivationRecord.activationStrategy = activationResult.bestCandidate.reason;

                // Single focus click without waiting for state changes
                await targetLocator.click({ timeout: 1000 }).catch(() => {
                  // Silent fail - not all elements respond to click for focus
                });

                // Capture post-activation state
                focusActivationRecord.activeElementAfter = await page.evaluate(() => {
                  const el = document.activeElement;
                  return el ? `${el.tagName.toLowerCase()}${(el as any).className ? `.${(el as any).className.split(' ')[0]}` : ''}` : "none";
                });

                focusActivationRecord.focusChangeDetected = focusActivationRecord.activeElementBefore !== focusActivationRecord.activeElementAfter;
                console.log(
                  `[auth-discovery] credentialFieldActivation target=${focusActivationRecord.activationTarget} before=${focusActivationRecord.activeElementBefore} after=${focusActivationRecord.activeElementAfter} changed=${focusActivationRecord.focusChangeDetected}`
                );
              }
            } catch (err) {
              console.log(
                `[auth-discovery] credentialFieldActivationFailed error=${err instanceof Error ? err.message : String(err)}`
              );
            }
          }

          // Emit activation diagnostic
          diagnostics.push({
            level: "info",
            code: "credential_field_activation_attempt",
            message: `Activation: target=${focusActivationRecord.activationTarget || "none"} strategy=${focusActivationRecord.activationStrategy || "none"} before=${focusActivationRecord.activeElementBefore} after=${focusActivationRecord.activeElementAfter} changed=${focusActivationRecord.focusChangeDetected}`,
          });

          const fillResult = await executeVirtualKeyboardFill(page, step.envVar);
          const afterFillSnapshot = await capturePageSnapshot(page);
          const afterElementsList = await captureVisibleElementsList(page);

          diagnostics.push({
            level: "info",
            code: "virtual_keyboard_fill_executed",
            message: `Virtual keyboard fill: ${step.envVar} charCount=${fillResult.charCount}`,
          });

          // Detect visual changes in element display after virtualKeyboardFill
          let credentialValueObserved = false;
          let credentialDisplayChangeDetected: Awaited<ReturnType<typeof detectCredentialDisplayChange>> | null = null;

          // Always attempt visual diff analysis (even if lists empty, report that)
          if (fillResult.success) {
            if (beforeElementsList.length > 0 && afterElementsList.length > 0) {
              credentialDisplayChangeDetected = await detectCredentialDisplayChange(beforeElementsList, afterElementsList);
              const { displayChanged, visibleLength, changedElements, addedElements, removedElements, bodyTextChanged, confidence, reason, redactedElements } = credentialDisplayChangeDetected;

              // Log summary
              console.log(
                `[auth-discovery] credentialVisualDiff changedElements=${changedElements} addedElements=${addedElements} removedElements=${removedElements} bodyTextChanged=${bodyTextChanged}`
              );

              // Emit summary diagnostic - ALWAYS emitted when comparison runs
              const beforeTotal = (beforeElementsList as any).totalCaptured || beforeElementsList.length;
              const afterTotal = (afterElementsList as any).totalCaptured || afterElementsList.length;
              diagnostics.push({
                level: "info",
                code: "credential_visual_diff_summary",
                message: `DOM visual diff: before=${beforeElementsList.length}/${beforeTotal} after=${afterElementsList.length}/${afterTotal}. Changed=${changedElements}, added=${addedElements}, removed=${removedElements}. BodyTextChanged=${bodyTextChanged}`,
              });

              if (displayChanged) {
                console.log(
                  `[auth-discovery] credentialDisplayChanged observed=true visibleLength=${visibleLength || "unknown"}`
                );
                diagnostics.push({
                  level: "info",
                  code: "credential_display_changed",
                  message: `Credential value detected in custom display: visibleLength=${visibleLength || "unknown"}, confidence=${confidence}`,
                });

                // Mark as observed if displayChanged is true (regardless of confidence)
                credentialValueObserved = true;

                // Include redacted element details for debugging (max 8 elements)
                if (redactedElements.length > 0) {
                  const elementSummary = redactedElements
                    .slice(0, 8)
                    .map((e) => `${e.tag}${e.role ? `[${e.role}]` : ""} (${e.bboxSize || "no-bbox"}) hash:${e.textHashBefore?.toString(16).substring(0, 4)}→${e.textHashAfter?.toString(16).substring(0, 4)} len:${e.textLengthBefore}→${e.textLengthAfter}`)
                    .join("; ");
                  diagnostics.push({
                    level: "info",
                    code: "credential_visual_diff_sample",
                    message: `Changed elements (max 8): ${elementSummary}`,
                  });
                }
              } else if (bodyTextChanged) {
                // Body text changed but no element match found
                console.log(
                  `[auth-discovery] credentialDisplayChanged observed=false reason="body_text_changed_without_element_match"`
                );
                diagnostics.push({
                  level: "warning",
                  code: "body_text_changed_without_element_match",
                  message: `Body text changed after keyboard fill but no element change detected. May indicate render-only display outside DOM scan.`,
                });
              } else {
                // No display change detected
                console.log(
                  `[auth-discovery] credentialDisplayChanged observed=false reason="${reason}"`
                );
                diagnostics.push({
                  level: "info",
                  code: "credential_display_no_change",
                  message: `No visual changes detected: ${reason}`,
                });
              }
            } else {
              // Element lists empty or capture failed - report as diagnostic
              console.log(
                `[auth-discovery] credentialVisualDiff capture_failed beforeLen=${beforeElementsList.length} afterLen=${afterElementsList.length}`
              );
              diagnostics.push({
                level: "info",
                code: "credential_visual_diff_summary",
                message: `DOM visual diff: capture incomplete (before=${beforeElementsList.length} elements, after=${afterElementsList.length} elements)`,
              });
              diagnostics.push({
                level: "warning",
                code: "credential_visual_diff_capture_failed",
                message: `Element capture returned empty lists; unable to perform granular DOM comparison`,
              });
            }
          }

          // Fallback: only use basic snapshot changes if new visual diff detection didn't run
          if (!credentialValueObserved && fillResult.success && credentialDisplayChangeDetected === null && beforeFieldSnapshot && afterFillSnapshot) {
            const textChanged = beforeFieldSnapshot.bodyTextPreview !== afterFillSnapshot.bodyTextPreview;
            const inputCountChanged = beforeFieldSnapshot.counts.inputs !== afterFillSnapshot.counts.inputs;

            if (textChanged) {
              // Text changed but new detection didn't run - may be a display outside our element scan
              console.log(
                `[auth-discovery] visualChangeDetected textChanged=${textChanged} (fallback: element detection skipped)`
              );
              diagnostics.push({
                level: "info",
                code: "credential_fill_visual_change",
                message: `Body text changed but element detection did not run. May indicate custom display.`,
              });
            }
          }

          if (fillResult.success) {
            console.log(`[auth-discovery] virtualKeyboardFill success charCount=${fillResult.charCount}`);

            // Emit virtual keyboard fill diagnostics
            diagnostics.push({
              level: "info",
              code: "virtual_keyboard_key_click_summary",
              message: `Keyboard fill: expectedCharCount=${fillResult.charCount}, successfulKeyClicks=${fillResult.successfulKeyClicks}, missingKeysCount=${fillResult.missingKeys.length}`,
            });

            if (fillResult.diagnostics) {
              // Emit form control state without exposing values
              if (fillResult.diagnostics.formControls && fillResult.diagnostics.formControls.length > 0) {
                const formSample = fillResult.diagnostics.formControls
                  .slice(0, 8)
                  .map((f) => `${f.tag}[name=${f.name || "?"}]`)
                  .join("; ");
                diagnostics.push({
                  level: "info",
                  code: "credential_state_model_sample",
                  message: `Form controls detected: ${formSample}`,
                });
              }

              // Emit hidden inputs state
              if (fillResult.diagnostics.hiddenInputs && fillResult.diagnostics.hiddenInputs.length > 0) {
                const hiddenSample = fillResult.diagnostics.hiddenInputs
                  .map((h) => `${h.name}(len=${h.valueLength})`)
                  .join("; ");
                diagnostics.push({
                  level: "info",
                  code: "credential_hidden_model_state",
                  message: `Hidden inputs: ${hiddenSample}`,
                });
              }
            }

            // Focus fallback: if fill succeeded but continue may be disabled by no_focus_target
            if (fillResult.success) {
              diagnostics.push({
                level: "info",
                code: "credential_focus_fallback_started",
                message: `fillOk=${fillResult.success} displayChanged=${credentialDisplayChangeDetected?.displayChanged ?? false}`,
              });
              let focusCandidate: string | null = null;
              try {
                const candidates = await page.locator('[role="textbox"], input:not([type="hidden"]), [contenteditable], [tabindex]:not([tabindex="-1"])').all();
                for (const c of candidates) {
                  if (await c.isVisible().catch(() => false)) { focusCandidate = await c.getAttribute("aria-label").catch(() => "") || await c.getAttribute("placeholder").catch(() => "") || await c.innerText().catch(() => "") || c.toString(); break; }
                }
              } catch { /* skip candidate scan */ }
              if (focusCandidate) {
                diagnostics.push({ level: "info", code: "credential_focus_fallback_candidate", message: `focusCandidate="${focusCandidate?.slice(0, 60)}"` });
                try { await page.locator('[role="textbox"], input:not([type="hidden"]), [contenteditable], [tabindex]:not([tabindex="-1"])').first().focus(); diagnostics.push({ level: "info", code: "credential_focus_fallback_executed", message: `focused="${focusCandidate?.slice(0, 60)}"` }); } catch { /* skip */ }
              } else {
                diagnostics.push({ level: "info", code: "credential_focus_fallback_executed", message: "no_focusable_candidate_found_using_tab" });
                await page.keyboard.press("Tab");
              }
              await page.waitForTimeout(300);
              diagnostics.push({ level: "info", code: "credential_continue_recheck_after_focus", message: "rechecking continue button after focus fallback" });
            }

            // After successful virtualKeyboardFill, try to find and execute continue button
            const beforeContinueSnapshot = await capturePageSnapshot(page);
            const beforeContinueElementsList = await captureVisibleElementsList(page);
            const continueResult = await executeCredentialContinue(page, beforeContinueSnapshot);

            if (continueResult.target) {
              diagnostics.push({
                level: "info",
                code: "credential_continue_detected",
                message: `Continue button detected: "${continueResult.target}" (${continueResult.confidence})`,
              });
            }

            if (continueResult.success) {
              diagnostics.push({
                level: "info",
                code: "credential_continue_executed",
                message: `${continueResult.reason}`,
              });

              // Capture post-continue snapshot
              postExecutionSnapshot = await capturePageSnapshot(page);
              const afterContinueElementsList = await captureVisibleElementsList(page);
              console.log(
                `[auth-discovery] postCredentialContinueSnapshot url=${postExecutionSnapshot.url} buttons=${postExecutionSnapshot.counts.buttons} inputs=${postExecutionSnapshot.counts.inputs} vkKeys=${postExecutionSnapshot.counts.virtualKeyboardKeys}`
              );

              diagnostics.push({
                level: "info",
                code: "post_credential_continue_snapshot",
                message: `Post-continue state: URL=${postExecutionSnapshot.url}, inputs=${postExecutionSnapshot.counts.inputs}, textboxes=${postExecutionSnapshot.counts.textboxes}, buttons=${postExecutionSnapshot.counts.buttons}, virtual keyboard keys=${postExecutionSnapshot.counts.virtualKeyboardKeys}`,
              });

              // Detect visual changes after continue click
              if (beforeContinueElementsList.length > 0 && afterContinueElementsList.length > 0) {
                const continueDisplayChanged = await detectCredentialDisplayChange(beforeContinueElementsList, afterContinueElementsList);
                const { changedElements, addedElements, removedElements, bodyTextChanged, redactedElements } = continueDisplayChanged;

                console.log(
                  `[auth-discovery] continueVisualDiff changedElements=${changedElements} addedElements=${addedElements} removedElements=${removedElements} bodyTextChanged=${bodyTextChanged}`
                );

                diagnostics.push({
                  level: "info",
                  code: "continue_visual_diff_summary",
                  message: `Visual diff after continue: changed=${changedElements}, added=${addedElements}, removed=${removedElements}, bodyTextChanged=${bodyTextChanged}`,
                });

                // MANDATORY: Emit sample of changed elements if there are any changes
                const totalChanges = changedElements + addedElements + removedElements;
                if (totalChanges > 0) {
                  if (redactedElements.length > 0) {
                    // Emit sample with actual changed elements (max 8)
                    const elementSummary = redactedElements
                      .slice(0, 8)
                      .map((e) => `${e.tag}${e.role ? `[${e.role}]` : ""}${e.classHints ? ` .${e.classHints}` : ""}${e.dataHints && e.dataHints.length > 0 ? ` [${e.dataHints.join(",")}]` : ""} (${e.bboxSize || "?"}) len:${e.textLengthBefore}→${e.textLengthAfter}`)
                      .join("; ");
                    diagnostics.push({
                      level: "info",
                      code: "continue_visual_diff_sample",
                      message: `Changed elements (max 8): ${elementSummary}`,
                    });
                  } else {
                    // No redacted elements captured but changes were detected
                    diagnostics.push({
                      level: "warning",
                      code: "continue_visual_diff_sample_missing",
                      message: `Visual diff reported changes (${totalChanges} total) but element capture was empty. May indicate render-outside-DOM or capture failure.`,
                    });
                  }
                }

                // Detect toast/notification/alert messages post-continue
                let toastDetected = false;
                let messageHints: string[] = [];
                const toastClassPatterns = /toast|snackbar|notification|message|feedback|alert|popup|banner/i;
                const messageRolePatterns = /alert|status|dialog|region/i;

                if (redactedElements.length > 0) {
                  for (const elem of redactedElements) {
                    if (elem.classHints && toastClassPatterns.test(elem.classHints)) {
                      toastDetected = true;
                      messageHints.push(`${elem.tag}${elem.role ? `[${elem.role}]` : ""} .${elem.classHints}`);
                    }
                    if (elem.dataHints && elem.dataHints.some(h => /toast|message|notification|alert|state|type|variant/i.test(h))) {
                      toastDetected = true;
                      messageHints.push(`${elem.tag} [${elem.dataHints.join(",")}]`);
                    }
                    if (elem.role && messageRolePatterns.test(elem.role)) {
                      toastDetected = true;
                      messageHints.push(`${elem.tag}[role=${elem.role}]`);
                    }
                  }
                }

                if (toastDetected && messageHints.length > 0) {
                  diagnostics.push({
                    level: "info",
                    code: "credential_post_continue_message",
                    message: `Post-continue message/toast detected: ${messageHints.slice(0, 3).join("; ")}`,
                  });

                  // Read toast content safely
                  try {
                    const toastText = await page.locator('[class*="toast"], [class*="snackbar"], [class*="notification"], [class*="alert"], [role="alert"]').first().textContent({ timeout: 2000 });
                    if (toastText) {
                      // Sanitize: replace digits with #, truncate to 120 chars
                      const sanitized = toastText.replace(/\d/g, "#").substring(0, 120).trim();

                      diagnostics.push({
                        level: "info",
                        code: "credential_post_continue_message_text",
                        message: `Post-continue message text: ${sanitized}`,
                      });

                      // Check if this is a transient verification state, not final blocker
                      const isTransient = /verificando|procesando|cargando|validando|consultando|verifying|processing|loading|validating|checking/i.test(sanitized);

                      if (isTransient) {
                        diagnostics.push({
                          level: "info",
                          code: "credential_post_continue_transient_verification",
                          message: `Transient verification state detected: "${sanitized}". Waiting for result (OTP, final message, or functional change)...`,
                        });

                        // Wait up to 15s for transient state to resolve
                        const transientStartTime = Date.now();
                        const transientUrlBefore = page.url();
                        let finalMessageText: string | null = null;
                        let otpDetected = false;
                        let urlChangeResolution = false;
                        let postTransientUrl: string | null = null;
                        let transientResolved = false;

                        while (Date.now() - transientStartTime < 15000) {
                          await page.waitForTimeout(500);

                          // Check if URL changed
                          const currentUrl = page.url();
                          if (currentUrl !== transientUrlBefore) {
                            diagnostics.push({
                              level: "info",
                              code: "credential_post_continue_transient_resolved_url_change",
                              message: `URL changed from transient state. Suggests navigation/progression.`,
                            });
                            urlChangeResolution = true;
                            postTransientUrl = currentUrl;
                            transientResolved = true;
                            break;
                          }

                          // Check if toast disappeared or changed
                          const currentToastText = await page.locator('[class*="toast"], [class*="snackbar"], [class*="notification"], [class*="alert"], [role="alert"]').first().textContent({ timeout: 1000 }).catch(() => null);
                          if (!currentToastText) {
                            diagnostics.push({
                              level: "info",
                              code: "credential_post_continue_transient_toast_cleared",
                              message: `Transient message disappeared.`,
                            });
                            transientResolved = true;
                            break;
                          }
                          const currentSanitized = currentToastText.replace(/\d/g, "#").substring(0, 120).trim();
                          if (currentSanitized !== sanitized) {
                            // Toast changed - likely final message
                            finalMessageText = currentSanitized;
                            diagnostics.push({
                              level: "info",
                              code: "credential_post_continue_transient_final_message",
                              message: `Final message after transient: "${finalMessageText}"`,
                            });
                            transientResolved = true;
                            break;
                          }

                          // Check for OTP field or code input
                          const otpField = await page.locator('[name*="otp"], [name*="code"], [name*="token"], [name*="verificación"], [placeholder*="código"], [placeholder*="OTP"], input[type="text"]:near(:text("código"), :text("OTP"), :text("verificación"))').first().isVisible().catch(() => false);
                          if (otpField) {
                            otpDetected = true;
                            diagnostics.push({
                              level: "info",
                              code: "credential_post_continue_otp_field_appeared",
                              message: `OTP/code input field appeared during transient wait.`,
                            });
                            transientResolved = true;
                            break;
                          }

                          // Check screen change: compare body text hash
                          const currentSnapshot = await captureVisibleElementsList(page);
                          if (currentSnapshot && currentSnapshot.length > 0 && beforeContinueElementsList && beforeContinueElementsList.length > 0) {
                            const screenChanged = (currentSnapshot.bodyTextHash !== beforeContinueElementsList.bodyTextHash) &&
                                                 !(currentToastText && currentToastText.includes(sanitized));
                            if (screenChanged) {
                              diagnostics.push({
                                level: "info",
                                code: "credential_post_continue_transient_screen_changed",
                                message: `Screen content changed significantly during transient wait.`,
                              });
                              transientResolved = true;
                              break;
                            }
                          }
                        }

                        // Generic error state detection after transient
                        const currentUrlForError = page.url();
                        const currentBodyForError = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) ?? "").catch(() => "");
                        const errorUrlPatterns = /error|falló|fallido|invalid|expiró|bloqueado|incorrecto|denied/i;
                        const errorBodyPatterns = /error|inválido|incorrecto|no válido|expirado|bloqueado|no pudimos|intente de nuevo|falló|fallido|denegado|rechazado/i;
                        const buttonsAfterTransient = await page.locator('button').count().catch(() => 0);
                        const inputsAfterTransient = await page.locator('input:not([type="hidden"])').count().catch(() => 0);
                        const isErrorUrl = errorUrlPatterns.test(currentUrlForError);
                        const isErrorBody = errorBodyPatterns.test(currentBodyForError);
                        if (isErrorUrl || (isErrorBody && buttonsAfterTransient <= 1 && inputsAfterTransient === 0)) {
                          diagnostics.push({
                            level: "error",
                            code: "credential_post_continue_error_state_detected",
                            message: `url=${currentUrlForError.split('/').slice(-1)[0]} buttons=${buttonsAfterTransient} inputs=${inputsAfterTransient} bodySample="${currentBodyForError.slice(0, 200).replace(/\s+/g, " ").trim()}"`,
                          });
                          return { proposedProfile, diagnostics };
                        }

                        // If URL changed during transient wait, capture final snapshot and detect OTP
                        if (urlChangeResolution && postTransientUrl) {
                          const postTransientSnapshot = await capturePageSnapshot(page);
                          const postTransientElements = await captureVisibleElementsList(page);

                          diagnostics.push({
                            level: "info",
                            code: "post_transient_snapshot",
                            message: `Post-transient snapshot: url=${postTransientUrl}, inputs=${postTransientSnapshot.counts.inputs}, buttons=${postTransientSnapshot.counts.buttons}`,
                          });

                          // Detect OTP stage: check URL patterns and screen content
                          const isOtpStageUrl = /phone-confirmation|otp|token|código|codigo|verificación|verification|confirmación|confirmation/i.test(postTransientUrl);
                          const otpStageContent = await page.evaluate(() => {
                            const bodyText = document.body.innerText || "";
                            return /otp|código|code|verificación|verification|token|confirm/i.test(bodyText);
                          }).catch(() => false);

                          const isOtpStage = isOtpStageUrl || otpStageContent;

                          // Check if this is an intermediate confirmation stage (not final OTP entry)
                          const isIntermediateStage = !isOtpStage && await page.evaluate(() => {
                            const bodyText = document.body.textContent || "";
                            const hasPhonePattern = /teléfono|telefono|phone|número|number|confirmación|confirmar|verificar|verification|enviar|sending|código|code/i.test(bodyText);
                            const hasOtpInput = !!document.querySelector('input[name*="otp"], input[name*="code"], [placeholder*="código"], [placeholder*="OTP"]');
                            const hasKeypadButtons = document.querySelectorAll('button:has(*, :contains("0")), [role=button]:contains("0")').length === 10;
                            const hasPrimaryButton = !!document.querySelector('button:not([class*="secondary"], [class*="cancel"], [class*="ghost"]), [role=button]:not([class*="secondary"])');
                            const hasSecondaryButton = !!document.querySelector('button[class*="secondary"], button:contains("Cancelar"), button:contains("No reconozco")');

                            return hasPhonePattern && !hasOtpInput && !hasKeypadButtons && hasPrimaryButton && hasSecondaryButton;
                          }).catch(() => false);

                          if (isIntermediateStage) {
                            console.log(`[auth-discovery] intermediateStageDetected url=${postTransientUrl}`);
                            diagnostics.push({
                              level: "info",
                              code: "otp_intermediate_stage_detected",
                              message: `Intermediate confirmation stage detected (not final OTP entry). URL: ${postTransientUrl}`,
                            });

                            // Resolve and click primary action button using robust multi-pattern matching
                            const actionResult = await resolveOtpIntermediatePrimaryAction(page);

                            if (actionResult.success && actionResult.buttonText) {
                              diagnostics.push({
                                level: "info",
                                code: "otp_intermediate_primary_action_detected",
                                message: `Primary confirmation button detected: "${actionResult.buttonText}"`,
                              });

                              diagnostics.push({
                                level: "info",
                                code: "otp_intermediate_primary_action_executed",
                                message: `Clicked primary confirmation button. Waiting for OTP entry screen...`,
                              });

                              // Wait up to 5s for OTP entry screen
                              diagnostics.push({
                                level: "info",
                                code: "otp_entry_wait_started",
                                message: `Waiting for OTP entry screen (max 5s)`,
                              });

                              const entryWaitStart = Date.now();
                              let otpEntryFound = false;

                              while (Date.now() - entryWaitStart < 5000) {
                                await page.waitForTimeout(300);

                                const state = await page.evaluate(() => ({
                                  url: window.location.href,
                                  buttons: document.querySelectorAll('button').length,
                                  digitButtons: document.querySelectorAll('button:has(*, :contains("0")), [role=button]:contains("0")').length,
                                  clickables: document.querySelectorAll('[role=button], button, [onclick]').length,
                                  inputs: document.querySelectorAll('input[type="text"], input:not([type]), [role=textbox]').length,
                                  slots: document.querySelectorAll('[class*="slot"], [class*="otp"], [class*="code"], input[maxlength]').length,
                                  confirmDetected: /confirmar|enviar|validar|submit|verify/i.test(document.body.textContent || "")
                                }));

                                diagnostics.push({
                                  level: "info",
                                  code: "otp_entry_wait_observed_state",
                                  message: `Observed state: digitButtons=${state.digitButtons} inputs=${state.inputs} slots=${state.slots} confirmDetected=${state.confirmDetected}`,
                                });

                                if (state.digitButtons === 10 || state.inputs > 0 || state.slots > 0 || (state.confirmDetected && state.clickables > 5)) {
                                  otpEntryFound = true;
                                  diagnostics.push({
                                    level: "info",
                                    code: "otp_entry_wait_resolved",
                                    message: `OTP entry screen detected. URL: ${state.url}`,
                                  });
                                  break;
                                }
                              }

                              if (!otpEntryFound) {
                                diagnostics.push({
                                  level: "warning",
                                  code: "otp_entry_wait_timeout",
                                  message: `OTP entry screen not detected within 5s after intermediate action`,
                                });
                }
              } else {
                              diagnostics.push({
                                level: "warning",
                                code: "otp_intermediate_primary_action_not_found",
                                message: `Primary confirmation button not found or click failed`,
                              });
                            }
                          }

                          if (isOtpStage) {
                            console.log(`[auth-discovery] otpStageDetected url=${postTransientUrl}`);
                            diagnostics.push({
                              level: "info",
                              code: "otp_stage_detected",
                              message: `OTP stage detected after transient resolution. URL: ${postTransientUrl}`,
                            });

                            // Mark functional advance and set final state
                            finalCredentialContinueAdvanced = true;
                            finalCredentialContinueReason = "transient_url_change_to_otp";
                            finalOtpStageDetected = true;
                            finalPostContinueUrl = postTransientUrl;

                            console.log(`[auth-discovery] credentialContinueFunctionalAdvance=true reason=transient_url_change_to_otp`);
                            diagnostics.push({
                              level: "info",
                              code: "credential_continue_functional_advance",
                              message: `Functional advance confirmed: URL changed to OTP stage (${postTransientUrl})`,
                            });
                            functionalAdvanceDiagnosticEmitted = true;

                            // === INTERMEDIATE STAGE EVALUATION (before OTP step proposal) ===
                            try {
                              diagnostics.push({
                                level: "info",
                                code: "otp_intermediate_probe_started",
                                message: "Probing for intermediate confirmation stage before OTP entry",
                              });

                              // Get URL safely (page.url() is synchronous, not Promise)
                              let probeUrl = "unknown";
                              try {
                                probeUrl = page.url();
                              } catch (err) {
                                probeUrl = "error";
                              }

                              // Evaluate intermediate stage conditions with granular error handling
                              let intermediateProbeState = {
                                url: probeUrl,
                                inputCount: 0,
                                buttonCount: 0,
                                digitButtonCount: 0,
                                confirmDetected: false,
                                hasPhonePattern: false,
                                hasOtpInput: false,
                                hasPrimaryButton: false,
                                hasSecondaryButton: false,
                                partial: false
                              };

                              // Try full evaluate first
                              try {
                                intermediateProbeState = await page.evaluate(() => ({
                                  url: window.location.href,
                                  inputCount: document.querySelectorAll('input[type="text"], input:not([type]), [role=textbox]').length,
                                  buttonCount: document.querySelectorAll('button').length,
                                  digitButtonCount: document.querySelectorAll('button:has(*, :contains("0")), [role=button]:contains("0")').length,
                                  confirmDetected: /confirmar|enviar|validar|submit|verify|código|code/i.test(document.body.textContent || ""),
                                  hasPhonePattern: /teléfono|telefono|phone|número|number|confirmación|confirmar|verificar|verification|enviar|sending|código|code/i.test(document.body.textContent || ""),
                                  hasOtpInput: !!document.querySelector('input[name*="otp"], input[name*="code"], [placeholder*="código"], [placeholder*="OTP"]'),
                                  hasPrimaryButton: !!document.querySelector('button:not([class*="secondary"], [class*="cancel"], [class*="ghost"]), [role=button]:not([class*="secondary"])'),
                                  hasSecondaryButton: !!document.querySelector('button[class*="secondary"], button:contains("Cancelar"), button:contains("No reconozco")')
                                }));
                                intermediateProbeState.url = probeUrl;
                              } catch (evalErr) {
                                // Full evaluate failed - emit error diagnostic and try granular fallback
                                const errorMsg = evalErr instanceof Error ? evalErr.message : String(evalErr);
                                diagnostics.push({
                                  level: "warning",
                                  code: "otp_intermediate_probe_error",
                                  message: `DOM evaluation failed: ${errorMsg.substring(0, 100)}. Attempting granular fallback.`,
                                });

                                // Fallback: use individual evaluations for each metric
                                try {
                                  intermediateProbeState.inputCount = await page.evaluate(() =>
                                    document.querySelectorAll('input[type="text"], input:not([type]), [role=textbox]').length
                                  ).catch(() => 0);
                                } catch {
                                  intermediateProbeState.inputCount = 0;
                                }

                                try {
                                  intermediateProbeState.buttonCount = await page.evaluate(() =>
                                    document.querySelectorAll('button').length
                                  ).catch(() => 0);
                                } catch {
                                  intermediateProbeState.buttonCount = 0;
                                }

                                try {
                                  intermediateProbeState.digitButtonCount = await page.evaluate(() =>
                                    document.querySelectorAll('button:has(*, :contains("0")), [role=button]:contains("0")').length
                                  ).catch(() => 0);
                                } catch {
                                  intermediateProbeState.digitButtonCount = 0;
                                }

                                try {
                                  intermediateProbeState.hasPhonePattern = await page.evaluate(() =>
                                    /teléfono|telefono|phone|número|number|confirmación|confirmar|verificar|verification|enviar|sending|código|code/i.test(document.body.textContent || "")
                                  ).catch(() => false);
                                } catch {
                                  intermediateProbeState.hasPhonePattern = false;
                                }

                                try {
                                  intermediateProbeState.hasOtpInput = await page.evaluate(() =>
                                    !!document.querySelector('input[name*="otp"], input[name*="code"], [placeholder*="código"], [placeholder*="OTP"]')
                                  ).catch(() => false);
                                } catch {
                                  intermediateProbeState.hasOtpInput = false;
                                }

                                intermediateProbeState.partial = true;

                                // Locator fallback for button detection
                                try {
                                  const buttonLocators = await page.locator('button').count().catch(() => 0);
                                  if (buttonLocators > 0) intermediateProbeState.buttonCount = buttonLocators;
                                } catch {
                                  // Silent fail
                                }

                                diagnostics.push({
                                  level: "info",
                                  code: "otp_intermediate_probe_recovered",
                                  message: `Recovered partial state via granular evaluation. Partial=${intermediateProbeState.partial}`,
                                });
                              }

                              diagnostics.push({
                                level: "info",
                                code: "otp_intermediate_probe_state",
                                message: `url=${intermediateProbeState.url.split('/').slice(-1)[0]} inputs=${intermediateProbeState.inputCount} btns=${intermediateProbeState.buttonCount} digitBtns=${intermediateProbeState.digitButtonCount} confirm=${intermediateProbeState.confirmDetected} phone=${intermediateProbeState.hasPhonePattern} otpIn=${intermediateProbeState.hasOtpInput} primary=${intermediateProbeState.hasPrimaryButton} secondary=${intermediateProbeState.hasSecondaryButton} partial=${intermediateProbeState.partial}`,
                              });

                              // Check if this is an intermediate confirmation stage (not final OTP entry)
                              // More resilient to partial state: if URL is phone-confirmation and no OTP input, assume intermediate
                              const urlSuggestsIntermediate = intermediateProbeState.url &&
                                                            (intermediateProbeState.url.includes('phone-confirmation') ||
                                                             intermediateProbeState.url.includes('confirmation') ||
                                                             intermediateProbeState.url.includes('verify'));
                              const noOtpInputPresent = !intermediateProbeState.hasOtpInput;
                              const hasButtonsAvailable = intermediateProbeState.buttonCount > 0;
                              const noDigitKeypadYet = intermediateProbeState.digitButtonCount < 10;

                              // Accept intermediate if: URL suggests it AND no OTP input AND has buttons
                              // OR: strict check with all signals
                              const isIntermediateConfirmation = (urlSuggestsIntermediate && noOtpInputPresent && hasButtonsAvailable && noDigitKeypadYet) ||
                                                               (intermediateProbeState.hasPhonePattern &&
                                                                !intermediateProbeState.hasOtpInput &&
                                                                intermediateProbeState.digitButtonCount < 10 &&
                                                                intermediateProbeState.hasPrimaryButton &&
                                                                intermediateProbeState.hasSecondaryButton);

                              let probeAction = "skipped";

                              if (isIntermediateConfirmation) {
                                console.log(`[auth-discovery] intermediateConfirmationStageDetected url=${intermediateProbeState.url}`);
                                diagnostics.push({
                                  level: "info",
                                  code: "otp_intermediate_stage_detected",
                                  message: `Intermediate confirmation stage detected (phone/code verification before OTP). URL: ${intermediateProbeState.url}`,
                                });

                                // Resolve and click primary action button
                                const intermediateActionResult = await resolveOtpIntermediatePrimaryAction(page);

                                if (intermediateActionResult.success && intermediateActionResult.buttonText) {
                                  probeAction = "executed";
                                  diagnostics.push({
                                    level: "info",
                                    code: "otp_intermediate_primary_action_detected",
                                    message: `Primary confirmation button detected: "${intermediateActionResult.buttonText}"`,
                                  });

                                  diagnostics.push({
                                    level: "info",
                                    code: "otp_intermediate_primary_action_executed",
                                    message: `Clicked primary confirmation button. Waiting for OTP entry screen...`,
                                  });

                                  // Wait up to 5s for OTP entry screen to appear
                                  diagnostics.push({
                                    level: "info",
                                    code: "otp_entry_wait_started",
                                    message: `Waiting for OTP entry screen (max 5s)`,
                                  });

                                  const entryWaitStart = Date.now();
                                  let otpEntryFound = false;

                                  while (Date.now() - entryWaitStart < 5000) {
                                    await page.waitForTimeout(300);

                                    const finalOtpState = await page.evaluate(() => ({
                                      url: window.location.href,
                                      inputs: document.querySelectorAll('input[type="text"], input:not([type]), [role=textbox]').length,
                                      slots: document.querySelectorAll('[class*="slot"], [class*="otp"], [class*="code"], input[maxlength]').length,
                                      digitButtons: document.querySelectorAll('button:has(*, :contains("0")), [role=button]:contains("0")').length,
                                      confirmDetected: /confirmar|enviar|validar|submit|verify/i.test(document.body.textContent || "")
                                    })).catch(() => ({ url: "error", inputs: 0, slots: 0, digitButtons: 0, confirmDetected: false }));

                                    diagnostics.push({
                                      level: "info",
                                      code: "otp_entry_wait_observed_state",
                                      message: `Observed: digitButtons=${finalOtpState.digitButtons} inputs=${finalOtpState.inputs} slots=${finalOtpState.slots} confirm=${finalOtpState.confirmDetected}`,
                                    });

                                    if (finalOtpState.digitButtons === 10 || finalOtpState.inputs > 0 || finalOtpState.slots > 0) {
                                      otpEntryFound = true;
                                      diagnostics.push({
                                        level: "info",
                                        code: "otp_entry_wait_resolved",
                                        message: `OTP entry screen reached after intermediate confirmation. URL: ${finalOtpState.url}`,
                                      });
                                      break;
                                    }
                                  }

                                  if (!otpEntryFound) {
                                    diagnostics.push({
                                      level: "warning",
                                      code: "otp_entry_wait_timeout",
                                      message: `OTP entry screen not detected within 5s after intermediate action. Continuing with OTP field detection.`,
                                    });
                                  }
                  } else {
                                  diagnostics.push({
                                    level: "warning",
                                    code: "otp_intermediate_primary_action_not_found",
                                    message: `Primary confirmation button not found or click failed. Continuing with OTP field detection.`,
                                  });
                                }
                              } else {
                                diagnostics.push({
                                  level: "info",
                                  code: "otp_intermediate_skipped",
                                  message: `Not an intermediate stage. Reason: phonePattern=${intermediateProbeState.hasPhonePattern} noOtpInput=${!intermediateProbeState.hasOtpInput} digitBtnsCt=${intermediateProbeState.digitButtonCount} primaryBtn=${intermediateProbeState.hasPrimaryButton} secondaryBtn=${intermediateProbeState.hasSecondaryButton}`,
                                });
                              }

                              // Emit final completion diagnostic
                              diagnostics.push({
                                level: "info",
                                code: "otp_intermediate_probe_completed",
                                message: `OTP intermediate probe completed. Action=${probeAction} ContinuedToOtpProposal=true URL=${intermediateProbeState.url.split('/').slice(-1)[0]}`,
                              });
                            } catch (probeErr) {
                              const errorMsg = probeErr instanceof Error ? probeErr.message : String(probeErr);
                              diagnostics.push({
                                level: "error",
                                code: "otp_intermediate_probe_error",
                                message: `OTP intermediate probe failed: ${errorMsg.substring(0, 100)}`,
                              });
                              diagnostics.push({
                                level: "info",
                                code: "otp_intermediate_probe_completed",
                                message: `OTP intermediate probe completed with error. Action=error ContinuedToOtpProposal=true`,
                              });
                            }

                            // Propose OTP step with environment variable source (if not already detected in loop)
                            if (!otpDetected && proposedProfile?.steps) {
                              diagnostics.push({
                                level: "info",
                                code: "otp_step_proposed",
                                message: `Proposing OTP step with OTP_SECRET environment variable`,
                              });

                              proposedProfile.steps.push({
                                action: "fill",
                                target: "otp-input",
                                confidence: "high",
                                reason: "otp_stage_detected_after_credential_continue",
                                envVar: "OTP_SECRET",
                              });
                            }
                          }
                        }

                        // If timeout reached
                        if (!transientResolved) {
                          diagnostics.push({
                            level: "warning",
                            code: "credential_post_continue_transient_timeout",
                            message: `Transient verification state did not resolve within 15s. No OTP, no final message, no functional advance.`,
                          });
                        }

                        // If OTP appeared, add step to proposedProfile
                        if (otpDetected && proposedProfile?.steps) {
                          proposedProfile.steps.push({
                            action: "fill",
                            target: "otp-input",
                            confidence: "medium",
                            reason: "OTP field detected after transient verification",
                            envVar: "OTP_SECRET",
                          });
                        }

                        // If final message was captured, classify it
                        if (finalMessageText) {
                          let finalBlockerType = "generic_blocker";
                          const finalLower = finalMessageText.toLowerCase();
                          if (/formato|inválido|no válido|invalid|format/.test(finalLower)) {
                            finalBlockerType = "invalid_format";
                          } else if (/no existe|no encontrado|not found|unknown|no existen/.test(finalLower)) {
                            finalBlockerType = "unknown_user";
                          } else if (/servicio|disponible|intente|error|unavailable|mantenimiento/.test(finalLower)) {
                            finalBlockerType = "service_error";
                          } else if (/requerido|obligatorio|required|mandatory|necesario/.test(finalLower)) {
                            finalBlockerType = "required_missing";
                          }
                          diagnostics.push({
                            level: "warning",
                            code: "credential_post_continue_final_blocker_classified",
                            message: `Final blocker after transient: ${finalBlockerType}`,
                          });
                        }
                      } else {
                        // Not transient - classify as blocker immediately
                        let blockerType = "generic_blocker";
                        const lowerText = sanitized.toLowerCase();

                        if (/formato|inválido|no válido|invalid|format/.test(lowerText)) {
                          blockerType = "invalid_format";
                        } else if (/no existe|no encontrado|not found|unknown|no existen/.test(lowerText)) {
                          blockerType = "unknown_user";
                        } else if (/servicio|disponible|intente|error|unavailable|mantenimiento/.test(lowerText)) {
                          blockerType = "service_error";
                        } else if (/requerido|obligatorio|required|mandatory|necesario/.test(lowerText)) {
                          blockerType = "required_missing";
                        }

                        diagnostics.push({
                          level: "warning",
                          code: "credential_post_continue_blocker_classified",
                          message: `Post-continue blocker classified: ${blockerType}`,
                        });
                      }
                    }
                  } catch {
                    // Silent fail - toast detection may not have exact selectors
                  }
                }

                // Improved validation detection: search by text, class, data attributes, role, aria-live
                let validationDetected = false;
                const validationTextPatterns = /requerido|inválido|error|incorrecto|intente|no válido|formato|advertencia|alerta|mandatory|invalid|required|warning|alert/gi;
                const bodyText = postExecutionSnapshot.bodyTextPreview || "";
                if (validationTextPatterns.test(bodyText)) {
                  validationDetected = true;
                }

                // Also search in element hints for validation signals
                if (!validationDetected && redactedElements.length > 0) {
                  const validationClassPatterns = /error|invalid|warning|alert|validation|feedback|danger|requerido|inválido|incorrecto|alerta/i;
                  for (const elem of redactedElements) {
                    if (elem.classHints && validationClassPatterns.test(elem.classHints)) {
                      validationDetected = true;
                      break;
                    }
                    if (elem.dataHints && elem.dataHints.some(h => validationClassPatterns.test(h))) {
                      validationDetected = true;
                      break;
                    }
                    if (elem.role && /alert|status/.test(elem.role)) {
                      validationDetected = true;
                      break;
                    }
                  }
                }

                if (validationDetected) {
                  diagnostics.push({
                    level: "warning",
                    code: "credential_validation_message",
                    message: `Validation or error message detected after continue (class/data/aria or text pattern)`,
                  });
                } else if ((changedElements + addedElements + removedElements) > 0 && !toastDetected) {
                  // Changes detected but no validation, toast, or functional advance
                  diagnostics.push({
                    level: "info",
                    code: "credential_continue_visual_change_unclassified",
                    message: `Visual changes detected after continue but no validation, message, or stage advance identified. May indicate loading, re-render, or UI state change.`,
                  });
                }
              }

              // Check if it was functional advance (not just DOM change)
              const beforeContinueSnap = beforeContinueSnapshot; // From earlier capture
              const functionalAdvance = await detectFunctionalAdvance(page, beforeContinueSnap, postExecutionSnapshot);

              // Use final state if already determined, otherwise use detected state
              const effectiveAdvanced = finalCredentialContinueAdvanced || functionalAdvance.advanced;
              const effectiveReason = finalCredentialContinueReason || functionalAdvance.reason;

              console.log(`[auth-discovery] credentialContinueFunctionalAdvance=${effectiveAdvanced} reason=${effectiveReason} credentialObserved=${credentialValueObserved}`);

              // Don't emit no_functional_advance if we already detected OTP via transient wait
              if (!effectiveAdvanced && !finalCredentialContinueAdvanced) {
                diagnostics.push({
                  level: "warning",
                  code: "credential_continue_no_functional_advance",
                  message: `Continue clicked but no functional stage advance: ${functionalAdvance.reason}. Credential observed: ${credentialValueObserved}`,
                });

                // Check for validation messages
                const inputState = await captureCredentialInputState(page);
                if (inputState.validationMessages.length > 0) {
                  console.log(`[auth-discovery] validationMessages=${inputState.validationMessages.length}`);
                  diagnostics.push({
                    level: "warning",
                    code: "credential_validation_message",
                    message: `Validation messages present: ${inputState.validationMessages.join("; ")}`,
                  });
                }

                // If we already have credentialValueObserved from display change detection, use that
                // Otherwise fall back to the older detection method
                if (!credentialValueObserved && credentialDisplayChangeDetected) {
                  // Use what we calculated from element change detection
                  if (!credentialDisplayChangeDetected.displayChanged) {
                    const valueObserved = await detectCredentialValueObserved(page);
                    console.log(`[auth-discovery] credentialValueObserved=${valueObserved.observed} visibleLength=${valueObserved.visibleLength || "unknown"}`);

                    if (!valueObserved.observed) {
                      diagnostics.push({
                        level: "warning",
                        code: "credential_value_not_observable",
                        message: `Could not observe credential value after entry: ${valueObserved.reason}`,
                      });
                    }
                  }
                } else if (!credentialValueObserved) {
                  // Legacy fallback if element detection didn't run
                  const valueObserved = await detectCredentialValueObserved(page);
                  console.log(`[auth-discovery] credentialValueObserved=${valueObserved.observed} visibleLength=${valueObserved.visibleLength || "unknown"}`);

                  if (!valueObserved.observed) {
                    diagnostics.push({
                      level: "warning",
                      code: "credential_value_not_observable",
                      message: `Could not observe credential value after entry: ${valueObserved.reason}`,
                    });
                  }
                }
              } else if (effectiveAdvanced) {
                // Functional advance detected (either via OTP detection or snapshot comparison)
                // Only emit if not already emitted via transient wait OTP detection
                if (!functionalAdvanceDiagnosticEmitted) {
                  diagnostics.push({
                    level: "info",
                    code: "credential_continue_functional_advance",
                    message: `Functional advance confirmed: ${effectiveReason}. Credential observed: ${credentialValueObserved}`,
                  });
                  functionalAdvanceDiagnosticEmitted = true;
                }
              }

              // Check state change status
              if (!continueResult.stateChanged) {
                // Extract validation messages from reason
                if (continueResult.reason.includes("validations:")) {
                  const validations = continueResult.reason.split("validations:")[1];
                  if (validations && validations !== "none") {
                    diagnostics.push({
                      level: "warning",
                      code: "credential_validation_message",
                      message: `Validation message detected: ${validations}`,
                    });
                  }
                }

                diagnostics.push({
                  level: "warning",
                  code: "post_continue_no_state_change",
                  message: `Continue button clicked but page state did not change. ${continueResult.reason}`,
                });
              }
            } else if (continueResult.target) {
              // Button was found but click failed - still show it as detected
              console.log(`[auth-discovery] continueButton detected but click failed: ${continueResult.reason}`);

              // Check if button was disabled
              if (continueResult.reason.includes("disabled")) {
                // Enhanced diagnostic for disabled button
                const inputState = await captureCredentialInputState(page);

                // Determine root cause based on available diagnostics
                let rootCauseGuess = "unknown";
                if (fillResult.diagnostics?.hiddenInputs) {
                  const emptyHiddenInputs = fillResult.diagnostics.hiddenInputs.filter((h) => h.valueLength === 0);
                  if (emptyHiddenInputs.length > 0) {
                    rootCauseGuess = "hidden_value_empty";
                  }
                }
                if (rootCauseGuess === "unknown" && fillResult.successfulKeyClicks < fillResult.charCount) {
                  rootCauseGuess = "invalid_length";
                }
                if (rootCauseGuess === "unknown" && inputState.activeElement === "body") {
                  rootCauseGuess = "no_focus_target";
                }
                if (rootCauseGuess === "unknown" && fillResult.diagnostics?.formControls?.length === 0) {
                  rootCauseGuess = "missing_internal_model_update";
                }

                diagnostics.push({
                  level: "warning",
                  code: "credential_continue_disabled_root_cause_guess",
                  message: `Probable root cause: ${rootCauseGuess}`,
                });

                diagnostics.push({
                  level: "warning",
                  code: "credential_continue_still_disabled",
                  message: `Continue button remained disabled after virtual keyboard fill and 2s wait. ${continueResult.reason}`,
                });

                // Add detailed tracking information
                diagnostics.push({
                  level: "info",
                  code: "credential_continue_disabled_context",
                  message: `Expected: charCount=${fillResult.charCount}, Actual clicks: ${fillResult.successfulKeyClicks}, Missing keys: ${fillResult.missingKeys.length > 0 ? fillResult.missingKeys.join(",") : "none"}, Display changed: ${credentialDisplayChangeDetected?.displayChanged || false}, Active element: ${inputState.activeElement}, Activation target: ${focusActivationRecord.activationTarget || "none"}, Focus changed: ${focusActivationRecord.focusChangeDetected}`,
                });

                diagnostics.push({
                  level: "warning",
                  code: "credential_continue_button_disabled",
                  message: continueResult.reason,
                });
              }

              // Check for validation messages
              if (continueResult.reason.includes("validations:")) {
                const validations = continueResult.reason.split("validations:")[1];
                if (validations && validations !== "none") {
                  diagnostics.push({
                    level: "warning",
                    code: "credential_validation_message",
                    message: `Validation message detected: ${validations}`,
                  });
                }
              }

              diagnostics.push({
                level: "warning",
                code: "credential_continue_click_failed",
                message: continueResult.reason,
              });
            } else {
              // No button found - show visible buttons sample
              diagnostics.push({
                level: "info",
                code: "visible_buttons_sample",
                message: continueResult.reason,
              });

              postExecutionSnapshot = await capturePageSnapshot(page);
            }
          }
        } else if (step.action === "fill" && step.envVar === "OTP_SECRET") {
          // Execute OTP entry step
          console.log(`[auth-discovery] otpExecutionStarted envVar=${step.envVar} confidence=${step.confidence}`);

          // Detect OTP input field
          const otpField = await page.locator('input[type="text"], input:not([type]), [role=textbox]').first();
          const otpFieldVisible = await otpField.isVisible().catch(() => false);

          if (!otpFieldVisible) {
            console.log(`[auth-discovery] otpFieldNotFound`);
            diagnostics.push({
              level: "warning",
              code: "otp_field_not_found",
              message: "OTP input field not detected",
            });

            // CUSTOM OTP FLOW: Detect slots + virtual keyboard
            diagnostics.push({ level: "info", code: "otp_custom_detection_started", message: "Detecting custom OTP control" });

            // Wait for OTP render stability (elements, text, buttons)
            let otpRenderStable = false;
            const waitStart = Date.now();
            let beforeSnapshot = await capturePageSnapshot(page);

            while (Date.now() - waitStart < 3000 && !otpRenderStable) {
              await page.waitForTimeout(200);
              const afterSnapshot = await capturePageSnapshot(page);

              // Check for stability: text content and button count
              const textStable = beforeSnapshot.bodyTextPreview === afterSnapshot.bodyTextPreview;
              const buttonStable = beforeSnapshot.counts.buttons === afterSnapshot.counts.buttons;
              const hasOtpPattern = /otp|código|token|verificación|code|pin|confirm|validar/i.test(afterSnapshot.bodyTextPreview);
              const hasClickables = afterSnapshot.counts.buttons > 0 || afterSnapshot.counts.virtualKeyboardKeys > 0;

              otpRenderStable = textStable && buttonStable && hasOtpPattern && hasClickables;
              if (!otpRenderStable) beforeSnapshot = afterSnapshot;
            }

            const customOtp = await detectCustomOtpControl(page);
            diagnostics.push({
              level: "info",
              code: "otp_custom_detection_result",
              message: `Slots=${customOtp.slotsCount} Keys=${customOtp.numericKeysCount} Confirm=${customOtp.hasConfirmButton} CanExecute=${customOtp.hasSlots && customOtp.hasNumericKeyboard}`,
            });

            // Emit key refinement diagnostics if available
            if (customOtp.keyRefinementDiagnostics?.uniqueDigitsResolved !== undefined) {
              const ignoredMsg = customOtp.keyRefinementDiagnostics.ignoredGlobalContainers.length > 0
                ? ` ignored:[${customOtp.keyRefinementDiagnostics.ignoredGlobalContainers.join(',')}]`
                : '';
              diagnostics.push({
                level: "info",
                code: "otp_digit_key_global_containers_ignored",
                message: `Global containers excluded${ignoredMsg}`,
              });

              if (customOtp.keyRefinementDiagnostics.keypadContainers.length > 0) {
                const kpList = customOtp.keyRefinementDiagnostics.keypadContainers
                  .map(k => `{tag:${k.tag} digits:${k.digitsFound} bbox:${k.bbox.w}x${k.bbox.h}${k.rowSizes ? ` rows:[${k.rowSizes.join(',')}]` : ''}}`)
                  .join(' | ');
                diagnostics.push({
                  level: "info",
                  code: "otp_keypad_container_candidates",
                  message: `Keypad containers detected: ${kpList}`,
                });
              }

              diagnostics.push({
                level: "info",
                code: "otp_keypad_grid_rows_detected",
                message: `Grid analysis: containers=${customOtp.keyRefinementDiagnostics.keypadContainers.length} rows detected`,
              });

              diagnostics.push({
                level: "info",
                code: "otp_digit_key_grid_candidates",
                message: `Grid resolution: resolved=${customOtp.keyRefinementDiagnostics.resolvedByLeaf + customOtp.keyRefinementDiagnostics.resolvedByAncestor} UniqueDigits=${customOtp.keyRefinementDiagnostics.uniqueDigitsResolved}/10 Missing=[${customOtp.keyRefinementDiagnostics.missingDigits.join(',')}]`,
              });

              diagnostics.push({
                level: "info",
                code: "otp_digit_key_ancestor_resolution_refined",
                message: `Resolved by leaf=${customOtp.keyRefinementDiagnostics.resolvedByLeaf} by ancestor=${customOtp.keyRefinementDiagnostics.resolvedByAncestor} aggregated=${customOtp.keyRefinementDiagnostics.unresolvedAggregatedText} UniqueDigits=${customOtp.keyRefinementDiagnostics.uniqueDigitsResolved}/10 Missing=[${customOtp.keyRefinementDiagnostics.missingDigits.join(',')}]`,
              });

              if (customOtp.keyRefinementDiagnostics.coordinatePlan) {
                const plan = customOtp.keyRefinementDiagnostics.coordinatePlan;
                const digitCount = Object.keys(plan.digitGrid).length;
                diagnostics.push({
                  level: "info",
                  code: "otp_digit_key_coordinate_plan",
                  message: `Coordinate plan available (diagnostic only): grid=${digitCount} digits, cellSize=${Math.round(plan.estimatedCellSize.w)}x${Math.round(plan.estimatedCellSize.h)}, keypad bbox=${Math.round(plan.keypadBbox.w)}x${Math.round(plan.keypadBbox.h)}`,
                });
              }

              const reasonMsg = customOtp.keyRefinementDiagnostics.reasonCodes.length > 0
                ? ` reasons:[${customOtp.keyRefinementDiagnostics.reasonCodes.join(',')}]`
                : '';
              diagnostics.push({
                level: "info",
                code: "otp_digit_key_candidates_refined",
                message: `Leaf candidates analyzed, Ancestor resolution active. UniqueDigits=${customOtp.keyRefinementDiagnostics.uniqueDigitsResolved}/10 Missing=[${customOtp.keyRefinementDiagnostics.missingDigits.join(',')}]${reasonMsg}`,
              });
            }

            // Scan visual keypad layout independently of text/digits
            try {
              const visualScan = await scanVisualKeypadLayout(page);

              // Emit visible base diagnostic
              if (visualScan.diagnostics.visibleBase) {
                const vb = visualScan.diagnostics.visibleBase;
                diagnostics.push({
                  level: "info",
                  code: "otp_visual_keypad_visible_base",
                  message: `Visible base: total=${vb.visibleTotal} divs=${vb.visibleDivs} sections=${vb.visibleSections} articles=${vb.visibleArticles} uls=${vb.visibleUls} ols=${vb.visibleOls} candidatesBefore=${vb.rawCandidates}`,
                });
              }

              // Always emit container scan diagnostic
              if (visualScan.containerScan.length > 0) {
                const containersList = visualScan.containerScan
                  .map(c => `{tag:${c.tag} bbox:${c.bbox.width}x${c.bbox.height} children:${c.visibleChildrenCount} digits:${c.descendantDigitTextCount} rows:${c.rowSizes.length}}`)
                  .join(' | ');
                diagnostics.push({
                  level: "info",
                  code: "otp_visual_keypad_container_scan",
                  message: `Visual containers (max 10): ${containersList}`,
                });
              } else if (visualScan.diagnostics.visibleBase) {
                const vb = visualScan.diagnostics.visibleBase;
                diagnostics.push({
                  level: "info",
                  code: "otp_visual_keypad_container_scan",
                  message: `Visual containers: rawCandidates=${vb.rawCandidates} scannedCandidates=${visualScan.diagnostics.scannedContainers} rejectedByArea=${vb.rejectedByArea} rejectedByChildren=${vb.rejectedByChildren} rejectedByVisibility=${vb.rejectedByVisibility} matchedCandidates=${visualScan.containerScan.length}`,
                });
              }

              // Always emit container sample diagnostic
              if (visualScan.containerScan.length > 0) {
                const sampleList = visualScan.containerScan.slice(0, 8)
                  .map(c => `{tag:${c.tag} bbox:${Math.round(c.bbox.width)}x${Math.round(c.bbox.height)} directVisibleChildren:${c.directVisibleChildrenCount} descendantVisibleCount:${c.descendantVisibleCount} descendantDigitTextCount:${c.descendantDigitTextCount} rowSizes:[${c.rowSizes.join(',')}]${c.descendantRowSizes?.length > 0 ? ` descendantRowSizes:[${c.descendantRowSizes.join(',')}]` : ''} matchedPattern:${c.matchedPattern}}`)
                  .join(' | ');
                diagnostics.push({
                  level: "info",
                  code: "otp_visual_keypad_container_sample",
                  message: `Visual container sample (max 8): ${sampleList}`,
                });

                // Capture detailed descendant diagnostics for best candidates
                try {
                  // Select best 3 candidates: medium bbox, enough descendants and digits
                  const bestCandidates = visualScan.containerScan
                    .filter(c => c.descendantVisibleCount >= 8 && c.descendantDigitTextCount >= 5)
                    .sort((a, b) => {
                      // Prefer medium-sized containers
                      const areaA = a.bbox.width * a.bbox.height;
                      const areaB = b.bbox.width * b.bbox.height;
                      const midArea = (750 * 350); // Reference: typical keypad
                      return Math.abs(areaA - midArea) - Math.abs(areaB - midArea);
                    })
                    .slice(0, 3);

                  for (const candidate of bestCandidates) {
                    // Capture descendants for this container using stored element reference
                    const descendantDetails = await candidate.el.evaluate((el: HTMLElement) => {
                      const containerRect = el.getBoundingClientRect();
                      const descendants: any[] = [];

                      // Collect all visible descendants
                      el.querySelectorAll("*").forEach((desc: any) => {
                        const r = desc.getBoundingClientRect();
                        if (r.height === 0 || r.width === 0) return;

                        const text = desc.textContent?.trim() || "";
                        const digitsInText = (text.match(/[0-9]/g) || []).length;

                        descendants.push({
                          tag: desc.tagName.toLowerCase(),
                          bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                          textLength: text.length,
                          textHash: text.split('').reduce((s, c) => s + c.charCodeAt(0), 0).toString(16),
                          hasDigit: /[0-9]/.test(text),
                          digitsFound: digitsInText,
                          role: desc.getAttribute("role"),
                          cursor: getComputedStyle(desc).cursor !== "auto" ? getComputedStyle(desc).cursor : undefined,
                          pointerEvents: getComputedStyle(desc).pointerEvents !== "auto" ? getComputedStyle(desc).pointerEvents : undefined,
                          hasOnClick: !!desc.onclick,
                          tabIndex: desc.getAttribute("tabindex"),
                          childCount: desc.children.length,
                          depth: (() => {
                            let d = 0;
                            let p = desc.parentElement;
                            while (p && p !== el) { d++; p = p.parentElement; }
                            return d;
                          })()
                        });
                      });

                      // Group by Y coordinate
                      const yGroups = new Map<number, any[]>();
                      const yTolerance = Math.max(4, containerRect.height / 15);

                      for (const desc of descendants) {
                        let found = false;
                        for (const [y] of yGroups) {
                          if (Math.abs(desc.bbox.y - y) < yTolerance) {
                            yGroups.get(y)!.push(desc);
                            found = true;
                            break;
                          }
                        }
                        if (!found) {
                          yGroups.set(Math.round(desc.bbox.y), [desc]);
                        }
                      }

                      const rows = Array.from(yGroups.entries())
                        .sort((a, b) => a[0] - b[0])
                        .map(([y, items]) => ({
                          y,
                          size: items.length,
                          avgWidth: Math.round(items.reduce((s, i) => s + i.bbox.w, 0) / items.length),
                          avgHeight: Math.round(items.reduce((s, i) => s + i.bbox.h, 0) / items.length),
                          hasDigits: items.some(i => i.hasDigit)
                        }));

                      return {
                        totalDescendants: descendants.length,
                        sample: descendants.slice(0, 20),
                        descendantRowGroups: rows,
                        rowSizes: rows.map(r => r.size)
                      };
                    });

                    if (descendantDetails) {
                      // Emit sample diagnostic
                      const sampleInfo = descendantDetails.sample.slice(0, 10)
                        .map(d => `{tag:${d.tag} y:${d.bbox.y} w:${d.bbox.w} digit:${d.hasDigit} digitsCount:${d.digitsFound} role:${d.role || '?'} depth:${d.depth}}`)
                        .join(' | ');
                      diagnostics.push({
                        level: "info",
                        code: "otp_keypad_candidate_descendant_sample",
                        message: `Candidate descendants sample: bbox=${Math.round(candidate.bbox.width)}x${Math.round(candidate.bbox.height)} total=${descendantDetails.totalDescendants} sample(max 10): ${sampleInfo}`,
                      });

                      // Emit rows diagnostic
                      const rowsInfo = descendantDetails.descendantRowGroups
                        .map(r => `{y~${r.y} size:${r.size} avgW:${r.avgWidth} avgH:${r.avgHeight} hasDigits:${r.hasDigits}}`)
                        .join(' | ');
                      diagnostics.push({
                        level: "info",
                        code: "otp_keypad_candidate_descendant_rows",
                        message: `Candidate descendant rows: rowSizes=[${descendantDetails.rowSizes.join(',')}] groups: ${rowsInfo}`,
                      });
                    }
                  }
                } catch {
                  // Descendant capture failed
                }
                const descendantMatches = visualScan.containerScan.filter(c => c.descendantGridAnalysis && c.descendantGridAnalysis.matchedPattern);
                if (descendantMatches.length > 0) {
                  const dgList = descendantMatches.slice(0, 4)
                    .map(c => `{containerBbox:${Math.round(c.bbox.width)}x${Math.round(c.bbox.height)} descendants:${c.descendantGridAnalysis.descendantCandidates} rowSizes:[${c.descendantGridAnalysis.descendantRowSizes.join(',')}] digits:${c.descendantGridAnalysis.digitLikeDescendants} matched:${c.descendantGridAnalysis.matchedPattern}}`)
                    .join(' | ');
                  diagnostics.push({
                    level: "info",
                    code: "otp_keypad_descendant_grid_candidates",
                    message: `Descendant grid candidates: ${dgList}`,
                  });

                  if (descendantMatches[0]?.descendantGridAnalysis) {
                    const dga = descendantMatches[0].descendantGridAnalysis;
                    diagnostics.push({
                      level: "info",
                      code: "otp_keypad_descendant_grid_rows",
                      message: `Descendant grid rows detected: rowSizes=[${dga.descendantRowSizes.join(',')}] candidates=${dga.descendantCandidates} digitDescendants=${dga.digitLikeDescendants} pattern=${dga.matchedPattern}`,
                    });
                  }
                }
              } else {
                diagnostics.push({
                  level: "info",
                  code: "otp_visual_keypad_container_sample",
                  message: `Visual container sample: no containers scanned`,
                });
              }

              if (visualScan.rowPatternScan.length > 0) {
                const patterns = visualScan.rowPatternScan
                  .map((p, i) => `[${i}] rows=${p.rowCount} sizes=[${p.rowSizes.join(',')}] keypad=${p.candidatePattern}`)
                  .join(' | ');
                diagnostics.push({
                  level: "info",
                  code: "otp_visual_keypad_row_pattern_scan",
                  message: `Row patterns: ${patterns}`,
                });
              }

              if (visualScan.diagnostics.potentialKeypadPatterns === 0 && customOtp.numericKeysCount === 0) {
                diagnostics.push({
                  level: "info",
                  code: "otp_visual_keypad_diagnostic_note",
                  message: `Visual scan: ${visualScan.diagnostics.scannedContainers} containers scanned, ${visualScan.diagnostics.potentialKeypadPatterns} matched keypad pattern`,
                });
              }
            } catch {
              // Visual scan failed
            }

            // Capture digit-bearing elements if detection found zeros
            if (customOtp.slotsCount === 0 || customOtp.numericKeysCount === 0) {
              const digitSample = await captureOtpDigitCandidatesSample(page);

              if (digitSample.digitBearingElements.length > 0) {
                const sampleList = digitSample.digitBearingElements.map(c =>
                  `{tag:${c.tag} digits:${c.digitsFound} src:${c.sources} clickable:?}`
                ).join(' | ');
                diagnostics.push({
                  level: "info",
                  code: "otp_digit_bearing_elements_sample",
                  message: `Digit-bearing elements (max 12): ${sampleList}`,
                });
              }

              const stats = digitSample.sourceStats;
              const uniqueDigitsArray = Array.from(stats.uniqueDigitsSeen).sort();
              const missingDigits = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]
                .filter(d => !stats.uniqueDigitsSeen.has(d));
              diagnostics.push({
                level: "info",
                code: "otp_digit_bearing_source_summary",
                message: `Digit-bearing count=${stats.digitBearingCount} unique=[${uniqueDigitsArray.join('')}] single=${stats.singleDigitElementCount} multi=${stats.multiDigitElementCount} svg=${stats.svgOrPathDigitCount} clickableAncestor=${stats.clickableAncestorCount}`,
              });
            }

            // Forensic capture if detection found zeros
            if (customOtp.slotsCount === 0 || customOtp.numericKeysCount === 0) {
              const forensic = await captureOtpForensicSnapshot(page);
              diagnostics.push({
                level: "info",
                code: "otp_forensic_snapshot",
                message: `Elements: total=${forensic.counts.totalVisibleElements} digits=${forensic.counts.visibleDigitTextElements} singleChar=${forensic.counts.visibleSingleCharElements} clickable=${forensic.counts.clickableLikeElements} buttons=${forensic.counts.nativeButtonElements} divs=${forensic.counts.nativeDivElements}`,
              });

              if (forensic.elementSample.length > 0) {
                const sample = forensic.elementSample.slice(0, 8).map(e => `${e.tag}${e.role ? `[${e.role}]` : ''}${e.textIsDigit ? '(digit)' : ''}`).join(' | ');
                diagnostics.push({
                  level: "info",
                  code: "otp_forensic_element_sample",
                  message: `Sample (max 8): ${sample}`,
                });
              }

              diagnostics.push({
                level: "info",
                code: "otp_forensic_shadow_iframe_summary",
                message: forensic.shadowIframeSummary,
              });

              // Capture clickable/button elements snapshot
              try {
                const clickableSnapshot = await page.evaluate(() => {
                  const clickables: any[] = [];

                  // Collect all potentially clickable elements
                  const candidates = new Set<Element>();

                  try {
                    document.querySelectorAll("button, [role='button']").forEach(el => candidates.add(el));
                    document.querySelectorAll("[tabindex]").forEach(el => {
                      if (parseInt(el.getAttribute("tabindex") || "0") >= 0) candidates.add(el);
                    });
                    document.querySelectorAll("[onclick]").forEach(el => candidates.add(el));
                    document.querySelectorAll("*").forEach(el => {
                      if (getComputedStyle(el).cursor === "pointer") candidates.add(el);
                    });
                    document.querySelectorAll("a[href]").forEach(el => {
                      if ((el as HTMLElement).offsetParent !== null) candidates.add(el);
                    });
                  } catch {
                    // Ignore collection errors
                  }

                  // Process and deduplicate, with try/catch per element
                  for (const el of candidates) {
                    if (clickables.length >= 20) break;

                    try {
                      const rect = (el as HTMLElement).getBoundingClientRect();
                      if (rect.height === 0 || rect.width === 0) continue;
                      if ((el as HTMLElement).offsetParent === null) continue;

                      // Determine region with try/catch
                      let region = "unknown";
                      try {
                        let parent = el as HTMLElement;
                        while (parent && parent !== document.body) {
                          if (parent.tagName === "FOOTER") { region = "footer"; break; }
                          if (parent.tagName === "HEADER") { region = "header"; break; }
                          if (parent.tagName === "MAIN") { region = "main"; break; }
                          parent = parent.parentElement!;
                        }
                      } catch {
                        region = "unknown";
                      }

                      // Extract properties with individual try/catch
                      let text = "";
                      try {
                        text = (el as HTMLElement).textContent?.trim() || "";
                      } catch {
                        text = "?";
                      }

                      let digitsInText = 0;
                      try {
                        digitsInText = (text.match(/[0-9]/g) || []).length;
                      } catch {
                        digitsInText = 0;
                      }

                      // Get child tags
                      let childTagsStr = "";
                      try {
                        const childTags = new Map<string, number>();
                        (el as HTMLElement).children.forEach(child => {
                          const tag = child.tagName.toLowerCase();
                          childTags.set(tag, (childTags.get(tag) || 0) + 1);
                        });
                        childTagsStr = Array.from(childTags.entries())
                          .map(([tag, count]) => `${tag}${count > 1 ? `(${count})` : ''}`)
                          .join(',') || "?";
                      } catch {
                        childTagsStr = "?";
                      }

                      // Calculate depth with try/catch
                      let depth = 0;
                      try {
                        let p = el as HTMLElement;
                        while (p.parentElement && p !== document.body) { depth++; p = p.parentElement; }
                      } catch {
                        depth = -1;
                      }

                      clickables.push({
                        tag: el.tagName.toLowerCase(),
                        region,
                        bbox: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                        textLength: text === "?" ? -1 : text.length,
                        textHash: text === "?" ? "?" : text.split('').reduce((s, c) => s + c.charCodeAt(0), 0).toString(16),
                        digitsFound: digitsInText,
                        ariaLabel: el.getAttribute("aria-label") || undefined,
                        role: el.getAttribute("role") || undefined,
                        disabled: (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true",
                        cursor: getComputedStyle(el).cursor,
                        pointerEvents: getComputedStyle(el).pointerEvents,
                        childTags: childTagsStr,
                        depth
                      });
                    } catch {
                      // Skip problematic element, continue to next
                    }
                  }

                  return { clickables, errorCount: candidates.size - clickables.length };
                });

                // ALWAYS emit clickable snapshot with count
                const errorCount = clickableSnapshot.errorCount || 0;
                const sampleCount = clickableSnapshot.clickables?.length || 0;

                if (sampleCount > 0) {
                  const sampleList = clickableSnapshot.clickables.slice(0, 10)
                    .map(c => `{tag:${c.tag} region:${c.region} bbox:${c.bbox.w}x${c.bbox.h} textLen:${c.textLength} digits:${c.digitsFound} disabled:${c.disabled} role:${c.role || '?'}}`)
                    .join(' | ');
                  diagnostics.push({
                    level: "info",
                    code: "otp_clickable_visible_snapshot",
                    message: `Clickable elements (max 20): sampleCount=${sampleCount} errorCount=${errorCount} ${sampleList}`,
                  });
                } else {
                  diagnostics.push({
                    level: "info",
                    code: "otp_clickable_visible_snapshot",
                    message: `Clickable elements: sampleCount=0 errorCount=${errorCount}`,
                  });
                }

                // ALWAYS emit digit ancestors snapshot with count
                const digitBearers = (clickableSnapshot.clickables || []).filter(c => c.digitsFound > 0);
                if (digitBearers.length > 0) {
                  const ancestorInfo = digitBearers.slice(0, 5)
                    .map(c => `{tag:${c.tag} region:${c.region} digits:${c.digitsFound} bbox:${c.bbox.w}x${c.bbox.h} disabled:${c.disabled}}`)
                    .join(' | ');
                  diagnostics.push({
                    level: "info",
                    code: "otp_clickable_digit_ancestors_snapshot",
                    message: `Clickables with digits: sampleCount=${digitBearers.length} ${ancestorInfo}`,
                  });
                } else {
                  diagnostics.push({
                    level: "info",
                    code: "otp_clickable_digit_ancestors_snapshot",
                    message: `Clickables with digits: sampleCount=0`,
                  });
                }
              } catch {
                // Clickable snapshot failed at evaluation level, emit diagnostics with error indication
                diagnostics.push({
                  level: "info",
                  code: "otp_clickable_visible_snapshot",
                  message: `Clickable elements: sampleCount=0 evaluationFailed=true`,
                });
                diagnostics.push({
                  level: "info",
                  code: "otp_clickable_digit_ancestors_snapshot",
                  message: `Clickables with digits: sampleCount=0 evaluationFailed=true`,
                });
              }
            }

            // Generate coordinate keypad plan when no clickable digits detected
            if (customOtp.numericKeysCount === 0 && customOtp.hasConfirmButton) {
              try {
                const coordinatePlan = await page.evaluate(() => {
                  const viewport = { width: window.innerWidth, height: window.innerHeight, area: window.innerWidth * window.innerHeight };

                  // Identify OTP/code text region (header area)
                  const bodyText = document.body.textContent || "";
                  const hasOtpPattern = /otp|código|código|token|verificación|code|pin|confirm|validar/i.test(bodyText);

                  // Find all visible text elements and action buttons to exclude
                  const excludedRegions: any[] = [];
                  const allElements = Array.from(document.querySelectorAll("*")) as HTMLElement[];

                  // Collect excluded regions: headers, text cards, buttons
                  allElements.forEach(el => {
                    const rect = el.getBoundingClientRect();
                    if (rect.height === 0 || rect.width === 0) return;
                    if ((el as HTMLElement).offsetParent === null) return;

                    const isHeader = el.tagName === "HEADER" || el.className?.includes("header") || rect.top < viewport.height * 0.2;
                    const isTextCard = el.tagName === "ARTICLE" || el.className?.includes("card") || (rect.height > 80 && rect.height < viewport.height * 0.4);
                    const isButton = el.tagName === "BUTTON" || el.getAttribute("role") === "button";
                    const isActionButton = isButton && /confirm|enviar|validar|next|submit/i.test(el.textContent || "");

                    if (isHeader || (isTextCard && isTextCard) || isActionButton) {
                      excludedRegions.push({
                        bbox: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
                        type: isHeader ? "header" : isTextCard ? "text_card" : "action_button"
                      });
                    }
                  });

                  // Infer keypad region: bottom/middle area, below excluded regions
                  const lowestExcluded = Math.max(...excludedRegions.map(r => r.bbox.y + r.bbox.h), viewport.height * 0.3);
                  const candidateTop = lowestExcluded + 20;
                  const candidateBottom = viewport.height * 0.95;
                  const candidateHeight = candidateBottom - candidateTop;
                  const candidateWidth = Math.min(viewport.width * 0.9, 400);
                  const candidateLeft = (viewport.width - candidateWidth) / 2;

                  // Check if region looks reasonable
                  const hasVisibleContent = candidateHeight > 200 && candidateHeight < viewport.height * 0.6;

                  if (!hasVisibleContent) {
                    return {
                      status: "unavailable",
                      reasonCode: "insufficient_layout_signal",
                      viewport,
                      excludedRegions: excludedRegions.slice(0, 5)
                    };
                  }

                  // Calculate digit centers for 3x3+1 pattern
                  const cellWidth = candidateWidth / 3;
                  const cellHeight = candidateHeight / 4;
                  const digitCenters = [
                    { digit: "1", x: Math.round(candidateLeft + cellWidth * 0.5), y: Math.round(candidateTop + cellHeight * 0.5) },
                    { digit: "2", x: Math.round(candidateLeft + cellWidth * 1.5), y: Math.round(candidateTop + cellHeight * 0.5) },
                    { digit: "3", x: Math.round(candidateLeft + cellWidth * 2.5), y: Math.round(candidateTop + cellHeight * 0.5) },
                    { digit: "4", x: Math.round(candidateLeft + cellWidth * 0.5), y: Math.round(candidateTop + cellHeight * 1.5) },
                    { digit: "5", x: Math.round(candidateLeft + cellWidth * 1.5), y: Math.round(candidateTop + cellHeight * 1.5) },
                    { digit: "6", x: Math.round(candidateLeft + cellWidth * 2.5), y: Math.round(candidateTop + cellHeight * 1.5) },
                    { digit: "7", x: Math.round(candidateLeft + cellWidth * 0.5), y: Math.round(candidateTop + cellHeight * 2.5) },
                    { digit: "8", x: Math.round(candidateLeft + cellWidth * 1.5), y: Math.round(candidateTop + cellHeight * 2.5) },
                    { digit: "9", x: Math.round(candidateLeft + cellWidth * 2.5), y: Math.round(candidateTop + cellHeight * 2.5) },
                    { digit: "0", x: Math.round(candidateLeft + cellWidth * 1.5), y: Math.round(candidateTop + cellHeight * 3.5) }
                  ];

                  return {
                    status: "available",
                    reasonCode: "inferred_from_geometry",
                    viewport,
                    candidateRegion: {
                      bbox: { x: Math.round(candidateLeft), y: Math.round(candidateTop), w: Math.round(candidateWidth), h: Math.round(candidateHeight) },
                      confidence: 0.65
                    },
                    rowPattern: [3, 3, 3, 1],
                    digitCenters,
                    excludedRegions: excludedRegions.slice(0, 3)
                  };
                });

                if (coordinatePlan.status === "available") {
                  const centersList = coordinatePlan.digitCenters
                    .slice(0, 10)
                    .map(c => `${c.digit}:(${c.x},${c.y})`)
                    .join(' ');
                  diagnostics.push({
                    level: "info",
                    code: "otp_coordinate_keypad_plan",
                    message: `Coordinate keypad plan: status=${coordinatePlan.status} confidence=${coordinatePlan.candidateRegion?.confidence} region=[${coordinatePlan.candidateRegion?.bbox.x},${coordinatePlan.candidateRegion?.bbox.y},${coordinatePlan.candidateRegion?.bbox.w}x${coordinatePlan.candidateRegion?.bbox.h}] centers: ${centersList}`,
                  });
                } else {
                  diagnostics.push({
                    level: "info",
                    code: "otp_coordinate_keypad_plan",
                    message: `Coordinate keypad plan: status=unavailable reasonCode=${coordinatePlan.reasonCode}`,
                  });
                }
              } catch {
                // Coordinate plan generation failed
                diagnostics.push({
                  level: "info",
                  code: "otp_coordinate_keypad_plan",
                  message: `Coordinate keypad plan: status=unavailable reasonCode=coordinate_plan_unsafe`,
                });
              }
            }

            // Try to detect and fill virtual keypad OTP
            const otpValue = process.env.OTP_SECRET || "";
            const otpMetadata = {
              envVarPresent: !!process.env.OTP_SECRET,
              length: otpValue.length,
              isNumeric: /^\d+$/.test(otpValue),
              isEmpty: otpValue.length === 0,
            };
            console.log(`[auth-discovery] OTP metadata: ${JSON.stringify(otpMetadata)}`);
            diagnostics.push({
              level: "info",
              code: "otp_resolution_metadata",
              message: `OTP from env: present=${otpMetadata.envVarPresent} length=${otpMetadata.length} numeric=${otpMetadata.isNumeric}`,
            });
            if (otpValue && otpValue.length > 0) {
              // Attempt virtual keypad fill using new detection logic
              const virtualKeypadFilled = await fillOtpVirtualKeypad(page, otpValue, diagnostics);

              if (virtualKeypadFilled) {
                diagnostics.push({
                  level: "info",
                  code: "otp_virtual_keyboard_fill_executed",
                  message: `OTP virtual keypad fill successful`,
                });
                postExecutionSnapshot = await capturePageSnapshot(page);

                // If confirm button exists, try to click it
                if (customOtp.hasConfirmButton) {
                  const confirmBtn = await page.locator('button, [role=button]')
                    .filter({ hasText: /confirmar|validar|verificar|continuar|next|submit|verify|confirm/i })
                    .first();
                  const isDisabled = await confirmBtn.isDisabled().catch(() => true);
                  if (!isDisabled) {
                    try {
                      await confirmBtn.click();
                      await page.waitForTimeout(500);
                      diagnostics.push({ level: "info", code: "otp_confirm_executed", message: "Confirm clicked" });
                      postExecutionSnapshot = await capturePageSnapshot(page);
                    } catch (err) {
                      diagnostics.push({ level: "warning", code: "otp_confirm_error", message: "Confirm failed" });
                    }
                  }
                }
              } else if (customOtp.hasSlots && customOtp.hasNumericKeyboard) {
                // Fallback to old method if new method failed but slots/keyboard detected
                const otpFillResult = await executeVirtualKeyboardFill(page, "OTP_SECRET", true);
                diagnostics.push({
                  level: "info",
                  code: "otp_virtual_keyboard_fill_executed",
                  message: `OTP fill (fallback): charCount=${otpFillResult.charCount} successfulClicks=${otpFillResult.successfulKeyClicks}`,
                });
                postExecutionSnapshot = await capturePageSnapshot(page);

                if (customOtp.hasConfirmButton) {
                  const confirmBtn = await page.locator('button, [role=button]')
                    .filter({ hasText: /confirmar|validar|verificar|continuar|next|submit|verify|confirm/i })
                    .first();
                  const isDisabled = await confirmBtn.isDisabled().catch(() => true);
                  if (!isDisabled) {
                    try {
                      await confirmBtn.click();
                      await page.waitForTimeout(500);
                      diagnostics.push({ level: "info", code: "otp_confirm_executed", message: "Confirm clicked" });
                      postExecutionSnapshot = await capturePageSnapshot(page);
                    } catch (err) {
                      diagnostics.push({ level: "warning", code: "otp_confirm_error", message: "Confirm failed" });
                    }
                  }
                }
              } else {
                diagnostics.push({
                  level: "warning",
                  code: "otp_custom_incomplete",
                  message: `Custom OTP incomplete: slots=${customOtp.hasSlots}(${customOtp.slotsCount}) keyboard=${customOtp.hasNumericKeyboard}(${customOtp.numericKeysCount})`,
                });
              }
            } else {
              diagnostics.push({
                level: "warning",
                code: "otp_secret_not_available",
                message: `OTP_SECRET environment variable not available for virtual keypad fill`,
              });
            }
          } else {
            console.log(`[auth-discovery] otpFieldDetected`);
            diagnostics.push({
              level: "info",
              code: "otp_field_detected",
              message: "OTP input field detected",
            });

            // Get OTP value from environment (don't log value)
            const otpValue = process.env.OTP_SECRET || "";
            const otpMetadata = {
              envVarPresent: !!process.env.OTP_SECRET,
              length: otpValue.length,
              isNumeric: /^\d+$/.test(otpValue),
              isEmpty: otpValue.length === 0,
            };
            console.log(`[auth-discovery] OTP metadata: ${JSON.stringify(otpMetadata)}`);
            diagnostics.push({
              level: "info",
              code: "otp_resolution_metadata",
              message: `OTP from env: present=${otpMetadata.envVarPresent} length=${otpMetadata.length} numeric=${otpMetadata.isNumeric}`,
            });
            if (!otpValue) {
              console.log(`[auth-discovery] otpSecretNotFound`);
              diagnostics.push({
                level: "warning",
                code: "otp_secret_not_found",
                message: "OTP_SECRET environment variable not set",
              });
            } else {
              // Execute OTP fill
              try {
                await otpField.click();
                await otpField.fill(otpValue);
                await page.waitForTimeout(300);

                console.log(`[auth-discovery] otpFillExecuted charCount=${otpValue.length}`);
                diagnostics.push({
                  level: "info",
                  code: "otp_fill_executed",
                  message: `OTP entry completed: charCount=${otpValue.length}`,
                });

                postExecutionSnapshot = await capturePageSnapshot(page);

                // Detect and click OTP continue button if confidence allows
                if (step.confidence === "high" || step.confidence === "medium") {
                  const continueButton = await page.locator('button, [role=button]').filter({ hasText: /continuar|verificar|confirmar|validar|next|submit|verify|confirm/i }).first();
                  const continueButtonVisible = await continueButton.isVisible().catch(() => false);

                  if (continueButtonVisible) {
                    console.log(`[auth-discovery] otpContinueDetected confidence=${step.confidence}`);
                    diagnostics.push({
                      level: "info",
                      code: "otp_continue_detected",
                      message: "OTP continue button detected",
                    });

                    try {
                      await continueButton.click();
                      await page.waitForTimeout(500);

                      console.log(`[auth-discovery] otpContinueExecuted`);
                      diagnostics.push({
                        level: "info",
                        code: "otp_continue_executed",
                        message: "OTP continue button clicked",
                      });

                      postExecutionSnapshot = await capturePageSnapshot(page);
                    } catch (err) {
                      console.log(`[auth-discovery] otpContinueClickError: ${err instanceof Error ? err.message : String(err)}`);
                      diagnostics.push({
                        level: "warning",
                        code: "otp_continue_click_error",
                        message: `OTP continue click failed`,
                      });
                    }
                  }
                }
              } catch (err) {
                console.log(`[auth-discovery] otpFillError: ${err instanceof Error ? err.message : String(err)}`);
                diagnostics.push({
                  level: "warning",
                  code: "otp_fill_error",
                  message: `OTP fill failed`,
                });
              }
            }
          }
        } else if (step.action === "click") {
          // Explicit click step (if needed)
          const continueResult = await executeCredentialContinue(page, postExecutionSnapshot);
          if (continueResult.success) {
            diagnostics.push({
              level: "info",
              code: "credential_continue_executed",
              message: continueResult.reason,
            });
            postExecutionSnapshot = await capturePageSnapshot(page);
          }
        }

        // Private catalog discovery post-auth: Wait for stable post-auth screen
        if (step.action === "fill" && step.envVar === "OTP_SECRET") {
          diagnostics.push({
            level: "info",
            code: "private_post_auth_wait_started",
            message: "Waiting for stable post-auth screen before catalog discovery",
          });

          const postAuthWaitStart = Date.now();
          let postAuthStable = false;
          let beforeAuthSnapshot = postExecutionSnapshot;
          const maxWaitMs = 8000;
          const loadingExtensionMs = 20000;
          let loadingExtensionUsed = false;
          let stableCycles = 0;
          const requiredStableCycles = 2;
          let lastObservedLoading = false;
          let lastObservedCatalog = false;
          let lastObservedButtons = beforeAuthSnapshot.counts.buttons;
          let lastObservedUrl = beforeAuthSnapshot.url;

          while (Date.now() - postAuthWaitStart < maxWaitMs + (loadingExtensionUsed ? loadingExtensionMs : 0) && !postAuthStable) {
            await page.waitForTimeout(400);
            const afterSnapshot = await capturePageSnapshot(page);

            // Detect state changes: URL, button count, links, cards, body text
            const urlChanged = beforeAuthSnapshot.url !== afterSnapshot.url;
            const buttonCountGrew = afterSnapshot.counts.buttons > beforeAuthSnapshot.counts.buttons;
            const linkCountChanged = afterSnapshot.counts.links !== beforeAuthSnapshot.counts.links;
            const cardCountChanged = afterSnapshot.counts.cards !== beforeAuthSnapshot.counts.cards;
            const bodyTextChanged = beforeAuthSnapshot.bodyTextPreview !== afterSnapshot.bodyTextPreview;

            // Comprehensive loading detection
            const processingPattern = /cargando|procesando|enviando|loading|processing|sending|esperando|waiting|verificando|verifying/i;
            const hasProcessingText = processingPattern.test(afterSnapshot.bodyTextPreview);

            // Detect modal/overlay visibility
            const overlayPattern = /modal|overlay|dialog|popup|capa|ventana/i;
            const hasModalText = overlayPattern.test(afterSnapshot.bodyTextPreview);

            // Detect spinner/progressbar via DOM evaluation
            const loadingElements = await page.evaluate(() => {
              const spinners = document.querySelectorAll('[role="progressbar"], [class*="spinner"], [class*="loader"], [class*="loading"], svg[class*="spinner"]').length;
              const ariaBusy = document.querySelectorAll('[aria-busy="true"]').length;
              const statusElements = document.querySelectorAll('[role="status"]').length;
              return { spinners, ariaBusy, statusElements };
            }).catch(() => ({ spinners: 0, ariaBusy: 0, statusElements: 0 }));

            const hasLoadingElements = loadingElements.spinners > 0 || loadingElements.ariaBusy > 0;
            const loadingDetected = hasProcessingText || hasModalText || hasLoadingElements;

            // Detect private catalog/navigation patterns appearing
            const privateCatalogPattern = /catálogo|productos|cuentas|servicios|menú|navegación|dashboard|inicio/i;
            const hasCatalogSignals = privateCatalogPattern.test(afterSnapshot.bodyTextPreview);
            lastObservedLoading = loadingDetected;
            lastObservedCatalog = hasCatalogSignals;
            lastObservedButtons = afterSnapshot.counts.buttons;
            lastObservedUrl = afterSnapshot.url;

            const loadingMenuState =
              loadingDetected &&
              (hasCatalogSignals || /operations-menu/i.test(afterSnapshot.url)) &&
              afterSnapshot.counts.buttons >= 1;
            if (loadingMenuState && !loadingExtensionUsed) {
              loadingExtensionUsed = true;
              diagnostics.push({
                level: "info",
                code: "private_post_auth_wait_extended_for_loading",
                message: `Extending post-auth wait by ${loadingExtensionMs}ms because loading remains active`,
              });
            }

            diagnostics.push({
              level: "info",
              code: "private_post_auth_wait_observed_state",
              message: `url=${afterSnapshot.url.split('/').slice(-1)[0]} buttons=${afterSnapshot.counts.buttons} links=${afterSnapshot.counts.links} cards=${afterSnapshot.counts.cards} headings=${afterSnapshot.counts.headings} loading=${loadingDetected} overlay=${hasModalText} catalog=${hasCatalogSignals} stable=${stableCycles}`,
            });

            // Stability criteria: Loading must be gone, catalog signals present, enough buttons, state changed
            const isCurrentlyCycleStable = !loadingDetected && hasCatalogSignals &&
                                         afterSnapshot.counts.buttons >= 2 &&
                                         (urlChanged || buttonCountGrew || linkCountChanged || cardCountChanged);

            // Check if NOT in OTP screen
            const otpPattern = /otp|token|código|verificación|one-time|code|pin/i;
            const isOtpScreen = otpPattern.test(afterSnapshot.bodyTextPreview);

            if (isCurrentlyCycleStable) {
              stableCycles++;
              // Fast resolve for simple catalog-ready state if not OTP
              const isCatalogReadySimple = !loadingDetected && hasCatalogSignals && afterSnapshot.counts.buttons >= 2 && !isOtpScreen;
              postAuthStable = isCatalogReadySimple || stableCycles >= requiredStableCycles;
            } else {
              stableCycles = 0; // Reset if not stable
            }

            if (!postAuthStable) beforeAuthSnapshot = afterSnapshot;
          }

          if (postAuthStable) {
            // Check which resolution path was taken
            const otpPattern = /otp|token|código|verificación|one-time|code|pin/i;
            const isFastResolve = stableCycles === 1 && !otpPattern.test(postExecutionSnapshot.bodyTextPreview);

            const resolveCode = isFastResolve ? "private_post_auth_wait_resolved_by_catalog_ready" : "private_post_auth_wait_resolved";
            diagnostics.push({
              level: "info",
              code: resolveCode,
              message: `Post-auth screen stabilized after ${Date.now() - postAuthWaitStart}ms with ${stableCycles} stable cycles`,
            });

            // Capture private menu snapshot
            diagnostics.push({
              level: "info",
              code: "private_menu_snapshot_started",
              message: "Capturing private menu snapshot",
            });

            const menuSnapshot = await capturePageSnapshot(page);
            let menuClickableTexts = [];
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                const readText = async (loc: any) => {
                  for (const r of [
                    async () => { const t = await loc.innerText(); return typeof t === "string" ? t.replace(/\s+/g, " ").trim() : ""; },
                    async () => { const t = await loc.textContent(); return typeof t === "string" ? t.replace(/\s+/g, " ").trim() : ""; },
                    async () => { const t = await loc.getAttribute("aria-label"); return typeof t === "string" ? t.replace(/\s+/g, " ").trim() : ""; },
                    async () => { const t = await loc.getAttribute("title"); return typeof t === "string" ? t.replace(/\s+/g, " ").trim() : ""; },
                  ]) { try { const t = await r(); if (t) return t; } catch {} }
                  return "";
                };
                const sources: Record<string, string[]> = {};
                const seen = new Set<string>();
                const isTransient = /éxito|verificado|exitosamente|cargando|verificando|procesando|error temporal/i;
                const collect = async (sel: string, key: string, checkVis: boolean) => {
                  sources[key] = [];
                  const locs = page.locator(sel);
                  const cnt = Math.min(await locs.count().catch(() => 0), 30);
                  for (let i = 0; i < cnt; i++) {
                    const el = locs.nth(i);
                    if (checkVis && !(await el.isVisible().catch(() => false))) continue;
                    const txt = await readText(el);
                    if (txt && !seen.has(txt) && !isTransient.test(txt)) { seen.add(txt); sources[key].push(txt); }
                  }
                };
                await collect('button', 'buttons', false);
                await collect('[role="button"]:not(button)', 'roleButtons', true);
                await collect('a', 'links', true);
                await collect('[tabindex]:not(button):not([role="button"]):not(a)', 'tabindex', true);
                await collect('[class*="card"], [class*="menu-item"], li:not([role="none"])', 'cards', true);
                const totalCandidates = Object.values(sources).reduce((s, arr) => s + arr.length, 0);
                diagnostics.push({
                  level: "info",
                  code: "private_menu_snapshot_candidate_sources",
                  message: `buttons=${sources.buttons.length} roleButtons=${sources.roleButtons.length} links=${sources.links.length} tabindex=${sources.tabindex.length} cards=${sources.cards.length} total=${totalCandidates}`,
                });
                menuClickableTexts = Array.from(new Set(Object.values(sources).flat()));
                if (menuSnapshot.counts.buttons >= 3 && menuClickableTexts.length <= 1) {
                  if (attempt === 0) {
                    diagnostics.push({ level: "warning", code: "private_menu_snapshot_incomplete", message: `buttons=${menuSnapshot.counts.buttons} but samples=${menuClickableTexts.length}, retrying after 1000ms` });
                    await page.waitForTimeout(1000);
                    continue;
                  }
                  diagnostics.push({ level: "warning", code: "private_menu_snapshot_incomplete", message: `buttons=${menuSnapshot.counts.buttons} samples=${menuClickableTexts.length} — blocking` });
                  menuClickableTexts = [];
                }
                break;
              } catch (error) {
                diagnostics.push({
                  level: "warning",
                  code: "private_menu_snapshot_error",
                  message: `private menu snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
                });
                menuClickableTexts = [];
                break;
              }
            }
            const menuButtonTexts = menuClickableTexts.slice(0, 10);

            diagnostics.push({
              level: "info",
              code: "private_menu_snapshot_result",
              message: `buttons=${menuSnapshot.counts.buttons} links=${menuSnapshot.counts.links} cards=${menuSnapshot.counts.cards} headings=${menuSnapshot.counts.headings} clickables=${menuClickableTexts.length} samples=${menuButtonTexts.length} sampleTexts="${menuButtonTexts.join(" | ")}"`,
            });

            diagnostics.push({
              level: "info",
              code: "private_hu_intent_context_check",
              message: `hasHuText=${Boolean(businessContext?.huText)} hasTitle=${Boolean(businessContext?.title)} hasText=${Boolean(businessContext?.text)} stepsCount=${Array.isArray(businessContext?.steps) ? businessContext.steps.length : 0} hasCase=${Boolean(businessContext?.case)} hasIssue=${Boolean(businessContext?.issue)} intent="${intent ?? "none"}"`,
            });

            const huIntentText = buildPrivateHuIntentText({
              request: businessContext,
              intent,
              step,
              menuSnapshot,
            });
            diagnostics.push({
              level: "info",
              code: "private_hu_intent_source",
              message: `source=${huIntentText.source} length=${huIntentText.text.length} sample="${huIntentText.sample}"`,
            });

            // HU-based module selection
            diagnostics.push({
              level: "info",
              code: "private_hu_intent_resolved",
              message: `Resolving module from intent="${huIntentText.text}"`,
            });

            const huIntention = resolveHuIntent(huIntentText.text);
            diagnostics.push({
              level: "info",
              code: "private_hu_intent_resolved",
              message: `category=${huIntention.category} confidence=${huIntention.confidence} matched=${huIntention.matchedTerms.join(",")} reason=${huIntention.reason}`,
            });

            if (huIntention.category === "private/authenticated_transaction") {
              diagnostics.push({
                level: "warning",
                code: "private_module_resolution_blocked",
                message: `reasonCode=missing_product_intent intent="${huIntentText.text}"`,
              });
              return;
            }

            // Score menu candidates against HU intent
            const moduleCandidates = scoreModuleCandidates(
              huIntention.category,
              menuButtonTexts.map(t => ({ text: t })),
              diagnostics
            );

            diagnostics.push({
              level: "info",
              code: "private_module_candidates_scored",
              message: `top5: ${moduleCandidates.slice(0, 5).map(c => `${c.text}(${c.score})`).join(" | ")}`,
            });

            // Select module if high confidence match exists
            const topCandidate = moduleCandidates.length > 0 ? moduleCandidates[0] : null;
            const secondScore1 = moduleCandidates[1]?.score ?? 0;
            const margin1 = topCandidate ? topCandidate.score - secondScore1 : 0;
            const shouldSelect1 = topCandidate && (
              (topCandidate.score >= 100 && huIntention.confidence !== "low") ||
              (topCandidate.score >= 80 && topCandidate.reason === "specific_match" && huIntention.confidence === "high" && margin1 >= 20)
            );
            diagnostics.push({
              level: "info",
              code: "private_module_resolution_decision",
              message: `topScore=${topCandidate?.score ?? 0} secondScore=${secondScore1} margin=${margin1} topReason=${topCandidate?.reason ?? "none"} huConfidence=${huIntention.confidence} selected=${shouldSelect1}`,
            });
            if (shouldSelect1) {
              diagnostics.push({
                level: "info",
                code: "private_module_selected",
                message: `Selected module: "${topCandidate.text}" (score=${topCandidate.score})`,
              });

              // Click selected module
              try {
              const shortLabel = (topCandidate.text.match(/^(.*?)(?:\s[——–-]\s|:\s|;\s|\n|\r|\.\s|,\s|\s{2,})/) || [])[1]?.trim() || topCandidate.text.split(/\s+/).slice(0, 4).join(" ");
              let moduleButton = await page.locator(`button:has-text("${shortLabel}"), [role="button"]:has-text("${shortLabel}"), a:has-text("${shortLabel}")`).first();
              let btnVisible = await moduleButton.isVisible().catch(() => false);
              if (!btnVisible) {
                const primaryWords = shortLabel.split(/\s+/).slice(0, 3).join(" ");
                moduleButton = await page.locator(`button:has-text("${primaryWords}"), [role="button"]:has-text("${primaryWords}")`).first();
                btnVisible = await moduleButton.isVisible().catch(() => false);
              }
              if (!btnVisible) throw new Error("Module button not visible");
              await moduleButton.click();
                await page.waitForTimeout(500);

                diagnostics.push({
                  level: "info",
                  code: "private_module_click_executed",
                  message: `Clicked module button: "${topCandidate.text}"`,
                });

                // Wait for module screen to load
                diagnostics.push({
                  level: "info",
                  code: "private_module_wait_started",
                  message: "Waiting for module screen to load",
                });

                let moduleScreenLoaded = false;
                const moduleWaitStart = Date.now();
                let prevSnapshot = menuSnapshot;
                const menuUrlBefore = page.url();

                while (Date.now() - moduleWaitStart < 10000 && !moduleScreenLoaded) {
                  await page.waitForTimeout(300);
                  const moduleSnapshot = await capturePageSnapshot(page);
                  const urlChanged = moduleSnapshot.url !== prevSnapshot.url;
                  const contentChanged = moduleSnapshot.bodyTextPreview !== prevSnapshot.bodyTextPreview;
                  const buttonsChanged = moduleSnapshot.counts.buttons !== prevSnapshot.counts.buttons;
                  const cardsAppeared = moduleSnapshot.counts.cards > 0;
                  const headingsAppeared = moduleSnapshot.counts.headings > 0;
                  const newClickables = moduleSnapshot.counts.buttons + moduleSnapshot.counts.links > prevSnapshot.counts.buttons + prevSnapshot.counts.links;

                  moduleScreenLoaded = urlChanged || contentChanged || buttonsChanged || cardsAppeared || headingsAppeared || newClickables;
                  if (!moduleScreenLoaded) prevSnapshot = moduleSnapshot;
                }

                if (moduleScreenLoaded) {
                  const resolveCode = moduleSnapshot.url !== menuUrlBefore ? "private_module_wait_resolved_by_url_change" : "private_module_wait_resolved_by_content_change";
                  diagnostics.push({
                    level: "info",
                    code: resolveCode,
                    message: `Module screen loaded after ${Date.now() - moduleWaitStart}ms`,
                  });

                  diagnostics.push({
                    level: "info",
                    code: "private_module_snapshot_started",
                    message: "Capturing module snapshot",
                  });

                  const modSnapshot = await capturePageSnapshot(page);
                  diagnostics.push({
                    level: "info",
                    code: "private_module_snapshot_result",
                    message: `buttons=${modSnapshot.counts.buttons} cards=${modSnapshot.counts.cards} links=${modSnapshot.counts.links} headings=${modSnapshot.counts.headings}`,
                  });

                  const internalOptions: string[] = [];
                  try {
                    const loc = page.locator('button, [role="button"], a, [tabindex], [onclick]');
                    const cnt = Math.min(await loc.count().catch(() => 0), 30);
                    const seen = new Set<string>();
                    for (let i = 0; i < cnt; i++) {
                      const el = loc.nth(i);
                      if (!(await el.isVisible().catch(() => false))) continue;
                      const txt = (await el.innerText().catch(() => "") || await el.textContent().catch(() => "") || await el.getAttribute("aria-label").catch(() => "") || "").replace(/\s+/g, " ").trim();
                      if (txt && !seen.has(txt)) { seen.add(txt); internalOptions.push(txt); }
                    }
                  } catch { /* skip */ }

                  const destructivePatterns = /confirmar|enviar|solicitar|pagar|transferir|aceptar|finalizar|procesar|guardar|eliminar/i;
                  const safeOptions = internalOptions.filter(t => !destructivePatterns.test(t));

                  if (safeOptions.length > 0) {
                    const internalCandidates = scoreModuleCandidates(huIntention.category, safeOptions.map(t => ({ text: t })), diagnostics);
                    diagnostics.push({
                      level: "info",
                      code: "private_module_internal_candidates_scored",
                      message: `top5: ${internalCandidates.slice(0, 5).map(c => `${c.text}(${c.score})`).join(" | ")}`,
                    });
                    const topInternal = internalCandidates[0];
                    if (topInternal && (topInternal.score >= 100 || (topInternal.score >= 80 && topInternal.reason === "specific_match"))) {
                      diagnostics.push({
                        level: "info",
                        code: "private_module_internal_option_selected",
                        message: `Selected internal option: "${topInternal.text}" (score=${topInternal.score})`,
                      });
                      try {
                        const shortLabel = topInternal.text.split(/\n|\.\s|,|\s{2,}/)[0].trim();
                        let btn = await page.locator(`button:has-text("${shortLabel}"), [role="button"]:has-text("${shortLabel}")`).first();
                        if (!(await btn.isVisible().catch(() => false))) {
                          const primaryWords = shortLabel.split(/\s+/).slice(0, 3).join(" ");
                          btn = await page.locator(`button:has-text("${primaryWords}"), [role="button"]:has-text("${primaryWords}")`).first();
                        }
                        if (await btn.isVisible().catch(() => false)) {
                          await btn.click();
                          await page.waitForTimeout(500);
                          diagnostics.push({
                            level: "info",
                            code: "private_module_internal_option_click_executed",
                            message: `Clicked internal option: "${shortLabel}"`,
                          });
                          const detailSnapshot = await capturePageSnapshot(page);
                          diagnostics.push({
                            level: "info",
                            code: "private_module_detail_snapshot_result",
                            message: `buttons=${detailSnapshot.counts.buttons} cards=${detailSnapshot.counts.cards} links=${detailSnapshot.counts.links} headings=${detailSnapshot.counts.headings}`,
                          });
                        } else {
                          diagnostics.push({
                            level: "warning",
                            code: "private_module_internal_option_click_blocked",
                            message: `Internal option not visible or not found: "${shortLabel}"`,
                          });
                        }
                      } catch {
                        diagnostics.push({
                          level: "warning",
                          code: "private_module_internal_option_click_failed",
                          message: `Could not click internal option: "${topInternal.text}"`,
                        });
                      }
                    } else {
                      diagnostics.push({
                        level: "warning",
                        code: "private_module_internal_resolution_blocked",
                        message: `reasonCode=no_clear_internal_candidate topScore=${topInternal?.score ?? 0}`,
                      });
                    }
                  } else {
                    diagnostics.push({
                      level: "warning",
                      code: "private_module_internal_resolution_blocked",
                      message: "reasonCode=no_safe_internal_options",
                    });
                  }
                } else {
                  const timeoutUrl = page.url();
                  const timeoutBody = await page.evaluate(() => document.body?.innerText?.slice(0, 200) ?? "").catch(() => "");
                  diagnostics.push({
                    level: "warning",
                    code: "private_module_wait_timeout",
                    message: `Module screen did not load within 10s`,
                  });
                  diagnostics.push({
                    level: "info",
                    code: "private_module_wait_timeout_snapshot",
                    message: `url=${timeoutUrl} buttons=${prevSnapshot.counts.buttons} cards=${prevSnapshot.counts.cards} links=${prevSnapshot.counts.links} bodySample="${timeoutUrl !== menuUrlBefore ? timeoutBody.slice(0, 200) : "unchanged"}".replace(/\s+/g, " ").trim()"`,
                  });
                  if (timeoutUrl !== menuUrlBefore) {
                    diagnostics.push({
                      level: "warning",
                      code: "private_module_wait_timeout_url_changed",
                      message: "URL changed during wait — continuing to snapshot despite timeout",
                    });
                    moduleScreenLoaded = true;
                  }
                }
              } catch (err) {
                diagnostics.push({
                  level: "warning",
                  code: "private_module_click_error",
                  message: `Failed to click module: ${err instanceof Error ? err.message : String(err)}`,
                });
              }
            } else {
              diagnostics.push({
                level: "warning",
                code: "private_module_resolution_blocked",
                message: `No confident module match found (topScore=${topCandidate?.score || 0} intentConfidence=${huIntention.confidence})`,
              });
            }
          } else {
            // Check if last observed state qualifies as catalog-ready despite timeout
            const catalogReadyPattern = /catálogo|productos|cuentas|servicios|menú|navegación|dashboard|inicio/i;
            const lastStateValid = beforeAuthSnapshot &&
                                  catalogReadyPattern.test(beforeAuthSnapshot.bodyTextPreview) &&
                                  beforeAuthSnapshot.counts.buttons >= 2;

            if (lastStateValid) {
              // Treat as resolved with fast-path diagnostic
              diagnostics.push({
                level: "info",
                code: "private_post_auth_wait_resolved_by_catalog_ready",
                message: `Post-auth catalog-ready state detected in final snapshot after ${Date.now() - postAuthWaitStart}ms`,
              });

              // Execute menu snapshot and module selection (same as resolved path)
              diagnostics.push({
                level: "info",
                code: "private_menu_snapshot_started",
              message: "Capturing private menu snapshot",
            });

            const menuSnapshot = await capturePageSnapshot(page);
            let menuClickableTexts: string[] = [];
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                const readText = async (loc: any) => {
                  for (const r of [
                    async () => { const t = await loc.innerText(); return typeof t === "string" ? t.replace(/\s+/g, " ").trim() : ""; },
                    async () => { const t = await loc.textContent(); return typeof t === "string" ? t.replace(/\s+/g, " ").trim() : ""; },
                    async () => { const t = await loc.getAttribute("aria-label"); return typeof t === "string" ? t.replace(/\s+/g, " ").trim() : ""; },
                    async () => { const t = await loc.getAttribute("title"); return typeof t === "string" ? t.replace(/\s+/g, " ").trim() : ""; },
                  ]) { try { const t = await r(); if (t) return t; } catch {} }
                  return "";
                };
                const sources: Record<string, string[]> = {};
                const seen = new Set<string>();
                const isTransient = /éxito|verificado|exitosamente|cargando|verificando|procesando|error temporal/i;
                const collect = async (sel: string, key: string, checkVis: boolean) => {
                  sources[key] = [];
                  const locs = page.locator(sel);
                  const cnt = Math.min(await locs.count().catch(() => 0), 30);
                  for (let i = 0; i < cnt; i++) {
                    const el = locs.nth(i);
                    if (checkVis && !(await el.isVisible().catch(() => false))) continue;
                    const txt = await readText(el);
                    if (txt && !seen.has(txt) && !isTransient.test(txt)) { seen.add(txt); sources[key].push(txt); }
                  }
                };
                await collect('button', 'buttons', false);
                await collect('[role="button"]:not(button)', 'roleButtons', true);
                await collect('a', 'links', true);
                await collect('[tabindex]:not(button):not([role="button"]):not(a)', 'tabindex', true);
                await collect('[class*="card"], [class*="menu-item"], li:not([role="none"])', 'cards', true);
                const totalCandidates = Object.values(sources).reduce((s, arr) => s + arr.length, 0);
                diagnostics.push({
                  level: "info",
                  code: "private_menu_snapshot_candidate_sources",
                  message: `buttons=${sources.buttons.length} roleButtons=${sources.roleButtons.length} links=${sources.links.length} tabindex=${sources.tabindex.length} cards=${sources.cards.length} total=${totalCandidates}`,
                });
                menuClickableTexts = Array.from(new Set(Object.values(sources).flat()));
                if (menuSnapshot.counts.buttons >= 3 && menuClickableTexts.length <= 1) {
                  if (attempt === 0) {
                    diagnostics.push({ level: "warning", code: "private_menu_snapshot_incomplete", message: `buttons=${menuSnapshot.counts.buttons} but samples=${menuClickableTexts.length}, retrying after 1000ms` });
                    await page.waitForTimeout(1000);
                    continue;
                  }
                  diagnostics.push({ level: "warning", code: "private_menu_snapshot_incomplete", message: `buttons=${menuSnapshot.counts.buttons} samples=${menuClickableTexts.length} — blocking` });
                  menuClickableTexts = [];
                }
                break;
              } catch { diagnostics.push({ level: "error", code: "private_menu_snapshot_error", message: "menu clickable snapshot failed" }); menuClickableTexts = []; break; }
            }
            const menuButtonTexts = menuClickableTexts.slice(0, 10);

            diagnostics.push({
              level: "info",
              code: "private_menu_snapshot_result",
              message: `buttons=${menuSnapshot.counts.buttons} links=${menuSnapshot.counts.links} cards=${menuSnapshot.counts.cards} headings=${menuSnapshot.counts.headings} clickables=${menuClickableTexts.length} samples=${menuButtonTexts.length} sampleTexts="${menuButtonTexts.join(" | ")}"`,
            });

              // Continue with module resolution using business context + menu
              diagnostics.push({
                level: "info",
                code: "private_hu_intent_context_check",
                message: `hasHuText=${Boolean(businessContext?.huText)} hasTitle=${Boolean(businessContext?.title)} hasText=${Boolean(businessContext?.text)} stepsCount=${Array.isArray(businessContext?.steps) ? businessContext.steps.length : 0} hasCase=${Boolean(businessContext?.case)} hasIssue=${Boolean(businessContext?.issue)} intent="${intent ?? "none"}"`,
              });
              const huIntentText2 = buildPrivateHuIntentText({
                request: businessContext,
                intent,
                menuSnapshot,
              });
              diagnostics.push({ level: "info", code: "private_hu_intent_source", message: `source=${huIntentText2.source} length=${huIntentText2.text.length} sample="${huIntentText2.sample}"` });
              if (huIntentText2.text && huIntentText2.text !== "none") {
                const huIntention2 = resolveHuIntent(huIntentText2.text);
                diagnostics.push({ level: "info", code: "private_hu_intent_resolved", message: `category=${huIntention2.category} confidence=${huIntention2.confidence} matched=${huIntention2.matchedTerms.join(",")} reason=${huIntention2.reason}` });
                const moduleCandidates2 = scoreModuleCandidates(huIntention2.category, menuButtonTexts.map((t: string) => ({ text: t })), diagnostics);
                diagnostics.push({ level: "info", code: "private_module_candidates_scored", message: `candidates=${moduleCandidates2.length} top="${moduleCandidates2[0]?.text ?? "none"}" score=${moduleCandidates2[0]?.score ?? 0}` });
                const topCandidate2 = moduleCandidates2.length > 0 ? moduleCandidates2[0] : null;
                const secondScore2 = moduleCandidates2[1]?.score ?? 0;
                const margin2 = topCandidate2 ? topCandidate2.score - secondScore2 : 0;
                const shouldSelect2 = topCandidate2 && (
                  topCandidate2.score >= 100 ||
                  (topCandidate2.score >= 80 && topCandidate2.reason === "specific_match" && margin2 >= 20)
                );
                diagnostics.push({ level: "info", code: "private_module_resolution_decision", message: `topScore=${topCandidate2?.score ?? 0} secondScore=${secondScore2} margin=${margin2} topReason=${topCandidate2?.reason ?? "none"} huConfidence=${huIntention2.confidence} selected=${shouldSelect2}` });
                if (shouldSelect2) {
                  diagnostics.push({ level: "info", code: "private_module_selected", message: `Selected module: "${topCandidate2.text}" (score=${topCandidate2.score})` });
                  const shortLabel = (topCandidate2.text.match(/^(.*?)(?:\s[——–-]\s|:\s|;\s|\n|\r|\.\s|,\s|\s{2,})/) || [])[1]?.trim() || topCandidate2.text.split(/\s+/).slice(0, 4).join(" ");
                  let btn = await page.locator(`button:has-text("${shortLabel}"), [role="button"]:has-text("${shortLabel}")`).first();
                  if (!(await btn.isVisible().catch(() => false))) {
                    const primaryWords = shortLabel.split(/\s+/).slice(0, 3).join(" ");
                    btn = await page.locator(`button:has-text("${primaryWords}"), [role="button"]:has-text("${primaryWords}")`).first();
                  }
                  diagnostics.push({ level: "info", code: "private_module_click_attempt", message: `strategy=primary_text textUsed="${shortLabel}"` });
                  let clickOk = false;
                  try { await btn.click({ timeout: 5000 }); clickOk = true; diagnostics.push({ level: "info", code: "private_module_click_executed", message: `clicked="${shortLabel}"` }); } catch { diagnostics.push({ level: "error", code: "private_module_click_failed", message: `could not click "${topCandidate2.text}"` }); }
                  if (clickOk) {

                    const menuUrlBefore2 = page.url();
                    const modWaitStart = Date.now();
                    let modLoaded = false;
                    let prevSnap2 = { url: page.url(), bodyTextPreview: "", counts: { buttons: 0, cards: 0, links: 0, headings: 0 } };
                    let modSnap2: any = null;
                    diagnostics.push({ level: "info", code: "private_module_wait_started", message: "Waiting for module screen to load" });
                    while (Date.now() - modWaitStart < 10000 && !modLoaded) {
                      await page.waitForTimeout(300);
                      modSnap2 = await capturePageSnapshot(page);
                      const urlChanged = modSnap2.url !== prevSnap2.url;
                      const contentChanged = modSnap2.bodyTextPreview !== prevSnap2.bodyTextPreview;
                      const buttonsChanged = modSnap2.counts.buttons !== prevSnap2.counts.buttons;
                      const cardsAppeared = modSnap2.counts.cards > 0;
                      modLoaded = urlChanged || contentChanged || buttonsChanged || cardsAppeared || modSnap2.counts.headings > 0 || modSnap2.counts.buttons + modSnap2.counts.links > prevSnap2.counts.buttons + prevSnap2.counts.links;
                      if (!modLoaded) prevSnap2 = modSnap2;
                    }
                    if (modLoaded) {
                      const rc = modSnap2.url !== menuUrlBefore2 ? "private_module_wait_resolved_by_url_change" : "private_module_wait_resolved_by_content_change";
                      diagnostics.push({ level: "info", code: rc, message: `Module screen loaded after ${Date.now() - modWaitStart}ms` });
                      const modSnap = await capturePageSnapshot(page);
                      diagnostics.push({ level: "info", code: "private_module_snapshot_result", message: `buttons=${modSnap.counts.buttons} cards=${modSnap.counts.cards} links=${modSnap.counts.links} headings=${modSnap.counts.headings}` });

                      const intOpts: string[] = [];
                      try {
                        const loc = page.locator('button, [role="button"], a, [tabindex], [onclick]');
                        const cnt = Math.min(await loc.count().catch(() => 0), 30);
                        const seen = new Set<string>();
                        for (let i = 0; i < cnt; i++) {
                          const el = loc.nth(i);
                          if (!(await el.isVisible().catch(() => false))) continue;
                          const txt = (await el.innerText().catch(() => "") || await el.textContent().catch(() => "") || await el.getAttribute("aria-label").catch(() => "") || "").replace(/\s+/g, " ").trim();
                          if (txt && !seen.has(txt)) { seen.add(txt); intOpts.push(txt); }
                        }
                      } catch { /* skip */ }
                      const dP = /confirmar|enviar|solicitar|pagar|transferir|aceptar|finalizar|procesar|guardar|eliminar/i;
                      const safe = intOpts.filter(t => !dP.test(t));
                      if (safe.length > 0) {
                        const ic = scoreModuleCandidates(huIntention2.category, safe.map(t => ({ text: t })), diagnostics);
                        diagnostics.push({ level: "info", code: "private_module_internal_candidates_scored", message: `top5: ${ic.slice(0, 5).map(c => `${c.text}(${c.score})`).join(" | ")}` });
                        const ti = ic[0];
                        if (ti && (ti.score >= 100 || (ti.score >= 80 && ti.reason === "specific_match"))) {
                          diagnostics.push({ level: "info", code: "private_module_internal_option_selected", message: `Selected: "${ti.text}" (score=${ti.score})` });
                          try {
                            const shortLabel = ti.text.split(/\n|\.\s|,|\s{2,}/)[0].trim();
                            let b = await page.locator(`button:has-text("${shortLabel}"), [role="button"]:has-text("${shortLabel}")`).first();
                            if (!(await b.isVisible().catch(() => false))) {
                              const pw = shortLabel.split(/\s+/).slice(0, 3).join(" ");
                              b = await page.locator(`button:has-text("${pw}"), [role="button"]:has-text("${pw}")`).first();
                            }
                            if (await b.isVisible().catch(() => false)) { await b.click(); await page.waitForTimeout(500); diagnostics.push({ level: "info", code: "private_module_internal_option_click_executed", message: `Clicked: "${shortLabel}"` }); const ds = await capturePageSnapshot(page); diagnostics.push({ level: "info", code: "private_module_detail_snapshot_result", message: `buttons=${ds.counts.buttons} cards=${ds.counts.cards} links=${ds.counts.links} headings=${ds.counts.headings}` }); }
                            else { diagnostics.push({ level: "warning", code: "private_module_internal_option_click_blocked", message: `Internal option not visible: "${shortLabel}"` }); }
                          } catch { diagnostics.push({ level: "warning", code: "private_module_internal_option_click_failed", message: `Could not click: "${ti.text}"` }); }
                        } else { diagnostics.push({ level: "warning", code: "private_module_internal_resolution_blocked", message: `reasonCode=no_clear_internal_candidate topScore=${ti?.score ?? 0}` }); }
                      } else { diagnostics.push({ level: "warning", code: "private_module_internal_resolution_blocked", message: "reasonCode=no_safe_internal_options" }); }
                    } else {
                      const timeoutUrl2 = page.url();
                      const timeoutBody2 = await page.evaluate(() => document.body?.innerText?.slice(0, 200) ?? "").catch(() => "");
                      diagnostics.push({ level: "warning", code: "private_module_wait_timeout", message: "Module screen did not load within 10s" });
                      diagnostics.push({ level: "info", code: "private_module_wait_timeout_snapshot", message: `url=${timeoutUrl2} buttons=${prevSnap2.counts.buttons} cards=${prevSnap2.counts.cards} links=${prevSnap2.counts.links} bodySample="${timeoutUrl2 !== menuUrlBefore2 ? timeoutBody2.slice(0, 200).replace(/\s+/g, " ").trim() : "unchanged"}"` });
                      if (timeoutUrl2 !== menuUrlBefore2) { diagnostics.push({ level: "warning", code: "private_module_wait_timeout_url_changed", message: "URL changed — continuing to snapshot" }); modLoaded = true; }
                    }
                  } else {
                    diagnostics.push({ level: "warning", code: "private_module_resolution_blocked", message: `reasonCode=no_clear_candidate topScore=${topCandidate2?.score ?? 0}` });
                  }
                } else {
                  diagnostics.push({ level: "warning", code: "private_module_resolution_blocked", message: `reasonCode=no_hu_intent_text` });
                }
            } else {
              if (loadingExtensionUsed && lastObservedLoading) {
                diagnostics.push({
                  level: "warning",
                  code: "private_post_auth_wait_timeout_loading_still_active",
                  message: `Post-auth loading remained active after extended wait url=${lastObservedUrl} buttons=${lastObservedButtons} catalog=${lastObservedCatalog}`,
                });
              } else {
                diagnostics.push({
                  level: "warning",
                  code: "private_post_auth_wait_timeout",
                  message: `Post-auth screen did not stabilize within ${maxWaitMs}ms (achieved ${stableCycles}/${requiredStableCycles} cycles)`,
                });
              }
            }
          }

        }
      }
      // Check if OTP screen appeared (calculate pattern once for later use)
      const hasOtpPattern = /otp|token|código|verificación|one-time|code|pin/i.test(postExecutionSnapshot.bodyTextPreview);

      // Only run OTP detection if not already detected via transient wait
      if (!finalOtpStageDetected) {
        // First probe for intermediate confirmation stage (e.g., phone verification before OTP entry)
        diagnostics.push({
          level: "info",
          code: "otp_intermediate_probe_started",
          message: "Probing for intermediate confirmation stage",
        });

        // Evaluate intermediate stage conditions
        const probeState = await page.evaluate(() => ({
          url: window.location.href,
          inputCount: document.querySelectorAll('input[type="text"], input:not([type]), [role=textbox]').length,
          buttonCount: document.querySelectorAll('button').length,
          digitButtonCount: document.querySelectorAll('button:has(*, :contains("0")), [role=button]:contains("0")').length,
          confirmDetected: /confirmar|enviar|validar|submit|verify|código|code/i.test(document.body.textContent || ""),
          hasPhonePattern: /teléfono|telefono|phone|número|number|confirmación|confirmar|verificar|verification|enviar|sending|código|code/i.test(document.body.textContent || ""),
          hasOtpInput: !!document.querySelector('input[name*="otp"], input[name*="code"], [placeholder*="código"], [placeholder*="OTP"]'),
          hasPrimaryButton: !!document.querySelector('button:not([class*="secondary"], [class*="cancel"], [class*="ghost"]), [role=button]:not([class*="secondary"])'),
          hasSecondaryButton: !!document.querySelector('button[class*="secondary"], button:contains("Cancelar"), button:contains("No reconozco")')
        })).catch(() => ({
          url: "error", inputCount: 0, buttonCount: 0, digitButtonCount: 0, confirmDetected: false,
          hasPhonePattern: false, hasOtpInput: false, hasPrimaryButton: false, hasSecondaryButton: false
        }));

        diagnostics.push({
          level: "info",
          code: "otp_intermediate_probe_state",
          message: `URL=${probeState.url.split('/').slice(-1)[0]} inputs=${probeState.inputCount} buttons=${probeState.buttonCount} digitButtons=${probeState.digitButtonCount} confirm=${probeState.confirmDetected} phonePattern=${probeState.hasPhonePattern} otpInput=${probeState.hasOtpInput} primaryBtn=${probeState.hasPrimaryButton} secondaryBtn=${probeState.hasSecondaryButton}`,
        });

        // Check if this is an intermediate confirmation stage (not final OTP entry)
        const isIntermediateStage = probeState.hasPhonePattern && !probeState.hasOtpInput &&
                                    probeState.digitButtonCount < 10 && probeState.hasPrimaryButton &&
                                    probeState.hasSecondaryButton;

        if (isIntermediateStage) {
          console.log(`[auth-discovery] intermediateStageDetected url=${probeState.url}`);
          diagnostics.push({
            level: "info",
            code: "otp_intermediate_stage_detected",
            message: `Intermediate confirmation stage detected. URL: ${probeState.url}`,
          });

          // Resolve and click primary action button
          const actionResult = await resolveOtpIntermediatePrimaryAction(page);

          if (actionResult.success && actionResult.buttonText) {
            diagnostics.push({
              level: "info",
              code: "otp_intermediate_primary_action_detected",
              message: `Primary confirmation button detected: "${actionResult.buttonText}"`,
            });

            diagnostics.push({
              level: "info",
              code: "otp_intermediate_primary_action_executed",
              message: `Clicked primary confirmation button. Waiting for OTP entry screen...`,
            });

            // Wait up to 5s for OTP entry screen
            diagnostics.push({
              level: "info",
              code: "otp_entry_wait_started",
              message: `Waiting for OTP entry screen (max 5s)`,
            });

            const entryWaitStart = Date.now();
            let otpEntryFound = false;

            while (Date.now() - entryWaitStart < 5000) {
              await page.waitForTimeout(300);

              const state = await page.evaluate(() => ({
                url: window.location.href,
                inputs: document.querySelectorAll('input[type="text"], input:not([type]), [role=textbox]').length,
                slots: document.querySelectorAll('[class*="slot"], [class*="otp"], [class*="code"], input[maxlength]').length,
                digitButtons: document.querySelectorAll('button:has(*, :contains("0")), [role=button]:contains("0")').length,
                confirmDetected: /confirmar|enviar|validar|submit|verify/i.test(document.body.textContent || "")
              })).catch(() => ({ url: "error", inputs: 0, slots: 0, digitButtons: 0, confirmDetected: false }));

              diagnostics.push({
                level: "info",
                code: "otp_entry_wait_observed_state",
                message: `Observed: digitButtons=${state.digitButtons} inputs=${state.inputs} slots=${state.slots} confirmDetected=${state.confirmDetected}`,
              });

              if (state.digitButtons === 10 || state.inputs > 0 || state.slots > 0) {
                otpEntryFound = true;
                diagnostics.push({
                  level: "info",
                  code: "otp_entry_wait_resolved",
                  message: `OTP entry screen detected. URL: ${state.url}`,
                });
                break;
              }
            }

            if (!otpEntryFound) {
              diagnostics.push({
                level: "warning",
                code: "otp_entry_wait_timeout",
                message: `OTP entry screen not detected within 5s after intermediate action`,
              });
            }
          } else {
            diagnostics.push({
              level: "warning",
              code: "otp_intermediate_primary_action_not_found",
              message: `Primary confirmation button not found or click failed`,
            });
          }
        } else {
          diagnostics.push({
            level: "info",
            code: "otp_intermediate_skipped",
            message: `No intermediate stage detected. Checking for final OTP screen. Reason: phonePattern=${probeState.hasPhonePattern} noOtpInput=${!probeState.hasOtpInput} digitButtonsLt10=${probeState.digitButtonCount < 10} primaryBtn=${probeState.hasPrimaryButton} secondaryBtn=${probeState.hasSecondaryButton}`,
          });
        }

        // Now check for final OTP stage (only if not intermediate)
        if (hasOtpPattern && (postExecutionSnapshot.counts.inputs > 0 || postExecutionSnapshot.counts.virtualKeyboardKeys > 0)) {
          console.log(`[auth-discovery] otpStageDetected=true`);
          diagnostics.push({
            level: "info",
            code: "otp_stage_detected",
            message: "OTP/verification stage detected. OTP input required.",
          });

          // Propose OTP step for next stage
          const otpStep = {
            action: "handleOtp" as const,
            strategy: "outflow" as const,
            valueSource: "env" as const,
            valueKey: "OTP_SECRET",
            confidence: "medium" as const,
            reason: "OTP stage detected after credential entry",
          };

          // Add OTP step to proposed profile
          proposedProfile.steps.push(otpStep as any);
        } else {
          console.log(`[auth-discovery] otpStageDetected=false`);
        }
      }

      // Determine execution status message based on actual progress
      const executionMessage = hasOtpPattern
        ? `Executed credential entry steps. Advanced to OTP stage.`
        : `Executed credential entry steps. Awaiting stage confirmation.`;

      diagnostics.push({
        level: "info",
        code: "proposed_step_executed",
        message: executionMessage,
      });
        }
    }

    return { proposedProfile, diagnostics };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    diagnostics.push({
      level: "error",
      code: "auth_discovery_error",
      message: `Auth discovery error: ${message}`,
    });
    console.log(`[auth-discovery] error: ${message}`);

    return {
      proposedProfile: {
        steps: [],
        confidence: "low",
        candidates: [],
      },
      diagnostics,
    };
  }
}

export type AuthenticatedPrivateDiscoveryRequest = {
  appSlug: string;
  issueKey?: string;
  intent?: string;
  suggestedRoute?: string;
  dryRun?: boolean;
  headed?: boolean;
  // Business context fields (optional, multi-project)
  huText?: string;
  title?: string;
  text?: string;
  description?: string;
  steps?: string[];
  case?: { title?: string; steps?: string[]; expectedResult?: string };
  issue?: { title?: string; description?: string };
};

export type ProposedAuthProfile = {
  steps: Array<{
    action: "fill" | "click" | "virtualKeyboardFill";
    field?: string;
    target?: string;
    envVar?: string;
    confidence: "high" | "medium" | "low";
    reason?: string;
  }>;
  successSignals?: string[];
  confidence: "high" | "medium" | "low";
  hasVirtualKeyboard?: boolean;
  candidates?: Array<{
    type: "input" | "button" | "virtual-keyboard-key";
    fieldType: "identity" | "password" | "otp" | "unknown";
    selectors: string[];
    label?: string;
    confidence: "high" | "medium" | "low";
  }>;
};

export type AuthenticatedPrivateDiscoveryResult = {
  ok: boolean;
  reasonCode?: string;
  appSlug: string;
  authProfileResolved: boolean;
  baseUrlResolved: boolean;
  authenticated: boolean;
  privateDiscoveryStarted: boolean;
  landingUrl?: string;
  matchedSuccessSignals: string[];
  discoveredRoutes: string[];
  discoveredControls: string[];
  discoveredAssertionTerms: string[];
  persisted: false; // Phase 2+: no persistence yet
  proposedAuthProfile?: ProposedAuthProfile; // Microfase 2.1: proposed steps when steps not found
  diagnostics: Array<{
    level: "error" | "warning" | "info";
    code: string;
    message: string;
  }>;
};

/**
 * Orchestrate authenticated private discovery for an app
 *
 * Phase 1: Infrastructure validation only (dryRun=true)
 * Phase 2: Real authentication (dryRun=false)
 */
/**
 * Resolve intent from HU text and categorize
 */
function resolveHuIntent(intentText: string | undefined): { category: string; matchedTerms: string[]; confidence: "high" | "medium" | "low"; reason: string } {
  const categoryDictionary: Record<string, RegExp> = {
    accounts: /cuenta|cuentas|cuenta efectivo|ahorro|corriente|depósito|balance|movimientos/i,
    cards: /tarjeta|tarjetas|crédito|débito|card/i,
    loans: /préstamo|préstamos|credito|financiamiento/i,
    certificates: /certificado|certificados|plazo|inversión/i,
    payments: /pago|pagos|factura|recarga/i,
    transfers: /transferencia|transferencias|enviar|beneficiario/i,
    services: /servicio|servicios|solicitud|reclamación/i
  };

  if (!intentText || intentText.trim().length === 0) {
    return { category: "unknown", matchedTerms: [], confidence: "low", reason: "empty_intent" };
  }

  const normalized = intentText.toLowerCase();
  const matches: { category: string; terms: string[] }[] = [];

  for (const [category, pattern] of Object.entries(categoryDictionary)) {
    const found = normalized.match(pattern);
    if (found) {
      matches.push({ category, terms: found });
    }
  }

  if (matches.length === 0) {
    return { category: "unknown", matchedTerms: [], confidence: "low", reason: "no_match" };
  }

  if (matches.length === 1) {
    return { category: matches[0].category, matchedTerms: matches[0].terms, confidence: "high", reason: "single_match" };
  }

  return { category: matches[0].category, matchedTerms: matches[0].terms, confidence: "medium", reason: "multiple_matches" };
}

/**
 * Score candidates from menu against HU intent
 */
function scoreModuleCandidates(
  intentCategory: string,
  candidates: Array<{ text: string; locator?: any }>,
  diagnostics: any[]
): Array<{ text: string; category: string; score: number; matchedTerms: string[]; reason: string }> {
  const categoryPatterns: Record<string, RegExp> = {
    accounts: /cuenta|cuentas|efectivo|ahorro|corriente|depósito|movimiento/i,
    cards: /tarjeta|tarjetas|crédito|débito|card/i,
    loans: /préstamo|préstamos|credito|financiamiento/i,
    certificates: /certificado|certificados|plazo|inversión/i,
    payments: /pago|pagos|factura|recarga/i,
    transfers: /transferencia|transferencias|enviar|beneficiario/i,
    services: /servicio|servicios|solicitud|reclamación/i
  };

  const intentSpecificTerms: Record<string, { boost: RegExp; penalty: RegExp }> = {
    accounts: {
      boost: /balance|saldo|saldos|consulta\s+de\s+balance|ver\s+saldo/i,
      penalty: /estado\s+de\s+cuenta|movimientos|certificación|certificado|pago\s+de/i,
    },
  };

  const scored = candidates.map(c => {
    const text = c.text.toLowerCase();
    let bestMatch = { category: "unknown", score: 0, terms: [] as string[] };

    // First pass: match against category patterns
    for (const [cat, pattern] of Object.entries(categoryPatterns)) {
      const found = text.match(pattern);
      let score = found ? (intentCategory === cat ? 100 : 30) : 0;
      if (score > 0 && intentCategory === cat) {
        const specific = intentSpecificTerms[cat];
        if (specific) {
          const boost = text.match(specific.boost);
          if (boost) { score += 50; bestMatch.terms = [...bestMatch.terms, ...boost.map(b => b)]; }
          const penalty = text.match(specific.penalty);
          if (penalty) { score -= 40; }
        }
      }
      if (score > bestMatch.score) {
        bestMatch = { category: cat, score, terms: found || [] };
      }
    }

    // Second pass: evaluate specific intent terms independently of category match
    const specific = intentSpecificTerms[intentCategory];
    if (specific && bestMatch.score === 0) {
      const boost = text.match(specific.boost);
      if (boost) {
        bestMatch = {
          category: intentCategory,
          score: 80 + boost.length * 10,
          terms: boost,
        };
      }
      const penalty = text.match(specific.penalty);
      if (penalty && bestMatch.score > 0) { bestMatch.score -= 40; }
    }

    return {
      text: c.text,
      category: bestMatch.category,
      score: bestMatch.score,
      matchedTerms: bestMatch.terms,
      reason: bestMatch.score >= 100 ? "exact_category" : bestMatch.score >= 80 ? "specific_match" : bestMatch.score > 0 ? "partial_match" : "no_match"
    };
  });

  scored.forEach(s => {
    diagnostics.push({
      level: "info",
      code: "private_module_candidate_score_detail",
      message: `text="${s.text.slice(0, 80)}" category=${s.category} score=${s.score} terms=${s.matchedTerms.join(",") || "none"} reason=${s.reason}`,
    });
  });

  return scored.sort((a, b) => b.score - a.score);
}

export async function discoverPrivateCatalogAuthenticated(
  request: AuthenticatedPrivateDiscoveryRequest
): Promise<AuthenticatedPrivateDiscoveryResult> {
  const { appSlug, issueKey, intent, suggestedRoute, dryRun = true, headed = false, huText, title, text, description, steps, case: caseData, issue } = request;

  const diagnostics: AuthenticatedPrivateDiscoveryResult["diagnostics"] = [];

  // Log business context input (multi-project, no hardcoded terms)
  diagnostics.push({
    level: "info",
    code: "private_discovery_business_context_input",
    message: `hasHuText=${Boolean(huText)} hasTitle=${Boolean(title)} hasText=${Boolean(text)} hasDescription=${Boolean(description)} stepsCount=${steps?.length ?? 0} hasCase=${Boolean(caseData)} hasIssue=${Boolean(issue)} intent="${intent ?? "none"}"`,
  });

  console.log(
    `[private-discovery] requested appSlug=${appSlug} issueKey=${issueKey ?? "none"} intent=${intent ?? "none"} dryRun=${dryRun}`
  );

  // Load app config
  const appConfig = loadAppConfigSync(appSlug);

  // Validate baseUrl
  const configBaseUrl = appConfig?.baseUrl as string | undefined;
  const baseUrl = configBaseUrl || process.env.APP_BASE_URL;
  const baseUrlResolved = Boolean(baseUrl && baseUrl.trim().length > 0);

  if (!baseUrlResolved) {
    diagnostics.push({
      level: "error",
      code: "missing_base_url",
      message: `baseUrl not found in app.config or APP_BASE_URL environment variable for appSlug=${appSlug}`,
    });
    console.log(
      `[private-discovery] authProfileResolved=false baseUrlResolved=${baseUrlResolved}`
    );
    return {
      ok: false,
      reasonCode: "missing_base_url",
      appSlug,
      authProfileResolved: false,
      baseUrlResolved,
      authenticated: false,
      privateDiscoveryStarted: false,
      matchedSuccessSignals: [],
      discoveredRoutes: [],
      discoveredControls: [],
      discoveredAssertionTerms: [],
      persisted: false,
      diagnostics,
    };
  }

  // Validate authProfile
  const authProfileResolved = Boolean(
    appConfig?.authProfile && Object.keys(appConfig.authProfile).length > 0
  );

  if (!authProfileResolved) {
    diagnostics.push({
      level: "error",
      code: "missing_auth_profile",
      message: `authProfile not found or empty in app.config for appSlug=${appSlug}. Private discovery requires authentication configuration.`,
    });
    console.log(
      `[private-discovery] authProfileResolved=${authProfileResolved} baseUrlResolved=${baseUrlResolved}`
    );
    return {
      ok: false,
      reasonCode: "missing_auth_profile",
      appSlug,
      authProfileResolved,
      baseUrlResolved,
      authenticated: false,
      privateDiscoveryStarted: false,
      matchedSuccessSignals: [],
      discoveredRoutes: [],
      discoveredControls: [],
      discoveredAssertionTerms: [],
      persisted: false,
      diagnostics,
    };
  }

  // Phase 1: Infrastructure validation complete
  if (dryRun) {
    console.log(
      `[private-discovery] authProfileResolved=${authProfileResolved} baseUrlResolved=${baseUrlResolved}`
    );
    console.log(
      `[private-discovery] status=ready_for_authenticated_navigation dryRun=${dryRun}`
    );

    return {
      ok: true,
      appSlug,
      authProfileResolved,
      baseUrlResolved,
      authenticated: false,
      privateDiscoveryStarted: false,
      matchedSuccessSignals: [],
      discoveredRoutes: [],
      discoveredControls: [],
      discoveredAssertionTerms: [],
      persisted: false,
      diagnostics: [
        {
          level: "info",
          code: "ready_for_authenticated_navigation",
          message: `Phase 1 infrastructure validation complete. Ready for authenticated private catalog discovery (phase 2+).`,
        },
      ],
    };
  }

  // Phase 2: Real authentication
  console.log(
    `[private-discovery] authProfileResolved=${authProfileResolved} baseUrlResolved=${baseUrlResolved}`
  );
  console.log(`[private-discovery] authFlowStarted=true`);

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    // Launch browser
    browser = await chromium.launch({ headless: !headed });
    context = await browser.newContext();
    page = await context.newPage();

    // Navigate to base URL
    console.log(`[private-discovery] navigating to baseUrl=${baseUrl}`);
    await page.goto(baseUrl!, { waitUntil: "networkidle" });

    // Extract authentication steps from authProfile with tolerant property names
    const authProfile = appConfig?.authProfile as Record<string, unknown> | undefined;
    const authSteps = extractAuthSteps(authProfile);
    const successSignals = extractSuccessSignals(authProfile);

    console.log(
      `[private-discovery] authStepsResolved=${authSteps.length} successSignalsResolved=${successSignals.length}`
    );

    if (authSteps.length === 0) {
      // Microfase 2.1: Try to discover auth steps from login page
      console.log(`[private-discovery] authSteps not found, attempting discovery learning`);

      const { proposedProfile, diagnostics: discoveryDiagnostics } = await discoverAuthProfileSteps(
        page,
        appSlug,
        baseUrl!,
        appConfig || undefined,
        suggestedRoute,
        request.intent,
        request
      );

      diagnostics.push(...discoveryDiagnostics);

      // Check if we have viable proposed steps
      if (proposedProfile.steps.length === 0) {
        diagnostics.push({
          level: "error",
          code: "auth_profile_steps_not_discoverable",
          message: `authProfile.steps not found and could not discover viable steps from login page. Configure authProfile.steps manually or ensure login page is accessible.`,
        });
        console.log(`[private-discovery] authenticated=false status=auth_discovery_failed`);

        return {
          ok: false,
          reasonCode: "auth_profile_steps_not_discoverable",
          appSlug,
          authProfileResolved,
          baseUrlResolved,
          authenticated: false,
          privateDiscoveryStarted: true,
          landingUrl: page.url(),
          matchedSuccessSignals: [],
          discoveredRoutes: [],
          discoveredControls: [],
          discoveredAssertionTerms: [],
          persisted: false,
          proposedAuthProfile: proposedProfile,
          diagnostics,
        };
      }

      // Return proposed auth profile for manual confirmation
      console.log(
        `[private-discovery] authSteps discovered proposedSteps=${proposedProfile.steps.length} confidence=${proposedProfile.confidence}`
      );

      return {
        ok: false,
        reasonCode: "auth_profile_steps_discovery_required",
        appSlug,
        authProfileResolved,
        baseUrlResolved,
        authenticated: false,
        privateDiscoveryStarted: true,
        landingUrl: page.url(),
        matchedSuccessSignals: [],
        discoveredRoutes: [],
        discoveredControls: [],
        discoveredAssertionTerms: [],
        persisted: false,
        proposedAuthProfile: proposedProfile,
        diagnostics,
      };
    }

    // Execute each auth step
    for (const step of authSteps) {
      const action = step.action as string | undefined;
      const target = step.target as string | undefined;
      const field = step.field as string | undefined;
      const fieldName = field || target;
      const envVar = step.envVar as string | undefined;

      try {
        if (action === "virtualKeyboardFill" && envVar) {
          const gateResult = await detectAndResolvePreCredentialGate(page);
          if (gateResult.detected) {
            diagnostics.push({
              level: gateResult.accepted ? "info" : "warning",
              code: gateResult.accepted ? "pre_credential_gate_accepted" : "pre_credential_gate_skipped",
              message: `Pre-credential gate ${gateResult.accepted ? "accepted" : "skipped"}: "${gateResult.target}"`,
            });
          }

          const fieldResult = await detectCredentialInputField(page);
          if (fieldResult.found && fieldResult.confidence !== "low") {
            await page.locator("input[type=text], input:not([type]), textarea, [role=textbox], [contenteditable]").first().click({ timeout: 3000 }).catch(() => undefined);
          }

          const beforeSnapshot = await capturePageSnapshot(page);
          const fillResult = await executeVirtualKeyboardFill(page, envVar);
          diagnostics.push({
            level: fillResult.success ? "info" : "warning",
            code: fillResult.success ? "virtual_keyboard_fill_executed" : "virtual_keyboard_fill_failed",
            message: fillResult.reason,
          });

          if (fillResult.success) {
            const continueResult = await executeCredentialContinue(page, beforeSnapshot);
            if (continueResult.success) {
              diagnostics.push({
                level: "info",
                code: "credential_continue_executed",
                message: continueResult.reason,
              });
              await page.waitForLoadState("networkidle").catch(() => undefined);
              await page.waitForTimeout(5000);
            }
          }
        } else if (action === "fill" && fieldName) {
          const value = resolveValue(envVar);
          if (!value) {
            diagnostics.push({
              level: "warning",
              code: "auth_step_skipped",
              message: `Auth step skipped: fill field="${fieldName}" envVar="${envVar}" not resolved`,
            });
            continue;
          }

          // Find element by data attribute, aria-label, placeholder, or other selector
          const selector = `[data-testid="${fieldName}"], [name="${fieldName}"], [aria-label*="${fieldName}"], input[placeholder*="${fieldName}"]`;
          const element = await page.$(selector);
          if (element) {
            const beforeSnapshot = await capturePageSnapshot(page);
            await element.fill(value);
            const continueResult = await executeCredentialContinue(page, beforeSnapshot);
            if (continueResult.success) {
              diagnostics.push({
                level: "info",
                code: "credential_continue_executed",
                message: continueResult.reason,
              });
              await page.waitForLoadState("networkidle").catch(() => undefined);
            }
          } else {
            const intermediateSnapshot = await capturePageSnapshot(page);
            const intermediateContinue = await executeCredentialContinue(page, intermediateSnapshot);
            if (intermediateContinue.success) {
              diagnostics.push({
                level: "info",
                code: "intermediate_continue_executed",
                message: intermediateContinue.reason,
              });
              await page.waitForLoadState("networkidle").catch(() => undefined);
              await page.waitForTimeout(3000);
            }

            const retryElement = await page.$(selector);
            if (retryElement) {
              const beforeSnapshot = await capturePageSnapshot(page);
              await retryElement.fill(value);
              const continueResult = await executeCredentialContinue(page, beforeSnapshot);
              if (continueResult.success) {
                diagnostics.push({
                  level: "info",
                  code: "credential_continue_executed",
                  message: continueResult.reason,
                });
                await page.waitForLoadState("networkidle").catch(() => undefined);
                await page.waitForTimeout(5000);
              }
              continue;
            }

            if (envVar) {
              const fillResult = await executeVirtualKeyboardFill(page, envVar);
              if (fillResult.success) {
                diagnostics.push({
                  level: "info",
                  code: "virtual_keyboard_fill_executed",
                  message: fillResult.reason,
                });
                const beforeSnapshot = await capturePageSnapshot(page);
                const continueResult = await executeCredentialContinue(page, beforeSnapshot);
                if (continueResult.success) {
                  diagnostics.push({
                    level: "info",
                    code: "credential_continue_executed",
                    message: continueResult.reason,
                  });
                  await page.waitForLoadState("networkidle").catch(() => undefined);
                  await page.waitForTimeout(5000);
                } else {
                  const otpSnapshot = await capturePageSnapshot(page);
                  diagnostics.push({
                    level: "warning",
                    code: "otp_continue_not_found",
                    message: `OTP filled but continue action did not complete reason="${continueResult.reason}" url=${otpSnapshot.url} bodyText="${otpSnapshot.bodyTextPreview.slice(0, 180)}" buttons=${otpSnapshot.counts.buttons} inputs=${otpSnapshot.counts.inputs} vkKeys=${otpSnapshot.counts.virtualKeyboardKeys} clickables="${otpSnapshot.clickablesSample.map((c: any) => `${c.tag}:${c.text || c.ariaLabel || c.title || c.dataKey || c.dataValue || ""}:${c.className || ""}`).slice(0, 20).join(" | ")}"`,
                  });
                }
                continue;
              }
            }
            diagnostics.push({
              level: "warning",
              code: "auth_field_not_found",
              message: `Auth field not found: field="${fieldName}" selector="${selector}"`,
            });
          }
        } else if (action === "click" && target) {
          const clickCandidates = [
            page.getByRole("button", { name: target }).first(),
            page.getByRole("link", { name: target }).first(),
            page.getByText(target, { exact: false }).first(),
            page.locator(`[data-testid="${target}"], [aria-label="${target}"]`).first(),
          ];
          let clicked = false;
          for (const candidate of clickCandidates) {
            if (!(await candidate.isVisible({ timeout: 1500 }).catch(() => false))) continue;
            await candidate.click();
            await page.waitForLoadState("networkidle").catch(() => undefined);
            await page.waitForTimeout(800);
            clicked = true;
            break;
          }
          if (!clicked) {
            const snapshot = await capturePageSnapshot(page);
            const buttonSamples = ((snapshot as any).buttonTexts || (snapshot.clickablesSample || [])
              .filter((e: any) => e?.tag === "button" && e?.text)
              .map((e: any) => e.text))
              .slice(0, 8)
              .join(" | ");
            const elementSamples = (snapshot.clickablesSample || [])
              .filter((e: any) => e?.text)
              .map((e: any) => `${e.tag}:${e.text}`)
              .slice(0, 8)
              .join(" | ");
            diagnostics.push({
              level: "warning",
              code: "auth_click_target_not_found",
              message: `Auth click target not found or not visible: target="${target}" url=${snapshot.url} buttons="${buttonSamples}" elements="${elementSamples}"`,
            });
          }
        }
      } catch (err) {
        diagnostics.push({
          level: "warning",
          code: "auth_step_error",
          message: `Auth step error: action="${action}" target="${target}" error=${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }

    // Give late-rendering auth screens a bounded chance to expose useful DOM.
    const authWaitStart = Date.now();
    let finalAuthSnapshot = await capturePageSnapshot(page);
    while (
      Date.now() - authWaitStart < 8000 &&
      finalAuthSnapshot.bodyTextPreview.length === 0 &&
      finalAuthSnapshot.counts.buttons === 0 &&
      finalAuthSnapshot.counts.inputs === 0 &&
      finalAuthSnapshot.counts.iframes === 0
    ) {
      await page.waitForTimeout(500);
      finalAuthSnapshot = await capturePageSnapshot(page);
    }

    // Check success signals
    const matchedSuccessSignals: string[] = [];

    if (successSignals && successSignals.length > 0) {
      const pageText = await page.content();
      for (const signal of successSignals) {
        if (pageText.includes(signal)) {
          matchedSuccessSignals.push(signal);
        }
      }
    }

    const authenticated = matchedSuccessSignals.length > 0;
    const landingUrl = page.url();
    let authFailureReasonCode = "authenticated_landing_not_reached";

    console.log(
      `[private-discovery] authenticated=${authenticated} matchedSignals=${matchedSuccessSignals.length}`
    );
    console.log(
      `[private-discovery] status=${authenticated ? "authenticated_landing_reached" : "authentication_failed"}`
    );

    if (!authenticated) {
      const domDiagnostics = await page.evaluate(() => {
        const active = document.activeElement;
        const shadowHosts = Array.from(document.querySelectorAll("*")).filter((el: any) => Boolean(el.shadowRoot)).length;
        const visibleControls = Array.from(document.querySelectorAll("button, a, input, textarea, [role='button'], [role='textbox']"))
          .filter((el: any) => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
          })
          .slice(0, 10)
          .map((el: any) => `${el.tagName.toLowerCase()}:${(el.innerText || el.value || el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 40)}`);
        return {
          readyState: document.readyState,
          bodyTextLength: document.body?.innerText?.length ?? 0,
          bodyTextSample: (document.body?.innerText || "").replace(/\s+/g, " ").trim().slice(0, 900),
          buttonCount: document.querySelectorAll("button").length,
          inputCount: document.querySelectorAll("input, textarea, [role='textbox']").length,
          iframeCount: document.querySelectorAll("iframe").length,
          shadowHostCount: shadowHosts,
          activeElement: active ? `${active.tagName.toLowerCase()}:${((active as any).innerText || (active as any).value || active.getAttribute("aria-label") || "").trim().slice(0, 40)}` : "none",
          visibleControls,
        };
      }).catch(() => null);

      const otpConfirmAttempted = diagnostics.some((diag) => diag.code === "credential_continue_executed" && /confirmar c[oó]digo/i.test(diag.message));

      if (/phone-confirmation/i.test(landingUrl) && domDiagnostics && domDiagnostics.bodyTextLength === 0 && domDiagnostics.buttonCount === 0 && domDiagnostics.inputCount === 0 && domDiagnostics.iframeCount === 0) {
        authFailureReasonCode = "phone_confirmation_empty_dom";
      } else if (/otp-entry/i.test(landingUrl) && otpConfirmAttempted) {
        authFailureReasonCode = "otp_invalid_or_rejected";
      } else if (/otp|token|c[oó]digo|pin/i.test(finalAuthSnapshot.bodyTextPreview) && finalAuthSnapshot.counts.inputs === 0 && finalAuthSnapshot.counts.virtualKeyboardKeys === 0) {
        authFailureReasonCode = "otp_input_not_found";
      }

      diagnostics.push({
        level: "error",
        code: authFailureReasonCode,
        message: `Authentication did not reach private landing. url=${landingUrl} readyState=${domDiagnostics?.readyState ?? "unknown"} bodyTextLength=${domDiagnostics?.bodyTextLength ?? "unknown"} bodyTextSample="${domDiagnostics?.bodyTextSample ?? ""}" buttons=${domDiagnostics?.buttonCount ?? "unknown"} inputs=${domDiagnostics?.inputCount ?? "unknown"} iframes=${domDiagnostics?.iframeCount ?? "unknown"} shadowHosts=${domDiagnostics?.shadowHostCount ?? "unknown"} activeElement="${domDiagnostics?.activeElement ?? "unknown"}" visibleControls="${domDiagnostics?.visibleControls?.join(" | ") ?? ""}" expectedSignals="${successSignals?.join(", ") ?? "none"}"`,
      });
    } else {
      diagnostics.push({
        level: "info",
        code: "authenticated",
        message: `Successfully authenticated. Matched signals: ${matchedSuccessSignals.join(", ")}`,
      });
    }

    return {
      ok: authenticated,
      reasonCode: authenticated ? undefined : authFailureReasonCode,
      appSlug,
      authProfileResolved,
      baseUrlResolved,
      authenticated,
      privateDiscoveryStarted: true,
      landingUrl,
      matchedSuccessSignals,
      discoveredRoutes: [],
      discoveredControls: [],
      discoveredAssertionTerms: [],
      persisted: false,
      diagnostics,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const reasonCode = /ERR_CONNECTION_TIMED_OUT|Timeout.*page\.goto|page\.goto.*Timeout/i.test(message)
      ? "base_url_navigation_timeout"
      : /ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|ERR_ADDRESS_UNREACHABLE|ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED/i.test(message)
        ? "base_url_unreachable"
        : "authentication_error";
    diagnostics.push({
      level: "error",
      code: reasonCode,
      message: `Authentication error: ${message}`,
    });
    console.log(`[private-discovery] authenticated=false status=authentication_failed reasonCode=${reasonCode}`);

    return {
      ok: false,
      reasonCode,
      appSlug,
      authProfileResolved,
      baseUrlResolved,
      authenticated: false,
      privateDiscoveryStarted: true,
      landingUrl: page?.url(),
      matchedSuccessSignals: [],
      discoveredRoutes: [],
      discoveredControls: [],
      discoveredAssertionTerms: [],
      persisted: false,
      diagnostics,
    };
  } finally {
    // Close browser and context
    if (context) await context.close();
    if (browser) await browser.close();
  }
}

/**
 * Log discovery result
 */
export function logPrivateDiscoveryResult(result: AuthenticatedPrivateDiscoveryResult): void {
  console.log(
    `[private-discovery] appSlug=${result.appSlug} ok=${result.ok} ` +
    `authProfileResolved=${result.authProfileResolved} baseUrlResolved=${result.baseUrlResolved} ` +
    `authenticated=${result.authenticated} privateDiscoveryStarted=${result.privateDiscoveryStarted} ` +
    `landingUrl=${result.landingUrl ?? "none"} matchedSuccessSignals=${result.matchedSuccessSignals.length} ` +
    `discoveredRoutes=${result.discoveredRoutes.length} discoveredControls=${result.discoveredControls.length} ` +
    `discoveredAssertionTerms=${result.discoveredAssertionTerms.length} persisted=${result.persisted}`
  );

  for (const diag of result.diagnostics) {
    if (diag.level === "error") {
      console.log(
        `[private-discovery] error appSlug=${result.appSlug} code=${diag.code} message=${diag.message}`
      );
    }
  }
}
