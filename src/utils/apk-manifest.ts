import { readFile } from "node:fs/promises";
import JSZip from "jszip";

/**
 * Lee paquete, actividad principal y versión de un APK sin herramientas del SDK:
 * descomprime AndroidManifest.xml (XML binario de Android, "AXML") y lo recorre.
 * Así el servidor solo necesita el APK subido; aapt/apkanalyzer quedan de respaldo
 * en `inspectApk`.
 *
 * Formato: una secuencia de bloques {tipo u16, tamaño de cabecera u16, tamaño u32}.
 * Interesan el pool de cadenas, el mapa de recursos (ids de los atributos, por si
 * el APK está ofuscado y los nombres vienen vacíos) y los inicios/finales de elemento.
 */

export type ApkManifestInfo = {
  packageName: string;
  /** Actividad con MAIN + LAUNCHER, con el nombre completo ("" si no hay). */
  mainActivity: string;
  versionName?: string;
  versionCode?: string;
  minSdk?: string;
  targetSdk?: string;
};

export class ApkManifestError extends Error {
  constructor(public readonly code: "apk_not_zip" | "manifest_missing" | "manifest_invalid", message: string) {
    super(message);
    this.name = "ApkManifestError";
  }
}

const RES_STRING_POOL_TYPE = 0x0001;
const RES_XML_TYPE = 0x0003;
const RES_XML_START_ELEMENT_TYPE = 0x0102;
const RES_XML_END_ELEMENT_TYPE = 0x0103;
const RES_XML_RESOURCE_MAP_TYPE = 0x0180;
const UTF8_FLAG = 0x100;
const NO_INDEX = 0xffffffff;

/** Ids de atributos de android: (android.R.attr), para APKs con nombres de atributo vacíos. */
const ATTR_BY_ID: Record<number, string> = {
  0x01010003: "name",
  0x0101000e: "enabled",
  0x0101020c: "minSdkVersion",
  0x01010270: "targetSdkVersion",
  0x0101021b: "versionCode",
  0x0101021c: "versionName",
};

type Element = { name: string; attrs: Record<string, string>; children: Element[] };

export async function readApkManifest(apkPath: string): Promise<ApkManifestInfo> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await readFile(apkPath));
  } catch {
    throw new ApkManifestError("apk_not_zip", "El archivo no es un APK válido (no se pudo abrir como zip)");
  }
  const entry = zip.file("AndroidManifest.xml");
  if (!entry) throw new ApkManifestError("manifest_missing", "El APK no tiene AndroidManifest.xml");
  return manifestInfo(parseAxml(Buffer.from(await entry.async("uint8array"))));
}

export function manifestInfo(root: Element): ApkManifestInfo {
  if (root.name !== "manifest") throw new ApkManifestError("manifest_invalid", `El manifiesto empieza por <${root.name}>, no <manifest>`);
  const packageName = root.attrs.package ?? "";
  if (!packageName) throw new ApkManifestError("manifest_invalid", "El manifiesto no declara el paquete");
  const usesSdk = root.children.find((c) => c.name === "uses-sdk");
  const application = root.children.find((c) => c.name === "application");
  const launcher = application?.children.find((c) =>
    (c.name === "activity" || c.name === "activity-alias") &&
    c.attrs.enabled !== "false" &&
    c.children.some((f) =>
      f.name === "intent-filter" &&
      f.children.some((a) => a.name === "action" && a.attrs.name === "android.intent.action.MAIN") &&
      f.children.some((a) => a.name === "category" && a.attrs.name === "android.intent.category.LAUNCHER")),
  );
  return {
    packageName,
    mainActivity: fullClassName(packageName, launcher?.attrs.name),
    ...optional("versionName", root.attrs.versionName),
    ...optional("versionCode", root.attrs.versionCode),
    ...optional("minSdk", usesSdk?.attrs.minSdkVersion),
    ...optional("targetSdk", usesSdk?.attrs.targetSdkVersion),
  };
}

function optional<K extends string>(key: K, value: string | undefined): Partial<Record<K, string>> {
  return value && !value.startsWith("@") ? ({ [key]: value } as Record<K, string>) : {};
}

/** ".MainActivity" o "MainActivity" → "com.app.MainActivity". */
export function fullClassName(packageName: string, name: string | undefined): string {
  if (!name) return "";
  if (name.startsWith(".")) return packageName + name;
  if (!name.includes(".")) return `${packageName}.${name}`;
  return name;
}

/** XML binario de Android → árbol de elementos (atributos sin prefijo de espacio de nombres). */
export function parseAxml(buf: Buffer): Element {
  const fail = (why: string) => new ApkManifestError("manifest_invalid", `AndroidManifest.xml ilegible: ${why}`);
  if (buf.length < 8 || buf.readUInt16LE(0) !== RES_XML_TYPE) throw fail("no es XML binario");
  const end = Math.min(buf.length, buf.readUInt32LE(4));
  let strings: string[] = [];
  let resourceIds: number[] = [];
  const stack: Element[] = [];
  let root: Element | undefined;

  let offset = buf.readUInt16LE(2);
  while (offset + 8 <= end) {
    const type = buf.readUInt16LE(offset);
    const headerSize = buf.readUInt16LE(offset + 2);
    const size = buf.readUInt32LE(offset + 4);
    if (size < 8 || offset + size > end) throw fail(`bloque de tamaño ${size} en ${offset}`);

    if (type === RES_STRING_POOL_TYPE) {
      strings = readStringPool(buf, offset);
    } else if (type === RES_XML_RESOURCE_MAP_TYPE) {
      resourceIds = [];
      for (let p = offset + headerSize; p + 4 <= offset + size; p += 4) resourceIds.push(buf.readUInt32LE(p));
    } else if (type === RES_XML_START_ELEMENT_TYPE) {
      const ext = offset + headerSize;
      const name = strings[buf.readUInt32LE(ext + 4)] ?? "";
      const attrStart = buf.readUInt16LE(ext + 8);
      const attrSize = buf.readUInt16LE(ext + 10);
      const attrCount = buf.readUInt16LE(ext + 12);
      const attrs: Record<string, string> = {};
      for (let i = 0; i < attrCount; i += 1) {
        const a = ext + attrStart + i * attrSize;
        if (a + 20 > offset + size) throw fail("atributo fuera del bloque");
        const nameIndex = buf.readUInt32LE(a + 4);
        const attrName = strings[nameIndex] || ATTR_BY_ID[resourceIds[nameIndex]] || "";
        if (!attrName) continue;
        attrs[attrName] = attributeValue(buf, a, strings);
      }
      const element: Element = { name, attrs, children: [] };
      if (stack.length) stack[stack.length - 1].children.push(element);
      else root ??= element;
      stack.push(element);
    } else if (type === RES_XML_END_ELEMENT_TYPE) {
      stack.pop();
    }
    offset += size;
  }
  if (!root) throw fail("sin elementos");
  return root;
}

function attributeValue(buf: Buffer, a: number, strings: string[]): string {
  const raw = buf.readUInt32LE(a + 8);
  if (raw !== NO_INDEX && strings[raw] !== undefined) return strings[raw];
  const dataType = buf.readUInt8(a + 15);
  const data = buf.readUInt32LE(a + 16);
  switch (dataType) {
    case 0x03: return strings[data] ?? "";
    case 0x10: return String(data | 0);
    case 0x11: return `0x${data.toString(16)}`;
    case 0x12: return data !== 0 ? "true" : "false";
    case 0x01: return `@0x${data.toString(16).padStart(8, "0")}`;
    default: return String(data);
  }
}

function readStringPool(buf: Buffer, chunk: number): string[] {
  const count = buf.readUInt32LE(chunk + 8);
  const flags = buf.readUInt32LE(chunk + 16);
  const stringsStart = chunk + buf.readUInt32LE(chunk + 20);
  const offsets = chunk + buf.readUInt16LE(chunk + 2);
  const utf8 = (flags & UTF8_FLAG) !== 0;
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    let p = stringsStart + buf.readUInt32LE(offsets + i * 4);
    if (utf8) {
      // Largo en caracteres y luego en bytes; cada uno en 1 o 2 bytes.
      p += buf[p] & 0x80 ? 2 : 1;
      let bytes = buf[p];
      if (bytes & 0x80) {
        bytes = ((bytes & 0x7f) << 8) | buf[p + 1];
        p += 2;
      } else {
        p += 1;
      }
      out.push(buf.toString("utf8", p, p + bytes));
    } else {
      let units = buf.readUInt16LE(p);
      if (units & 0x8000) {
        units = ((units & 0x7fff) << 16) | buf.readUInt16LE(p + 2);
        p += 4;
      } else {
        p += 2;
      }
      out.push(buf.toString("utf16le", p, p + units * 2));
    }
  }
  return out;
}
