import { createHash } from "node:crypto";

export type MobileScreenSnapshot = {
  screenKey: string;      // stable key derived from the screen's dominant heading/text
  title: string;          // human-readable screen title (best-effort)
  clickTargets: string[]; // content-desc/text of clickable elements (real tappables)
  assertionTargets: string[]; // visible non-clickable text (headings, labels, messages)
};

/** Decodes common XML entities and normalizes whitespace. */
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

/** Matches each XML element tag (self-closing or opening) with all its attributes. */
const ELEMENT_RE = /<([\w.]+)\b([^>]*?)\/?>/g;

function attr(attrs: string, name: string): string | undefined {
  const m = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : undefined;
}

/**
 * Parses an Appium/UiAutomator2 page-source XML into a screen snapshot: the clickable
 * targets (what can be tapped) and assertion targets (visible text). Pure function on
 * the XML string — no Appium/browser dependency, so it's unit-testable.
 */
export function extractMobileScreenSnapshot(pageSourceXml: string): MobileScreenSnapshot {
  const clickTargets: string[] = [];
  const assertionTargets: string[] = [];
  const seenClick = new Set<string>();
  const seenText = new Set<string>();
  const headings: string[] = [];

  let m: RegExpExecArray | null;
  ELEMENT_RE.lastIndex = 0;
  while ((m = ELEMENT_RE.exec(pageSourceXml)) !== null) {
    const attrs = m[2];
    const clickable = attr(attrs, "clickable") === "true";
    const displayed = attr(attrs, "displayed") !== "false";
    if (!displayed) continue;

    const desc = decodeXml(attr(attrs, "content-desc") ?? "");
    const text = decodeXml(attr(attrs, "text") ?? "");
    const label = desc || text;
    if (!label) continue;

    if (clickable) {
      if (!seenClick.has(label)) {
        seenClick.add(label);
        clickTargets.push(label);
      }
    } else {
      if (!seenText.has(label)) {
        seenText.add(label);
        assertionTargets.push(label);
      }
      if (attr(attrs, "heading") === "true") headings.push(label);
    }
  }

  // Screen title: prefer an explicit heading, else the first visible text, else "unknown".
  const title = headings[0] || assertionTargets[0] || "unknown";

  // Stable key: the title if it's a short heading, else a hash of the top visible texts
  // (so two structurally-identical screens map to the same key across runs).
  const shortTitle = title.length > 0 && title.length <= 48;
  const screenKey = shortTitle
    ? title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "screen"
    : "screen_" + createHash("sha256").update(assertionTargets.slice(0, 8).join("|")).digest("hex").slice(0, 10);

  return { screenKey, title, clickTargets, assertionTargets };
}
