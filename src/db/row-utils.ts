/**
 * Row coercion shared by the repositories.
 *
 * The two drivers disagree on scalar shapes: SQLite stores booleans as INTEGER
 * 0/1 and timestamps as ISO-8601 TEXT, while SQL Server returns BIT as boolean
 * and datetime2 as Date. These helpers normalize both into the JSON-friendly
 * shapes the API layer hands to clients.
 */

export function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

export function toIso(value: unknown): string {
  const iso = toIsoOrNull(value);
  if (iso === null) throw new Error(`expected a timestamp, received ${String(value)}`);
  return iso;
}

export function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/** `?, ?, ?` placeholder run for an IN clause of `count` bound parameters. */
export function placeholders(count: number): string {
  return new Array(count).fill("?").join(", ");
}
