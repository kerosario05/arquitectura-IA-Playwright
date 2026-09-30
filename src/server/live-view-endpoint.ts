import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { resolveSessionToken } from "../auth/auth-service";
import { resolveAuthConfig } from "../auth/config";
import { canAccessProject, hasPermission, type Principal } from "../auth/principal";
import type { LiveViewSession } from "../recording/web/live-view-session";
import { getLiveViewAccess } from "./jobs/session-recording-runner";

/**
 * `GET /api/recordings/:recordingId/live` (WebSocket upgrade): the stream of a "remote" recording.
 *
 * Browsers cannot put an Authorization header on a WebSocket, and a token in the URL ends up in
 * logs, so the FIRST message must be `{ t: "auth", token }`. Until it is verified nothing is
 * streamed and no input is accepted. Watching needs `recordings.view` on the project; CONTROLLING
 * (clicks/keys reach the recorded page) is reserved to whoever started the recording, or an admin.
 */

const LIVE_PATH = /^\/api\/recordings\/([^/?#]+)\/live(?:[?#].*)?$/;
const AUTH_TIMEOUT_MS = 5_000;

export type LiveViewAccess = { session: LiveViewSession; startedBy?: string; projectSlug: string };

export type LiveViewAuthDeps = {
  authEnabled: boolean;
  apiKey?: string;
  resolveToken: (token: string) => Promise<Principal>;
};

export type LiveViewDecision = { ok: true; canControl: boolean } | { ok: false; code: string };

/** Pure admission rule, separated from sockets so it is unit-testable. */
export async function decideLiveViewAccess(
  auth: { token?: unknown; apiKey?: unknown },
  access: Pick<LiveViewAccess, "startedBy" | "projectSlug">,
  deps: LiveViewAuthDeps,
): Promise<LiveViewDecision> {
  if (deps.apiKey && auth.apiKey === deps.apiKey) return { ok: true, canControl: true };
  if (typeof auth.token !== "string" || !auth.token) {
    // Same rule as the HTTP middleware: nothing configured to guard the API means open access.
    return !deps.authEnabled && !deps.apiKey ? { ok: true, canControl: true } : { ok: false, code: "missing_token" };
  }
  let principal: Principal;
  try {
    principal = await deps.resolveToken(auth.token);
  } catch {
    return { ok: false, code: "invalid_token" };
  }
  if (principal.scope !== "full") return { ok: false, code: "password_change_required" };
  if (!hasPermission(principal, "recordings.view") || !canAccessProject(principal, access.projectSlug)) {
    return { ok: false, code: "forbidden" };
  }
  const owner = !access.startedBy || principal.userId === access.startedBy;
  const canControl = hasPermission(principal, "recordings.create") && (owner || hasPermission(principal, "admin.users"));
  return { ok: true, canControl };
}

function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function toText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

export function attachLiveViewEndpoint(
  server: Server,
  resolveAccess: (recordingId: string) => LiveViewAccess | undefined = getLiveViewAccess,
  deps: () => LiveViewAuthDeps = () => ({
    authEnabled: resolveAuthConfig().enabled,
    apiKey: process.env.API_KEY || undefined,
    resolveToken: async (token) => (await resolveSessionToken(token)).principal,
  }),
): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const match = request.url?.match(LIVE_PATH);
    if (!match) return; // not ours: leave it to any other upgrade handler
    const recordingId = decodeURIComponent(match[1]);
    const access = resolveAccess(recordingId);
    if (!access) {
      rejectUpgrade(socket, 404, "Not Found");
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      const timer = setTimeout(() => ws.close(4401, "auth_timeout"), AUTH_TIMEOUT_MS);
      ws.once("message", async (data: RawData) => {
        clearTimeout(timer);
        let auth: { t?: unknown; token?: unknown; apiKey?: unknown } = {};
        try { auth = JSON.parse(toText(data)); } catch { /* handled as missing auth below */ }
        const decision = auth.t === "auth"
          ? await decideLiveViewAccess(auth, access, deps())
          : { ok: false as const, code: "auth_required" };
        if (!decision.ok) {
          ws.send(JSON.stringify({ t: "error", code: decision.code }));
          ws.close(4403, decision.code);
          return;
        }
        console.log(`[live-view] viewer attached recordingId=${recordingId} canControl=${decision.canControl}`);
        await access.session.attachViewer({
          get readyState() { return ws.readyState; },
          get bufferedAmount() { return ws.bufferedAmount; },
          send: (payload, options) => ws.send(payload, options),
          close: (code, reason) => ws.close(code, reason),
          on: ((event: "message" | "close", handler: (payload?: unknown) => void) => {
            if (event === "message") ws.on("message", (payload: RawData) => handler(toText(payload)));
            else ws.on("close", () => handler());
          }) as never,
        }, { canControl: decision.canControl });
      });
    });
  });
}
