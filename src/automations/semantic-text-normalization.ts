const MAX_MOJIBAKE_ITERATIONS = 3;

const CP1252_HIGH_BYTE: Readonly<Record<number, number>> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

function decodeMojibakeLevel(value: string): string | null {
  const bytes: number[] = [];
  for (const char of value) {
    const code = char.codePointAt(0) ?? -1;
    if (code >= 0 && code <= 0xff) bytes.push(code);
    else if (CP1252_HIGH_BYTE[code] !== undefined) bytes.push(CP1252_HIGH_BYTE[code]);
    else return null;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
  } catch {
    return null;
  }
}

function nonAsciiCount(value: string): number {
  return Array.from(value).filter((char) => (char.codePointAt(0) ?? 0) > 0x7f).length;
}

export function normalizeSemanticText(value: string): string {
  let current = decodeJsStringLiteralBody(value);
  for (let iteration = 0; iteration < MAX_MOJIBAKE_ITERATIONS; iteration += 1) {
    const decoded = decodeMojibakeLevel(current);
    if (!decoded || decoded === current || nonAsciiCount(decoded) >= nonAsciiCount(current)) break;
    current = decoded;
  }
  return current.normalize("NFC");
}

/** Decode a quoted JS string body without executing generated code. */
export function decodeJsStringLiteralBody(body: string): string {
  let result = "";
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if (char !== "\\") {
      result += char;
      continue;
    }
    const next = body[++index];
    if (next === undefined) return body;
    if (next === "n") result += "\n";
    else if (next === "r") result += "\r";
    else if (next === "t") result += "\t";
    else if (next === "b") result += "\b";
    else if (next === "f") result += "\f";
    else if (next === "v") result += "\v";
    else if (next === "0") result += "\0";
    else if (next === "x" && /^[0-9a-f]{2}$/i.test(body.slice(index + 1, index + 3))) {
      result += String.fromCharCode(Number.parseInt(body.slice(index + 1, index + 3), 16));
      index += 2;
    } else if (next === "u") {
      const hex = body.slice(index + 1, index + 5);
      if (!/^[0-9a-f]{4}$/i.test(hex)) return body;
      result += String.fromCharCode(Number.parseInt(hex, 16));
      index += 4;
    } else result += next;
  }
  return result;
}

export function semanticallyEqualText(left: string, right: string): boolean {
  return normalizeSemanticText(left) === normalizeSemanticText(right);
}
