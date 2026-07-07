const fs = require("fs");
const lines = fs.readFileSync("C:\\MisProyectos\\arquitectura-IA-Playwright-feature-auth-gate\\src\\scenarios\\mcp-scenario-prompt-builder.ts", "utf-8").split("\n");
for (let i = 1485; i < 1500; i++) {
  const bt = (lines[i].split("`").length - 1);
  if (bt > 0) console.log("L" + (i + 1) + ": " + bt + " backtick(s) " + JSON.stringify(lines[i].substring(0, 100)));
}
