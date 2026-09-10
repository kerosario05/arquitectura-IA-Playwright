import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { chromium, firefox, webkit, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { extractRuntimeUiSnapshot, type RuntimeUiSnapshot } from "../../knowledge/runtime-knowledge-extractor";
import type { RecordedControl, RecordedEvent, RecordedLocator, RecordedScreen } from "../session-trace.types";

/**
 * Structural identity of a page state.
 *
 * Built from the SHAPE of the controls (their roles and identities), never from their text
 * content: a list that renders different rows is the same screen, while a form that gains a
 * field is not. Sorting makes it order-independent, so a re-render that reshuffles the DOM
 * does not read as navigation.
 */
export function fingerprintSnapshot(snapshot: RuntimeUiSnapshot): string {
  const canonical = snapshot.observedControls
    .map((c) => [c.role ?? "", c.locatorIdentity ?? "", c.href ?? ""].join("|"))
    .concat(snapshot.inputLabels.map((l) => `input|${l}`))
    .concat(snapshot.selectLabels.map((l) => `select|${l}`))
    .sort()
    .join(";");
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Observes a human driving the web app in a real, visible browser.
 *
 * The web side needs none of the Android machinery: the page itself can tell us what was
 * clicked. An init script installs capture-phase listeners in every frame and hands each
 * interaction back through an exposed binding, together with the identity of the element —
 * so the locator is computed where the element actually lives, not reconstructed later from
 * a coordinate.
 *
 * The browser is launched headed on purpose. This is not automation; a person is meant to
 * use it.
 */

export type WebRecorderOptions = {
  baseUrl: string;
  framesDir: string;
  browserName?: "chromium" | "firefox" | "webkit";
  /** Labels or names whose typed content must never be stored verbatim. */
  sensitiveLabels?: string[];
  onLog?: (line: string) => void;
  onEvent?: (event: RecordedEvent) => void;
};

/** How many elements one identity matched in the page, and where the clicked one sat. */
export type LocatorRank = { count: number; index: number };

/** Identity keys the page measures uniqueness for, one per locator candidate. */
export type LocatorRanks = Partial<Record<"testId" | "ariaLabel" | "role" | "domId" | "text" | "name", LocatorRank>>;

type RawInteraction = {
  kind: "click" | "input" | "submit";
  label: string;
  role?: string;
  tagName?: string;
  inputType?: string;
  disabled?: boolean;
  value?: string;
  testId?: string;
  domId?: string;
  name?: string;
  ariaLabel?: string;
  text?: string;
  placeholder?: string;
  href?: string;
  /** Measured in the page at click time — absent for an interaction captured before this. */
  ranks?: LocatorRanks;
};

const ALWAYS_SENSITIVE = ["clave", "contrasena", "contraseña", "password", "pin", "otp", "token", "cvv"];

function normalizeLabel(raw: string): string {
  return raw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

export function isSensitiveField(interaction: RawInteraction, extra: readonly string[] = []): boolean {
  if (interaction.inputType === "password") return true;
  const haystack = normalizeLabel(
    [interaction.label, interaction.name, interaction.domId, interaction.ariaLabel, interaction.placeholder]
      .filter(Boolean)
      .join(" "),
  );
  return [...ALWAYS_SENSITIVE, ...extra.map(normalizeLabel)].some(
    (needle) => needle.length > 0 && haystack.includes(needle),
  );
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
export function buildWebLocators(interaction: RawInteraction): RecordedLocator[] {
  const ranks = interaction.ranks ?? {};
  const candidates: Array<{ key: keyof LocatorRanks; locator: RecordedLocator }> = [];

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

  const unique: RecordedLocator[] = [];
  const shared: RecordedLocator[] = [];
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
 * own handler cannot hide the interaction from the recorder. Values of password fields never
 * leave the page: the script sends the field's identity and lets the Node side decide, but
 * the value itself is dropped here as well, so a secret is not even transported.
 */
const CAPTURE_SCRIPT = `
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

  const describe = (el, kind, value) => ({
    kind,
    label: accessibleName(el),
    ranks: ranksFor(el),
    role: el.getAttribute ? (el.getAttribute('role') || undefined) : undefined,
    tagName: el.tagName ? el.tagName.toLowerCase() : undefined,
    inputType: el.type || undefined,
    disabled: el.disabled === true,
    value: el.type === 'password' ? undefined : value,
    testId: el.getAttribute ? (el.getAttribute('data-testid') || el.getAttribute('data-test-id') || undefined) : undefined,
    domId: el.id || undefined,
    name: el.name || undefined,
    ariaLabel: el.getAttribute ? (el.getAttribute('aria-label') || undefined) : undefined,
    text: (el.innerText || el.textContent || '').trim().slice(0, 120) || undefined,
    placeholder: el.getAttribute ? (el.getAttribute('placeholder') || undefined) : undefined,
    href: el.getAttribute ? (el.getAttribute('href') || undefined) : undefined,
  });

  const send = (payload) => {
    try { window.__qaRecord(payload); } catch (e) { /* binding not ready yet */ }
  };

  document.addEventListener('click', (e) => {
    const el = e.target && e.target.closest
      ? (e.target.closest('button, a, [role="button"], input, select, label, [onclick]') || e.target)
      : e.target;
    if (el) send(describe(el, 'click'));
  }, true);

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el) return;
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      send(describe(el, 'input', el.value));
    }
  }, true);

  document.addEventListener('submit', (e) => {
    if (e.target) send(describe(e.target, 'submit'));
  }, true);
})();
`;

export class WebSessionRecorder {
  private browser: Browser | null = null;

  private context: BrowserContext | null = null;

  private page: Page | null = null;

  private readonly startedAt = Date.now();

  private readonly events: RecordedEvent[] = [];

  private readonly screens = new Map<string, RecordedScreen>();

  private seq = 0;

  private stopped = false;

  private lastScreenKey = "inicio";

  private lastFingerprint = "";

  constructor(private readonly options: WebRecorderOptions) {}

  private log(line: string): void {
    this.options.onLog?.(line);
  }

  private now(): number {
    return Date.now() - this.startedAt;
  }

  private pushEvent(event: Omit<RecordedEvent, "seq">): RecordedEvent {
    const full: RecordedEvent = { ...event, seq: this.seq++ };
    this.events.push(full);
    this.options.onEvent?.(full);
    return full;
  }

  private async captureFrame(tag: string): Promise<string | undefined> {
    if (!this.page) return undefined;
    const file = path.join(this.options.framesDir, `${String(this.seq).padStart(4, "0")}-${tag}.png`);
    try {
      await this.page.screenshot({ path: file });
      return file;
    } catch {
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
  private async absorbScreen(): Promise<{ changed: boolean; screenKey: string }> {
    if (!this.page) return { changed: false, screenKey: this.lastScreenKey };
    const snapshot = await extractRuntimeUiSnapshot(this.page);
    const fingerprint = fingerprintSnapshot(snapshot);
    const screenKey = snapshot.screenKey || fingerprint.slice(0, 16);
    const changed = fingerprint !== this.lastFingerprint;

    if (!this.screens.has(screenKey)) {
      const controls: RecordedControl[] = snapshot.observedControls.map((c) => ({
        label: c.businessLabel ?? c.label,
        role: c.role,
        locators: c.locatorIdentity
          ? [{ strategy: "aria-label", value: c.locatorIdentity, confidence: 0.9 }]
          : [{ strategy: "text", value: c.label, confidence: 0.7 }],
      }));
      this.screens.set(screenKey, {
        screenKey,
        title: snapshot.headings[0] ?? screenKey,
        fingerprint,
        url: snapshot.url,
        firstSeenAt: this.now(),
        controls,
        texts: snapshot.assertionTargets.slice(0, 40),
      });
    }

    this.lastFingerprint = fingerprint;
    return { changed, screenKey };
  }

  private async onInteraction(raw: RawInteraction): Promise<void> {
    if (this.stopped) return;
    const sensitive = isSensitiveField(raw, this.options.sensitiveLabels);
    const locators = buildWebLocators(raw);
    const framePath = await this.captureFrame(raw.kind);

    if (raw.kind === "input") {
      this.pushEvent({
        t: this.now(),
        kind: "fill",
        screenKey: this.lastScreenKey,
        fingerprint: this.lastFingerprint,
        url: this.page?.url(),
        target: { label: raw.label || raw.name || "campo", role: "input", locators, sensitive },
        value: sensitive ? undefined : raw.value,
        redactedKey: sensitive ? normalizeLabel(raw.label || raw.name || "campo").replace(/\s+/g, "_") : undefined,
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
      target: {
        label: raw.label || raw.text || "control",
        role: raw.role ?? raw.tagName,
        locators,
        enabled: raw.disabled === true ? false : undefined,
      },
      framePath,
    });
    this.log(`[recording] clic -> "${raw.label || raw.text || "(sin etiqueta)"}"`);

    // Give the app a moment, then see whether the view changed.
    await this.page?.waitForTimeout(900).catch(() => undefined);
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

  async start(): Promise<boolean> {
    fs.mkdirSync(this.options.framesDir, { recursive: true });
    const engine =
      this.options.browserName === "firefox" ? firefox : this.options.browserName === "webkit" ? webkit : chromium;

    this.browser = await engine.launch({ headless: false });
    this.context = await this.browser.newContext();
    await this.context.exposeBinding("__qaRecord", async (_source, payload: RawInteraction) => {
      await this.onInteraction(payload).catch((err) =>
        this.log(`[recording] error procesando interacción: ${err instanceof Error ? err.message : String(err)}`),
      );
    });
    await this.context.addInitScript(CAPTURE_SCRIPT);

    this.page = await this.context.newPage();
    this.page.on("framenavigated", (frame) => {
      if (frame !== this.page?.mainFrame() || this.stopped) return;
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

  async stop(): Promise<{ events: RecordedEvent[]; screens: RecordedScreen[] }> {
    this.stopped = true;
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = null;
    this.browser = null;
    this.page = null;
    return { events: [...this.events], screens: [...this.screens.values()] };
  }

  snapshotProgress(): { events: number; screens: number; currentScreen: string } {
    return {
      events: this.events.length,
      screens: this.screens.size,
      currentScreen: this.screens.get(this.lastScreenKey)?.title ?? this.lastScreenKey,
    };
  }
}
