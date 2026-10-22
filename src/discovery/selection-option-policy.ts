export type ObservedSelectionOption = { label: string; value?: string; disabled?: boolean };

const normalize = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const categoryConnectors = new Set(["de", "del", "el", "la", "los", "las", "un", "una", "unos", "unas", "of", "the", "a", "an"]);

/** All significant whole words must occur; numeric/recorded authority stays literal. */
export function selectionCategoryPattern(requested: string, strict = false): RegExp {
  const text = requested.trim();
  const category = !strict && !/\d/.test(text) && /^[\p{L}\s]+$/u.test(text);
  if (category) {
    const words = [...new Set(normalize(text).split(/\s+/).filter(word => !categoryConnectors.has(word)))];
    if (!words.length) return /(?!)/u;
    const terms = words.map(word => {
      const singular = word.length > 4 && /s$/i.test(word) && !/(?:ss|us|is)$/i.test(word) ? word.slice(0, -1) : word;
      const letters = escape(singular).replace(/[aeioun]/g, letter => ({a:"[aáàâäãå]",e:"[eéèêë]",i:"[iíìîï]",o:"[oóòôöõ]",u:"[uúùûü]",n:"[nñ]"})[letter]!);
      const term = letters + (singular.length > 3 && !/s$/i.test(singular) ? "s?" : "");
      return `(?=[\\s\\S]*(?<![\\p{L}\\p{N}])${term}(?![\\p{L}\\p{N}]))`;
    });
    return new RegExp(`^${terms.join("")}[\\s\\S]*$`, "iu");
  }
  return new RegExp(`${/^\d/.test(text) ? "(?<!\\d)" : ""}${escape(text)}${/\d$/.test(text) ? "(?!\\d)" : ""}`, "iu");
}

/** One policy for observed options; field/surface ownership is established by each adapter. */
export function resolveSelectionOption<T>(
  requested: string,
  options: readonly T[],
  describe: (option: T) => ObservedSelectionOption,
  requireUnique = false,
): { chosen?: T; matches: T[]; mode: "missing" | "unique" | "any_matching" | "ambiguous" } {
  const wanted = normalize(requested);
  if (!wanted) return { matches: [], mode: "missing" };
  const available = options.map((option) => ({ option, ...describe(option) })).filter((entry) => !entry.disabled);
  const exact = available.filter((entry) => normalize(entry.value ?? "") === wanted || normalize(entry.label) === wanted);
  const pattern = selectionCategoryPattern(wanted, requireUnique);
  const matches = (exact.length ? exact : available.filter((entry) => pattern.test(normalize(entry.label)) || pattern.test(normalize(entry.value ?? ""))))
    .sort((left, right) => normalize(left.label).localeCompare(normalize(right.label)) || normalize(left.value ?? "").localeCompare(normalize(right.value ?? "")));
  const candidates = matches.map((entry) => entry.option);
  if (!matches.length) return { matches: candidates, mode: "missing" };
  if (matches.length > 1 && (requireUnique || /\d/.test(wanted))) return { matches: candidates, mode: "ambiguous" };
  return { chosen: matches[0].option, matches: candidates, mode: matches.length === 1 ? "unique" : "any_matching" };
}

/** Compatibility adapter for existing resolvers whose zero/multiple branches carry diagnostics. */
export function selectionOptionsByPolicy<T>(requested: string, options: readonly T[], describe: (option: T) => ObservedSelectionOption, requireUnique = false): T[] {
  const result = resolveSelectionOption(requested, options, describe, requireUnique);
  return result.chosen === undefined ? result.matches : [result.chosen];
}
