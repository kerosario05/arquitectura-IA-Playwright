/**
 * Contrato entre el agente local (PC del usuario) y el servidor de QA Lab.
 *
 * El agente abre SIEMPRE las conexiones hacia el servidor, por el puerto del
 * panel (el único que la red deja pasar desde los PCs):
 *  - un canal de CONTROL, permanente, con estos mensajes JSON;
 *  - un canal de DATOS por cada navegador abierto, que es una tubería 1:1 con
 *    el WebSocket CDP de nivel navegador de ese Chromium. El motor lo usa con
 *    `chromium.connectOverCDP`, así que el grabador no sabe que es remoto;
 *  - un canal de DATOS por cada conexión TCP que el motor abre hacia el adb o el
 *    Appium del PC (`open_stream`; ese Appium lo instala y arranca el agente).
 *    adb y webdriverio abren varias conexiones a la vez, así que cada una lleva
 *    su propio canal y los bytes van tal cual.
 *
 * Ningún mensaje lleva credenciales de la aplicación grabada: el agente solo
 * transporta CDP.
 */

import type { AndroidStatus } from "./android-probe";

export type { AndroidDevice, AndroidStatus } from "./android-probe";

export const AGENT_PROTOCOL_VERSION = 1;

/** Rutas del servidor, relativas a `serverUrl` (http→ws). */
export const AGENT_CONTROL_PATH = "/api/local-agent/control";
export const AGENT_CDP_PATH = "/api/local-agent/cdp";
export const AGENT_STREAM_PATH = "/api/local-agent/stream";

/**
 * Servicios TCP del PC a los que el servidor puede pedir una conexión. El puerto
 * lo decide el agente, nunca el servidor: así un servidor comprometido no puede
 * usar el agente para alcanzar otros puertos del PC o de la red del usuario.
 */
export type StreamTarget = "adb" | "appium";

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
  /** Android Studio en el PC. Ausente en agentes anteriores a 0.2.0. */
  android?: AndroidStatus;
  /** Versiones de Appium instaladas por el agente. Ausente en agentes anteriores a 0.3.0. */
  appium?: { installed: string[] };
};

export type EmulatorPhase = "launched" | "booting";

export type AgentToServer =
  | AgentHello
  | { t: "install_progress"; requestId: string; revision: string; phase: "download" | "extract"; receivedBytes: number; totalBytes?: number; percent?: number }
  | { t: "install_done"; requestId: string; chromium: ChromiumStatus }
  | { t: "install_error"; requestId: string; revision: string; message: string }
  | { t: "browser_opened"; sessionId: string; revision: string }
  | { t: "browser_error"; sessionId: string; message: string }
  /** El usuario cerró la ventana, Chromium terminó o se cortó el canal de datos. */
  | { t: "browser_closed"; sessionId: string; reason: "user_closed" | "server_closed" | "data_channel_lost" | "crashed" }
  | { t: "emulator_progress"; requestId: string; avd: string; phase: EmulatorPhase }
  | { t: "emulator_ready"; requestId: string; avd: string; serial: string }
  | { t: "emulator_error"; requestId: string; avd: string; message: string }
  | { t: "appium_install_progress"; requestId: string; version: string; phase: "download" | "extract"; receivedBytes: number; totalBytes?: number; percent?: number }
  | { t: "appium_install_done"; requestId: string; version: string }
  | { t: "appium_install_error"; requestId: string; version: string; message: string }
  /** No se pudo abrir la conexión TCP local de un open_stream. */
  | { t: "stream_error"; streamId: string; message: string };

export type ServerToAgent =
  | { t: "welcome"; serverVersion?: string; requiredRevision?: string; requiredAppium?: string }
  /** Descargar e instalar Chromium desde el propio servidor (sin internet). */
  | { t: "install_chromium"; requestId: string; revision: string; url: string; sha256?: string; sizeBytes?: number }
  /** Descargar e instalar Appium y su driver desde el propio servidor; lo arranca el túnel cuando haga falta. */
  | { t: "install_appium"; requestId: string; version: string; url: string; sha256?: string; sizeBytes?: number }
  /** Abrir un Chromium con ventana y conectar su CDP al servidor por un canal de datos. */
  | { t: "open_browser"; sessionId: string; revision: string; dataToken: string }
  | { t: "close_browser"; sessionId: string }
  /** El servidor pide un estado fresco (p. ej. al iniciar sesión el usuario en el panel). */
  | { t: "status_request" }
  /** Arrancar un AVD del PC con ventana; responde emulator_progress/ready/error y luego un hello. */
  | { t: "start_emulator"; requestId: string; avd: string }
  | { t: "stop_emulator"; serial: string }
  /** Conectar al servicio local `target` y unirlo al servidor por un canal de datos. */
  | { t: "open_stream"; streamId: string; target: StreamTarget; dataToken: string };

export function parseServerMessage(raw: string): ServerToAgent | undefined {
  try {
    const msg = JSON.parse(raw) as { t?: unknown };
    if (!msg || typeof msg.t !== "string") return undefined;
    switch (msg.t) {
      case "welcome":
      case "install_chromium":
      case "install_appium":
      case "open_browser":
      case "close_browser":
      case "status_request":
      case "start_emulator":
      case "stop_emulator":
      case "open_stream":
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
