import type { RecordedBounds, RecordedLocator, RecordedTarget } from "../session-trace.types";

/**
 * Resolves WHICH control a physical touch landed on.
 *
 * This is what separates "I recorded a session" from "I have an executable plan". A touch
 * from the kernel is only a coordinate; the UiAutomator page source is only a tree. Matching
 * one against the other turns a human tap into a named, locatable control the generator can
 * emit a step for.
 *
 * Pure over the page-source XML string, so the whole policy is unit-testable without a device.
 */

export type BoundedNode = {
  className?: string;
  text?: string;
  contentDesc?: string;
  resourceId?: string;
  package?: string;
  clickable: boolean;
  enabled: boolean;
  bounds: RecordedBounds;
  /** Depth in the XML tree — deeper nodes win ties against equally sized ancestors. */
  depth: number;
};

const ELEMENT_RE = /<([\w.]+)\b([^>]*?)(\/?)>|<\/([\w.]+)>/g;
const BOUNDS_RE = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/;

function attr(attrs: string, name: string): string | undefined {
  const m = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : undefined;
}

function decodeXml(s: string): string {
  return s
    .replace(/&#10;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseBounds(raw: string | undefined): RecordedBounds | null {
  if (!raw) return null;
  const m = raw.match(BOUNDS_RE);
  if (!m) return null;
  const x1 = Number(m[1]);
  const y1 = Number(m[2]);
  const x2 = Number(m[3]);
  const y2 = Number(m[4]);
  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * Extracts every node that declares bounds, tracking tree depth.
 *
 * Depth matters because a container can share identical bounds with its only child; without
 * it the hit test would pick the wrapper (which carries no label) over the control.
 */
export function extractBoundedNodes(pageSourceXml: string): BoundedNode[] {
  const nodes: BoundedNode[] = [];
  let depth = 0;
  let m: RegExpExecArray | null;
  ELEMENT_RE.lastIndex = 0;
  while ((m = ELEMENT_RE.exec(pageSourceXml)) !== null) {
    const closingTag = m[4];
    if (closingTag) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    const tagName = m[1] ?? "";
    const attrs = m[2] ?? "";
    const selfClosing = m[3] === "/";
    const bounds = parseBounds(attr(attrs, "bounds"));
    if (bounds) {
      nodes.push({
        // Appium's Android source names each element after its widget class
        // (`<android.widget.EditText …>`), while a raw uiautomator dump uses `<node
        // class="…">`. Reading the attribute first and falling back to the tag covers both,
        // and without the fallback every control reads as a plain clickable — an input
        // would never be recognised as one.
        className: attr(attrs, "class") ?? (tagName === "node" ? undefined : tagName),
        text: decodeXml(attr(attrs, "text") ?? "") || undefined,
        contentDesc: decodeXml(attr(attrs, "content-desc") ?? "") || undefined,
        resourceId: attr(attrs, "resource-id") || undefined,
        package: attr(attrs, "package") || undefined,
        clickable: attr(attrs, "clickable") === "true",
        enabled: attr(attrs, "enabled") !== "false",
        bounds,
        depth,
      });
    }
    if (!selfClosing) depth += 1;
  }
  return nodes;
}

function contains(b: RecordedBounds, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
}

function area(b: RecordedBounds): number {
  return b.width * b.height;
}

/** Smaller area wins; on a tie the deeper node wins (the child, not its wrapper). */
function tighter(a: BoundedNode, b: BoundedNode): BoundedNode {
  const aa = area(a.bounds);
  const ba = area(b.bounds);
  if (aa !== ba) return aa < ba ? a : b;
  return a.depth >= b.depth ? a : b;
}

function escapeForUiSelector(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * One way of naming a node, plus what it takes to check that the name is unambiguous.
 *
 * `matches` mirrors what the device-side selector does, so counting it over the tree answers
 * the only question that matters: would this locator find exactly the control the person
 * touched, or several?
 */
type LocatorCandidate = {
  locator: RecordedLocator;
  matches: (node: BoundedNode) => boolean;
  /** The same identity anchored on a position, for when the identity alone is not unique. */
  atInstance: (instance: number) => RecordedLocator;
};

/** Confidence for a locator that only resolves because it is pinned to a position. */
const DISAMBIGUATED_CONFIDENCE = 0.5;

function candidatesFor(node: BoundedNode): LocatorCandidate[] {
  const candidates: LocatorCandidate[] = [];
  const desc = node.contentDesc?.trim();

  if (desc) {
    if (desc.includes(",")) {
      const longest = desc
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)[0];
      if (longest) {
        const escaped = escapeForUiSelector(longest);
        candidates.push({
          locator: {
            strategy: "androidUiAutomator",
            value: `new UiSelector().descriptionContains("${escaped}")`,
            confidence: 0.8,
          },
          matches: (n) => (n.contentDesc ?? "").includes(longest),
          atInstance: (instance) => ({
            strategy: "androidUiAutomator",
            value: `new UiSelector().descriptionContains("${escaped}").instance(${instance})`,
            confidence: DISAMBIGUATED_CONFIDENCE,
            ambiguous: true,
            matchIndex: instance,
          }),
        });
      }
    } else {
      const escaped = escapeForUiSelector(desc);
      candidates.push({
        locator: { strategy: "accessibilityId", value: desc, confidence: 0.95 },
        matches: (n) => n.contentDesc?.trim() === desc,
        atInstance: (instance) => ({
          strategy: "androidUiAutomator",
          value: `new UiSelector().description("${escaped}").instance(${instance})`,
          confidence: DISAMBIGUATED_CONFIDENCE,
          ambiguous: true,
          matchIndex: instance,
        }),
      });
    }
  }

  if (node.resourceId) {
    const resourceId = node.resourceId;
    const escaped = escapeForUiSelector(resourceId);
    candidates.push({
      locator: { strategy: "id", value: resourceId, confidence: 0.9 },
      matches: (n) => n.resourceId === resourceId,
      atInstance: (instance) => ({
        strategy: "androidUiAutomator",
        value: `new UiSelector().resourceId("${escaped}").instance(${instance})`,
        confidence: DISAMBIGUATED_CONFIDENCE,
        ambiguous: true,
        matchIndex: instance,
      }),
    });
  }

  const text = node.text?.trim();
  if (text) {
    const escaped = escapeForUiSelector(text);
    candidates.push({
      locator: {
        strategy: "androidUiAutomator",
        value: `new UiSelector().text("${escaped}")`,
        confidence: 0.7,
      },
      matches: (n) => n.text?.trim() === text,
      atInstance: (instance) => ({
        strategy: "androidUiAutomator",
        value: `new UiSelector().text("${escaped}").instance(${instance})`,
        confidence: DISAMBIGUATED_CONFIDENCE,
        ambiguous: true,
        matchIndex: instance,
      }),
    });
  }

  return candidates;
}

/**
 * Ranks locators for a node the way the executor prefers them: accessibility identity first
 * (stable across layout changes), then resource id, then visible text. A composite
 * content-desc (Android concatenates a container's children with commas) is anchored on its
 * longest segment with `descriptionContains`, because the exact string is padded on the
 * device in a way the extracted source no longer shows.
 *
 * `tree` is what turns a plausible name into a usable one. A screen routinely carries the
 * same label twice — this app shows "Enviar código de validación" for the email and again
 * for the phone — and a locator that matches both sends the generated script to whichever
 * comes first, not to the control the person actually pressed. So every candidate is counted
 * against the tree it came from: those that resolve to exactly one node are offered first,
 * and the rest are re-anchored on their instance index and marked ambiguous, which drops
 * their confidence below the threshold the scenario builder uses to flag a step as uncertain.
 *
 * Passing no tree keeps the old behaviour (names only, no verification), which is the honest
 * default for a caller that has no hierarchy to check against.
 */
export function buildLocators(node: BoundedNode, tree: readonly BoundedNode[] = []): RecordedLocator[] {
  const candidates = candidatesFor(node);
  if (tree.length === 0) return candidates.map((c) => c.locator);

  const unique: RecordedLocator[] = [];
  const disambiguated: RecordedLocator[] = [];

  for (const candidate of candidates) {
    const matching = tree.filter(candidate.matches);
    if (matching.length <= 1) {
      unique.push(candidate.locator);
      continue;
    }
    const instance = matching.indexOf(node);
    disambiguated.push(
      instance >= 0
        ? candidate.atInstance(instance)
        : { ...candidate.locator, confidence: DISAMBIGUATED_CONFIDENCE, ambiguous: true },
    );
  }

  return [...unique, ...disambiguated];
}

const INPUT_CLASS_RE = /EditText|AutoCompleteTextView/i;

export function nodeRole(node: BoundedNode): string {
  const cls = node.className ?? "";
  if (INPUT_CLASS_RE.test(cls)) return "input";
  if (/Button/i.test(cls)) return "button";
  if (/CheckBox|Switch|ToggleButton/i.test(cls)) return "toggle";
  if (node.clickable) return "button";
  return "text";
}

export function nodeLabel(node: BoundedNode): string {
  return (node.contentDesc ?? node.text ?? node.resourceId?.split("/").pop() ?? "").trim();
}

export type HitTestResult = {
  target: RecordedTarget;
  /** The node the coordinate literally fell in, before climbing to a clickable ancestor. */
  innermostLabel?: string;
  /** True when no clickable node contained the point and a labeled node was used instead. */
  fallback: boolean;
};

export type HitTestOptions = {
  /** Ignore nodes owned by another package (System UI, the launcher, the keyboard). */
  appPackage?: string;
};

/**
 * Finds the control a tap at (x, y) addressed.
 *
 * Preference order is deliberate: the tightest CLICKABLE node containing the point is the
 * control the user pressed, even when a smaller decorative label sits inside it — pressing
 * the text of a button is pressing the button. Only when nothing clickable contains the
 * point (a tap on a static area, or a surface with no accessibility tree at all) does it
 * fall back to the tightest labeled node, and it flags that so the caller can mark the step
 * as uncertain rather than emit a locator nobody can trust.
 */
export function hitTest(
  nodes: BoundedNode[],
  x: number,
  y: number,
  options: HitTestOptions = {},
): HitTestResult | null {
  const scoped = options.appPackage
    ? nodes.filter((n) => !n.package || n.package === options.appPackage)
    : nodes;
  const containing = scoped.filter((n) => contains(n.bounds, x, y));
  if (containing.length === 0) return null;

  const innermost = containing.reduce(tighter);
  const clickableLabeled = containing.filter((n) => n.clickable && nodeLabel(n).length > 0);
  const clickableAny = containing.filter((n) => n.clickable);
  const clickable = clickableLabeled.length > 0
    ? clickableLabeled.reduce(tighter)
    : clickableAny.length > 0
      ? clickableAny.reduce(tighter)
      : null;

  const labeled = containing.filter((n) => nodeLabel(n).length > 0);
  const chosen = clickable ?? (labeled.length > 0 ? labeled.reduce(tighter) : innermost);

  return {
    target: {
      label: nodeLabel(chosen) || nodeLabel(innermost),
      role: nodeRole(chosen),
      // Counted against the WHOLE tree, not the package-scoped slice: the device-side
      // selector sees every window, so a label the system UI also carries is genuinely
      // ambiguous there even though it looks unique inside the app's own nodes.
      locators: buildLocators(chosen, nodes),
      bounds: chosen.bounds,
      enabled: chosen.enabled,
    },
    innermostLabel: nodeLabel(innermost) || undefined,
    fallback: clickable === null,
  };
}
