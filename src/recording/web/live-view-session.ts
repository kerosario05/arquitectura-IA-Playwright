import type { RecordingViewport } from "./recording-presentation";

/**
 * Streams a headless recording page to QA Lab viewers and replays their input into it.
 *
 * Frames come from CDP `Page.startScreencast` (JPEG, only when the page repaints) and input goes
 * back through CDP `Input.*`. CDP input reaches the page as TRUSTED events, so Capture V2 records
 * a streamed click exactly like a click on a visible browser -- nothing in the capture path knows
 * the difference.
 *
 * Deliberately small dependency surface (`LiveCdp`, `LiveViewerSocket`) so it is testable without
 * a browser or a network.
 */

export type LiveCdp = {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: string, handler: (payload: any) => void): void;
  off?(event: string, handler: (payload: any) => void): void;
};

export type LiveViewerSocket = {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: string | Buffer, options?: { binary?: boolean }): void;
  close(code?: number, reason?: string): void;
  on(event: "message", handler: (data: unknown) => void): void;
  on(event: "close", handler: () => void): void;
};

export type LivePage = {
  url(): string;
  goBack(): Promise<unknown>;
  reload(): Promise<unknown>;
};

export type LiveViewSessionOptions = {
  cdp: () => Promise<LiveCdp>;
  page: LivePage;
  viewport: RecordingViewport;
  jpegQuality?: number;
  /** A viewer this far behind gets frames dropped (never queued: stale frames only add lag). */
  maxBufferedBytes?: number;
  log?: (line: string) => void;
};

/** Client -> server. Coordinates are in page (viewport) pixels. */
export type LiveClientMessage =
  | { t: "mouse"; type: "mousePressed" | "mouseReleased" | "mouseMoved"; x: number; y: number; button?: "left" | "right" | "middle" | "none"; clickCount?: number; seq?: number }
  | { t: "wheel"; x: number; y: number; dx: number; dy: number }
  | { t: "key"; type: "keyDown" | "keyUp"; key: string; code?: string; text?: string; keyCode?: number; modifiers?: number; seq?: number }
  | { t: "text"; text: string; seq?: number }
  | { t: "nav"; action: "back" | "reload" }
  | { t: "ping"; ts: number };

const SOCKET_OPEN = 1;
const MOUSE_TYPES = new Set(["mousePressed", "mouseReleased", "mouseMoved"]);
const MOUSE_BUTTONS = new Set(["left", "right", "middle", "none"]);
const MAX_TEXT_LENGTH = 2_000;

type Viewer = { socket: LiveViewerSocket; canControl: boolean };

export class LiveViewSession {
  private readonly viewers = new Set<Viewer>();
  private cdpPromise: Promise<LiveCdp> | null = null;
  private screencasting = false;
  private closed = false;
  private lastInputSeq = 0;
  /** Last time a viewer acted or connected -- read by the idle stop. */
  lastActivityAt = Date.now();
  framesSent = 0;
  framesDropped = 0;

  constructor(private readonly options: LiveViewSessionOptions) {}

  get viewerCount(): number {
    return this.viewers.size;
  }

  async attachViewer(socket: LiveViewerSocket, access: { canControl: boolean }): Promise<void> {
    if (this.closed) {
      socket.close(4410, "recording_closed");
      return;
    }
    const viewer: Viewer = { socket, canControl: access.canControl };
    this.viewers.add(viewer);
    this.lastActivityAt = Date.now();
    socket.on("close", () => this.detach(viewer));
    socket.on("message", (data) => { void this.onMessage(viewer, data); });
    this.sendJson(socket, { t: "hello", viewport: this.options.viewport, canControl: viewer.canControl, url: this.options.page.url() });
    await this.startScreencast();
  }

  /** Ends the stream for everyone (the recording stopped). */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const viewer of this.viewers) viewer.socket.close(4410, "recording_closed");
    this.viewers.clear();
    await this.stopScreencast();
  }

  private detach(viewer: Viewer): void {
    this.viewers.delete(viewer);
    this.lastActivityAt = Date.now();
    if (this.viewers.size === 0) void this.stopScreencast();
  }

  private cdp(): Promise<LiveCdp> {
    if (!this.cdpPromise) {
      this.cdpPromise = this.options.cdp().then((cdp) => {
        cdp.on("Page.screencastFrame", (frame) => this.onFrame(cdp, frame));
        return cdp;
      });
    }
    return this.cdpPromise;
  }

  private async startScreencast(): Promise<void> {
    if (this.screencasting || this.closed) return;
    this.screencasting = true;
    const { width, height } = this.options.viewport;
    try {
      await (await this.cdp()).send("Page.startScreencast", {
        format: "jpeg",
        quality: this.options.jpegQuality ?? 60,
        maxWidth: width,
        maxHeight: height,
        everyNthFrame: 1,
      });
    } catch (err) {
      this.screencasting = false;
      this.options.log?.(`[live-view] screencast start failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async stopScreencast(): Promise<void> {
    if (!this.screencasting || !this.cdpPromise) return;
    this.screencasting = false;
    await (await this.cdpPromise).send("Page.stopScreencast").catch(() => undefined);
  }

  private onFrame(cdp: LiveCdp, frame: { data: string; sessionId: number; metadata?: { deviceWidth?: number; deviceHeight?: number } }): void {
    // Chromium only produces the next frame once this one is acknowledged.
    cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
    const header = JSON.stringify({
      t: "frame",
      w: frame.metadata?.deviceWidth ?? this.options.viewport.width,
      h: frame.metadata?.deviceHeight ?? this.options.viewport.height,
      inputSeq: this.lastInputSeq,
      url: this.options.page.url(),
    });
    const image = Buffer.from(frame.data, "base64");
    const limit = this.options.maxBufferedBytes ?? 512 * 1024;
    for (const viewer of this.viewers) {
      if (viewer.socket.readyState !== SOCKET_OPEN) continue;
      if (viewer.socket.bufferedAmount > limit) {
        this.framesDropped += 1;
        continue;
      }
      viewer.socket.send(header);
      viewer.socket.send(image, { binary: true });
      this.framesSent += 1;
    }
  }

  private async onMessage(viewer: Viewer, data: unknown): Promise<void> {
    const message = parseClientMessage(data);
    if (!message) return;
    if (message.t === "ping") {
      this.sendJson(viewer.socket, { t: "pong", ts: message.ts });
      return;
    }
    if (!viewer.canControl) {
      this.sendJson(viewer.socket, { t: "error", code: "view_only" });
      return;
    }
    this.lastActivityAt = Date.now();
    try {
      await this.dispatch(message);
    } catch (err) {
      this.options.log?.(`[live-view] input failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async dispatch(message: Exclude<LiveClientMessage, { t: "ping" }>): Promise<void> {
    const cdp = await this.cdp();
    const clamp = (value: number, max: number) => Math.min(Math.max(0, value), max);
    const { width, height } = this.options.viewport;
    switch (message.t) {
      case "mouse": {
        if (message.seq) this.lastInputSeq = message.seq;
        const idle = message.type === "mouseMoved";
        await cdp.send("Input.dispatchMouseEvent", {
          type: message.type,
          x: clamp(message.x, width),
          y: clamp(message.y, height),
          button: message.button ?? (idle ? "none" : "left"),
          clickCount: message.clickCount ?? (idle ? 0 : 1),
        });
        return;
      }
      case "wheel":
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: clamp(message.x, width),
          y: clamp(message.y, height),
          deltaX: message.dx,
          deltaY: message.dy,
        });
        return;
      case "key": {
        if (message.seq) this.lastInputSeq = message.seq;
        // A printable keyDown carries `text` so the page receives keypress/input like a real key.
        const type = message.type === "keyUp" ? "keyUp" : message.text ? "keyDown" : "rawKeyDown";
        await cdp.send("Input.dispatchKeyEvent", {
          type,
          key: message.key,
          code: message.code,
          text: type === "keyDown" ? message.text : undefined,
          windowsVirtualKeyCode: message.keyCode,
          nativeVirtualKeyCode: message.keyCode,
          modifiers: message.modifiers ?? 0,
        });
        return;
      }
      case "text":
        if (message.seq) this.lastInputSeq = message.seq;
        await cdp.send("Input.insertText", { text: message.text });
        return;
      case "nav":
        if (message.action === "back") await this.options.page.goBack().catch(() => undefined);
        else await this.options.page.reload().catch(() => undefined);
        return;
    }
  }

  private sendJson(socket: LiveViewerSocket, payload: unknown): void {
    if (socket.readyState === SOCKET_OPEN) socket.send(JSON.stringify(payload));
  }
}

/** Strict parsing: anything malformed is ignored rather than forwarded to the browser. */
export function parseClientMessage(data: unknown): LiveClientMessage | undefined {
  let value: any;
  try {
    value = JSON.parse(typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const finite = (n: unknown) => typeof n === "number" && Number.isFinite(n);
  switch (value.t) {
    case "ping":
      return finite(value.ts) ? { t: "ping", ts: value.ts } : undefined;
    case "mouse":
      if (!MOUSE_TYPES.has(value.type) || !finite(value.x) || !finite(value.y)) return undefined;
      if (value.button !== undefined && !MOUSE_BUTTONS.has(value.button)) return undefined;
      return {
        t: "mouse",
        type: value.type,
        x: value.x,
        y: value.y,
        ...(value.button ? { button: value.button } : {}),
        ...(finite(value.clickCount) ? { clickCount: Math.min(Math.max(0, Math.trunc(value.clickCount)), 3) } : {}),
        ...(finite(value.seq) ? { seq: value.seq } : {}),
      };
    case "wheel":
      return finite(value.x) && finite(value.y) && finite(value.dx) && finite(value.dy)
        ? { t: "wheel", x: value.x, y: value.y, dx: value.dx, dy: value.dy }
        : undefined;
    case "key":
      if ((value.type !== "keyDown" && value.type !== "keyUp") || typeof value.key !== "string" || value.key.length === 0 || value.key.length > 32) return undefined;
      return {
        t: "key",
        type: value.type,
        key: value.key,
        ...(typeof value.code === "string" ? { code: value.code.slice(0, 32) } : {}),
        ...(typeof value.text === "string" && value.text.length <= 4 ? { text: value.text } : {}),
        ...(finite(value.keyCode) ? { keyCode: value.keyCode } : {}),
        ...(finite(value.modifiers) ? { modifiers: value.modifiers } : {}),
        ...(finite(value.seq) ? { seq: value.seq } : {}),
      };
    case "text":
      return typeof value.text === "string" && value.text.length > 0 && value.text.length <= MAX_TEXT_LENGTH
        ? { t: "text", text: value.text, ...(finite(value.seq) ? { seq: value.seq } : {}) }
        : undefined;
    case "nav":
      return value.action === "back" || value.action === "reload" ? { t: "nav", action: value.action } : undefined;
    default:
      return undefined;
  }
}
