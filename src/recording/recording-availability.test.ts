import assert from "node:assert";
import { hasInteractiveDesktop, resolveRecordingAvailability } from "./recording-availability";

/**
 * Decides whether this installation can record. Pure function over the
 * environment, so the tests just build environments.
 */

const failures: string[] = [];

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    failures.push(label);
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const isWindows = process.platform === "win32";

console.log(`\nresolveRecordingAvailability (plataforma: ${process.platform})`);

test("una sesión interactiva puede grabar", () => {
  const result = resolveRecordingAvailability({ SESSIONNAME: "Console", DISPLAY: ":0" } as NodeJS.ProcessEnv);
  assert.strictEqual(result.enabled, true);
  assert.strictEqual(result.reason, undefined);
});

test("escritorio remoto también cuenta como interactivo", () => {
  const result = resolveRecordingAvailability({ SESSIONNAME: "RDP-Tcp#3", DISPLAY: ":0" } as NodeJS.ProcessEnv);
  assert.strictEqual(result.enabled, true);
});

if (isWindows) {
  test("un servicio en Sesión 0 no puede grabar", () => {
    const result = resolveRecordingAvailability({} as NodeJS.ProcessEnv);
    assert.strictEqual(result.enabled, false);
    assert.strictEqual(result.reason, "no_interactive_desktop");
    assert.match(String(result.message), /servicio de Windows/);
  });

  test("SESSIONNAME vacío se trata como servicio", () => {
    const result = resolveRecordingAvailability({ SESSIONNAME: "   " } as NodeJS.ProcessEnv);
    assert.strictEqual(result.enabled, false);
    assert.strictEqual(result.reason, "no_interactive_desktop");
  });

  test("detecta el escritorio por SESSIONNAME", () => {
    assert.strictEqual(hasInteractiveDesktop({ SESSIONNAME: "Console" } as NodeJS.ProcessEnv), true);
    assert.strictEqual(hasInteractiveDesktop({} as NodeJS.ProcessEnv), false);
  });
}

test("RECORDING_ENABLED=false gana aunque haya escritorio", () => {
  const result = resolveRecordingAvailability({
    SESSIONNAME: "Console",
    DISPLAY: ":0",
    RECORDING_ENABLED: "false",
  } as NodeJS.ProcessEnv);
  assert.strictEqual(result.enabled, false);
  assert.strictEqual(result.reason, "disabled_by_config");
  assert.match(String(result.message), /desde tu máquina/);
});

test("RECORDING_ENABLED=true gana aunque no se detecte escritorio", () => {
  // An operator running the engine interactively knows better than the heuristic.
  const result = resolveRecordingAvailability({ RECORDING_ENABLED: "true" } as NodeJS.ProcessEnv);
  assert.strictEqual(result.enabled, true);
});

test("acepta las formas habituales del flag", () => {
  for (const value of ["0", "no", "off", "FALSE"]) {
    assert.strictEqual(
      resolveRecordingAvailability({ SESSIONNAME: "Console", DISPLAY: ":0", RECORDING_ENABLED: value } as NodeJS.ProcessEnv).enabled,
      false,
      `valor: ${value}`,
    );
  }
  for (const value of ["1", "yes", "on", "TRUE"]) {
    assert.strictEqual(
      resolveRecordingAvailability({ RECORDING_ENABLED: value } as NodeJS.ProcessEnv).enabled,
      true,
      `valor: ${value}`,
    );
  }
});

test("un valor sin sentido cae en la detección automática", () => {
  const result = resolveRecordingAvailability({
    SESSIONNAME: "Console",
    DISPLAY: ":0",
    RECORDING_ENABLED: "quizás",
  } as NodeJS.ProcessEnv);
  assert.strictEqual(result.enabled, true, "ignora el flag inválido y mira el escritorio");
});

test("cuando no puede, siempre explica por qué", () => {
  const disabled = resolveRecordingAvailability({ RECORDING_ENABLED: "false" } as NodeJS.ProcessEnv);
  assert.ok(disabled.message && disabled.message.length > 20, "el mensaje es accionable");
  assert.ok(disabled.reason, "y trae una causa para que la UI decida");
});

console.log("");
if (failures.length > 0) {
  console.error(`${failures.length} test(s) failed:\n  - ${failures.join("\n  - ")}\n`);
  process.exitCode = 1;
} else {
  console.log("All recording availability tests passed.\n");
}
