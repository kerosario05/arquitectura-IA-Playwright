const { chromium } = require("playwright");

const baseUrl = process.argv[2] || "https://172.27.4.50";

const terms = [
  "Consulta",
  "consulta",
  "Balance",
  "balance",
  "Tarjeta",
  "tarjeta",
  "Crédito",
  "credito",
  "credit",
  "Préstamo",
  "prestamo",
  "loan",
  "Depósito",
  "deposito",
  "deposit",
  "Certificado",
  "certificado",
  "Cuenta",
  "cuenta",
  "Producto",
  "producto",
  "Pago",
  "pago"
];

function clean(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

function unique(arr) {
  return [...new Set(arr)].filter(Boolean);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ ignoreHTTPSErrors: true });

  const jsUrls = [];

  page.on("response", async (res) => {
    const url = res.url();
    const ct = res.headers()["content-type"] || "";
    if (ct.includes("javascript") || url.endsWith(".js")) {
      jsUrls.push(url);
    }
  });

  console.log("[scan-labels] opening", baseUrl);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);

  const findings = [];

  for (const jsUrl of unique(jsUrls)) {
    console.log("[scan-labels] inspecting", jsUrl);

    const text = await page.evaluate(async (url) => {
      const res = await fetch(url);
      return await res.text();
    }, jsUrl);

    for (const term of terms) {
      let index = 0;

      while ((index = text.toLowerCase().indexOf(term.toLowerCase(), index)) !== -1) {
        const start = Math.max(0, index - 140);
        const end = Math.min(text.length, index + term.length + 220);
        const snippet = clean(text.slice(start, end));

        findings.push({
          term,
          snippet
        });

        index += term.length;
        if (findings.length > 300) break;
      }

      if (findings.length > 300) break;
    }
  }

  console.log("");
  console.log("=== Business label candidates ===");

  for (const item of findings.slice(0, 120)) {
    console.log("");
    console.log(`[term=${item.term}]`);
    console.log(item.snippet);
  }

  if (findings.length === 0) {
    console.log("(none)");
  }

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
