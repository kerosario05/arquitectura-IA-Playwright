import net from "node:net";
import type { Duplex } from "node:stream";
import WebSocket, { createWebSocketStream } from "ws";

/**
 * Una conexión TCP del servidor al adb o al Appium de este PC.
 *
 *   motor ⇄ túnel del servidor ⇄ canal de datos (saliente) ⇄ agente ⇄ 127.0.0.1:<puerto>
 *
 * Los bytes no se interpretan. Solo se conecta a 127.0.0.1 y al puerto que el
 * agente asocia al servicio pedido. Cuando cualquiera de los dos lados se
 * cierra, se cierra el otro.
 */

export type LocalTarget = {
  port: number;
  /** Arranca el servicio si no escucha (p. ej. `adb start-server`); se reintenta una vez. */
  start?: () => Promise<void>;
};

const CONNECT_TIMEOUT_MS = 10_000;
const MAX_PAYLOAD = 64 * 1024 * 1024;

export async function openTcpStream(options: { local: LocalTarget; dataChannelUrl: string; headers?: Record<string, string> }): Promise<void> {
  let tcp: net.Socket;
  try {
    tcp = await connectLocal(options.local.port);
  } catch (err) {
    if (!options.local.start || (err as NodeJS.ErrnoException).code !== "ECONNREFUSED") throw err;
    await options.local.start();
    tcp = await connectLocal(options.local.port);
  }
  // Lo que llegue antes de abrir el canal queda en el socket hasta el pipe.
  tcp.pause();

  let data: WebSocket;
  let stream: Duplex;
  try {
    ({ data, stream } = await openSocket(options.dataChannelUrl, options.headers));
  } catch (err) {
    tcp.destroy();
    throw err;
  }
  const closeBoth = () => {
    tcp.destroy();
    stream.destroy();
  };
  tcp.on("error", closeBoth);
  stream.on("error", closeBoth);
  tcp.on("close", () => stream.destroy());
  data.on("close", () => tcp.destroy());
  tcp.pipe(stream).pipe(tcp);
}

function connectLocal(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.setNoDelay(true);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`127.0.0.1:${port} no respondió en ${CONNECT_TIMEOUT_MS / 1000} s`));
    }, CONNECT_TIMEOUT_MS);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.removeAllListeners("error");
      resolve(socket);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * El stream se crea antes de abrir: el servidor puede mandar bytes del motor en
 * el mismo paquete que el saludo del WebSocket, y se emitirían antes de que una
 * escucha añadida después de `open` los viera.
 */
function openSocket(url: string, headers?: Record<string, string>): Promise<{ data: WebSocket; stream: Duplex }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers, perMessageDeflate: false, maxPayload: MAX_PAYLOAD, handshakeTimeout: 15000 });
    const stream = createWebSocketStream(socket);
    // Mientras no se abre, un fallo se informa por `reject`, no como error del stream.
    stream.on("error", () => undefined);
    socket.once("open", () => resolve({ data: socket, stream }));
    socket.once("error", reject);
    socket.once("unexpected-response", (_req, res) => reject(new Error(`el servidor rechazó la conexión: HTTP ${res.statusCode}`)));
  });
}
