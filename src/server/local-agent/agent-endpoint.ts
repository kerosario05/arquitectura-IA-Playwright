import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { timingSafeEqual } from "node:crypto";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { AGENT_CDP_PATH, AGENT_CONTROL_PATH } from "../../local-agent/protocol";
import { localAgentRegistry, type LocalAgentRegistry } from "./agent-registry";

/**
 * WebSockets de los agentes locales:
 *  - `/api/local-agent/control`: canal permanente de órdenes y estado;
 *  - `/api/local-agent/cdp?session=&token=`: tubería CDP de un navegador abierto.
 *
 * El agente no tiene sesión de usuario: se identifica con `x-qalab-agent-id` y,
 * si el servidor define `LOCAL_AGENT_KEY`, debe presentar esa clave en
 * `x-qalab-agent-key` (la reparte TI en agente.json). El canal de datos exige
 * además el token de un solo uso que el servidor mandó en `open_browser`.
 *
 * El motor escucha en 127.0.0.1 y el agente llega a través del BFF, que pone la
 * IP real del PC en `X-Forwarded-For`; solo se cree esa cabecera cuando la
 * conexión viene de la propia máquina.
 */

const HEADER_ID = "x-qalab-agent-id";
const HEADER_KEY = "x-qalab-agent-key";
const AGENT_ID = /^[A-Za-z0-9-]{8,64}$/;
const MAX_PAYLOAD = 256 * 1024 * 1024;
const SWEEP_MS = 30_000;
const MAX_SILENCE_MS = 90_000;

export function normalizeIp(ip: string | undefined): string {
  const raw = String(ip ?? "").trim();
  if (raw.startsWith("::ffff:")) return raw.slice(7);
  if (raw === "::1") return "127.0.0.1";
  return raw;
}

function isLoopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip.startsWith("127.");
}

/** IP del PC que llama: la directa, o la que informa el BFF local. */
export function clientIpOf(req: Pick<IncomingMessage, "headers" | "socket">): string {
  const direct = normalizeIp(req.socket?.remoteAddress);
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0];
  if (first && isLoopback(direct)) return normalizeIp(first);
  return direct;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export function agentKeyAccepted(presented: string | undefined, configured = process.env.LOCAL_AGENT_KEY || ""): boolean {
  if (!configured) return true;
  if (!presented) return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(configured);
  return a.length === b.length && timingSafeEqual(a, b);
}

function reject(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

function toText(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

export function attachLocalAgentEndpoint(server: Server, registry: LocalAgentRegistry = localAgentRegistry): void {
  const controlWss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  const dataWss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false });

  const sweep = setInterval(() => registry.sweepSilent(MAX_SILENCE_MS), SWEEP_MS);
  sweep.unref();
  server.on("close", () => clearInterval(sweep));

  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(request.url ?? "/", "http://motor.local");
    if (url.pathname !== AGENT_CONTROL_PATH && url.pathname !== AGENT_CDP_PATH) return;

    const agentId = header(request, HEADER_ID) ?? "";
    if (!AGENT_ID.test(agentId)) {
      reject(socket, 400, "Bad Request");
      return;
    }
    if (!agentKeyAccepted(header(request, HEADER_KEY))) {
      reject(socket, 401, "Unauthorized");
      return;
    }
    const ip = clientIpOf(request);

    if (url.pathname === AGENT_CONTROL_PATH) {
      controlWss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        const handlers = registry.attachControl(
          { send: (data) => ws.send(data), close: (code, reason) => ws.close(code, reason) },
          { agentId, ip },
        );
        ws.on("message", (data: RawData) => handlers.onMessage(toText(data)));
        ws.on("ping", () => handlers.onPing());
        ws.on("close", () => handlers.onClose());
        ws.on("error", () => ws.terminate());
      });
      return;
    }

    const accept = registry.acceptDataChannel({
      sessionId: url.searchParams.get("session") ?? "",
      token: url.searchParams.get("token") ?? "",
      agentId,
    });
    if (!accept) {
      reject(socket, 403, "Forbidden");
      return;
    }
    dataWss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      ws.on("error", () => ws.terminate());
      accept(ws);
    });
  });
}
