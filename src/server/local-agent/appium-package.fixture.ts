import fs from "node:fs";
import path from "node:path";

/**
 * Un node_modules mínimo con la forma del de Appium para las pruebas: appium (cuyo
 * index.js es un servidor que responde /status como Appium), el driver, dependencias
 * anidadas, un paquete solo de Linux y archivos que el zip debe dejar fuera.
 */

/** `node index.js server --address 127.0.0.1 --port N`: responde /status con APPIUM_HOME. */
export const FAKE_APPIUM_MAIN = `const http = require("node:http");
const args = process.argv;
const port = Number(args[args.indexOf("--port") + 1]);
http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ value: { ready: true, build: { version: "3.5.0" } }, home: process.env.APPIUM_HOME, path: req.url }));
}).listen(port, "127.0.0.1", () => console.log("fake appium listening " + port));
`;

function writePackage(dir: string, pkg: Record<string, unknown>, files: Record<string, string> = {}): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), content);
  }
}

export function writeFakeAppiumTree(root: string): void {
  const nm = path.join(root, "node_modules");
  writePackage(
    path.join(nm, "appium"),
    { name: "appium", version: "3.5.0", dependencies: { lodash: "^4" }, optionalDependencies: { "@img/sharp-linux-x64": "1", "not-installed": "1" } },
    { "index.js": FAKE_APPIUM_MAIN, "index.js.map": "{}", "lib/types.d.ts": "export {};", "README.md": "# appium" },
  );
  writePackage(path.join(nm, "appium-uiautomator2-driver"), { name: "appium-uiautomator2-driver", version: "8.4.0", dependencies: { "appium-adb": "1" } }, { "build/index.js": "module.exports = {};" });
  writePackage(path.join(nm, "appium-adb"), { name: "appium-adb", version: "1.0.0", dependencies: { semver: "7" } }, { "index.js": "" });
  // semver anidado: la versión que pide appium-adb no es la del nivel superior.
  writePackage(path.join(nm, "appium-adb", "node_modules", "semver"), { name: "semver", version: "7.0.0" }, { "index.js": "" });
  writePackage(path.join(nm, "semver"), { name: "semver", version: "5.0.0" }, { "index.js": "" });
  writePackage(path.join(nm, "lodash"), { name: "lodash", version: "4.17.21" }, { "lodash.js": "" });
  writePackage(path.join(nm, "@img", "sharp-linux-x64"), { name: "@img/sharp-linux-x64", version: "1.0.0", os: ["linux"], cpu: ["x64"] }, { "lib/sharp.node": "x" });
  // Del proyecto, no de Appium: no debe entrar en el zip.
  writePackage(path.join(nm, "playwright"), { name: "playwright", version: "1.0.0" }, { "index.js": "" });
}
