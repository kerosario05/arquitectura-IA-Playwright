import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Android Studio en el PC del usuario: dónde está el SDK, qué emuladores (AVD)
 * tiene creados y qué dispositivos ve adb ahora mismo.
 *
 * El agente solo informa y arranca o apaga emuladores; el servidor usa el
 * dispositivo a través de su túnel de adb.
 */

export type AndroidDevice = {
  serial: string;
  /** "device" = listo; "offline" / "unauthorized" = adb lo ve pero no lo puede usar. */
  state: string;
  kind: "emulator" | "physical";
  model?: string;
  /** Nombre del AVD cuando es un emulador. */
  avd?: string;
};

export type AndroidStatus = {
  sdkFound: boolean;
  sdkPath?: string;
  adbVersion?: string;
  emulatorFound: boolean;
  avds: string[];
  devices: AndroidDevice[];
  /** Por qué no hay SDK o qué falló al consultarlo. */
  error?: string;
  checkedAt: string;
};

export type AndroidSdkPaths = { sdkPath: string; adbPath: string; emulatorPath?: string };

export type CommandRunner = (file: string, args: string[], timeoutMs?: number) => Promise<string>;

const COMMAND_TIMEOUT_MS = 8000;

export const runCommand: CommandRunner = (file, args, timeoutMs = COMMAND_TIMEOUT_MS) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });

const exe = (name: string) => (process.platform === "win32" ? `${name}.exe` : name);

/** ANDROID_HOME, ANDROID_SDK_ROOT y la carpeta por defecto de Android Studio. */
export function sdkCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const localAppData = env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const candidates = [
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    process.platform === "win32" ? path.join(localAppData, "Android", "Sdk") : path.join(os.homedir(), "Android", "Sdk"),
    process.platform === "darwin" ? path.join(os.homedir(), "Library", "Android", "sdk") : undefined,
  ];
  return [...new Set(candidates.filter((c): c is string => Boolean(c && c.trim())).map((c) => c.trim()))];
}

/** El primer SDK que tenga adb. El emulador es opcional: un teléfono por USB basta. */
export function resolveSdk(candidates = sdkCandidates(), exists: (p: string) => boolean = fs.existsSync): AndroidSdkPaths | undefined {
  for (const sdkPath of candidates) {
    const adbPath = path.join(sdkPath, "platform-tools", exe("adb"));
    if (!exists(adbPath)) continue;
    const emulatorPath = path.join(sdkPath, "emulator", exe("emulator"));
    return { sdkPath, adbPath, emulatorPath: exists(emulatorPath) ? emulatorPath : undefined };
  }
  return undefined;
}

/** "Android Debug Bridge version 1.0.41\nVersion 35.0.2-12147458" → "35.0.2" (o "1.0.41"). */
export function parseAdbVersion(output: string): string | undefined {
  return output.match(/^Version\s+([\d.]+)/m)?.[1] ?? output.match(/Android Debug Bridge version\s+([\d.]+)/)?.[1];
}

/** Salida de `adb devices -l`. */
export function parseAdbDevices(output: string): AndroidDevice[] {
  const devices: AndroidDevice[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^(\S+)\s+(device|offline|unauthorized|no permissions|recovery|sideload|bootloader)\b(.*)$/);
    if (!match) continue;
    const [, serial, state, rest] = match;
    const model = rest.match(/\bmodel:(\S+)/)?.[1];
    devices.push({ serial, state, kind: /^emulator-\d+$/.test(serial) ? "emulator" : "physical", ...(model ? { model } : {}) });
  }
  return devices;
}

/** Salida de `emulator -list-avds`: un nombre por línea (las líneas de aviso empiezan por INFO/WARNING). */
export function parseAvdList(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^(INFO|WARNING|ERROR)\b/i.test(line) && !line.includes(" "));
}

/** Primera línea útil de `getprop ro.boot.qemu.avd_name` o de `emu avd name` (este termina en "OK"). */
export function parseAvdName(output: string): string | undefined {
  const first = output.split(/\r?\n/).map((l) => l.trim()).find((l) => l && l !== "OK");
  return first || undefined;
}

export async function probeAndroid(options: { run?: CommandRunner; sdk?: AndroidSdkPaths | undefined; now?: () => Date } = {}): Promise<AndroidStatus> {
  const run = options.run ?? runCommand;
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const sdk = "sdk" in options ? options.sdk : resolveSdk();
  if (!sdk) {
    return {
      sdkFound: false,
      emulatorFound: false,
      avds: [],
      devices: [],
      error: "No se encontró el SDK de Android (Android Studio). Revisa ANDROID_HOME o instala Android Studio.",
      checkedAt,
    };
  }

  const status: AndroidStatus = { sdkFound: true, sdkPath: sdk.sdkPath, emulatorFound: Boolean(sdk.emulatorPath), avds: [], devices: [], checkedAt };
  const problems: string[] = [];
  const [version, devices, avds] = await Promise.allSettled([
    run(sdk.adbPath, ["version"]),
    run(sdk.adbPath, ["devices", "-l"]),
    sdk.emulatorPath ? run(sdk.emulatorPath, ["-list-avds"]) : Promise.resolve(""),
  ]);
  if (version.status === "fulfilled") status.adbVersion = parseAdbVersion(version.value);
  if (devices.status === "fulfilled") status.devices = parseAdbDevices(devices.value);
  else problems.push(`adb devices falló: ${reasonOf(devices.reason)}`);
  if (avds.status === "fulfilled") status.avds = parseAvdList(avds.value);
  else problems.push(`emulator -list-avds falló: ${reasonOf(avds.reason)}`);

  await Promise.all(
    status.devices
      .filter((d) => d.kind === "emulator" && d.state === "device")
      .map(async (device) => {
        // La propiedad no necesita la consola del emulador (que en versiones
        // recientes pide un token y responde vacío); `emu avd name` queda de respaldo.
        for (const args of [["shell", "getprop", "ro.boot.qemu.avd_name"], ["emu", "avd", "name"]]) {
          const name = await run(sdk.adbPath, ["-s", device.serial, ...args]).then(parseAvdName, () => undefined);
          if (name) {
            device.avd = name;
            return;
          }
        }
        // Sin nombre el emulador sigue siendo usable por su serial.
      }),
  );
  if (problems.length) status.error = problems.join("; ");
  return status;
}

function reasonOf(err: unknown): string {
  return err instanceof Error ? err.message.split(/\r?\n/)[0] : String(err);
}

export type EmulatorProgress = (phase: "launched" | "booting") => void;

/**
 * Arranca el AVD con ventana en el escritorio del usuario (así ve la app mientras
 * graba) y espera a que Android termine de iniciar. Si ya está encendido lo reutiliza.
 */
export async function startEmulator(
  avd: string,
  options: { sdk?: AndroidSdkPaths; run?: CommandRunner; timeoutMs?: number; pollMs?: number; onProgress?: EmulatorProgress; launch?: (emulatorPath: string, avd: string) => void } = {},
): Promise<{ serial: string; avd: string }> {
  const run = options.run ?? runCommand;
  const sdk = options.sdk ?? resolveSdk();
  if (!sdk) throw new Error("No se encontró el SDK de Android (Android Studio)");
  if (!sdk.emulatorPath) throw new Error("El SDK no tiene el emulador instalado (Android Studio > SDK Manager > Android Emulator)");
  const known = parseAvdList(await run(sdk.emulatorPath, ["-list-avds"]));
  if (!known.includes(avd)) throw new Error(`El emulador "${avd}" no existe en este equipo`);

  const findRunning = async () => {
    const status = await probeAndroid({ run, sdk });
    return status.devices.find((d) => d.kind === "emulator" && d.avd === avd);
  };

  let device = await findRunning();
  if (!device) {
    (options.launch ?? launchDetached)(sdk.emulatorPath, avd);
    options.onProgress?.("launched");
  }

  const deadline = Date.now() + (options.timeoutMs ?? 180_000);
  const pollMs = options.pollMs ?? 2000;
  let announcedBoot = false;
  while (Date.now() < deadline) {
    device = device?.state === "device" ? device : await findRunning();
    if (device?.state === "device") {
      if (!announcedBoot) {
        options.onProgress?.("booting");
        announcedBoot = true;
      }
      const booted = await run(sdk.adbPath, ["-s", device.serial, "shell", "getprop", "sys.boot_completed"]).catch(() => "");
      if (booted.trim() === "1") return { serial: device.serial, avd };
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`El emulador "${avd}" no terminó de iniciar en ${Math.round((options.timeoutMs ?? 180_000) / 1000)} s`);
}

function launchDetached(emulatorPath: string, avd: string): void {
  // Desacoplado: el emulador sigue abierto aunque el agente se reinicie.
  const child = spawn(emulatorPath, ["-avd", avd], { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
}

export async function stopEmulator(serial: string, options: { sdk?: AndroidSdkPaths; run?: CommandRunner } = {}): Promise<void> {
  const sdk = options.sdk ?? resolveSdk();
  if (!sdk) throw new Error("No se encontró el SDK de Android (Android Studio)");
  if (!/^emulator-\d+$/.test(serial)) throw new Error(`"${serial}" no es un emulador`);
  const run = options.run ?? runCommand;
  try {
    await run(sdk.adbPath, ["-s", serial, "emu", "kill"]);
  } catch {
    // La consola del emulador puede rechazar la conexión (visto en emuladores
    // recientes): se apaga desde Android, que cierra también la ventana.
    await run(sdk.adbPath, ["-s", serial, "shell", "reboot", "-p"]);
  }
}
