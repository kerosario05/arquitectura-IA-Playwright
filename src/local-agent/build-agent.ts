import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

/**
 * Empaqueta el agente en UN archivo .cjs (con `ws` dentro) para el PC del
 * usuario: allí solo hay un node.exe renombrado, sin node_modules.
 *
 *   npx tsx src/local-agent/build-agent.ts [carpetaSalida]
 *
 * El motor lo usa también para armar el zip que descarga el instalador de TI.
 */
export async function buildAgentBundle(outfile: string): Promise<void> {
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  await build({
    entryPoints: [path.join(__dirname, "main.ts")],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
    minify: false,
    sourcemap: false,
    legalComments: "none",
    logLevel: "silent",
    // Aceleradores nativos opcionales de ws: si faltan, ws usa JS puro.
    external: ["bufferutil", "utf-8-validate"],
  });
}

async function main(): Promise<void> {
  const outDir = path.resolve(process.argv[2] ?? path.join("dist", "local-agent"));
  const outfile = path.join(outDir, "qalab-agente.cjs");
  await buildAgentBundle(outfile);
  console.log(`agente: ${outfile} (${(fs.statSync(outfile).size / 1024).toFixed(0)} KB)`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
