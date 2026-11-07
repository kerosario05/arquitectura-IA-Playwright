import { parseAdbDevices } from "../../local-agent/android-probe";
import { adbArgs, runAdb, type AdbExec, type AdbTarget } from "../../mobile/apk-installer";
import { resolveAdbPath } from "../../mobile/android-sdk";
import { localAgentRegistry, LocalAgentError, type LocalAgentRegistry } from "./agent-registry";
import { openAgentTunnel, type AgentTunnel } from "./agent-tunnel";

/**
 * El dispositivo Android que el usuario eligió en SU equipo (emulador de Android
 * Studio o teléfono por USB), listo para una grabación o una ejecución:
 *
 *   - `adb`: el adb del servidor apuntando al adb del PC por el túnel
 *     (`adb -H 127.0.0.1 -P <túnel> -s <serial>`).
 *   - `appium`: el Appium del PC por su propio túnel, solo si se pidió (grabar no
 *     lo necesita; ejecutar sí). Con un agente 0.3.0+ ese Appium es el del servidor,
 *     que el agente instala y arranca solo; con uno anterior, el que abrió el usuario.
 *
 * Es de una sola sesión: se abre al empezar y se cierra al terminar. No toca el
 * emulador ni el Appium del servidor, que siguen sirviendo al modo servidor.
 */

export type AgentDevice = {
  agentId: string;
  serial: string;
  adb: AdbTarget;
  appium?: { host: string; port: number };
  close(): Promise<void>;
};

export type OpenAgentDeviceOptions = {
  agentId: string;
  serial: string;
  /** Abrir también el túnel a Appium y comprobar que responde. */
  appium?: boolean;
  registry?: LocalAgentRegistry;
  adbPath?: string;
  exec?: AdbExec;
  fetchFn?: typeof fetch;
  log?: (line: string) => void;
};

const DEVICE_QUERY_TIMEOUT_MS = 15_000;
const APPIUM_STATUS_TIMEOUT_MS = 8_000;
/** El agente arranca Appium con la primera conexión: la primera vez tarda ~40 s. */
const MANAGED_APPIUM_STATUS_TIMEOUT_MS = 300_000;

export async function openAgentDevice(options: OpenAgentDeviceOptions): Promise<AgentDevice> {
  const registry = options.registry ?? localAgentRegistry;
  const exec = options.exec ?? runAdb;
  const log = options.log ?? (() => undefined);
  const adbPath = options.adbPath ?? resolveAdbPath();
  const tunnels: AgentTunnel[] = [];
  const closeAll = () => Promise.all(tunnels.map((t) => t.close())).then(() => undefined);

  try {
    const adbTunnel = await openAgentTunnel(options.agentId, "adb", registry, log);
    tunnels.push(adbTunnel);
    const adb: AdbTarget = { adbPath, serial: options.serial, host: adbTunnel.host, port: adbTunnel.port };
    await checkDeviceReady(adb, exec);
    log(`[dispositivo] ${options.serial} del equipo del usuario conectado por el túnel adb (puerto ${adbTunnel.port})`);

    let appium: AgentDevice["appium"];
    if (options.appium) {
      const agent = registry.get(options.agentId);
      const managed = Boolean(agent && registry.appiumSupported(agent));
      if (managed && !registry.hasAppium(agent!)) log("[dispositivo] instalando Appium en el equipo del usuario (solo la primera vez)");
      if (managed) await registry.ensureAppium(options.agentId);
      const appiumTunnel = await openAgentTunnel(options.agentId, "appium", registry, log);
      tunnels.push(appiumTunnel);
      appium = { host: appiumTunnel.host, port: appiumTunnel.port };
      await checkAppiumReady(appium, options.fetchFn ?? fetch, managed);
      log(`[dispositivo] Appium del equipo del usuario listo (túnel ${appiumTunnel.port})`);
    }

    let closing: Promise<void> | undefined;
    return {
      agentId: options.agentId,
      serial: options.serial,
      adb,
      ...(appium ? { appium } : {}),
      close: () => (closing ??= closeAll()),
    };
  } catch (err) {
    await closeAll();
    throw err;
  }
}

/** El serial existe en el adb del PC y está en estado "device". */
async function checkDeviceReady(adb: AdbTarget, exec: AdbExec): Promise<void> {
  const server = adbArgs(adb, []).slice(0, -2); // sin "-s <serial>": `devices` es del servidor adb
  const result = await exec(adb.adbPath, [...server, "devices", "-l"], DEVICE_QUERY_TIMEOUT_MS);
  if (result.exitCode !== 0) {
    throw new LocalAgentError(
      "LOCAL_AGENT_ADB_UNAVAILABLE",
      `No se pudo hablar con el adb de tu equipo: ${lastLine(result.stderr || result.stdout) || "sin respuesta"}`,
    );
  }
  const device = parseAdbDevices(result.stdout).find((d) => d.serial === adb.serial);
  if (!device) {
    throw new LocalAgentError("LOCAL_AGENT_DEVICE_NOT_FOUND", `${adb.serial} no está conectado en tu equipo. Abre el emulador o conecta el teléfono y vuelve a intentar.`);
  }
  if (device.state === "unauthorized") {
    throw new LocalAgentError("LOCAL_AGENT_DEVICE_UNAUTHORIZED", `${adb.serial} no autorizó la depuración USB: acepta el aviso en el teléfono y vuelve a intentar.`);
  }
  if (device.state !== "device") {
    throw new LocalAgentError("LOCAL_AGENT_DEVICE_NOT_READY", `${adb.serial} no está listo (estado ${device.state}).`);
  }
}

async function checkAppiumReady(appium: { host: string; port: number }, fetchFn: typeof fetch, managed: boolean): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), managed ? MANAGED_APPIUM_STATUS_TIMEOUT_MS : APPIUM_STATUS_TIMEOUT_MS);
  try {
    const res = await fetchFn(`http://${appium.host}:${appium.port}/status`, { signal: controller.signal });
    const body = (await res.json().catch(() => ({}))) as { value?: { ready?: boolean } };
    if (res.ok && body.value?.ready !== false) return;
    throw new Error(`HTTP ${res.status}`);
  } catch {
    throw new LocalAgentError(
      "LOCAL_AGENT_APPIUM_UNAVAILABLE",
      managed
        ? "Appium no arrancó en tu equipo. El detalle está en %LOCALAPPDATA%\\QALab\\agente\\logs\\appium.log; vuelve a intentar."
        : "Appium no responde en tu equipo. Ábrelo (comando `appium`, puerto 4723 o QALAB_APPIUM_PORT) o actualiza el agente de QA Lab, que lo instala solo.",
    );
  } finally {
    clearTimeout(timer);
  }
}

export type UserDeviceChoice = { localAgentId: string; deviceSerial: string };

/**
 * The device a panel request asked for, on the agent paired with that request (same IP, same
 * rules as the web recording). The agent id is never taken from the client: a job only ever
 * reaches the PC of whoever launched it.
 */
export function pairUserDevice(
  user: { userId: string | null; username: string },
  ip: string,
  serial: string,
  registry: LocalAgentRegistry = localAgentRegistry,
): UserDeviceChoice {
  const deviceSerial = serial.trim();
  if (!/^[\w.:\-]{1,128}$/.test(deviceSerial)) {
    throw new LocalAgentError("LOCAL_AGENT_BAD_REQUEST", "El serial del dispositivo no es válido");
  }
  const pairing = registry.findForUser(user, ip);
  if (pairing.status !== "found") {
    throw new LocalAgentError(
      pairing.status === "none" ? "LOCAL_AGENT_NOT_FOUND" : "LOCAL_AGENT_AMBIGUOUS",
      pairing.status === "none" ? "No hay un agente de QA Lab conectado desde tu equipo" : "Hay varios equipos en tu red: elige el tuyo",
    );
  }
  if (!registry.hasAndroid(pairing.agent)) {
    throw new LocalAgentError("LOCAL_AGENT_ANDROID_MISSING", "Tu equipo no tiene Android Studio (SDK con adb) o el agente es anterior a 0.2.0");
  }
  return { localAgentId: pairing.agent.agentId, deviceSerial };
}

function lastLine(text: string): string {
  return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-1)[0] ?? "";
}
