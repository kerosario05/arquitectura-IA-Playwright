"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AndroidSessionRecorder = void 0;
exports.isSensitiveLabel = isSensitiveLabel;
exports.readableTitle = readableTitle;
exports.newRecordingId = newRecordingId;
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_crypto_1 = require("node:crypto");
const android_sdk_1 = require("../../mobile/android-sdk");
const mobile_knowledge_extractor_1 = require("../../mobile/mobile-knowledge-extractor");
const android_touch_listener_1 = require("./android-touch-listener");
const tap_hit_tester_1 = require("./tap-hit-tester");
const execFileAsync = (0, node_util_1.promisify)(node_child_process_1.execFile);
/** Field labels whose content is redacted regardless of project configuration. */
const ALWAYS_SENSITIVE = [
    "clave", "contrasena", "contraseña", "password", "pin", "otp", "codigo de validacion",
    "token", "cvv", "secret",
];
function normalizeLabel(raw) {
    return raw
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .trim();
}
function isSensitiveLabel(label, extra = []) {
    const normalized = normalizeLabel(label);
    if (!normalized)
        return false;
    return [...ALWAYS_SENSITIVE, ...extra.map(normalizeLabel)].some((needle) => needle.length > 0 && normalized.includes(needle));
}
/** Where the UI tree is dumped on the device before being read back and deleted. */
const SOURCE_DUMP_PATH = "/data/local/tmp/qa-recording-dump.xml";
/**
 * A screen name a person can read, or undefined when the screen offers none.
 *
 * The snapshot's own title is the first heading or text on screen, which on an icon-heavy
 * header is a private-use glyph from an icon font: unreadable in a report and useless as a
 * name. The first text carrying actual letters or digits is what a tester would call the
 * screen.
 */
function readableTitle(snapshot) {
    for (const candidate of [snapshot.title, ...snapshot.assertionTargets]) {
        const trimmed = candidate?.trim();
        if (!trimmed)
            continue;
        const letters = trimmed.replace(/[^\p{L}\p{N}]+/gu, "");
        if (letters.length >= 3)
            return trimmed.slice(0, 80);
    }
    return undefined;
}
/** Identity of an input across polls — resource id if present, else its position. */
function inputKey(node) {
    return node.resourceId ?? `@${node.bounds.x},${node.bounds.y}`;
}
class AndroidSessionRecorder {
    options;
    touchProcess = null;
    pollTimer = null;
    startedAt = Date.now();
    events = [];
    screens = new Map();
    lastSource = null;
    lastScreenKey = "unknown";
    lastFingerprint = "";
    inputs = new Map();
    seq = 0;
    stopped = false;
    calibration = null;
    /** Serializes source reads so a tap-triggered read never races the periodic one. */
    readChain = Promise.resolve();
    constructor(options) {
        this.options = options;
    }
    log(line) {
        this.options.onLog?.(line);
    }
    adb() {
        return (0, android_sdk_1.resolveAndroidSdk)().adbPath;
    }
    async adbShell(command) {
        const { stdout } = await execFileAsync(this.adb(), ["-s", this.options.deviceId, "shell", command], { maxBuffer: 32 * 1024 * 1024 });
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
    async calibrate() {
        try {
            let probe = await this.adbShell("getevent -lp");
            let devices = (0, android_touch_listener_1.parseTouchDevices)(probe);
            if (devices.length === 0) {
                probe = await this.adbShell("getevent -p");
                devices = (0, android_touch_listener_1.parseTouchDevices)(probe);
            }
            if (devices.length === 0) {
                const seen = (0, android_touch_listener_1.summarizeProbedDevices)(probe);
                this.log(seen.length
                    ? `[recording] ningún dispositivo de entrada reporta ejes de posición; vistos: ${seen.join(", ")}`
                    : "[recording] getevent no listó dispositivos de entrada (¿permisos de /dev/input?)");
                return null;
            }
            if (devices.every((device) => device.axes === "st")) {
                this.log("[recording] el panel solo reporta un contacto (ABS_X/ABS_Y); se grabará igual");
            }
            const size = (0, android_touch_listener_1.parseScreenSize)(await this.adbShell("wm size"));
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
                },
            }));
            this.calibration = calibrated[0].calibration;
            this.log(`[recording] calibrado sobre ${calibrated.length} dispositivo(s) táctil(es) [${devices
                .map((device) => `${device.devicePath} ${device.rawMaxX}x${device.rawMaxY}`)
                .join(", ")}] pantalla=${size.width}x${size.height}`);
            return calibrated;
        }
        catch (err) {
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
    async readSource() {
        try {
            const out = await this.adbShell(`uiautomator dump ${SOURCE_DUMP_PATH} >/dev/null 2>&1; cat ${SOURCE_DUMP_PATH}; rm -f ${SOURCE_DUMP_PATH}`);
            const start = out.indexOf("<?xml");
            const end = out.lastIndexOf("</hierarchy>");
            if (start === -1 || end === -1)
                return null;
            return out.slice(start, end + "</hierarchy>".length);
        }
        catch {
            return null;
        }
    }
    pushEvent(event) {
        const full = { ...event, seq: this.seq++ };
        this.events.push(full);
        this.options.onEvent?.(full);
        return full;
    }
    now() {
        return Date.now() - this.startedAt;
    }
    async captureFrame(tag) {
        const file = path.join(this.options.framesDir, `${String(this.seq).padStart(4, "0")}-${tag}.png`);
        try {
            const { stdout } = await execFileAsync(this.adb(), ["-s", this.options.deviceId, "exec-out", "screencap", "-p"], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
            fs.writeFileSync(file, stdout);
            return file;
        }
        catch {
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
    absorbScreen(source) {
        const snapshot = (0, mobile_knowledge_extractor_1.extractMobileScreenSnapshot)(source);
        const nodes = (0, tap_hit_tester_1.extractBoundedNodes)(source);
        const scoped = this.options.appPackage
            ? nodes.filter((n) => n.package === this.options.appPackage)
            : nodes;
        const controls = scoped
            .filter((n) => n.clickable && (0, tap_hit_tester_1.nodeLabel)(n).length > 0)
            .map((n) => ({
            label: (0, tap_hit_tester_1.nodeLabel)(n),
            role: (0, tap_hit_tester_1.nodeRole)(n),
            locators: (0, tap_hit_tester_1.buildLocators)(n, nodes),
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
            const recordedScreen = {
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
        const nextInputs = new Map();
        for (const node of scoped) {
            if ((0, tap_hit_tester_1.nodeRole)(node) !== "input")
                continue;
            const key = inputKey(node);
            const label = (0, tap_hit_tester_1.nodeLabel)(node) || node.contentDesc || "campo";
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
    detectFills(next, tree) {
        for (const [key, state] of next) {
            const previous = this.inputs.get(key);
            if (previous && previous.text === state.text)
                continue;
            if (!state.text)
                continue;
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
                    locators: node ? (0, tap_hit_tester_1.buildLocators)(node, tree) : [],
                    bounds: node?.bounds,
                    enabled: node?.enabled,
                    sensitive,
                },
                value: sensitive && !this.options.persistQaCredentials ? undefined : state.text,
                redactedKey: sensitive ? normalizeLabel(state.label).replace(/\s+/g, "_") : undefined,
            });
        }
    }
    async handleGesture(gesture) {
        if (this.stopped)
            return;
        const source = this.lastSource;
        if (!source)
            return;
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
        const nodes = (0, tap_hit_tester_1.extractBoundedNodes)(source);
        const hit = (0, tap_hit_tester_1.hitTest)(nodes, gesture.x, gesture.y, { appPackage: this.options.appPackage });
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
        this.log(`[recording] toque -> "${hit.target.label || "(sin etiqueta)"}" ${hit.fallback ? "(aproximado)" : ""}`);
        // Let the app settle, then see where it went.
        const from = this.lastScreenKey;
        this.readChain = this.readChain.then(async () => {
            await new Promise((r) => setTimeout(r, this.options.settleAfterTapMs ?? 1400));
            const after = await this.readSource();
            if (!after || this.stopped)
                return;
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
    async start() {
        const touchDevices = await this.calibrate();
        if (!touchDevices)
            return false;
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
            parser: (0, android_touch_listener_1.createTouchStreamParser)({
                calibration: device.calibration,
                devicePath: device.devicePath,
            }),
        }));
        let activeDevice = parsers.length === 1 ? parsers[0].devicePath : null;
        this.touchProcess = (0, node_child_process_1.spawn)(this.adb(), ["-s", this.options.deviceId, "shell", "getevent", "-lt"], { stdio: ["ignore", "pipe", "pipe"] });
        let buffer = "";
        this.touchProcess.stdout?.on("data", (chunk) => {
            buffer += chunk.toString("utf8");
            const lines = buffer.split(/\r?\n/);
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                for (const { devicePath, parser } of parsers) {
                    if (activeDevice && devicePath !== activeDevice)
                        continue;
                    for (const gesture of parser.push(line)) {
                        if (!activeDevice) {
                            activeDevice = devicePath;
                            this.log(`[recording] toques llegando por ${devicePath}`);
                        }
                        void this.handleGesture(gesture).catch((err) => this.log(`[recording] error procesando gesto: ${err instanceof Error ? err.message : String(err)}`));
                    }
                }
            }
        });
        this.touchProcess.stderr?.on("data", (chunk) => {
            const text = chunk.toString("utf8").trim();
            if (text)
                this.log(`[recording] getevent: ${text.slice(0, 200)}`);
        });
        this.touchProcess.on("exit", (code) => {
            if (!this.stopped)
                this.log(`[recording] el stream de toques terminó (code=${code})`);
        });
        const interval = this.options.pollIntervalMs ?? 1200;
        this.pollTimer = setInterval(() => {
            this.readChain = this.readChain.then(async () => {
                if (this.stopped)
                    return;
                const source = await this.readSource();
                if (!source)
                    return;
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
    async stop() {
        this.stopped = true;
        if (this.pollTimer)
            clearInterval(this.pollTimer);
        this.pollTimer = null;
        this.touchProcess?.kill();
        this.touchProcess = null;
        await this.readChain.catch(() => undefined);
        return { events: [...this.events], screens: [...this.screens.values()] };
    }
    snapshotProgress() {
        return {
            events: this.events.length,
            screens: this.screens.size,
            currentScreen: this.screens.get(this.lastScreenKey)?.title ?? this.lastScreenKey,
        };
    }
}
exports.AndroidSessionRecorder = AndroidSessionRecorder;
/** Stable id for a recording, short enough to read in a log line. */
function newRecordingId() {
    return (0, node_crypto_1.createHash)("sha1").update(`${Date.now()}-${Math.random()}`).digest("hex").slice(0, 32);
}
