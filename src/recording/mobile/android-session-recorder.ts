import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { resolveAndroidSdk } from "../../mobile/android-sdk";
import { extractMobileScreenSnapshot } from "../../mobile/mobile-knowledge-extractor";
import {
  createTouchStreamParser,
  parseScreenSize,
  parseTouchDevices,
  summarizeProbedDevices,
  type Gesture,
  type TouchCalibration,
} from "./android-touch-listener";
import {
  extractBoundedNodes,
  buildLocators,
  nodeLabel,
  nodeRole,
  hitTest,
  type BoundedNode,
} from "./tap-hit-tester";
import type {
  RecordedControl,
  RecordedEvent,
  RecordedScreen,
} from "../session-trace.types";

const execFileAsync = promisify(execFile);

/**
 * Observes a human driving an Android app.
 *
 * Three streams run concurrently and are stitched by timestamp:
 *
 * 1. `getevent -lt` — the only way to know a person touched the screen, since Appium drives
 *    but never reports. Gives coordinates.
 * 2. a page-source poller — keeps the most recent UI tree so a coordinate can be resolved to
 *    a named control the instant a touch arrives.
 * 3. per-event screenshots — the visual context for the derivation pass, written to a temp
 *    directory and deleted as soon as it has been consumed.
 *
 * The poller is what makes (1) useful: hit-testing against the tree captured AFTER the tap
 * would resolve against the screen the tap produced, not the one it happened on.
 */

export type AndroidRecorderOptions = {
  deviceId: string;
  appPackage?: string;
  framesDir: string;
  /** How often the UI tree is re-read while the user explores. Default 1200ms. */
  pollIntervalMs?: number;
  /** Settle time after a tap before the resulting screen is read. Default 1400ms. */
  settleAfterTapMs?: number;
  /** Labels whose typed content must never be stored verbatim. */
  sensitiveLabels?: string[];
  onLog?: (line: string) => void;
  onEvent?: (event: RecordedEvent) => void;
};

/** Field labels whose content is redacted regardless of project configuration. */
const ALWAYS_SENSITIVE = [
  "clave",
  "contrasena",
  "contraseña",
  "password",
  "pin",
  "otp",
  "codigo de validacion",
  "token",
  "cvv",
];

function normalizeLabel(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function isSensitiveLabel(label: string, extra: readonly string[] = []): boolean {
  const normalized = normalizeLabel(label);
  if (!normalized) return false;
  return [...ALWAYS_SENSITIVE, ...extra.map(normalizeLabel)].some(
    (needle) => needle.length > 0 && normalized.includes(needle),
  );
}

/** Where the UI tree is dumped on the device before being read back and deleted. */
const SOURCE_DUMP_PATH = "/data/local/tmp/qa-recording-dump.xml";

type EditTextState = { key: string; label: string; text: string };

/**
 * A screen name a person can read, or undefined when the screen offers none.
 *
 * The snapshot's own title is the first heading or text on screen, which on an icon-heavy
 * header is a private-use glyph from an icon font: unreadable in a report and useless as a
 * name. The first text carrying actual letters or digits is what a tester would call the
 * screen.
 */
export function readableTitle(snapshot: {
  title: string;
  assertionTargets: readonly string[];
}): string | undefined {
  for (const candidate of [snapshot.title, ...snapshot.assertionTargets]) {
    const trimmed = candidate?.trim();
    if (!trimmed) continue;
    const letters = trimmed.replace(/[^\p{L}\p{N}]+/gu, "");
    if (letters.length >= 3) return trimmed.slice(0, 80);
  }
  return undefined;
}

/** Identity of an input across polls — resource id if present, else its position. */
function inputKey(node: { resourceId?: string; bounds: { x: number; y: number } }): string {
  return node.resourceId ?? `@${node.bounds.x},${node.bounds.y}`;
}

export class AndroidSessionRecorder {
  private touchProcess: ChildProcess | null = null;

  private pollTimer: NodeJS.Timeout | null = null;

  private readonly startedAt = Date.now();

  private readonly events: RecordedEvent[] = [];

  private readonly screens = new Map<string, RecordedScreen>();

  private lastSource: string | null = null;

  private lastScreenKey = "unknown";

  private lastFingerprint = "";

  private inputs = new Map<string, EditTextState>();

  private seq = 0;

  private stopped = false;

  private calibration: TouchCalibration | null = null;

  /** Serializes source reads so a tap-triggered read never races the periodic one. */
  private readChain: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: AndroidRecorderOptions) {}

  private log(line: string): void {
    this.options.onLog?.(line);
  }

  private adb(): string {
    return resolveAndroidSdk().adbPath;
  }

  private async adbShell(command: string): Promise<string> {
    const { stdout } = await execFileAsync(
      this.adb(),
      ["-s", this.options.deviceId, "shell", command],
      { maxBuffer: 32 * 1024 * 1024 },
    );
    return stdout;
  }

  /**
   * Reads the digitizer ranges and display size.
   *
   * The probe is taken with `-lp`, not `-p`: without `-l` getevent prints every axis as a raw
   * hex code, and a panel that reports its ranges perfectly then looks like a device with no
   * touch axes at all. The parser understands both spellings, so the plain form is still worth
   * a retry when the labelled one comes back empty on an odd shell.
   *
   * Returns null rather than assuming a mapping: on a device that truly reports no position
   * axes (no permission, or an unusual input stack) every recorded coordinate would be wrong,
   * and a recording full of taps on the wrong controls is worse than one that refuses to start.
   */
  async calibrate(): Promise<Array<{ devicePath: string; calibration: TouchCalibration }> | null> {
    try {
      let probe = await this.adbShell("getevent -lp");
      let devices = parseTouchDevices(probe);
      if (devices.length === 0) {
        probe = await this.adbShell("getevent -p");
        devices = parseTouchDevices(probe);
      }
      if (devices.length === 0) {
        const seen = summarizeProbedDevices(probe);
        this.log(
          seen.length
            ? `[recording] ningún dispositivo de entrada reporta ejes de posición; vistos: ${seen.join(", ")}`
            : "[recording] getevent no listó dispositivos de entrada (¿permisos de /dev/input?)",
        );
        return null;
      }
      if (devices.every((device) => device.axes === "st")) {
        this.log("[recording] el panel solo reporta un contacto (ABS_X/ABS_Y); se grabará igual");
      }
      const size = parseScreenSize(await this.adbShell("wm size"));
      if (!size) {
        this.log("[recording] no se pudo leer el tamaño de pantalla (wm size)");
        return null;
      }
      const calibrated = devices.map((device) => ({
        devicePath: device.devicePath,
        calibration: {
          rawMaxX: device.rawMaxX,
          rawMaxY: device.rawMaxY,
          screenWidth: size.width,
          screenHeight: size.height,
        } satisfies TouchCalibration,
      }));
      this.calibration = calibrated[0]!.calibration;
      this.log(
        `[recording] calibrado sobre ${calibrated.length} dispositivo(s) táctil(es) [${devices
          .map((device) => `${device.devicePath} ${device.rawMaxX}x${device.rawMaxY}`)
          .join(", ")}] pantalla=${size.width}x${size.height}`,
      );
      return calibrated;
    } catch (err) {
      this.log(`[recording] calibración falló: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Reads the current UI tree through adb, independent of the Appium session.
   *
   * The dump goes to a file and is read back, not to `/dev/tty`: `adb shell <cmd>` allocates
   * no terminal, so a dump aimed at the tty prints its "dumped to" confirmation and drops the
   * XML on the floor — the recorder then sees no screen at all, discards every touch that
   * arrives (a gesture needs a tree to hit-test against) and ends with zero actions.
   *
   * `/data/local/tmp` rather than `/sdcard` because it is writable by the shell user on every
   * device, and the file is deleted in the same command: it holds a snapshot of whatever the
   * tester has on screen, and a failed dump must leave nothing behind for the next poll to
   * read as if it were current.
   */
  private async readSource(): Promise<string | null> {
    try {
      const out = await this.adbShell(
        `uiautomator dump ${SOURCE_DUMP_PATH} >/dev/null 2>&1; cat ${SOURCE_DUMP_PATH}; rm -f ${SOURCE_DUMP_PATH}`,
      );
      const start = out.indexOf("<?xml");
      const end = out.lastIndexOf("</hierarchy>");
      if (start === -1 || end === -1) return null;
      return out.slice(start, end + "</hierarchy>".length);
    } catch {
      return null;
    }
  }

  private pushEvent(event: Omit<RecordedEvent, "seq">): RecordedEvent {
    const full: RecordedEvent = { ...event, seq: this.seq++ };
    this.events.push(full);
    this.options.onEvent?.(full);
    return full;
  }

  private now(): number {
    return Date.now() - this.startedAt;
  }

  private async captureFrame(tag: string): Promise<string | undefined> {
    const file = path.join(this.options.framesDir, `${String(this.seq).padStart(4, "0")}-${tag}.png`);
    try {
      const { stdout } = await execFileAsync(
        this.adb(),
        ["-s", this.options.deviceId, "exec-out", "screencap", "-p"],
        { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
      );
      fs.writeFileSync(file, stdout as unknown as Buffer);
      return file;
    } catch {
      return undefined;
    }
  }

  /**
   * Registers the screen currently on source, emitting a transition when it actually changed.
   *
   * The structural fingerprint decides, not the title: two different screens of the same app
   * often share a header, and a screen whose content changed in place (a list that loaded)
   * keeps its title while being a genuinely different state.
   */
  private absorbScreen(source: string): { changed: boolean; screenKey: string } {
    const snapshot = extractMobileScreenSnapshot(source);
    const nodes = extractBoundedNodes(source);
    const scoped = this.options.appPackage
      ? nodes.filter((n) => n.package === this.options.appPackage)
      : nodes;

    const controls: RecordedControl[] = scoped
      .filter((n) => n.clickable && nodeLabel(n).length > 0)
      .map((n) => ({
        label: nodeLabel(n),
        role: nodeRole(n),
        locators: buildLocators(n, nodes),
        enabled: n.enabled,
        bounds: n.bounds,
      }));

    // The fingerprint IS the identity, not `snapshot.screenKey`: that key is a slug of the
    // screen's title, and a title made only of icon-font glyphs (this app's headers are
    // private-use characters) slugs down to the constant "screen". Every screen of the
    // session then shares one key, the map keeps a single entry and no transition can ever be
    // reported, since a change is only emitted when the key differs from the previous one.
    const screenKey = snapshot.fingerprint;
    const changed = snapshot.fingerprint !== this.lastFingerprint;

    if (!this.screens.has(screenKey)) {
      this.screens.set(screenKey, {
        screenKey,
        title: readableTitle(snapshot) ?? screenKey,
        fingerprint: snapshot.fingerprint,
        firstSeenAt: this.now(),
        controls,
        texts: snapshot.assertionTargets.slice(0, 40),
      });
    }

    // Track every input's current content so a change between polls reads as a fill.
    const nextInputs = new Map<string, EditTextState>();
    for (const node of scoped) {
      if (nodeRole(node) !== "input") continue;
      const key = inputKey(node);
      const label = nodeLabel(node) || node.contentDesc || "campo";
      nextInputs.set(key, { key, label, text: node.text ?? "" });
    }
    this.detectFills(nextInputs, nodes);
    this.inputs = nextInputs;

    this.lastSource = source;
    this.lastFingerprint = snapshot.fingerprint;
    return { changed, screenKey };
  }

  /**
   * Emits a `fill` when an input's content changed since the previous read.
   *
   * Typing is not observable through `getevent` in any usable form (the soft keyboard reports
   * key positions, not characters), so the field's own value is the signal. Sensitive fields
   * record only a key: the recording must be able to reproduce the STEP without ever storing
   * the secret a tester typed into a banking app.
   */
  private detectFills(next: Map<string, EditTextState>, tree: readonly BoundedNode[]): void {
    for (const [key, state] of next) {
      const previous = this.inputs.get(key);
      if (previous && previous.text === state.text) continue;
      if (!state.text) continue;
      if (previous === undefined && this.inputs.size === 0) {
        // First observation of the screen: a pre-filled field is state, not an action.
        continue;
      }
      const node = tree.find((n) => inputKey(n) === key);
      const sensitive = isSensitiveLabel(state.label, this.options.sensitiveLabels);
      this.pushEvent({
        t: this.now(),
        kind: "fill",
        screenKey: this.lastScreenKey,
        fingerprint: this.lastFingerprint,
        target: {
          label: state.label,
          role: "input",
          locators: node ? buildLocators(node, tree) : [],
          bounds: node?.bounds,
          enabled: node?.enabled,
          sensitive,
        },
        value: sensitive ? undefined : state.text,
        redactedKey: sensitive ? normalizeLabel(state.label).replace(/\s+/g, "_") : undefined,
      });
    }
  }

  private async handleGesture(gesture: Gesture): Promise<void> {
    if (this.stopped) return;
    const source = this.lastSource;
    if (!source) return;

    if (gesture.kind === "swipe") {
      this.pushEvent({
        t: this.now(),
        kind: "swipe",
        screenKey: this.lastScreenKey,
        fingerprint: this.lastFingerprint,
        note: `Desplazamiento de (${gesture.x},${gesture.y}) a (${gesture.toX},${gesture.toY})`,
      });
      return;
    }

    const nodes = extractBoundedNodes(source);
    const hit = hitTest(nodes, gesture.x, gesture.y, { appPackage: this.options.appPackage });
    const framePath = await this.captureFrame("tap");

    if (!hit) {
      this.pushEvent({
        t: this.now(),
        kind: "note",
        screenKey: this.lastScreenKey,
        fingerprint: this.lastFingerprint,
        note: `Toque en (${gesture.x},${gesture.y}) fuera de la jerarquía de la app`,
        framePath,
      });
      return;
    }

    this.pushEvent({
      t: this.now(),
      kind: "tap",
      screenKey: this.lastScreenKey,
      fingerprint: this.lastFingerprint,
      target: hit.target,
      framePath,
      note: hit.fallback ? "Resuelto sin control clickeable bajo el toque" : undefined,
    });
    this.log(
      `[recording] toque -> "${hit.target.label || "(sin etiqueta)"}" ${hit.fallback ? "(aproximado)" : ""}`,
    );

    // Let the app settle, then see where it went.
    const from = this.lastScreenKey;
    this.readChain = this.readChain.then(async () => {
      await new Promise((r) => setTimeout(r, this.options.settleAfterTapMs ?? 1400));
      const after = await this.readSource();
      if (!after || this.stopped) return;
      const { changed, screenKey } = this.absorbScreen(after);
      if (changed && screenKey !== from) {
        this.lastScreenKey = screenKey;
        this.pushEvent({
          t: this.now(),
          kind: "screen_change",
          screenKey: from,
          toScreenKey: screenKey,
          fingerprint: this.lastFingerprint,
          framePath: await this.captureFrame("screen"),
        });
        this.log(`[recording] pantalla -> ${this.screens.get(screenKey)?.title ?? screenKey}`);
      }
    });
    await this.readChain;
  }

  /**
   * Starts observing. Resolves once the streams are live, not when recording ends.
   *
   * Returns false when touches cannot be captured on this device, so the caller can fail the
   * job loudly instead of producing a trace with screens but no actions.
   */
  async start(): Promise<boolean> {
    const touchDevices = await this.calibrate();
    if (!touchDevices) return false;

    fs.mkdirSync(this.options.framesDir, { recursive: true });

    const initial = await this.readSource();
    if (initial) {
      const { screenKey } = this.absorbScreen(initial);
      this.lastScreenKey = screenKey;
      this.pushEvent({
        t: 0,
        kind: "launch",
        screenKey,
        fingerprint: this.lastFingerprint,
        framePath: await this.captureFrame("launch"),
      });
    }

    // One parser per candidate, each filtered to its own device, and the whole getevent
    // stream feeding all of them: which node actually delivers touches cannot be known from
    // the probe, so the stream itself decides. The first node to complete a gesture wins and
    // the rest are dropped, so a panel mirrored onto a second node cannot double-report.
    const parsers = touchDevices.map((device) => ({
      devicePath: device.devicePath,
      parser: createTouchStreamParser({
        calibration: device.calibration,
        devicePath: device.devicePath,
      }),
    }));
    let activeDevice: string | null = parsers.length === 1 ? parsers[0]!.devicePath : null;

    this.touchProcess = spawn(
      this.adb(),
      ["-s", this.options.deviceId, "shell", "getevent", "-lt"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let buffer = "";
    this.touchProcess.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        for (const { devicePath, parser } of parsers) {
          if (activeDevice && devicePath !== activeDevice) continue;
          for (const gesture of parser.push(line)) {
            if (!activeDevice) {
              activeDevice = devicePath;
              this.log(`[recording] toques llegando por ${devicePath}`);
            }
            void this.handleGesture(gesture).catch((err) =>
              this.log(`[recording] error procesando gesto: ${err instanceof Error ? err.message : String(err)}`),
            );
          }
        }
      }
    });
    this.touchProcess.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8").trim();
      if (text) this.log(`[recording] getevent: ${text.slice(0, 200)}`);
    });
    this.touchProcess.on("exit", (code) => {
      if (!this.stopped) this.log(`[recording] el stream de toques terminó (code=${code})`);
    });

    const interval = this.options.pollIntervalMs ?? 1200;
    this.pollTimer = setInterval(() => {
      this.readChain = this.readChain.then(async () => {
        if (this.stopped) return;
        const source = await this.readSource();
        if (!source) return;
        const { changed, screenKey } = this.absorbScreen(source);
        if (changed && screenKey !== this.lastScreenKey) {
          const from = this.lastScreenKey;
          this.lastScreenKey = screenKey;
          this.pushEvent({
            t: this.now(),
            kind: "screen_change",
            screenKey: from,
            toScreenKey: screenKey,
            fingerprint: this.lastFingerprint,
          });
        }
      });
    }, interval);

    this.log("[recording] grabación activa: interactúa con la app en el dispositivo");
    return true;
  }

  async stop(): Promise<{ events: RecordedEvent[]; screens: RecordedScreen[] }> {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.touchProcess?.kill();
    this.touchProcess = null;
    await this.readChain.catch(() => undefined);
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

/** Stable id for a recording, short enough to read in a log line. */
export function newRecordingId(): string {
  return createHash("sha1").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 32);
}
