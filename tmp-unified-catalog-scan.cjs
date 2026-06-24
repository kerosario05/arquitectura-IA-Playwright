const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const baseUrl = process.argv[2] || "https://172.27.4.50";
const outFile = process.argv[3] || ".artifacts/unified-catalog-kiosko.json";

const businessTerms = [
  "Consulta",
  "Balance",
  "Tarjeta",
  "Crédito",
  "Credito",
  "Préstamo",
  "Prestamo",
  "Depósito",
  "Deposito",
  "Cuenta",
  "Producto",
  "Pago",
  "Estado de cuenta",
  "Transacciones",
  "Servicios",
  "Certificado",
  "Carta",
  "Cancelar"
];

function uniq(arr) {
  return [...new Set(arr)].filter(Boolean).sort();
}

function clean(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
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

  if (/^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/.test(v)) {
    return "/" + v;
  }

  return null;
}

function inferAccessLevel(route, labelsText) {
  const haystack = `${route} ${labelsText}`.toLowerCase();

  const privateSignals = [
    "otp",
    "authentication",
    "identification",
    "phone-confirmation",
    "main-menu",
    "operations-menu",
    "balance",
    "account-statement",
    "product-payment",
    "credit-card-statement",
    "deposit-account-statement",
    "consumer-loan-statement",
    "certificate-of-deposit-statement",
    "consulta de balance",
    "estado de cuenta",
    "pago de productos",
    "tarjeta de crédito",
    "prestamo",
    "préstamo",
    "depósito",
    "deposito"
  ];

  const publicSignals = [
    "product-catalog",
    "product-info",
    "product-details",
    "product-subcategory",
    "product-extended",
    "digital-application",
    "online-registration"
  ];

  if (privateSignals.some((s) => haystack.includes(s))) return "private_inferred";
  if (publicSignals.some((s) => haystack.includes(s))) return "public_inferred";
  return "unknown";
}

function extractI18nPairs(text) {
  const pairs = [];
  const re = /["'`]([a-zA-Z0-9_.-]+)["'`]\s*:\s*`([^`]{2,160})`/g;

  let match;
  while ((match = re.exec(text))) {
    const key = match[1];
    const value = clean(match[2]);

    if (!value) continue;

    const lower = `${key} ${value}`.toLowerCase();
    const isBusiness = businessTerms.some((t) => lower.includes(t.toLowerCase()));

    if (isBusiness) {
      pairs.push({ key, value });
    }
  }

  return pairs;
}

async function probeRoute(page, route) {
  const url = new URL(route, baseUrl).toString();

  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 12000
    });

    await page.waitForTimeout(1000);

    const dom = await page.evaluate(() => {
      const bodyText = document.body?.innerText || "";
      const buttons = Array.from(document.querySelectorAll("button"))
        .map((b) => b.innerText || b.getAttribute("aria-label") || "")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 12);

      const links = Array.from(document.querySelectorAll("a"))
        .map((a) => a.innerText || a.getAttribute("href") || "")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 12);

      return {
        title: document.title,
        bodyTextSample: bodyText.replace(/\s+/g, " ").trim().slice(0, 260),
        buttonCount: document.querySelectorAll("button").length,
        inputCount: document.querySelectorAll("input").length,
        linkCount: document.querySelectorAll("a").length,
        buttons,
        links
      };
    });

    return {
      route,
      status: response ? response.status() : null,
      finalUrl: page.url(),
      redirected: page.url() !== url,
      ...dom
    };
  } catch (error) {
    return {
      route,
      error: error.message
    };
  }
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

  console.log("[unified-catalog] opening", baseUrl);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);

  const domValues = await page.evaluate(() => {
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
    }

    return values;
  });

  const domRoutes = uniq(domValues.map(normalizeRoute).filter(Boolean));

  const bundleRoutes = [];
  const i18nPairs = [];

  for (const jsUrl of uniq(jsUrls).slice(0, 20)) {
    console.log("[unified-catalog] inspecting bundle", jsUrl);

    try {
      const text = await page.evaluate(async (url) => {
        const res = await fetch(url);
        return await res.text();
      }, jsUrl);

      const routePatterns = [
        /path\s*:\s*["'`]([^"'`]+)["'`]/g,
        /route\s*:\s*["'`]([^"'`]+)["'`]/g,
        /routerLink\s*[:=]\s*["'`]([^"'`]+)["'`]/g,
        /navigate(?:ByUrl)?\(\s*["'`]([^"'`]+)["'`]/g,
        /screenPath\s*:\s*["'`]([^"'`]+)["'`]/g,
        /["'`]\/[a-zA-Z0-9_\/.-]{2,}["'`]/g
      ];

      for (const re of routePatterns) {
        let match;
        while ((match = re.exec(text))) {
          const raw = match[1] || match[0].replace(/^["'`]|["'`]$/g, "");
          const route = normalizeRoute(raw);
          if (route) bundleRoutes.push(route);
        }
      }

      i18nPairs.push(...extractI18nPairs(text));
    } catch (error) {
      console.log("[unified-catalog] could not inspect bundle", jsUrl, error.message);
    }
  }

  const allRoutes = uniq([...domRoutes, ...bundleRoutes]);

  const labelText = i18nPairs.map((p) => `${p.key} ${p.value}`).join(" ");

  const routeCatalog = allRoutes.map((route) => ({
    route,
    accessLevel: inferAccessLevel(route, labelText),
    source: domRoutes.includes(route) && bundleRoutes.includes(route)
      ? "dom+bundle"
      : domRoutes.includes(route)
        ? "dom"
        : "bundle",
    validated: false
  }));

  const probeCandidates = uniq([
    "/",
    "/product-catalog",
    "/product-info",
    "/product-details",
    "/client-identification",
    "/phone-confirmation",
    "/otp-entry",
    "/authentication-success",
    "/main-menu",
    "/operations-menu",
    "/balance-inquiry",
    "/account-statement",
    "/product-payment"
  ].filter((r) => allRoutes.includes(r) || r === "/"));

  console.log("[unified-catalog] probing", probeCandidates.length, "routes");

  const probes = [];
  for (const route of probeCandidates) {
    probes.push(await probeRoute(page, route));
  }

  const publicRoutes = routeCatalog.filter((r) => r.accessLevel === "public_inferred");
  const privateRoutes = routeCatalog.filter((r) => r.accessLevel === "private_inferred");

  const result = {
    appSlug: "manual-kiosko-scan",
    baseUrl,
    generatedAt: new Date().toISOString(),
    mode: "unified-passive-plus-probe",
    summary: {
      domRoutes: domRoutes.length,
      bundleRoutes: uniq(bundleRoutes).length,
      allRoutes: allRoutes.length,
      i18nBusinessLabels: i18nPairs.length,
      publicInferredRoutes: publicRoutes.length,
      privateInferredRoutes: privateRoutes.length,
      probedRoutes: probes.length,
      authenticatedPrivateCatalogStatus: "not_attempted",
      authenticatedPrivateCatalogReason: "This mini test does not execute auth/OTP."
    },
    public: {
      routes: publicRoutes,
      domRoutes
    },
    privateInferred: {
      routes: privateRoutes,
      authRoutes: privateRoutes.filter((r) =>
        /client-identification|phone-confirmation|otp-entry|authentication-success/.test(r.route)
      ),
      entryRoutes: privateRoutes.filter((r) =>
        /main-menu|operations-menu/.test(r.route)
      )
    },
    businessLabels: uniq(i18nPairs.map((p) => `${p.key} = ${p.value}`)),
    routeProbes: probes,
    jsFilesInspected: uniq(jsUrls),
    apiOrJsonCallsDetected: uniq(apiUrls)
  };

  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), "utf8");

  console.log("");
  console.log("=== Unified catalog summary ===");
  console.log(JSON.stringify(result.summary, null, 2));

  console.log("");
  console.log("=== Private inferred entry/auth routes ===");
  console.log(JSON.stringify({
    authRoutes: result.privateInferred.authRoutes.map((r) => r.route),
    entryRoutes: result.privateInferred.entryRoutes.map((r) => r.route)
  }, null, 2));

  console.log("");
  console.log("=== Top business labels ===");
  console.log(result.businessLabels.slice(0, 40).join("\n"));

  console.log("");
  console.log("[unified-catalog] written:", outFile);

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
