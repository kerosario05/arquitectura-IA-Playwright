/**
 * Whether this installation can record a walkthrough.
 *
 * Recording drives a *visible* browser that a person clicks through, so it only
 * works where there is a desktop and where that desktop is in front of the
 * person recording. On a server both fail: a Windows service runs in Session 0,
 * which has no desktop at all, and even with one the window would be on the
 * server rather than on the QA's screen.
 *
 * Rather than let someone press "Grabar" and watch nothing happen, the engine
 * states up front that it cannot, and the UI hides the module.
 */

export type RecordingAvailability = {
  enabled: boolean;
  /** Machine-readable cause, for the UI to branch on. */
  reason?: "disabled_by_config" | "no_interactive_desktop";
  /** Sentence shown to the user. */
  message?: string;
};

function parseFlag(raw: string | undefined): boolean | null {
  const value = raw?.trim().toLowerCase();
  if (!value) return null;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return null;
}

/**
 * On Windows, SESSIONNAME is set for an interactive session ("Console", or
 * "RDP-Tcp#n" over remote desktop) and absent for a service in Session 0.
 * It is the cheapest reliable signal that a window could actually be shown.
 */
export function hasInteractiveDesktop(env: NodeJS.ProcessEnv = process.env): boolean {
  if (process.platform !== "win32") {
    // On Linux/macOS a display server is the equivalent requirement.
    return Boolean(env.DISPLAY || env.WAYLAND_DISPLAY || process.platform === "darwin");
  }
  return Boolean(env.SESSIONNAME?.trim());
}

export function resolveRecordingAvailability(
  env: NodeJS.ProcessEnv = process.env,
): RecordingAvailability {
  const configured = parseFlag(env.RECORDING_ENABLED);

  if (configured === false) {
    return {
      enabled: false,
      reason: "disabled_by_config",
      message:
        "La grabación está desactivada en este servidor. Grábalo desde tu máquina y promueve el escenario; las ejecuciones sí corren aquí.",
    };
  }

  // An explicit `true` wins: an operator who knows the engine runs in an
  // interactive session should not be second-guessed by the heuristic.
  if (configured === true) return { enabled: true };

  if (!hasInteractiveDesktop(env)) {
    return {
      enabled: false,
      reason: "no_interactive_desktop",
      message:
        "Este motor corre sin escritorio (servicio de Windows), así que no puede abrir el navegador que la grabación necesita. Graba desde tu máquina.",
    };
  }

  return { enabled: true };
}
