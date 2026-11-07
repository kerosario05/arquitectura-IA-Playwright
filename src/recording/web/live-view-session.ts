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
  bringToFront?(): Promise<unknown>;
};

export type LiveViewTab = { pageKey: string; url: string; title: string };

export type LiveViewSessionOptions = {
  cdp: () => Promise<LiveCdp>;
  page: LivePage;
  viewport: RecordingViewport;
  jpegQuality?: number;
  /** A viewer this far behind gets frames dropped (never queued: stale frames only add lag). */
  maxBufferedBytes?: number;
  /** Keep remote input disabled until the recorder's initial page navigation has completed. */
  ready?: boolean;
  getTabs?: () => Promise<LiveViewTab[]>;
  resolveTab?: (pageKey: string) => Promise<{ page: LivePage; createCdp: () => Promise<LiveCdp> } | undefined>;
  navigateUrl?: (url: string, newTab: boolean, currentPageKey?: string) => Promise<string>;
  onTabSelected?: (pageKey: string) => void | Promise<void>;
  onFileUpload?: (files: Array<{ name: string; mimeType: string; buffer: Buffer }>) => Promise<void>;
  fileChooserState?: () => { available: boolean; pageKey?: string; multiple?: boolean };
  log?: (line: string) => void;
};

/** Client -> server. Coordinates are in page (viewport) pixels. */
export type LiveClientMessage =
  | { t: "mouse"; type: "mousePressed" | "mouseReleased" | "mouseMoved"; x: number; y: number; button?: "left" | "right" | "middle" | "none"; clickCount?: number; seq?: number }
  | { t: "wheel"; x: number; y: number; dx: number; dy: number }
  | { t: "key"; type: "keyDown" | "keyUp"; key: string; code?: string; text?: string; keyCode?: number; modifiers?: number; seq?: number }
  | { t: "text"; text: string; seq?: number }
  | { t: "nav"; action: "back" | "reload" }
  | { t: "select_tab"; pageKey: string }
  | { t: "navigate"; url: string; newTab: boolean }
  | { t: "frame_ack"; frameId: number }
  | { t: "ping"; ts: number };

const SOCKET_OPEN = 1;
const MOUSE_TYPES = new Set(["mousePressed", "mouseReleased", "mouseMoved"]);
const MOUSE_BUTTONS = new Set(["left", "right", "middle", "none"]);
const MAX_TEXT_LENGTH = 2_000;
const FRAME_ACK_TIMEOUT_MS = 2_000;
const SHORTCUT_COMMANDS: Record<string, string> = { c: "copy", v: "paste", x: "cut", a: "selectAll" };
const CTRL_OR_META = 2 | 4;

/** Editing command for Ctrl/Cmd+C|V|X|A pressed in the viewer, so copy/paste work against the real page. */
export function editingCommandFor(message: { type: string; key: string; modifiers?: number }): string | undefined {
  if (message.type !== "keyDown" && message.type !== "rawKeyDown") return undefined;
  if (!((message.modifiers ?? 0) & CTRL_OR_META)) return undefined;
  return SHORTCUT_COMMANDS[message.key.toLowerCase()];
}

type VisualFrame = { id: number; header: string; image: Buffer };
type Viewer = {
  socket: LiveViewerSocket;
  canControl: boolean;
  frameAcknowledgements: boolean;
  inFlightFrame?: number;
  inFlightAt?: number;
  pendingFrame?: VisualFrame;
};

export class LiveViewSession {
  private readonly viewers = new Set<Viewer>();
  private cdpPromise: Promise<LiveCdp> | null = null;
  private currentPage: LivePage;
  private currentCdpFactory: () => Promise<LiveCdp>;
  private selectedPageKey = "tab-1";
  private screencasting = false;
  private closed = false;
  private ready: boolean;
  private inputQueue: Promise<void> = Promise.resolve();
  private pendingMove?: { viewer: Viewer; data: unknown };
  private nextFrameId = 0;
  private nudgeTimers: ReturnType<typeof setTimeout>[] = [];
  private lastInputSeq = 0;
  /** Last time a viewer acted or connected -- read by the idle stop. */
  lastActivityAt = Date.now();
  framesSent = 0;
  framesDropped = 0;

  constructor(private readonly options: LiveViewSessionOptions) {
    this.ready = options.ready !== false;
    this.currentPage = options.page;
    this.currentCdpFactory = options.cdp;
  }

  get viewerCount(): number {
    return this.viewers.size;
  }

  async attachViewer(socket: LiveViewerSocket, access: { canControl: boolean; frameAcknowledgements?: boolean }): Promise<void> {
    if (this.closed) {
      socket.close(4410, "recording_closed");
      return;
    }
    const viewer: Viewer = { socket, canControl: access.canControl, frameAcknowledgements: access.frameAcknowledgements === true };
    this.viewers.add(viewer);
    this.lastActivityAt = Date.now();
    socket.on("close", () => this.detach(viewer));
    socket.on("message", (data) => {
      if (this.closed) return;
      const message = parseClientMessage(data);
      if (!message) return;
      // Visual acknowledgements must never wait behind browser interactions.
      if (message.t === "frame_ack") {
        if (viewer.inFlightFrame === message.frameId) {
          viewer.inFlightFrame = undefined;
          const pending = viewer.pendingFrame;
          viewer.pendingFrame = undefined;
          if (pending) this.sendFrame(viewer, pending);
        }
        return;
      }
      if (message.t === "ping") {
        this.sendJson(socket, { t: "pong", ts: message.ts });
        return;
      }
      if (message.t === "mouse" && message.type === "mouseMoved" && this.pendingMove?.viewer === viewer) {
        this.pendingMove.data = data;
        return;
      }
      const item = { viewer, data };
      this.pendingMove = message.t === "mouse" && message.type === "mouseMoved" ? item : undefined;
      this.inputQueue = this.inputQueue.then(() => {
        if (this.pendingMove === item) this.pendingMove = undefined;
        return this.onMessage(viewer, item.data);
      }).catch((err) => {
        this.options.log?.(`[live-view] input queue failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    });
    this.sendJson(socket, {
      t: "hello",
      viewport: this.options.viewport,
      canControl: viewer.canControl && this.ready,
      ready: this.ready,
      url: this.currentPage.url(),
      pageKey: this.selectedPageKey,
      tabs: await this.getTabs(),
      ...(this.options.fileChooserState?.().available === true
        ? {
            fileChooserAvailable: true,
            fileChooserPageKey: this.options.fileChooserState?.().pageKey,
            fileChooserMultiple: this.options.fileChooserState?.().multiple === true,
          }
        : { fileChooserAvailable: false, fileChooserMultiple: false }),
    });
    await this.startScreencast();
  }

  async refreshTabs(): Promise<void> {
    const tabs = await this.getTabs();
    for (const viewer of this.viewers) {
      this.sendJson(viewer.socket, { t: "tabs", tabs, selectedPageKey: this.selectedPageKey });
    }
  }

  setFileChooserAvailable(available: boolean, pageKey?: string, multiple = false): void {
    for (const viewer of this.viewers) {
      this.sendJson(viewer.socket, { t: "file_chooser", available, multiple: available && multiple, ...(pageKey ? { pageKey } : {}) });
    }
  }

  async uploadFiles(files: Array<{ name: string; mimeType: string; buffer: Buffer }>): Promise<void> {
    if (!this.options.onFileUpload) throw new Error("LIVE_FILE_UPLOAD_UNAVAILABLE");
    await this.options.onFileUpload(files);
    this.setFileChooserAvailable(false);
  }

  markReady(): void {
    if (this.closed || this.ready) return;
    this.ready = true;
    for (const viewer of this.viewers) {
      this.sendJson(viewer.socket, { t: "ready", ready: true, canControl: viewer.canControl });
    }
  }

  async fail(code: string): Promise<void> {
    if (this.closed) return;
    for (const viewer of this.viewers) {
      this.sendJson(viewer.socket, { t: "error", code });
      viewer.socket.close(4412, code);
    }
    await this.close();
  }

  /** Ends the stream for everyone (the recording stopped). */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const viewer of this.viewers) viewer.socket.close(4410, "recording_closed");
    this.viewers.clear();
    await this.inputQueue;
    await this.stopScreencast();
  }

  private detach(viewer: Viewer): void {
    this.viewers.delete(viewer);
    this.lastActivityAt = Date.now();
    if (this.viewers.size === 0) void this.stopScreencast();
  }

  private cdp(): Promise<LiveCdp> {
    if (!this.cdpPromise) {
      this.cdpPromise = this.currentCdpFactory().then((cdp) => {
        cdp.on("Page.screencastFrame", (frame) => this.onFrame(cdp, frame));
        return cdp;
      });
    }
    return this.cdpPromise;
  }

  /**
   * Chromium sends no frame for an idle page, so a fresh screencast or a late viewer would keep showing
   * nothing (or the previous tab). A one-frame opacity flicker forces a frame without any input.
   */
  private async requestFrame(): Promise<void> {
    await (await this.cdp()).send("Runtime.evaluate", {
      expression: "(()=>{const s=document.documentElement&&document.documentElement.style;if(!s)return;s.opacity='0.999';requestAnimationFrame(()=>requestAnimationFrame(()=>s.removeProperty('opacity')));})()",
    }).catch(() => undefined);
  }

  private async startScreencast(): Promise<void> {
    if (this.screencasting) { await this.requestFrame(); return; }
    if (this.closed) return;
    this.screencasting = true;
    const { width, height } = this.options.viewport;
    try {
      await (await this.cdp()).send("Page.startScreencast", {
        format: "jpeg",
        quality: this.options.jpegQuality ?? 60,
        maxWidth: width,
        maxHeight: height,
        everyNthFrame: 3,
      });
      await this.requestFrame();
    } catch (err) {
      this.screencasting = false;
      this.options.log?.(`[live-view] screencast start failed: ${err instanceof Error ? err.message : String(err)}`);
      for (const viewer of this.viewers) {
        this.sendJson(viewer.socket, { t: "error", code: "stream_unavailable" });
        viewer.socket.close(4411, "stream_unavailable");
      }
    }
  }

  private async stopScreencast(): Promise<void> {
    if (!this.screencasting || !this.cdpPromise) return;
    this.screencasting = false;
    try {
      await (await this.cdpPromise).send("Page.stopScreencast");
    } catch {
      // Losing the visual connection must not prevent the recorder's own stop/flush.
    }
  }

  private onFrame(cdp: LiveCdp, frame: { data: string; sessionId: number; metadata?: { deviceWidth?: number; deviceHeight?: number } }): void {
    // Chromium only produces the next frame once this one is acknowledged.
    cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined);
    const id = ++this.nextFrameId;
    const header = JSON.stringify({
      t: "frame",
      frameId: id,
      w: frame.metadata?.deviceWidth ?? this.options.viewport.width,
      h: frame.metadata?.deviceHeight ?? this.options.viewport.height,
      inputSeq: this.lastInputSeq,
      url: this.currentPage.url(),
      pageKey: this.selectedPageKey,
    });
    const image = Buffer.from(frame.data, "base64");
    for (const viewer of this.viewers) {
      this.sendFrame(viewer, { id, header, image });
    }
  }

  private sendFrame(viewer: Viewer, frame: VisualFrame): void {
    if (viewer.socket.readyState !== SOCKET_OPEN || this.closed) return;
    const limit = this.options.maxBufferedBytes ?? 512 * 1024;
    // A lost acknowledgement must not freeze the stream forever: release the slot after a grace period.
    if (viewer.inFlightFrame !== undefined && Date.now() - (viewer.inFlightAt ?? 0) > FRAME_ACK_TIMEOUT_MS) viewer.inFlightFrame = undefined;
    if (viewer.inFlightFrame !== undefined || viewer.socket.bufferedAmount > limit) {
      // Keep only the latest visual state, never a backlog of obsolete images.
      viewer.pendingFrame = frame;
      this.framesDropped += 1;
      return;
    }
    viewer.pendingFrame = undefined;
    if (viewer.frameAcknowledgements) { viewer.inFlightFrame = frame.id; viewer.inFlightAt = Date.now(); }
    viewer.socket.send(frame.header);
    viewer.socket.send(frame.image, { binary: true });
    this.framesSent += 1;
  }

  private async onMessage(viewer: Viewer, data: unknown): Promise<void> {
    const message = parseClientMessage(data);
    if (!message) return;
    if (message.t === "frame_ack") return;
    if (message.t === "ping") {
      this.sendJson(viewer.socket, { t: "pong", ts: message.ts });
      return;
    }
    if (!viewer.canControl || !this.ready) {
      this.sendJson(viewer.socket, { t: "error", code: "view_only" });
      return;
    }
    this.lastActivityAt = Date.now();
    try {
      await this.dispatch(message);
      if (!(message.t === "mouse" && message.type === "mouseMoved")) this.scheduleFrameNudges();
    } catch (err) {
      this.options.log?.(`[live-view] input failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** The page often settles after an input (route change, overlay removed) without Chromium emitting a final frame. */
  private scheduleFrameNudges(): void {
    for (const timer of this.nudgeTimers) clearTimeout(timer);
    this.nudgeTimers = [700, 2_000].map((delay) => {
      const timer = setTimeout(() => { if (this.screencasting && !this.closed) void this.requestFrame(); }, delay);
      timer.unref?.();
      return timer;
    });
  }

  private async dispatch(message: Exclude<LiveClientMessage, { t: "ping" } | { t: "frame_ack" }>): Promise<void> {
    if (message.t === "select_tab") {
      await this.selectTab(message.pageKey);
      return;
    }
    if (message.t === "navigate") {
      if (!this.options.navigateUrl) throw new Error("LIVE_NAVIGATION_UNAVAILABLE");
      const pageKey = await this.options.navigateUrl(message.url, message.newTab, this.selectedPageKey);
      if (message.newTab) await this.selectTab(pageKey, false);
      else await this.refreshTabs();
      return;
    }
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
          // CDP key events never run clipboard shortcuts on their own; the editing command has to be named.
          ...(editingCommandFor(message) ? { commands: [editingCommandFor(message)] } : {}),
        });
        return;
      }
      case "text":
        if (message.seq) this.lastInputSeq = message.seq;
        await cdp.send("Input.insertText", { text: message.text });
        return;
      case "nav":
        if (message.action === "back") await this.currentPage.goBack().catch(() => undefined);
        else await this.currentPage.reload().catch(() => undefined);
        return;
    }
  }

  private async selectTab(pageKey: string, recordSwitch = true): Promise<void> {
    if (!this.options.resolveTab) throw new Error("LIVE_TABS_UNAVAILABLE");
    const target = await this.options.resolveTab(pageKey);
    if (!target) throw new Error("LIVE_TAB_NOT_FOUND");
    const changedPage = pageKey !== this.selectedPageKey;
    await this.stopScreencast();
    this.currentPage = target.page;
    this.currentCdpFactory = target.createCdp;
    this.cdpPromise = null;
    this.selectedPageKey = pageKey;
    // A background tab produces no frames, so the viewer would keep showing the previous page.
    await target.page.bringToFront?.().catch(() => undefined);
    if (recordSwitch && changedPage) await this.options.onTabSelected?.(pageKey);
    await this.refreshTabs();
    for (const viewer of this.viewers) {
      this.sendJson(viewer.socket, { t: "selected_tab", pageKey, url: this.currentPage.url() });
    }
    await this.startScreencast();
  }

  private async getTabs(): Promise<LiveViewTab[]> {
    if (this.options.getTabs) return this.options.getTabs().catch(() => []);
    return [{ pageKey: this.selectedPageKey, url: this.currentPage.url(), title: this.currentPage.url() }];
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
    case "frame_ack":
      return Number.isSafeInteger(value.frameId) && value.frameId > 0 ? { t: "frame_ack", frameId: value.frameId } : undefined;
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
    case "select_tab":
      return typeof value.pageKey === "string" && /^tab-[1-9][0-9]{0,3}$/.test(value.pageKey)
        ? { t: "select_tab", pageKey: value.pageKey }
        : undefined;
    case "navigate":
      return typeof value.url === "string" && value.url.trim().length > 0 && value.url.length <= 2048
        && typeof value.newTab === "boolean"
        ? { t: "navigate", url: value.url.trim(), newTab: value.newTab }
        : undefined;
    default:
      return undefined;
  }
}
