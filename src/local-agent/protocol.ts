/**
 * Contrato entre el agente local (PC del usuario) y el servidor de QA Lab.
 *
 * El agente abre SIEMPRE las conexiones hacia el servidor, por el puerto del
 * panel (el único que la red deja pasar desde los PCs):
 *  - un canal de CONTROL, permanente, con estos mensajes JSON;
 *  - un canal de DATOS por cada navegador abierto, que es una tubería 1:1 con
 *    el WebSocket CDP de nivel navegador de ese Chromium. El motor lo usa con
 *    `chromium.connectOverCDP`, así que el grabador no sabe que es remoto.
 *
 * Ningún mensaje lleva credenciales de la aplicación grabada: el agente solo
 * transporta CDP.
 */

export const AGENT_PROTOCOL_VERSION = 1;

/** Rutas del servidor, relativas a `serverUrl` (http→ws). */
export const AGENT_CONTROL_PATH = "/api/local-agent/control";
export const AGENT_CDP_PATH = "/api/local-agent/cdp";

export type ChromiumStatus = {
  revision: string;
  installed: boolean;
  /** Ruta de chrome.exe cuando `installed`. */
  executablePath?: string;
};

export type AgentHello = {
  t: "hello";
  protocol: number;
  agentVersion: string;
  agentId: string;
  machine: string;
  windowsUser: string;
  chromium: ChromiumStatus[];
};

export type AgentToServer =
  | AgentHello
  | { t: "install_progress"; requestId: string; revision: string; phase: "download" | "extract"; receivedBytes: number; totalBytes?: number; percent?: number }
  | { t: "install_done"; requestId: string; chromium: ChromiumStatus }
  | { t: "install_error"; requestId: string; revision: string; message: string }
  | { t: "browser_opened"; sessionId: string; revision: string }
  | { t: "browser_error"; sessionId: string; message: string }
  /** El usuario cerró la ventana, Chromium terminó o se cortó el canal de datos. */
  | { t: "browser_closed"; sessionId: string; reason: "user_closed" | "server_closed" | "data_channel_lost" | "crashed" };

export type ServerToAgent =
  | { t: "welcome"; serverVersion?: string; requiredRevision?: string }
  /** Descargar e instalar Chromium desde el propio servidor (sin internet). */
  | { t: "install_chromium"; requestId: string; revision: string; url: string; sha256?: string; sizeBytes?: number }
  /** Abrir un Chromium con ventana y conectar su CDP al servidor por un canal de datos. */
  | { t: "open_browser"; sessionId: string; revision: string; dataToken: string }
  | { t: "close_browser"; sessionId: string }
  /** El servidor pide un estado fresco (p. ej. al iniciar sesión el usuario en el panel). */
  | { t: "status_request" };

export function parseServerMessage(raw: string): ServerToAgent | undefined {
  try {
    const msg = JSON.parse(raw) as { t?: unknown };
    if (!msg || typeof msg.t !== "string") return undefined;
    switch (msg.t) {
      case "welcome":
      case "install_chromium":
      case "open_browser":
      case "close_browser":
      case "status_request":
        return msg as ServerToAgent;
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

/** http(s)://host:port → ws(s)://host:port + path */
export function toWebSocketUrl(serverUrl: string, pathname: string, query?: Record<string, string>): string {
  const url = new URL(pathname, serverUrl.endsWith("/") ? serverUrl : `${serverUrl}/`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  return url.toString();
}
