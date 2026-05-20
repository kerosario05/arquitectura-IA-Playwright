import type { ObjectRegistry, RegistryObject } from "../types/object-registry.types";

export function normalizeRegistryText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveRegistryObject(registry: ObjectRegistry, keyOrAlias: string): RegistryObject | undefined {
  const input = normalizeRegistryText(keyOrAlias);

  const exact = registry.objects.find((item) => item.key === keyOrAlias);
  if (exact) {
    return exact;
  }

  const normalizedKey = registry.objects.find((item) => normalizeRegistryText(item.key) === input);
  if (normalizedKey) {
    return normalizedKey;
  }

  return registry.objects.find((item) =>
    (item.aliases ?? []).some((alias) => alias === keyOrAlias || normalizeRegistryText(alias) === input)
  );
}

export function findRegistryObjectsByText(registry: ObjectRegistry, text: string): RegistryObject[] {
  const normalized = normalizeRegistryText(text);
  if (!normalized) {
    return [];
  }

  return registry.objects.filter((item) => {
    const candidates = [
      item.key,
      item.name,
      item.description ?? "",
      ...(item.aliases ?? []),
      ...(item.tags ?? [])
    ].map((entry) => normalizeRegistryText(entry));

    return candidates.some((candidate) => candidate.includes(normalized));
  });
}
