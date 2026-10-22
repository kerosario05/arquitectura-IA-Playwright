import type { AddressInfo } from "node:net";
import { chromium, type Browser } from "@playwright/test";
import WebSocket, { WebSocketServer } from "ws";
import { localAgentRegistry, type AgentDataChannel, type BrowserCloseReason, type LocalAgentRegistry } from "./agent-registry";

/**
 * Un Chromium del PC del usuario, visto por el motor como un `Browser` de Playwright.
 *
 *   Playwright ⇄ relé 127.0.0.1:<puerto aleatorio> ⇄ canal de datos ⇄ agente ⇄ Chromium
 *
 * `connectOverCDP` necesita una URL; el relé local se la da y copia los mensajes
 * tal cual hacia el canal del agente. Solo acepta una conexión, desde la propia
 * máquina y con una ruta aleatoria.
 */

export type AgentBrowser = {
  browser: Browser;
  agentId: string;
  sessionId: string;
  /** El navegador se cerró sin que lo pidiera el servidor (el usuario cerró la ventana, se cortó la red...). */
  onLost(listener: (reason: BrowserCloseReason | "cdp_disconnected") => void): void;
  close(): Promise<void>;
};

const MAX_PAYLOAD = 256 * 1024 * 1024;

export async function openAgentBrowser(agentId: string, registry: LocalAgentRegistry = localAgentRegistry): Promise<AgentBrowser> {
  const channel = await registry.openBrowser(agentId);
  let relay: { url: string; close: () => Promise<void> } | undefined;
  let closing = false;
  const listeners: Array<(reason: BrowserCloseReason | "cdp_disconnected") => void> = [];
  let lost = false;
  const fireLost = (reason: BrowserCloseReason | "cdp_disconnected") => {
    if (closing || lost) return;
    lost = true;
    for (const listener of listeners) listener(reason);
  };

  try {
    relay = await startRelay(channel);
    const browser = await chromium.connectOverCDP(relay.url, { timeout: 30_000 });
    channel.onAgentClosed((reason) => fireLost(reason));
    browser.on("disconnected", () => fireLost("cdp_disconnected"));
    const opened = relay;
    return {
      browser,
      agentId,
      sessionId: channel.sessionId,
      onLost: (listener) => listeners.push(listener),
      close: async () => {
        if (closing) return;
        closing = true;
        // El grabador ya cerró su contexto; esto solo suelta la conexión y cierra
        // la ventana en el PC.
        await browser.close().catch(() => undefined);
        channel.close();
        await opened.close();
      },
    };
  } catch (err) {
    closing = true;
    channel.close();
    await relay?.close();
    throw err;
  }
}

function startRelay(channel: AgentDataChannel): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const path = `/relay/${channel.sessionId}`;
    const wss = new WebSocketServer({
      host: "127.0.0.1",
      port: 0,
      maxPayload: MAX_PAYLOAD,
      perMessageDeflate: false,
      verifyClient: (info: { req: { url?: string } }) => info.req.url === path,
    });
    let used = false;
    const data = channel.socket;
    wss.on("connection", (local: WebSocket) => {
      if (used) {
        local.close(1008, "busy");
        return;
      }
      used = true;
      data.on("message", (msg, isBinary) => {
        if (local.readyState === WebSocket.OPEN) local.send(msg, { binary: isBinary });
      });
      local.on("message", (msg, isBinary) => {
        if (data.readyState === WebSocket.OPEN) data.send(msg, { binary: isBinary });
      });
      data.on("close", () => local.close());
      local.on("close", () => {
        if (data.readyState === WebSocket.OPEN) data.close();
      });
      local.on("error", () => local.terminate());
    });
    wss.once("error", reject);
    wss.once("listening", () => {
      const { port } = wss.address() as AddressInfo;
      resolve({
        url: `ws://127.0.0.1:${port}${path}`,
        close: () => new Promise<void>((done) => {
          for (const client of wss.clients) client.terminate();
          wss.close(() => done());
        }),
      });
    });
  });
}
