import type { Page } from "@playwright/test";
import { buildCandidateLocators } from "./locator-candidate-builder";
import { extractDataHintsFromElementText } from "./data-hint-extractor";
import { sanitizeSnapshotText } from "./snapshot-sanitizer";
import type { PageSnapshot, SnapshotElement, SnapshotElementType } from "../types/page-snapshot.types";
import { createHash } from "node:crypto";
import { buildRuntimeControlIdentity } from "../types/control-identity";
import { classifyActionability, isFrameworkActionOwner, type ActionabilityKind } from "../recording/actionability-contract";
import { normalizeStructuralOwnerIdentity, type StructuralOwnerIdentityInput } from "../recording/structural-owner-identity";

type RawDomElement = {
  id: string;
  text?: string;
  label?: string;
  placeholder?: string;
  name?: string;
  role?: string;
  tagName?: string;
  inputType?: string;
  required?: boolean;
  disabled?: boolean;
  visible: boolean;
  nearbyText?: string;
  elementType: SnapshotElementType;
  testId?: string;
  domId?: string;
  href?: string;
  ariaLabel?: string;
  ariaControls?: string;
  controlName?: string;
  title?: string;
  alt?: string;
  className?: string;
  actionability?: ActionabilityKind;
  tabIndex?: number;
  cursor?: string;
  pointerEvents?: string;
  actionOwner?: boolean;
  structuralOwnerIdentityInput?: StructuralOwnerIdentityInput;
};

const MAX_ELEMENTS = 300;

export function buildStructuralFingerprint(elements: SnapshotElement[]): string {
  const canonical = elements.map((element) => [
    element.type,
    element.role ?? "",
    element.tagName ?? "",
    element.inputType ?? "",
    element.required === true,
    element.disabled === true,
  ].join("|")).sort().join(";");
  return createHash("sha256").update(canonical).digest("hex");
}

export function buildTechnicalScreenKey(url: string, structuralFingerprint?: string): string | undefined {
  if (!structuralFingerprint) return undefined;
  try {
    const parsed = new URL(url);
    return createHash("sha256")
      .update(`${parsed.origin}\n${parsed.pathname}\n${structuralFingerprint}`)
      .digest("hex")
      .slice(0, 16);
  } catch {
    return undefined;
  }
}

function getSummary(elements: SnapshotElement[]): PageSnapshot["summary"] {
  return {
    totalElements: elements.length,
    buttons: elements.filter((item) => item.type === "button").length,
    links: elements.filter((item) => item.type === "link").length,
    inputs: elements.filter((item) => item.type === "input" || item.type === "textarea" || item.type === "checkbox" || item.type === "radio").length,
    selects: elements.filter((item) => item.type === "select").length,
    tables: elements.filter((item) => item.type === "table").length,
    dialogs: elements.filter((item) => item.type === "dialog").length,
    headings: elements.filter((item) => item.type === "heading").length
  };
}

export async function scanCurrentPage(page: Page): Promise<PageSnapshot> {
  const rawElements = await page.evaluate(({ maxElements, actionabilityContract, actionOwnerContract }) => {
    const classifyActionability = new Function(`return ${actionabilityContract}`)() as (signals: {
      tagName?: string;
      role?: string;
      onclick?: boolean;
      tabIndex?: number;
      cursor?: string;
      pointerEvents?: string;
      trustedInteraction?: boolean;
      stableTechnicalIdentity?: boolean;
      structuredClickableAncestor?: boolean;
    }) => ActionabilityKind;
    const isFrameworkActionOwner = new Function(`return ${actionOwnerContract}`)() as (signals: {
      actionability?: ActionabilityKind;
      ancestorFrameworkActionable?: boolean;
      explicitPointerCursor?: boolean;
    }) => boolean;
    const selectors = [
      "button",
      "a[href]",
      "input",
      "textarea",
      "select",
      "table",
      "dialog",
      "[role='dialog']",
      "[role='alertdialog']",
      "h1,h2,h3,h4,h5,h6",
      "img[alt]",
      "section",
      "article",
      "[role='button']",
      "[role='link']",
      "[role='textbox']",
      "p",
      "span"
    ];

    const nodes = Array.from(new Set([
      ...Array.from(document.querySelectorAll(selectors.join(","))),
      ...Array.from(document.querySelectorAll("*")),
    ]));
    const items: Array<RawDomElement & { score: number }> = [];

    for (let i = 0; i < nodes.length; i += 1) {
      const el = nodes[i] as HTMLElement;
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      if (style.visibility === "hidden" || style.display === "none" || rect.width <= 0 || rect.height <= 0) {
        continue;
      }

      const tagName = el.tagName.toLowerCase();
      const role = (el.getAttribute("role") || "").toLowerCase() || undefined;
      const inputType = (el as HTMLInputElement).type?.toLowerCase();

      let type: SnapshotElementType = "text";
      if (tagName === "button" || role === "button") {
        type = "button";
      } else if (tagName === "a" || role === "link") {
        type = "link";
      } else if (tagName === "textarea") {
        type = "textarea";
      } else if (tagName === "select") {
        type = "select";
      } else if (tagName === "table") {
        type = "table";
      } else if (tagName === "dialog" || role === "dialog" || role === "alertdialog") {
        type = "dialog";
      } else if (/^h[1-6]$/.test(tagName)) {
        type = "heading";
      } else if (tagName === "img") {
        type = "image";
      } else if (tagName === "section") {
        type = "section";
      } else if (tagName === "article") {
        type = "card";
      } else if (tagName === "input") {
        if (inputType === "checkbox") {
          type = "checkbox";
        } else if (inputType === "radio") {
          type = "radio";
        } else {
          type = "input";
        }
      } else if (role === "textbox") {
        type = "input";
      }

      const text = (el.textContent || "").replace(/\s+/g, " ").trim() || undefined;
      const placeholder = (el as HTMLInputElement).placeholder || undefined;
      const name = el.getAttribute("aria-label") || el.getAttribute("name") || undefined;
      const idAttr = el.getAttribute("id");
      let label: string | undefined;
      if (idAttr) {
        const labelByFor = document.querySelector(`label[for="${idAttr}"]`);
        label = labelByFor?.textContent?.trim() || undefined;
      }
      if (!label) {
        label = el.closest("label")?.textContent?.trim() || undefined;
      }
      const domId = el.getAttribute("id") || undefined;
      const inputTypeRaw = (el as HTMLInputElement).type || undefined;
      const required = (el as HTMLInputElement).required || undefined;
      const disabled = (el as HTMLInputElement).disabled || undefined;
      const nearbyText = el.parentElement?.textContent?.replace(/\s+/g, " ").trim().slice(0, 200) || undefined;
      const testId = el.getAttribute("data-testid") || el.getAttribute("data-test") || undefined;
      const href = (el as HTMLAnchorElement).href || undefined;
      const ariaLabel = el.getAttribute("aria-label") || undefined;
      const ariaControls = el.getAttribute("aria-controls") || undefined;
      const controlName = el.getAttribute("name") || undefined;
      const titleAttr = el.getAttribute("title") || undefined;
      const altAttr = (el as HTMLImageElement).alt || undefined;
      const className = el.getAttribute("class") || undefined;
      const tabIndex = el.tabIndex >= 0 ? el.tabIndex : undefined;
      const stableTechnicalIdentity = Boolean(
        el.getAttribute("data-testid") || el.getAttribute("data-test-id") || el.getAttribute("data-qa")
        || el.getAttribute("id") || el.getAttribute("name") || el.getAttribute("href") || el.getAttribute("aria-label"),
      );
      let structuredClickableAncestor = false;
      let ancestorFrameworkActionable = false;
      let ancestor = el.parentElement;
      let ancestorDepth = 0;
      while (ancestor && ancestorDepth < 8) {
        const ancestorStyle = window.getComputedStyle(ancestor);
        if (ancestorStyle.cursor === "pointer" && ancestorStyle.pointerEvents !== "none") {
          structuredClickableAncestor = true;
          ancestorFrameworkActionable = true;
          break;
        }
        ancestor = ancestor.parentElement;
        ancestorDepth += 1;
      }
      const actionability = classifyActionability({
        tagName,
        role,
        onclick: typeof (el as HTMLElement).onclick === "function" || el.hasAttribute("onclick"),
        tabIndex,
        cursor: style.cursor,
        pointerEvents: style.pointerEvents,
        stableTechnicalIdentity,
        structuredClickableAncestor,
      });
      const actionOwner = actionability === "FRAMEWORK_ACTIONABLE"
        ? isFrameworkActionOwner({
            actionability,
            ancestorFrameworkActionable,
            explicitPointerCursor: el.style.cursor.trim().toLowerCase() === "pointer",
          })
        : actionability !== "NON_ACTIONABLE";
      const knownElement = selectors.some((selector) => el.matches(selector));
      if ((!knownElement && actionability === "NON_ACTIONABLE")
        || (actionability === "FRAMEWORK_ACTIONABLE" && !actionOwner)) continue;

      const score =
        type === "button" ||
        type === "link" ||
        type === "input" ||
        type === "textarea" ||
        type === "select" ||
        type === "checkbox" ||
        type === "radio" || actionability === "FRAMEWORK_ACTIONABLE"
          ? 2
          : 1;

      items.push({
        id: `el-${i + 1}`,
        elementType: type,
        text,
        label,
        placeholder,
        name,
        role,
        tagName,
        inputType: inputTypeRaw,
        required,
        disabled,
        visible: true,
        nearbyText,
        testId,
        domId,
        href,
        ariaLabel,
        ariaControls,
        controlName,
        title: titleAttr,
        alt: altAttr,
        className,
        actionability,
        tabIndex,
        cursor: style.cursor,
        pointerEvents: style.pointerEvents,
        actionOwner,
        structuralOwnerIdentityInput: {
          ownerTag: tagName,
          ownerRole: role,
          stableDirectAttributes: Object.fromEntries(
            ['id', 'data-testid', 'data-test-id', 'name', 'href', 'aria-label', 'aria-labelledby', 'role', 'data-field', 'data-column', 'alt', 'src']
              .map((name) => [name, el.getAttribute(name)]).filter((entry) => entry[1]),
          ),
          stableDescendants: Array.from(el.querySelectorAll('*')).map((node) => ({
            relation: 'descendant' as const,
            tag: node.tagName.toLowerCase(),
            role: node.getAttribute('role') || undefined,
            stableAttributes: Object.fromEntries(
              ['id', 'data-testid', 'data-test-id', 'name', 'href', 'aria-label', 'aria-labelledby', 'role', 'data-field', 'data-column', 'alt', 'src']
                .map((name) => [name, node.getAttribute(name)]).filter((entry) => entry[1]),
            ),
          })).filter((node) => Object.keys(node.stableAttributes).length > 0).slice(0, 32),
          semanticShape: Array.from(el.children).map((node) => {
            const childTag = node.tagName.toLowerCase();
            const childRole = node.getAttribute('role');
            return childRole ? `${childTag}:${childRole}` : childTag;
          }),
        },
        score
      });
    }

    items.sort((a, b) => b.score - a.score);
    return items.slice(0, maxElements).map(({ score: _score, ...rest }) => rest);
  }, {
    maxElements: MAX_ELEMENTS,
    actionabilityContract: `(${classifyActionability.toString()})`,
    actionOwnerContract: `(${isFrameworkActionOwner.toString()})`,
  });

  const identityKeys = rawElements.map((raw) => JSON.stringify(normalizeStructuralOwnerIdentity(raw.structuralOwnerIdentityInput ?? {})))
    .reduce((counts, key) => counts.set(key, (counts.get(key) ?? 0) + 1), new Map<string, number>());
  const elements: SnapshotElement[] = rawElements.map((raw) => {
    const text = sanitizeSnapshotText(raw.text ?? "") || undefined;
    const label = sanitizeSnapshotText(raw.label ?? "") || undefined;
    const placeholder = sanitizeSnapshotText(raw.placeholder ?? "") || undefined;
    const name = sanitizeSnapshotText(raw.name ?? "") || undefined;
    const nearbyText = sanitizeSnapshotText(raw.nearbyText ?? "") || undefined;

    const candidateLocators = buildCandidateLocators({
      tagName: raw.tagName,
      role: raw.role,
      text,
      label,
      placeholder,
      name,
      id: raw.domId,
      testId: raw.testId,
      inputType: raw.inputType
    });

    const hintsText = [text, label, placeholder, name, nearbyText].filter(Boolean).join(" ");

    const identityInput = raw.structuralOwnerIdentityInput ?? {};
    const identityKey = JSON.stringify(normalizeStructuralOwnerIdentity(identityInput));
    const structuralOwnerIdentity = normalizeStructuralOwnerIdentity({
      ...identityInput,
      structuralIdentityMatchCount: identityKeys.get(identityKey) ?? 0,
    });
    return {
      id: raw.id,
      type: raw.elementType,
      text,
      label,
      placeholder,
      name,
      role: raw.role,
      tagName: raw.tagName,
      inputType: raw.inputType,
      required: raw.required,
      disabled: raw.disabled,
      visible: true,
      nearbyText,
      candidateLocators,
      dataHints: extractDataHintsFromElementText(hintsText),
      href: raw.href,
      ariaLabel: raw.ariaLabel,
      title: raw.title,
      alt: raw.alt,
      dataTestid: raw.testId,
      className: raw.className,
      domId: raw.domId,
      actionability: raw.actionability,
      tabIndex: raw.tabIndex,
      cursor: raw.cursor,
      pointerEvents: raw.pointerEvents,
      actionOwner: raw.actionOwner,
      structuralOwnerIdentity,
      controlIdentity: buildRuntimeControlIdentity({
        tagName: raw.tagName,
        inputType: raw.inputType,
        role: raw.role,
        name: raw.controlName,
        id: raw.domId,
        ariaControls: raw.ariaControls,
        candidateLocator: candidateLocators[0],
        snapshotId: raw.id,
      }) ?? undefined
    };
  });

  const structuralFingerprint = buildStructuralFingerprint(elements);
  return {
    version: "1.0",
    url: page.url(),
    title: await page.title(),
    capturedAt: new Date().toISOString(),
    structuralFingerprint,
    technicalScreenKey: buildTechnicalScreenKey(page.url(), structuralFingerprint),
    elements,
    summary: getSummary(elements)
  };
}
