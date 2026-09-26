import fs from "node:fs";
import path from "node:path";
import { findRoutePolicy } from "../src/server/middleware/route-policy";

/**
 * Completeness check: every route the Express routers actually define must have
 * a policy in route-policy.ts, otherwise enforceRoutePolicy would refuse it.
 */
const MOUNTS: Record<string, string> = {
  "projects.ts": "/api/projects",
  "runs.ts": "/api/runs",
  "recordings.ts": "/api/recordings",
  "scenarios.ts": "/api/scenarios",
  "mobile.ts": "/api/mobile",
  "jira.ts": "/api/jira",
  "testrail.ts": "/api/testrail",
  "auth.ts": "/api/auth",
  "users.ts": "/api/users",
  "roles.ts": "/api/roles",
  "internal-otp.ts": "/api/internal/otp",
  "debug.ts": "/api/debug",
  // Mounted at the app root: their paths are already absolute.
  "executions.ts": "",
  "checklist.ts": "",
  "health.ts": "",
};

const ROUTE_RE = /^\s*(?:router|[a-zA-Z]+Router)\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/;
const routesDir = path.resolve(__dirname, "..", "src", "server", "routes");

let total = 0;
const missing: string[] = [];

for (const file of fs.readdirSync(routesDir)) {
  if (!file.endsWith(".ts") || file.includes(".test.")) continue;
  const mount = MOUNTS[file];
  if (mount === undefined) {
    console.warn(`  ?  ${file}: sin punto de montaje conocido, se omite`);
    continue;
  }
  const source = fs.readFileSync(path.join(routesDir, file), "utf8");
  for (const line of source.split("\n")) {
    const matched = ROUTE_RE.exec(line);
    if (!matched) continue;
    const method = matched[1].toUpperCase();
    const suffix = matched[2] === "/" ? "" : matched[2];
    const full = `${mount}${suffix}` || "/";
    total += 1;
    if (!findRoutePolicy(method, full.replace(/:[^/]+/g, "x"))) {
      missing.push(`${method} ${full}`);
    }
  }
}

console.log(`\n[coverage] ${total} rutas definidas en los routers`);
if (missing.length > 0) {
  console.error(`[coverage] ${missing.length} SIN política declarada:`);
  for (const route of missing) console.error(`   - ${route}`);
  process.exitCode = 1;
} else {
  console.log(`[coverage] todas tienen política declarada\n`);
}
