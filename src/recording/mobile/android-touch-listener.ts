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

export type TouchCalibration = {
  /** Raw range reported by the touchscreen for ABS_MT_POSITION_X / _Y. */
  rawMaxX: number;
  rawMaxY: number;
  /** Display size in pixels, from `wm size`. */
  screenWidth: number;
  screenHeight: number;
};

export type Gesture =
  | { kind: "tap"; x: number; y: number; t: number }
  | { kind: "swipe"; x: number; y: number; toX: number; toY: number; t: number; durationMs: number };

const HEX_LINE_RE =
  /^\[\s*([\d.]+)\]\s+(\S+):\s+(EV_\w+)\s+(\w+)\s+([0-9a-fA-F]+)\s*$/;

const NO_CONTACT = "ffffffff";

export type TouchParserOptions = {
  calibration: TouchCalibration;
  /** Maximum travel, in display pixels, still considered a tap. Default 24. */
  tapMaxDistancePx?: number;
  /** Only listen to this input device path (e.g. /dev/input/event1). */
  devicePath?: string;
};

/**
 * Scales a raw touchscreen coordinate to display pixels.
 *
 * Emulators usually report a raw range identical to the display, which is exactly why this
 * must not be skipped: it works by accident there and silently misplaces every tap on a real
 * phone, where the digitizer is typically a higher resolution than the panel.
 */
export function scalePoint(
  rawX: number,
  rawY: number,
  calibration: TouchCalibration,
): { x: number; y: number } {
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
} as const;

/**
 * Reads the `max` of one axis out of a device block.
 *
 * Axis lines read `ABS_MT_POSITION_X : value 0, min 0, max 1439, ...` when labelled and
 * `0035  : value 0, min 0, max 1439, ...` when not. Requiring the `: value ... max` tail is
 * what stops a bare code listed under the KEY section from being taken for an axis.
 */
function axisMax(block: string, names: readonly string[]): number | null {
  for (const name of names) {
    const m = block.match(new RegExp(`(?:^|[^\\w])${name}\\s*:\\s*value[^\\n]*?max\\s+(-?\\d+)`));
    if (m) {
      const value = Number(m[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return null;
}

export type TouchProbe = {
  devicePath: string;
  rawMaxX: number;
  rawMaxY: number;
  /** `mt` when the panel reports multitouch axes, `st` for a single-touch digitizer. */
  axes: "mt" | "st";
};

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
export function parseTouchDevices(geteventProbeOutput: string): TouchProbe[] {
  const multiTouch: TouchProbe[] = [];
  const singleTouch: TouchProbe[] = [];

  for (const block of geteventProbeOutput.split(/^add device \d+:\s*/m).slice(1)) {
    const devicePath = block.split(/\r?\n/, 1)[0]?.trim();
    if (!devicePath) continue;

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
export function summarizeProbedDevices(geteventProbeOutput: string): string[] {
  return geteventProbeOutput
    .split(/^add device \d+:\s*/m)
    .slice(1)
    .map((block) => {
      const devicePath = block.split(/\r?\n/, 1)[0]?.trim();
      if (!devicePath) return "";
      const name = block.match(/name:\s*"([^"]*)"/)?.[1] ?? "";
      return name ? `${devicePath} (${name})` : devicePath;
    })
    .filter((entry) => entry.length > 0);
}

/** Parses `wm size` output ("Physical size: 1080x2400"), preferring an override size. */
export function parseScreenSize(wmSizeOutput: string): { width: number; height: number } | null {
  const override = wmSizeOutput.match(/Override size:\s*(\d+)x(\d+)/);
  const physical = wmSizeOutput.match(/Physical size:\s*(\d+)x(\d+)/);
  const m = override ?? physical;
  if (!m) return null;
  return { width: Number(m[1]), height: Number(m[2]) };
}

type Contact = {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startT: number;
  /** Whether any coordinate was ever reported for this contact. */
  located: boolean;
};

/**
 * Reassembles gestures from getevent lines.
 *
 * Two device dialects have to work: those that frame a touch with BTN_TOUCH DOWN/UP, and
 * those that only flip ABS_MT_TRACKING_ID between a slot id and ffffffff. Treating either
 * signal as the frame boundary covers both without having to detect the dialect up front.
 */
export function createTouchStreamParser(options: TouchParserOptions) {
  const tapMax = options.tapMaxDistancePx ?? 24;
  let contact: Contact | null = null;
  let pendingX: number | null = null;
  let pendingY: number | null = null;
  let baseTime: number | null = null;

  /** Opens a contact at whatever position the current frame has already reported. */
  function beginContact(t: number): Contact {
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

  function releaseContact(t: number): Gesture | null {
    if (!contact) return null;
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
    const gesture: Gesture =
      distance <= tapMax
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
    push(line: string): Gesture[] {
      const m = line.match(HEX_LINE_RE);
      if (!m) return [];
      const [, tsRaw, device, type, code, valueHex] = m;
      if (options.devicePath && device !== options.devicePath) return [];

      const tsMs = Number(tsRaw) * 1000;
      if (baseTime === null) baseTime = tsMs;
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
          if (!contact) contact = beginContact(t);
          return [];
        }
        const g = releaseContact(t);
        return g ? [g] : [];
      }
      if (type === "EV_SYN" && code === "SYN_REPORT") {
        if (contact) {
          if (pendingX !== null) contact.lastX = pendingX;
          if (pendingY !== null) contact.lastY = pendingY;
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
    flush(): Gesture[] {
      const g = releaseContact(contact ? contact.startT : 0);
      return g ? [g] : [];
    },
  };
}
