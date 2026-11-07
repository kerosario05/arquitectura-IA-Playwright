import { spawn, execFile, type ChildProcess } from "node:child_process";
import { compactRecordedEvents } from "./compact-recorded-events";
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
  /**
   * adb server to talk to: the tunnel to the adb on the user's PC. Absent = the server's own
   * adb (default port 5037).
   */
  adb?: { adbPath: string; host?: string; port?: number };
  appPackage?: string;
  framesDir: string;
  /** How often the UI tree is re-read while the user explores. Default 1200ms. */
  pollIntervalMs?: number;
  /** Settle time after a tap before the resulting screen is read. Default 1400ms. */
  settleAfterTapMs?: number;
  /** Labels whose typed content must never be stored verbatim. */
  sensitiveLabels?: string[];
  /** QA-only project policy; false keeps secure values out of the trace. */
  persistQaCredentials?: boolean;
  onLog?: (line: string) => void;
  onEvent?: (event: RecordedEvent) => void;
  onScreen?: (screen: RecordedScreen) => void;
  /**
   * Reads the UI tree some other way than `uiautomator dump` (an Appium session that does not
   * wait for idle). Returns null when it cannot; the recorder then falls back to the dump.
   */
  readSource?: () => Promise<string | null>;
  /**
   * Opens the app. Called by start() once everything else is ready, right before the first
   * read: opening it earlier let the user tap its first screen ("Regístrate") while the
   * recorder was still setting up, and that first action was lost.
   */
  launchApp?: () => Promise<void>;
};

/** Field labels whose content is redacted regardless of project configuration. */
const ALWAYS_SENSITIVE = [
  "clave", "contrasena", "contraseña", "password", "pin", "otp", "codigo de validacion",
  "token", "cvv", "secret",
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

/** Global animation settings turned off while recording (restored exactly at stop). */
const ANIMATION_SCALES = ["animator_duration_scale", "window_animation_scale", "transition_animation_scale"] as const;

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
  private touchStreamReport: NodeJS.Timeout | null = null;
  /**
   * Original `animator_duration_scale` while the recorder has animations turned off, so stop()
   * puts it back (null = the setting did not exist and is deleted again).
   */
  private animatorScaleToRestore: { value: string | null } | null = null;

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
  /** A read is running; further requests only mark `readPending` instead of queueing. */
  private reading = false;
  /**
   * Key presses on the soft keyboard since the last read. A value found on a screen's first
   * read is normally state the screen came with; after the user typed, it is what they typed
   * (a slow screen can be read for the first time only once the code is complete).
   */
  private keyboardTapsSinceRead = 0;
  /** Taps that arrived before the first screen was read (the app was still opening). */
  private pendingGestures: Gesture[] = [];
  private readPending = false;
  /** The pending read follows a tap: its screen change gets a frame. */
  private readAfterTap = false;

  constructor(private readonly options: AndroidRecorderOptions) {}

  private log(line: string): void {
    this.options.onLog?.(line);
  }

  private adb(): string {
    return this.options.adb?.adbPath ?? resolveAndroidSdk().adbPath;
  }

  /** `-H/-P` of the chosen adb server, then `-s <device>`, then the command. */
  private deviceArgs(args: string[]): string[] {
    const { adb } = this.options;
    const server = adb?.host ? ["-H", adb.host, "-P", String(adb.port ?? 5037)] : [];
    return [...server, "-s", this.options.deviceId, ...args];
  }

  private async adbShell(command: string, timeoutMs?: number): Promise<string> {
    const { stdout } = await execFileAsync(
      this.adb(),
      this.deviceArgs(["shell", command]),
      { maxBuffer: 32 * 1024 * 1024, ...(timeoutMs ? { timeout: timeoutMs } : {}) },
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
    if (this.options.readSource) {
      const viaDriver = await this.options.readSource().catch(() => null);
      if (viaDriver && viaDriver.includes("<hierarchy")) return viaDriver;
    }
    try {
      let out = await this.dumpSource();
      // Screens that never stop animating (an OTP field with an animated cursor, a looping
      // loader) make uiautomator give up with "could not get idle state": the recorder would
      // not see that screen at all, nor anything typed on it. With animations off the same
      // screen dumps fine; they are restored when the recording stops.
      if (out.includes("could not get idle state") && !this.animatorScaleToRestore) {
        await this.disableAnimations();
        out = await this.dumpSource();
      }
      const start = out.indexOf("<?xml");
      const end = out.lastIndexOf("</hierarchy>");
      if (start === -1 || end === -1) return null;
      return out.slice(start, end + "</hierarchy>".length);
    } catch {
      return null;
    }
  }

  private dumpSource(): Promise<string> {
    return this.adbShell(
      `timeout 20 uiautomator dump ${SOURCE_DUMP_PATH} 2>&1 | grep -i "idle state"; cat ${SOURCE_DUMP_PATH} 2>/dev/null; rm -f ${SOURCE_DUMP_PATH}`,
      25_000,
    );
  }

  /**
   * Clicks made on a mirrored phone (Android Studio "Running Devices", scrcpy) are injected
   * by software and never reach the touchscreen, so getevent cannot see them: the recording
   * would get the screens and none of the taps. Says so up front, in the user's words.
   */
  private async warnIfMirrored(): Promise<void> {
    try {
      const ps = await this.adbShell('ps -A -o ARGS 2>/dev/null | grep -E "screensharing|scrcpy" | grep -v grep');
      if (!ps.trim()) return;
      const tool = ps.includes("screensharing") ? "la duplicación de pantalla de Android Studio" : "scrcpy";
      this.log(`[recording] AVISO: el teléfono está duplicado en el PC (${tool}). Los clics y lo que escribas desde el PC no se graban: toca y escribe en el propio teléfono.`);
    } catch {
      // Only a hint: never blocks the recording.
    }
  }

  /**
   * The tap fell where the soft keyboard is: the keyboard is shown (asked to the device, since
   * the last tree may predate it) and the tap is in the lower part of the screen it occupies.
   */
  private async onKeyboardArea(y: number): Promise<boolean> {
    const height = this.calibration?.screenHeight;
    if (!height || y < height * 0.5) return false;
    try {
      const ime = await this.adbShell("dumpsys input_method | grep -E \"mInputShown=|mWindowVisible=\"");
      return /mInputShown=true|mWindowVisible=true/.test(ime);
    } catch {
      return false;
    }
  }

  private async disableAnimations(): Promise<void> {
    try {
      const saved: Record<string, string | null> = {};
      for (const name of ANIMATION_SCALES) {
        const current = (await this.adbShell(`settings get global ${name}`)).trim();
        saved[name] = current && current !== "null" ? current : null;
      }
      this.animatorScaleToRestore = { value: JSON.stringify(saved) };
      await this.adbShell(ANIMATION_SCALES.map((name) => `settings put global ${name} 0`).join("; "));
      this.log("[recording] la pantalla no deja de animarse: animaciones del dispositivo desactivadas hasta detener la grabación");
    } catch (err) {
      this.log(`[recording] no se pudieron desactivar las animaciones: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async restoreAnimations(): Promise<void> {
    const saved = this.animatorScaleToRestore;
    if (!saved) return;
    this.animatorScaleToRestore = null;
    try {
      const values = JSON.parse(saved.value ?? "{}") as Record<string, string | null>;
      await this.adbShell(ANIMATION_SCALES.map((name) => values[name] == null
        ? `settings delete global ${name}`
        : `settings put global ${name} ${values[name]}`).join("; "));
      this.log("[recording] animaciones del dispositivo restauradas");
    } catch (err) {
      this.log(`[recording] no se pudieron restaurar las animaciones: ${err instanceof Error ? err.message : String(err)}`);
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

  /** Adds the screenshot to an event already recorded (and re-emits it so the trace keeps it). */
  private async attachFrame(event: RecordedEvent, tag: string): Promise<void> {
    const framePath = await this.captureFrame(tag);
    if (framePath) event.framePath = framePath;
  }

  private async captureFrame(tag: string): Promise<string | undefined> {
    const file = path.join(this.options.framesDir, `${String(this.seq).padStart(4, "0")}-${tag}.png`);
    try {
      const { stdout } = await execFileAsync(
        this.adb(),
        this.deviceArgs(["exec-out", "screencap", "-p"]),
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
      const recordedScreen: RecordedScreen = {
        screenKey,
        title: readableTitle(snapshot) ?? screenKey,
        fingerprint: snapshot.fingerprint,
        firstSeenAt: this.now(),
        controls,
        texts: snapshot.assertionTargets.slice(0, 40),
      };
      this.screens.set(screenKey, recordedScreen);
      this.options.onScreen?.(recordedScreen);
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
    this.keyboardTapsSinceRead = 0;

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
      if (previous === undefined && this.inputs.size === 0 && this.keyboardTapsSinceRead === 0) {
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
        value: sensitive && !this.options.persistQaCredentials ? undefined : state.text,
        redactedKey: sensitive ? normalizeLabel(state.label).replace(/\s+/g, "_") : undefined,
      });
    }
  }

  private async handleGesture(gesture: Gesture): Promise<void> {
    if (this.stopped) return;
    const source = this.lastSource;
    if (!source) {
      this.pendingGestures.push(gesture);
      return;
    }

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
    // The soft keyboard is another window, absent from the app's tree: a tap on it resolves to
    // whatever big container lies underneath. What was typed is recorded as the field's value
    // (a fill), so the key presses themselves are not actions.
    if ((!hit || hit.fallback) && (isKeyboardTap(nodes, gesture.y) || await this.onKeyboardArea(gesture.y))) {
      this.keyboardTapsSinceRead += 1;
      this.scheduleRead(600, false);
      return;
    }
    // The event is recorded NOW, with the screen the tap happened on; the screenshot (≈1 s
    // through the tunnel) is attached afterwards. Awaiting it first let the next screen read
    // overtake the tap, so "Regístrate" landed after "the app moved to Registro".
    const screenKey = this.lastScreenKey;
    const fingerprint = this.lastFingerprint;
    const width = this.calibration?.screenWidth ?? 0;
    const height = this.calibration?.screenHeight ?? 0;
    // A tap that only lands on a container covering (almost) the whole screen hit nothing the
    // user could mean: it is kept as a note, never as a "Presionar <fondo>" step.
    const onBackground = Boolean(hit?.fallback && hit.target.bounds && width > 0 && height > 0
      && hit.target.bounds.width * hit.target.bounds.height >= 0.8 * width * height);

    if (!hit || onBackground) {
      const event = this.pushEvent({
        t: this.now(),
        kind: "note",
        screenKey,
        fingerprint,
        note: onBackground
          ? `Toque en (${gesture.x},${gesture.y}) sobre el fondo de la pantalla, sin control`
          : `Toque en (${gesture.x},${gesture.y}) fuera de la jerarquía de la app`,
      });
      void this.attachFrame(event, "tap");
      this.scheduleRead(this.options.settleAfterTapMs ?? 1400, true);
      return;
    }

    const event = this.pushEvent({
      t: this.now(),
      kind: "tap",
      screenKey,
      fingerprint,
      target: hit.target,
      note: hit.fallback ? `Resuelto sin control clickeable bajo el toque (${gesture.x},${gesture.y})` : undefined,
    });
    void this.attachFrame(event, "tap");
    this.log(
      `[recording] toque (${gesture.x},${gesture.y}) -> "${hit.target.label || "(sin etiqueta)"}" ${hit.fallback ? "(aproximado)" : ""}`,
    );

    // Let the app settle, then see where it went.
    this.scheduleRead(this.options.settleAfterTapMs ?? 1400, true);
  }

  /**
   * Asks for a fresh read of the screen after `delayMs`.
   *
   * Reads are coalesced, never queued: one runs at a time and any number of requests made
   * meanwhile become ONE more read. Queueing a settle-and-read per tap (and one per poll)
   * let a fast typist build up tens of seconds of backlog, so every tap was hit-tested
   * against a screen the user had already left.
   */
  private scheduleRead(delayMs: number, afterTap: boolean): void {
    const request = () => {
      if (this.stopped) return;
      this.readPending = true;
      if (afterTap) this.readAfterTap = true;
      if (this.reading) return;
      this.reading = true;
      this.readChain = this.drainReads().finally(() => {
        this.reading = false;
      });
    };
    if (delayMs > 0) setTimeout(request, delayMs);
    else request();
  }

  private async drainReads(): Promise<void> {
    while (this.readPending && !this.stopped) {
      this.readPending = false;
      const afterTap = this.readAfterTap;
      this.readAfterTap = false;
      const source = await this.readSource();
      if (!source || this.stopped) continue;
      const from = this.lastScreenKey;
      const { changed, screenKey } = this.absorbScreen(source);
      if (changed && screenKey !== from) {
        this.lastScreenKey = screenKey;
        this.pushEvent({
          t: this.now(),
          kind: "screen_change",
          screenKey: from,
          toScreenKey: screenKey,
          fingerprint: this.lastFingerprint,
          ...(afterTap ? { framePath: await this.captureFrame("screen") } : {}),
        });
        this.log(`[recording] pantalla -> ${this.screens.get(screenKey)?.title ?? screenKey}`);
      }
    }
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
    await this.warnIfMirrored();
    // Loaders and animated cursors keep a screen from ever going idle, and uiautomator then
    // spends ~12 s failing to read it. Off for the whole recording, restored by stop().
    await this.disableAnimations();

    fs.mkdirSync(this.options.framesDir, { recursive: true });


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
      this.deviceArgs(["shell", "getevent", "-lt"]),
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let buffer = "";
    // Bytes seen on the touch stream: a recording with screens but no taps says whether the
    // stream went silent (transport) or carried touches nobody understood (parser).
    let streamBytes = 0;
    let reportedBytes = 0;
    this.touchStreamReport = setInterval(() => {
      if (streamBytes === reportedBytes) return;
      reportedBytes = streamBytes;
      this.log(`[recording] stream de toques: ${streamBytes} bytes recibidos${activeDevice ? ` (toques por ${activeDevice})` : " (sin toques reconocidos)"}`);
    }, 10_000);
    this.touchProcess.stdout?.on("data", (chunk: Buffer) => {
      streamBytes += chunk.length;
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
    // The touch stream is already live: the app opens now, and a tap made while its first
    // screen is being read waits in pendingGestures instead of being lost.
    await this.options.launchApp?.();
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
    const early = this.pendingGestures.splice(0);
    for (const gesture of early) await this.handleGesture(gesture).catch(() => undefined);

    this.pollTimer = setInterval(() => this.scheduleRead(0, false), interval);

    this.log("[recording] grabación activa: interactúa con la app en el dispositivo");
    return true;
  }

  async stop(): Promise<{ events: RecordedEvent[]; screens: RecordedScreen[] }> {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.touchStreamReport) clearInterval(this.touchStreamReport);
    this.touchStreamReport = null;
    this.touchProcess?.kill();
    this.touchProcess = null;
    await Promise.race([
      this.readChain.catch(() => undefined),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    await this.restoreAnimations();
    const screens = [...this.screens.values()];
    return { events: compactRecordedEvents(this.events, screens), screens };
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

/**
 * Whether a tap that hit no control fell on the soft keyboard: an input has focus (it owns the
 * keyboard) and the tap is below it, where the keyboard opens.
 */
export function isKeyboardTap(nodes: readonly BoundedNode[], y: number): boolean {
  return nodes.some((node) =>
    node.focused === true
    && /EditText/i.test(node.className ?? "")
    && y > node.bounds.y + node.bounds.height,
  );
}
