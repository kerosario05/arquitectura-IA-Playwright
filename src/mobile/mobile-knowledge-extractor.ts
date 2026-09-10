import { createHash } from "node:crypto";

/** Structured control observation with both semantic label and technical identity attributes.
 *  contentDesc/resourceId/className are captured directly from the XML and only present when
 *  the attribute actually exists — never fabricated. Used by classifyLocatorExecutionBacking
 *  to determine technical execution-backing per locator strategy. */
export type MobileObservedControl = {
  label: string;
  businessLabel?: string;
  locatorIdentity?: string;
  sourceScreenKey: string;
  contentDesc?: string;
  resourceId?: string;
  className?: string;
  /** Android package that owns this control, from the XML `package` attribute. */
  package?: string;
  /**
   * Whether the control is currently actionable, from the XML `enabled` attribute. Only recorded
   * for clickable controls, where it carries meaning: a submit button gated behind a precondition
   * (an OTP still to validate, a consent still to tick) reads as disabled until the gate opens.
   * Without it the learning file cannot express that "Continuar" is not yet pressable, and a
   * generated scenario has no way to know a step is missing before it.
   */
  enabled?: boolean;
};

export type MobileScreenSnapshot = {
  screenKey: string;      // stable key derived from the screen's dominant heading/text
  title: string;          // human-readable screen title (best-effort)
  clickTargets: string[]; // content-desc/text of clickable elements (real tappables)
  assertionTargets: string[]; // visible non-clickable text (headings, labels, messages)
  /** Structured observations with technical identity per control (content-desc, resource-id,
   *  class). ClickTargets/assertionTargets are kept for backward compat. */
  observedControls: MobileObservedControl[];
  /** Stable STRUCTURAL fingerprint (screen_<hash>) derived from the observed elements only —
   *  never from title/labels/slugs. Order-independent; identical structure -> same fingerprint. */
  fingerprint: string;
  /** Package that owns the majority of controls on this screen. Derived from the XML `package`
   *  attribute on each node. Used to filter out external screens (System UI, launcher, etc.)
   *  that should not be persisted as functional project knowledge. */
  dominantPackage?: string;
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
  const observedControls: MobileObservedControl[] = [];
  const seenClick = new Set<string>();
  const seenText = new Set<string>();
  const headings: string[] = [];
  const packageCounts = new Map<string, number>();

  let m: RegExpExecArray | null;
  ELEMENT_RE.lastIndex = 0;
  while ((m = ELEMENT_RE.exec(pageSourceXml)) !== null) {
    const attrs = m[2];
    const pkg = attr(attrs, "package") || undefined;
    if (pkg) packageCounts.set(pkg, (packageCounts.get(pkg) ?? 0) + 1);

    const clickable = attr(attrs, "clickable") === "true";
    const displayed = attr(attrs, "displayed") !== "false";
    if (!displayed) continue;

    const desc = decodeXml(attr(attrs, "content-desc") ?? "");
    const text = decodeXml(attr(attrs, "text") ?? "");
    const resourceId = attr(attrs, "resource-id") || undefined;
    const className = attr(attrs, "class") || undefined;
    const label = desc || text;
    if (!label) continue;

    // Best technical identity: content-desc preferred, then resource-id.
    const locatorIdentity = desc || resourceId || undefined;

    const control: MobileObservedControl = {
      label,
      businessLabel: label,
      sourceScreenKey: "",
      locatorIdentity,
    };
    if (desc) control.contentDesc = desc;
    if (resourceId) control.resourceId = resourceId;
    if (className) control.className = className;
    if (pkg) control.package = pkg;
    // Recorded whenever the source states it, not only for tappables.
    //
    // Restricting this to `clickable` controls looked like noise control and instead threw away
    // the one case that matters: this app renders a gated button as clickable="false", so the
    // disabled "Continuar" — the whole point of capturing gate state — was the single control
    // guaranteed to be skipped. Across a real run, 50 of 186 controls carried the flag and not
    // one of them was ever false.
    const enabledAttr = attr(attrs, "enabled");
    if (enabledAttr !== undefined) control.enabled = enabledAttr !== "false";

    observedControls.push(control);

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

  const title = headings[0] || assertionTargets[0] || "unknown";

  const shortTitle = title.length > 0 && title.length <= 48;
  const screenKey = shortTitle
    ? title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "screen"
    : "screen_" + createHash("sha256").update(assertionTargets.slice(0, 8).join("|")).digest("hex").slice(0, 10);

  // Gate state is structural: the same screen with "Continuar" disabled and with it enabled are
  // two different states of the flow, and the second is the observable proof that the
  // preconditions were satisfied. Folding it into the fingerprint is what lets both be learned.
  const gateTokens = observedControls
    .filter((c) => c.enabled === false)
    .map((c) => `disabled:${c.label}`)
    .sort();
  const structuralTokens = [...clickTargets, ...assertionTargets].sort().concat(gateTokens).join("|");
  const fingerprint = "screen_" + createHash("sha256").update(structuralTokens).digest("hex").slice(0, 10);

  const dominantPackage = (() => {
    const sorted = [...packageCounts.entries()].sort((a, b) => b[1] - a[1]);
    if (sorted.length === 0) return undefined;
    if (sorted.length >= 2 && sorted[0][1] === sorted[1][1]) return undefined;
    return sorted[0][0];
  })();

  return { screenKey, title, clickTargets, assertionTargets, observedControls, fingerprint, dominantPackage };
}
