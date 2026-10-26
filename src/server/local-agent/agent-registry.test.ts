import assert from "node:assert/strict";
import test from "node:test";
import { ChromiumPackage } from "./chromium-package";
import { LocalAgentRegistry, normalizeAccountName } from "./agent-registry";
import { agentKeyAccepted, clientIpOf } from "./agent-endpoint";
import type { AgentHello, ServerToAgent } from "../../local-agent/protocol";

type FakeSocket = { sent: ServerToAgent[]; closed?: string; send(data: string): void; close(code?: number, reason?: string): void };

function fakeSocket(): FakeSocket {
  return {
    sent: [],
    send(data) { this.sent.push(JSON.parse(data)); },
    close(_code, reason) { this.closed = reason ?? "closed"; },
  };
}

/** Paquete falso: revisión 1223, zip "listo" sin tocar disco. */
function fakePackage(revision: string | null = "1223"): ChromiumPackage {
  const pkg = new ChromiumPackage("C:\\no-usado", () => (revision ? { revision, revisionDir: "C:\\no-usado" } : undefined));
  pkg.ensure = async () => ({ revision: revision!, fileName: `chromium-${revision}.zip`, url: `/descargas/chromium-${revision}.zip`, sha256: "a".repeat(64), sizeBytes: 100 });
  return pkg;
}

function hello(over: Partial<AgentHello> = {}): string {
  return JSON.stringify({ t: "hello", protocol: 1, agentVersion: "0.1.0", agentId: "x", machine: "PC-1", windowsUser: "kerosario", chromium: [], ...over });
}

function connect(registry: LocalAgentRegistry, agentId: string, ip: string, over: Partial<AgentHello> = {}) {
  const socket = fakeSocket();
  const handlers = registry.attachControl(socket, { agentId, ip });
  handlers.onMessage(hello({ agentId, ...over }));
  return { socket, handlers };
}

const user = { userId: "u1", username: "KEROSARIO" };

test("sin hello no cuenta como conectado; con hello recibe welcome con la revisión exigida", () => {
  const registry = new LocalAgentRegistry(fakePackage(), () => undefined);
  const socket = fakeSocket();
  const handlers = registry.attachControl(socket, { agentId: "agente-0001", ip: "10.0.0.5" });
  assert.equal(registry.list().length, 0);
  handlers.onMessage(hello({ agentId: "agente-0001" }));
  assert.equal(registry.list().length, 1);
  assert.deepEqual(socket.sent[0], { t: "welcome", requiredRevision: "1223" });
  handlers.onClose();
  assert.equal(registry.list().length, 0);
});

test("empareja por IP; con varios en la IP desempata el usuario de Windows y si no, pide elegir", () => {
  const registry = new LocalAgentRegistry(fakePackage(), () => undefined);
  assert.equal(registry.findForUser(user, "10.0.0.5").status, "none");

  connect(registry, "agente-0001", "10.0.0.5", { windowsUser: "otro" });
  const one = registry.findForUser(user, "10.0.0.5");
  assert.equal(one.status === "found" && one.agent.agentId, "agente-0001");
  assert.equal(registry.findForUser(user, "10.0.0.9").status, "none", "nunca un agente de otra IP");

  connect(registry, "agente-0002", "10.0.0.5", { windowsUser: "CORP\\kerosario" });
  const byUser = registry.findForUser(user, "10.0.0.5");
  assert.equal(byUser.status === "found" && byUser.agent.agentId, "agente-0002");

  connect(registry, "agente-0003", "10.0.0.5", { windowsUser: "kerosario@corp.local" });
  const ambiguous = registry.findForUser(user, "10.0.0.5");
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.status === "ambiguous" && ambiguous.candidates.length, 3);

  registry.select(user, "10.0.0.5", "agente-0003");
  const chosen = registry.findForUser(user, "10.0.0.5");
  assert.equal(chosen.status === "found" && chosen.agent.agentId, "agente-0003");
  assert.throws(() => registry.select(user, "10.0.0.9", "agente-0001"), /no está conectado desde tu red/);
});

test("normaliza cuentas de dominio", () => {
  assert.equal(normalizeAccountName("CORP\\KeRosario"), "kerosario");
  assert.equal(normalizeAccountName("kerosario@corp.local"), "kerosario");
  assert.equal(normalizeAccountName(undefined), "");
});

test("instalación: preparing → install_chromium → avance → done, e idempotente mientras sigue", async () => {
  const registry = new LocalAgentRegistry(fakePackage(), () => undefined);
  const { socket, handlers } = connect(registry, "agente-0001", "10.0.0.5");
  const first = registry.requestInstall("agente-0001");
  assert.equal(first.state, "preparing");
  assert.equal(registry.requestInstall("agente-0001").requestId, first.requestId, "no duplica la instalación");

  await new Promise((r) => setImmediate(r));
  const order = socket.sent.find((m) => m.t === "install_chromium");
  assert.ok(order && order.t === "install_chromium");
  assert.equal(order.requestId, first.requestId);
  assert.equal(order.url, "/descargas/chromium-1223.zip");
  assert.equal(order.sha256, "a".repeat(64));

  handlers.onMessage(JSON.stringify({ t: "install_progress", requestId: first.requestId, revision: "1223", phase: "download", receivedBytes: 50, totalBytes: 100, percent: 50 }));
  assert.equal(registry.installState("agente-0001")?.state, "download");
  assert.equal(registry.installState("agente-0001")?.percent, 45);
  handlers.onMessage(JSON.stringify({ t: "install_progress", requestId: "otra", revision: "1223", phase: "download", receivedBytes: 99, percent: 99 }));
  assert.equal(registry.installState("agente-0001")?.percent, 45, "ignora avances de otra petición");

  handlers.onMessage(JSON.stringify({ t: "install_done", requestId: first.requestId, chromium: { revision: "1223", installed: true } }));
  assert.equal(registry.installState("agente-0001")?.state, "done");
  assert.equal(registry.installState("agente-0001")?.percent, 100);
  assert.equal(registry.hasChromium(registry.get("agente-0001")!), true);
});

test("instalación: el agente se desconecta a mitad → error; el servidor sin Chromium → error claro", async () => {
  const registry = new LocalAgentRegistry(fakePackage(), () => undefined);
  const { handlers } = connect(registry, "agente-0001", "10.0.0.5");
  registry.requestInstall("agente-0001");
  handlers.onMessage(JSON.stringify({ t: "install_error", requestId: registry.installState("agente-0001")!.requestId, revision: "1223", message: "sha256 distinto" }));
  assert.equal(registry.installState("agente-0001")?.state, "error");
  assert.equal(registry.installState("agente-0001")?.message, "sha256 distinto");

  const sinChromium = new LocalAgentRegistry(fakePackage(null), () => undefined);
  connect(sinChromium, "agente-0002", "10.0.0.6");
  assert.throws(() => sinChromium.requestInstall("agente-0002"), /no tiene Chromium/);
});

test("ya instalado: requestInstall responde done sin pedir nada al agente", () => {
  const registry = new LocalAgentRegistry(fakePackage(), () => undefined);
  const { socket } = connect(registry, "agente-0001", "10.0.0.5", { chromium: [{ revision: "1223", installed: true }] });
  assert.equal(registry.requestInstall("agente-0001").state, "done");
  assert.equal(socket.sent.some((m) => m.t === "install_chromium"), false);
});

test("canal de datos: solo con la sesión, el agente y el token correctos; un solo uso", async () => {
  const registry = new LocalAgentRegistry(fakePackage(), () => undefined);
  const { socket } = connect(registry, "agente-0001", "10.0.0.5", { chromium: [{ revision: "1223", installed: true }] });
  const opening = registry.openBrowser("agente-0001", 5000);
  const order = socket.sent.find((m) => m.t === "open_browser");
  assert.ok(order && order.t === "open_browser");

  assert.equal(registry.acceptDataChannel({ sessionId: order.sessionId, token: "mal", agentId: "agente-0001" }), undefined);
  assert.equal(registry.acceptDataChannel({ sessionId: order.sessionId, token: order.dataToken, agentId: "agente-9999" }), undefined);
  const accept = registry.acceptDataChannel({ sessionId: order.sessionId, token: order.dataToken, agentId: "agente-0001" });
  assert.ok(accept);
  assert.equal(registry.acceptDataChannel({ sessionId: order.sessionId, token: order.dataToken, agentId: "agente-0001" }), undefined, "un solo uso");

  const { EventEmitter } = await import("node:events");
  const data = Object.assign(new EventEmitter(), { close() { (this as any).emit("close"); } });
  accept!(data as never);
  const channel = await opening;
  const reasons: string[] = [];
  channel.onAgentClosed((r) => reasons.push(r));

  // Cierre pedido por el servidor: el "user_closed" que llegue después no se notifica.
  channel.close();
  assert.ok(socket.sent.some((m) => m.t === "close_browser"));
  assert.deepEqual(reasons, []);
});

test("canal de datos: el usuario cierra la ventana → se notifica una vez", async () => {
  const registry = new LocalAgentRegistry(fakePackage(), () => undefined);
  const { socket, handlers } = connect(registry, "agente-0001", "10.0.0.5", { chromium: [{ revision: "1223", installed: true }] });
  const opening = registry.openBrowser("agente-0001", 5000);
  const order = socket.sent.find((m) => m.t === "open_browser") as Extract<ServerToAgent, { t: "open_browser" }>;
  const { EventEmitter } = await import("node:events");
  const data = Object.assign(new EventEmitter(), { close() { (this as any).emit("close"); } });
  registry.acceptDataChannel({ sessionId: order.sessionId, token: order.dataToken, agentId: "agente-0001" })!(data as never);
  const channel = await opening;
  const reasons: string[] = [];
  channel.onAgentClosed((r) => reasons.push(r));
  handlers.onMessage(JSON.stringify({ t: "browser_closed", sessionId: order.sessionId, reason: "user_closed" }));
  data.emit("close");
  assert.deepEqual(reasons, ["user_closed"]);
});

test("abrir navegador: sin Chromium, error del agente o tiempo agotado se rechazan", async () => {
  const registry = new LocalAgentRegistry(fakePackage(), () => undefined);
  connect(registry, "agente-0001", "10.0.0.5");
  await assert.rejects(registry.openBrowser("agente-0001"), (err: any) => err.code === "LOCAL_AGENT_CHROMIUM_MISSING");

  const { socket, handlers } = connect(registry, "agente-0002", "10.0.0.6", { chromium: [{ revision: "1223", installed: true }] });
  const failing = registry.openBrowser("agente-0002", 5000);
  const order = socket.sent.find((m) => m.t === "open_browser") as Extract<ServerToAgent, { t: "open_browser" }>;
  handlers.onMessage(JSON.stringify({ t: "browser_error", sessionId: order.sessionId, message: "chrome.exe bloqueado" }));
  await assert.rejects(failing, /chrome\.exe bloqueado/);

  await assert.rejects(registry.openBrowser("agente-0002", 50), (err: any) => err.code === "LOCAL_AGENT_TIMEOUT");
  assert.ok(socket.sent.filter((m) => m.t === "close_browser").length >= 1, "tras el tiempo límite se pide cerrar");
});

test("reconexión con el mismo agentId reemplaza el canal viejo", () => {
  const registry = new LocalAgentRegistry(fakePackage(), () => undefined);
  const old = connect(registry, "agente-0001", "10.0.0.5");
  connect(registry, "agente-0001", "10.0.0.5");
  assert.equal(old.socket.closed, "replaced");
  old.handlers.onClose();
  assert.equal(registry.list().length, 1, "el cierre del viejo no borra el nuevo");
});

test("IP del cliente: X-Forwarded-For solo si la conexión viene de la propia máquina", () => {
  const req = (remoteAddress: string, xff?: string) => ({ socket: { remoteAddress }, headers: xff ? { "x-forwarded-for": xff } : {} }) as never;
  assert.equal(clientIpOf(req("::ffff:127.0.0.1", "10.1.2.3")), "10.1.2.3");
  assert.equal(clientIpOf(req("::1", "10.1.2.3, 1.1.1.1")), "10.1.2.3");
  assert.equal(clientIpOf(req("10.9.9.9", "10.1.2.3")), "10.9.9.9", "un cliente remoto no puede fingir su IP");
  assert.equal(clientIpOf(req("::ffff:10.9.9.9")), "10.9.9.9");
});

test("clave de agente: sin configurar acepta todo; configurada exige la misma", () => {
  assert.equal(agentKeyAccepted(undefined, ""), true);
  assert.equal(agentKeyAccepted(undefined, "secreto"), false);
  assert.equal(agentKeyAccepted("otro", "secreto"), false);
  assert.equal(agentKeyAccepted("secreto", "secreto"), true);
});
