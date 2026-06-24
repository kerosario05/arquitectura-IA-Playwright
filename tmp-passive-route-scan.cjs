const { chromium } = require("playwright");

const baseUrl = process.argv[2] || "https://172.27.4.50";

function uniq(arr) {
  return [...new Set(arr)].filter(Boolean).sort();
}

function normalizeRoute(value) {
  if (!value || typeof value !== "string") return null;
  const v = value.trim();

  if (!v) return null;
  if (v.startsWith("javascript:")) return null;
  if (v.startsWith("mailto:")) return null;
  if (v.startsWith("tel:")) return null;
  if (v.startsWith("#")) return null;

  try {
    if (v.startsWith("http")) {
      const u = new URL(v);
      return u.pathname + u.search;
    }
  } catch {}

  if (v.startsWith("/")) return v;
  if (/^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/.test(v)) return "/" + v;

  return null;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ ignoreHTTPSErrors: true });

  const jsUrls = [];
  const apiUrls = [];

  page.on("response", async (res) => {
    const url = res.url();
    const ct = res.headers()["content-type"] || "";

    if (ct.includes("javascript") || url.endsWith(".js")) {
      jsUrls.push(url);
    }

    if (url.includes("/api/") || ct.includes("application/json")) {
      apiUrls.push(url);
    }
  });

  console.log("[scan] opening", baseUrl);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);

  const domRoutes = await page.evaluate(() => {
    const values = [];

    for (const el of Array.from(document.querySelectorAll("*"))) {
      const attrs = [
        "href",
        "src",
        "routerLink",
        "ng-reflect-router-link",
        "data-route",
        "data-url",
        "data-href",
        "to",
        "action"
      ];

      for (const attr of attrs) {
        const value = el.getAttribute(attr);
        if (value) values.push(value);
      }

      const onclick = el.getAttribute("onclick");
      if (onclick) values.push(onclick);
    }

    return values;
  });

  const normalizedDomRoutes = uniq(domRoutes.map(normalizeRoute).filter(Boolean));

  const scriptRouteCandidates = [];

  for (const jsUrl of uniq(jsUrls).slice(0, 20)) {
    try {
      const text = await page.evaluate(async (url) => {
        const res = await fetch(url);
        return await res.text();
      }, jsUrl);

      const patterns = [
        /path\s*:\s*["'`]([^"'`]+)["'`]/g,
        /route\s*:\s*["'`]([^"'`]+)["'`]/g,
        /routerLink\s*[:=]\s*["'`]([^"'`]+)["'`]/g,
        /navigate(?:ByUrl)?\(\s*["'`]([^"'`]+)["'`]/g,
        /["'`]\/[a-zA-Z0-9_\/.-]{2,}["'`]/g
      ];

      for (const re of patterns) {
        let match;
        while ((match = re.exec(text))) {
          const raw = match[1] || match[0].replace(/^["'`]|["'`]$/g, "");
          const route = normalizeRoute(raw);
          if (route) scriptRouteCandidates.push(route);
        }
      }
    } catch (e) {
      console.log("[scan] could not inspect js", jsUrl, e.message);
    }
  }

  console.log("");
  console.log("=== DOM routes / links visibles ===");
  console.log(normalizedDomRoutes.join("\n") || "(none)");

  console.log("");
  console.log("=== JS bundle route candidates ===");
  console.log(uniq(scriptRouteCandidates).join("\n") || "(none)");

  console.log("");
  console.log("=== JS files inspected ===");
  console.log(uniq(jsUrls).join("\n") || "(none)");

  console.log("");
  console.log("=== API / JSON calls detected ===");
  console.log(uniq(apiUrls).join("\n") || "(none)");

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
