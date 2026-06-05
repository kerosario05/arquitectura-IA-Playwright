export function resolveServerPort(env: Record<string, string | undefined>): number {
  const raw = env.PORT ?? env.API_PORT ?? "3001";
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0 && Number.isInteger(n)) return n;
  return 3001;
}
