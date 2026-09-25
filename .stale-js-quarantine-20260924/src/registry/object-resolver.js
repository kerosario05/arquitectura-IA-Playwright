"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeRegistryText = normalizeRegistryText;
exports.resolveRegistryObject = resolveRegistryObject;
exports.findRegistryObjectsByText = findRegistryObjectsByText;
function normalizeRegistryText(value) {
    return value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}
function resolveRegistryObject(registry, keyOrAlias) {
    const input = normalizeRegistryText(keyOrAlias);
    const exact = registry.objects.find((item) => item.key === keyOrAlias);
    if (exact) {
        return exact;
    }
    const normalizedKey = registry.objects.find((item) => normalizeRegistryText(item.key) === input);
    if (normalizedKey) {
        return normalizedKey;
    }
    return registry.objects.find((item) => (item.aliases ?? []).some((alias) => alias === keyOrAlias || normalizeRegistryText(alias) === input));
}
function findRegistryObjectsByText(registry, text) {
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
