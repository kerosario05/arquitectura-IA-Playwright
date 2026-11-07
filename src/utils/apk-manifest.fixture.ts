import JSZip from "jszip";

/**
 * Construye un AndroidManifest.xml binario mínimo. `utf8` elige la codificación
 * del pool; `obfuscated` deja vacíos los nombres de atributo de android: y los
 * resuelve el mapa de recursos, como en APKs ofuscados. Solo para pruebas.
 */
export type Node = { name: string; attrs?: Array<[string, string | number | boolean]>; children?: Node[] };

const ATTR_IDS: Record<string, number> = { name: 0x01010003, versionCode: 0x0101021b, versionName: 0x0101021c, minSdkVersion: 0x0101020c, targetSdkVersion: 0x01010270, enabled: 0x0101000e };

export function buildAxml(root: Node, options: { utf8?: boolean; obfuscated?: boolean } = {}): Buffer {
  // Los atributos con id van primero en el pool, como hace aapt.
  const attrNames = Object.keys(ATTR_IDS);
  const pool: string[] = [...attrNames.map((n) => (options.obfuscated ? "" : n))];
  const index = (s: string) => {
    const at = pool.indexOf(s, attrNames.length);
    if (at >= 0) return at;
    pool.push(s);
    return pool.length - 1;
  };
  const attrIndex = (n: string) => (attrNames.includes(n) ? attrNames.indexOf(n) : index(n));

  const chunk = (type: number, headerSize: number, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt16LE(type, 0);
    head.writeUInt16LE(headerSize, 2);
    head.writeUInt32LE(8 + body.length, 4);
    return Buffer.concat([head, body]);
  };

  const elements: Buffer[] = [];
  const walk = (node: Node) => {
    const attrs = node.attrs ?? [];
    const ext = Buffer.alloc(20 + attrs.length * 20);
    ext.writeUInt32LE(0xffffffff, 0);
    ext.writeUInt32LE(index(node.name), 4);
    ext.writeUInt16LE(20, 8);
    ext.writeUInt16LE(20, 10);
    ext.writeUInt16LE(attrs.length, 12);
    attrs.forEach(([attrName, value], i) => {
      const a = 20 + i * 20;
      ext.writeUInt32LE(0xffffffff, a);
      ext.writeUInt32LE(attrIndex(attrName), a + 4);
      ext.writeUInt16LE(8, a + 12);
      if (typeof value === "string") {
        ext.writeUInt32LE(index(value), a + 8);
        ext.writeUInt8(0x03, a + 15);
        ext.writeUInt32LE(index(value), a + 16);
      } else {
        ext.writeUInt32LE(0xffffffff, a + 8);
        ext.writeUInt8(typeof value === "boolean" ? 0x12 : 0x10, a + 15);
        ext.writeUInt32LE(typeof value === "boolean" ? (value ? 0xffffffff : 0) : value, a + 16);
      }
    });
    const line = Buffer.alloc(8, 0xff);
    line.writeUInt32LE(1, 0);
    elements.push(chunk(0x0102, 16, Buffer.concat([line, ext])));
    (node.children ?? []).forEach(walk);
    const end = Buffer.alloc(16, 0xff);
    end.writeUInt32LE(1, 0);
    end.writeUInt32LE(index(node.name), 12);
    elements.push(chunk(0x0103, 16, end));
  };
  walk(root);

  const encoded = pool.map((s) => {
    if (options.utf8) {
      const bytes = Buffer.from(s, "utf8");
      return Buffer.concat([Buffer.from([s.length, bytes.length]), bytes, Buffer.from([0])]);
    }
    const len = Buffer.alloc(2);
    len.writeUInt16LE(s.length, 0);
    return Buffer.concat([len, Buffer.from(s, "utf16le"), Buffer.alloc(2)]);
  });
  const offsets = Buffer.alloc(pool.length * 4);
  let at = 0;
  encoded.forEach((e, i) => {
    offsets.writeUInt32LE(at, i * 4);
    at += e.length;
  });
  let data = Buffer.concat(encoded);
  if (data.length % 4) data = Buffer.concat([data, Buffer.alloc(4 - (data.length % 4))]);
  const poolHead = Buffer.alloc(20);
  poolHead.writeUInt32LE(pool.length, 0);
  poolHead.writeUInt32LE(0, 4);
  poolHead.writeUInt32LE(options.utf8 ? 0x100 : 0, 8);
  poolHead.writeUInt32LE(28 + offsets.length, 12);
  poolHead.writeUInt32LE(0, 16);
  const stringPool = chunk(0x0001, 28, Buffer.concat([poolHead, offsets, data]));

  const ids = Buffer.alloc(attrNames.length * 4);
  attrNames.forEach((n, i) => ids.writeUInt32LE(ATTR_IDS[n], i * 4));
  const resourceMap = chunk(0x0180, 8, ids);

  return chunk(0x0003, 8, Buffer.concat([stringPool, resourceMap, ...elements]));
}

/** Un APK (zip) con ese manifiesto, listo para escribir en disco. */
export function buildApk(root: Node): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("AndroidManifest.xml", buildAxml(root));
  zip.file("classes.dex", "dex");
  return zip.generateAsync({ type: "nodebuffer" });
}
