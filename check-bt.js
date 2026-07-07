const fs = require("fs");
const c = fs.readFileSync("C:\\MisProyectos\\arquitectura-IA-Playwright-feature-auth-gate\\src\\scenarios\\mcp-scenario-prompt-builder.ts", "utf-8");
const lines = c.split("\n");
let bt = 0;
for (let i = 0; i < lines.length; i++) {
  const b = (lines[i].match(/`/g) || []).length;
  bt += b;
  if (b % 2 !== 0) console.log("L" + (i + 1) + ": odd backticks (" + b + ")");
}
console.log("Total backticks:", bt, "even:", bt % 2 === 0);
