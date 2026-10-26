import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { AgentPackage, AGENT_INSTALLER, AGENT_MANIFEST, AGENT_ZIP, type AgentPackageSources } from "./agent-package";

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function fakeSources(overrides: Partial<AgentPackageSources> = {}): AgentPackageSources & { bundles: number } {
  const src = tmp("qalab-agentpkg-src-");
  const nodeExe = path.join(src, "node.exe");
  fs.writeFileSync(nodeExe, "MZ-node-falso");
  const installer = path.join(src, AGENT_INSTALLER);
  fs.writeFileSync(installer, "# instalador v1\n");
  const state = {
    version: "0.1.0",
    nodeExe,
    nodeVersion: "24.0.0",
    installer,
    bundles: 0,
    bundle: async (outfile: string) => {
      state.bundles += 1;
      fs.writeFileSync(outfile, "// agente empaquetado\n");
    },
    ...overrides,
  };
  return state;
}

function zipEntries(zip: string): string[] {
  const tar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  return execFileSync(tar, ["-tf", zip], { encoding: "utf8" }).trim().split(/\r?\n/).sort();
}

test("arma qalab-agente.zip con exe + agente + versión, manifiesto con sha256 e instalador publicado", async () => {
  const downloads = tmp("qalab-agentpkg-out-");
  const sources = fakeSources();
  const pkg = new AgentPackage(downloads, sources);

  const [a, b] = await Promise.all([pkg.ensure(() => undefined), pkg.ensure(() => undefined)]);
  assert.deepEqual(a, b);
  assert.equal(sources.bundles, 1, "una sola vez aunque lo pidan a la vez");
  const zip = path.join(downloads, AGENT_ZIP);
  assert.deepEqual(zipEntries(zip), ["qalab-agente.cjs", "qalab-agente.exe", "version.txt"]);
  assert.equal(a.sha256, createHash("sha256").update(fs.readFileSync(zip)).digest("hex"));
  assert.equal(a.url, "/descargas/qalab-agente.zip");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(downloads, AGENT_MANIFEST), "utf8")), a);
  assert.equal(fs.readFileSync(path.join(downloads, AGENT_INSTALLER), "utf8"), "# instalador v1\n");
  assert.deepEqual(fs.readdirSync(downloads).sort(), [AGENT_INSTALLER, AGENT_MANIFEST, AGENT_ZIP].sort(), "sin restos temporales");
});

test("reutiliza el zip mientras no cambie la versión del agente ni el node del servidor", async () => {
  const downloads = tmp("qalab-agentpkg-out-");
  const sources = fakeSources();
  const first = await new AgentPackage(downloads, sources).ensure(() => undefined);
  const again = await new AgentPackage(downloads, sources).ensure(() => undefined);
  assert.equal(sources.bundles, 1);
  assert.equal(again.sha256, first.sha256);

  const newer = { ...sources, version: "0.2.0" };
  const rebuilt = await new AgentPackage(downloads, newer).ensure(() => undefined);
  assert.equal(sources.bundles, 2, "versión nueva → se rearma");
  assert.equal(rebuilt.version, "0.2.0");

  const otherNode = { ...newer, nodeVersion: "24.1.0" };
  await new AgentPackage(downloads, otherNode).ensure(() => undefined);
  assert.equal(sources.bundles, 3, "node del servidor actualizado → se rearma");
});

test("actualiza el instalador publicado aunque el zip no cambie", async () => {
  const downloads = tmp("qalab-agentpkg-out-");
  const sources = fakeSources();
  await new AgentPackage(downloads, sources).ensure(() => undefined);
  fs.writeFileSync(sources.installer, "# instalador v2\n");
  await new AgentPackage(downloads, sources).ensure(() => undefined);
  assert.equal(fs.readFileSync(path.join(downloads, AGENT_INSTALLER), "utf8"), "# instalador v2\n");
  assert.equal(sources.bundles, 1);
});

test("si falla el empaquetado no deja zip a medias ni manifiesto", async () => {
  const downloads = tmp("qalab-agentpkg-out-");
  const sources = fakeSources({ bundle: async () => { throw new Error("esbuild no disponible"); } });
  await assert.rejects(new AgentPackage(downloads, sources).ensure(() => undefined), /esbuild no disponible/);
  assert.deepEqual(fs.readdirSync(downloads), [AGENT_INSTALLER]);
});
