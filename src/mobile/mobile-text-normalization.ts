export function looksLikeUtf8Mojibake(value: string): boolean {
  return /(?:Ã.|Â.|â.|Ð.|Ñ.)/.test(value);
}

function mojibakeTokenCount(value: string): number {
  const matches = value.match(/(?:Ã.|Â.|â.|Ð.|Ñ.|�)/g);
  return matches?.length ?? 0;
}

export function repairUtf8Mojibake(value: string): string {
  if (!value || !looksLikeUtf8Mojibake(value)) return value;
  const repaired = Buffer.from(value, "latin1").toString("utf8");
  if (!repaired || repaired.includes("\uFFFD")) return value;
  const originalScore = mojibakeTokenCount(value);
  const repairedScore = mojibakeTokenCount(repaired);
  return repairedScore < originalScore ? repaired : value;
}

export function normalizeComparableText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function buildTextVariants(value: string): string[] {
  const base = value.trim();
  if (!base) return [];
  const repaired = repairUtf8Mojibake(base);
  const comparableBase = normalizeComparableText(base);
  const comparableRepaired = normalizeComparableText(repaired);
  const variants = new Set<string>([base, repaired]);
  if (comparableBase && comparableBase !== base) variants.add(comparableBase);
  if (comparableRepaired && comparableRepaired !== repaired) variants.add(comparableRepaired);
  return Array.from(variants).filter((candidate) => candidate.length > 0);
}
