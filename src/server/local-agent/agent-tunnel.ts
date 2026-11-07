import net from "node:net";
import type { AddressInfo } from "node:net";
import { createWebSocketStream } from "ws";
import type { StreamTarget } from "../../local-agent/protocol";
import { localAgentRegistry, type LocalAgentRegistry } from "./agent-registry";

/**
 * El adb o el Appium del PC del usuario, vistos por el motor como un puerto local.
 *
 *   adb -H 127.0.0.1 -P <puerto> / webdriverio ⇄ túnel 127.0.0.1:<puerto aleatorio>
 *     ⇄ un canal de datos por conexión ⇄ agente ⇄ 127.0.0.1:5037 / Appium del PC
 *
 * adb y webdriverio abren varias conexiones (una por comando, keep-alive...): cada
 * conexión que llega al túnel pide su propio canal al agente. Solo escucha en
 * 127.0.0.1 y se cierra cuando termina la grabación o la ejecución.
 */

export type AgentTunnel = {
  agentId: string;
  target: StreamTarget;
  host: "127.0.0.1";
  port: number;
  /** Conexiones del motor que pasan ahora por el túnel. */
  readonly activeConnections: number;
  close(): Promise<void>;
};

export function openAgentTunnel(
  agentId: string,
  target: StreamTarget,
  registry: LocalAgentRegistry = localAgentRegistry,
  log: (line: string) => void = (line) => console.log(line),
): Promise<AgentTunnel> {
  const connections = new Set<net.Socket>();
  const server = net.createServer((local) => {
    connections.add(local);
    local.on("close", () => connections.delete(local));
    local.on("error", () => local.destroy());
    local.setNoDelay(true);
    // Lo que mande el motor antes de que llegue el canal espera en el socket.
    local.pause();
    registry.openStream(agentId, target).then(
      (data) => {
        if (local.destroyed) {
          data.close();
          return;
        }
        const stream = createWebSocketStream(data);
        const closeBoth = () => {
          local.destroy();
          stream.destroy();
        };
        stream.on("error", closeBoth);
        local.on("error", closeBoth);
        local.on("close", () => stream.destroy());
        data.on("close", () => local.destroy());
        local.pipe(stream).pipe(local);
      },
      (err) => {
        log(`[agente-local] túnel ${target}: ${err instanceof Error ? err.message : String(err)}`);
        local.destroy();
      },
    );
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const { port } = server.address() as AddressInfo;
      let closing: Promise<void> | undefined;
      resolve({
        agentId,
        target,
        host: "127.0.0.1",
        port,
        get activeConnections() {
          return connections.size;
        },
        close: () => {
          closing ??= new Promise<void>((done) => {
            for (const socket of connections) socket.destroy();
            server.close(() => done());
          });
          return closing;
        },
      });
    });
  });
}
