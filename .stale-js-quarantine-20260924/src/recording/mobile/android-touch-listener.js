"use strict";
/**
 * Turns the kernel's raw input stream into gestures.
 *
 * Appium emits no user events — it only drives. To observe a HUMAN driving the app the
 * recorder reads `adb shell getevent -lt`, which streams every touch the touchscreen device
 * reports, and reassembles taps and swipes from it.
 *
 * The parser is a pure state machine over lines so the protocol handling (which is fiddly:
 * hex values, per-contact tracking ids, devices that report BTN_TOUCH and devices that only
 * report a tracking id) is unit-testable without a device attached.
 *
 * Coordinates arrive in the touchscreen's own resolution, which is NOT the display
 * resolution on many panels, so every point is scaled through a calibration read from
 * `getevent -lp`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.scalePoint = scalePoint;
exports.parseTouchDevices = parseTouchDevices;
exports.summarizeProbedDevices = summarizeProbedDevices;
exports.parseScreenSize = parseScreenSize;
exports.createTouchStreamParser = createTouchStreamParser;
const HEX_LINE_RE = /^\[\s*([\d.]+)\]\s+(\S+):\s+(EV_\w+)\s+(\w+)\s+([0-9a-fA-F]+)\s*$/;
const NO_CONTACT = "ffffffff";
/**
 * Scales a raw touchscreen coordinate to display pixels.
 *
 * Emulators usually report a raw range identical to the display, which is exactly why this
 * must not be skipped: it works by accident there and silently misplaces every tap on a real
 * phone, where the digitizer is typically a higher resolution than the panel.
 */
function scalePoint(rawX, rawY, calibration) {
    const { rawMaxX, rawMaxY, screenWidth, screenHeight } = calibration;
    const sx = rawMaxX > 0 ? (rawX / rawMaxX) * screenWidth : rawX;
    const sy = rawMaxY > 0 ? (rawY / rawMaxY) * screenHeight : rawY;
    return { x: Math.round(sx), y: Math.round(sy) };
}
/**
 * Axis codes as `getevent` prints them.
 *
 * Only `getevent -l` prints the symbolic names; the bare `-p` form prints the raw hex code of
 * each axis, so a probe parser that recognises only the labels finds nothing on a real device.
 * Accepting both dialects removes the dependency on which flag the caller used.
 */
const AXIS_CODES = {
    mtX: ["ABS_MT_POSITION_X", "0035"],
    mtY: ["ABS_MT_POSITION_Y", "0036"],
    stX: ["ABS_X", "0000"],
    stY: ["ABS_Y", "0001"],
};
/**
 * Reads the `max` of one axis out of a device block.
 *
 * Axis lines read `ABS_MT_POSITION_X : value 0, min 0, max 1439, ...` when labelled and
 * `0035  : value 0, min 0, max 1439, ...` when not. Requiring the `: value ... max` tail is
 * what stops a bare code listed under the KEY section from being taken for an axis.
 */
function axisMax(block, names) {
    for (const name of names) {
        const m = block.match(new RegExp(`(?:^|[^\\w])${name}\\s*:\\s*value[^\\n]*?max\\s+(-?\\d+)`));
        if (m) {
            const value = Number(m[1]);
            if (Number.isFinite(value) && value > 0)
                return value;
        }
    }
    return null;
}
/**
 * Parses `getevent -p` / `getevent -lp` output for every device that reports position axes.
 *
 * All of them are returned, not just the first, because "declares touch axes" does not mean
 * "delivers touches": the Android emulator exposes eleven identical `virtio_input_multi_touch_*`
 * nodes of which only the first ever emits, and picking one up front is a coin flip that ends
 * in a recording with screens and no taps. The caller listens to all of them and keeps the one
 * that actually speaks.
 *
 * Multitouch devices come first; a single-touch digitizer (ABS_X / ABS_Y — still shipped on
 * cheap panels and some emulator images) is kept as a fallback instead of being read as "no
 * touchscreen at all".
 */
function parseTouchDevices(geteventProbeOutput) {
    const multiTouch = [];
    const singleTouch = [];
    for (const block of geteventProbeOutput.split(/^add device \d+:\s*/m).slice(1)) {
        const devicePath = block.split(/\r?\n/, 1)[0]?.trim();
        if (!devicePath)
            continue;
        const mtX = axisMax(block, AXIS_CODES.mtX);
        const mtY = axisMax(block, AXIS_CODES.mtY);
        if (mtX !== null && mtY !== null) {
            multiTouch.push({ devicePath, rawMaxX: mtX, rawMaxY: mtY, axes: "mt" });
            continue;
        }
        const stX = axisMax(block, AXIS_CODES.stX);
        const stY = axisMax(block, AXIS_CODES.stY);
        if (stX !== null && stY !== null) {
            singleTouch.push({ devicePath, rawMaxX: stX, rawMaxY: stY, axes: "st" });
        }
    }
    return [...multiTouch, ...singleTouch];
}
/** Lists the input devices a probe saw, for the log line when no touchscreen is found. */
function summarizeProbedDevices(geteventProbeOutput) {
    return geteventProbeOutput
        .split(/^add device \d+:\s*/m)
        .slice(1)
        .map((block) => {
        const devicePath = block.split(/\r?\n/, 1)[0]?.trim();
        if (!devicePath)
            return "";
        const name = block.match(/name:\s*"([^"]*)"/)?.[1] ?? "";
        return name ? `${devicePath} (${name})` : devicePath;
    })
        .filter((entry) => entry.length > 0);
}
/** Parses `wm size` output ("Physical size: 1080x2400"), preferring an override size. */
function parseScreenSize(wmSizeOutput) {
    const override = wmSizeOutput.match(/Override size:\s*(\d+)x(\d+)/);
    const physical = wmSizeOutput.match(/Physical size:\s*(\d+)x(\d+)/);
    const m = override ?? physical;
    if (!m)
        return null;
    return { width: Number(m[1]), height: Number(m[2]) };
}
/**
 * Reassembles gestures from getevent lines.
 *
 * Two device dialects have to work: those that frame a touch with BTN_TOUCH DOWN/UP, and
 * those that only flip ABS_MT_TRACKING_ID between a slot id and ffffffff. Treating either
 * signal as the frame boundary covers both without having to detect the dialect up front.
 */
function createTouchStreamParser(options) {
    const tapMax = options.tapMaxDistancePx ?? 24;
    let contact = null;
    let pendingX = null;
    let pendingY = null;
    let baseTime = null;
    /** Opens a contact at whatever position the current frame has already reported. */
    function beginContact(t) {
        const located = pendingX !== null && pendingY !== null;
        return {
            startX: pendingX ?? 0,
            startY: pendingY ?? 0,
            lastX: pendingX ?? 0,
            lastY: pendingY ?? 0,
            startT: t,
            located,
        };
    }
    function releaseContact(t) {
        if (!contact)
            return null;
        // A contact the stream never gave a position for has nowhere to land. Reporting it would
        // mean reusing the previous gesture's coordinates and inventing a tap on whatever control
        // happens to sit there.
        if (!contact.located) {
            contact = null;
            return null;
        }
        const start = scalePoint(contact.startX, contact.startY, options.calibration);
        const end = scalePoint(contact.lastX, contact.lastY, options.calibration);
        const distance = Math.hypot(end.x - start.x, end.y - start.y);
        const durationMs = Math.max(0, Math.round(t - contact.startT));
        const gesture = distance <= tapMax
            ? { kind: "tap", x: end.x, y: end.y, t: contact.startT }
            : {
                kind: "swipe",
                x: start.x,
                y: start.y,
                toX: end.x,
                toY: end.y,
                t: contact.startT,
                durationMs,
            };
        contact = null;
        return gesture;
    }
    return {
        /** Feeds one line; returns the gestures completed by it (usually none or one). */
        push(line) {
            const m = line.match(HEX_LINE_RE);
            if (!m)
                return [];
            const [, tsRaw, device, type, code, valueHex] = m;
            if (options.devicePath && device !== options.devicePath)
                return [];
            const tsMs = Number(tsRaw) * 1000;
            if (baseTime === null)
                baseTime = tsMs;
            const t = tsMs - baseTime;
            const value = parseInt(valueHex, 16);
            // A single-touch digitizer reports ABS_X / ABS_Y instead; multitouch panels that emit
            // both send identical values, so treating them as the same axis is safe either way.
            if (type === "EV_ABS" && (code === "ABS_MT_POSITION_X" || code === "ABS_X")) {
                pendingX = value;
                if (contact) {
                    contact.lastX = value;
                    if (!contact.located && pendingY !== null) {
                        contact.startX = value;
                        contact.startY = pendingY;
                        contact.located = true;
                    }
                }
                return [];
            }
            if (type === "EV_ABS" && (code === "ABS_MT_POSITION_Y" || code === "ABS_Y")) {
                pendingY = value;
                if (contact) {
                    contact.lastY = value;
                    if (!contact.located && pendingX !== null) {
                        contact.startX = pendingX;
                        contact.startY = value;
                        contact.located = true;
                    }
                }
                return [];
            }
            if (type === "EV_ABS" && code === "ABS_MT_TRACKING_ID") {
                if (valueHex.toLowerCase() === NO_CONTACT) {
                    const g = releaseContact(t);
                    return g ? [g] : [];
                }
                // A new contact begins; its coordinates may arrive before or after this line.
                contact = beginContact(t);
                return [];
            }
            if (type === "EV_KEY" && code === "BTN_TOUCH") {
                if (value === 1) {
                    if (!contact)
                        contact = beginContact(t);
                    return [];
                }
                const g = releaseContact(t);
                return g ? [g] : [];
            }
            if (type === "EV_SYN" && code === "SYN_REPORT") {
                if (contact) {
                    if (pendingX !== null)
                        contact.lastX = pendingX;
                    if (pendingY !== null)
                        contact.lastY = pendingY;
                }
                // Coordinates belong to the frame that carried them. Dropping them at the frame
                // boundary is what keeps a contact that reports no position of its own from
                // inheriting the previous gesture's — and landing a tap on the wrong control.
                pendingX = null;
                pendingY = null;
            }
            return [];
        },
        /** Flushes an in-flight contact when the stream ends mid-gesture. */
        flush() {
            const g = releaseContact(contact ? contact.startT : 0);
            return g ? [g] : [];
        },
    };
}
