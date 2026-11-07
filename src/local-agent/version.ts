/** Versión del agente local. Súbela al cambiar el agente: el instalador reinstala si difiere. */
export const AGENT_VERSION = "0.3.1";

/**
 * `installed` es anterior a `latest` (versiones "x.y.z"). Lo que no se puede leer no se da
 * por antiguo: el panel no debe pedir actualizar por una versión con otro formato.
 */
export function isOlderAgentVersion(installed: string, latest: string = AGENT_VERSION): boolean {
  const parse = (v: string) => (/^\d+(\.\d+)*$/.test(v.trim()) ? v.trim().split(".").map(Number) : undefined);
  const a = parse(installed);
  const b = parse(latest);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff < 0;
  }
  return false;
}
