const { execSync } = require("child_process");
const wdio = require("webdriverio");
const APK = "C:\\Users\\radames\\Downloads\\app-release-4.apk";
const PACKAGE = "com.appconversacionalbsc";
const ACTIVITY = "com.appconversacionalbsc.MainActivity";
const ID_NUMBER = "40224679551";
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function extractFingerprint(xml) {
  const tokens = []; const re = /(?:text|content-desc)="([^"]*)"/g; let m;
  while ((m = re.exec(xml)) !== null) { const v = m[1].trim(); if (v) tokens.push(v); }
  tokens.sort(); let h = 0; const s = tokens.join("|");
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return "fp_" + (h >>> 0).toString(16).padStart(8, "0");
}
function countTexts(xml) { return (xml.match(/text="[^"]+"/g) || []).filter(m => m.slice(6,-1).trim().length > 0).length; }
function countDescs(xml) { return (xml.match(/content-desc="[^"]+"/g) || []).filter(m => m.slice(13,-1).trim().length > 0).length; }
function getClasses(xml) {
  const s = new Set(); const re = /class="([^"]+)"/g; let m;
  while ((m = re.exec(xml)) !== null) { const c = m[1]; if (c.includes(".") && !c.includes("FrameLayout")) s.add(c.split(".").pop()); }
  return [...s].slice(0, 10);
}
function classify(xml, cls, tc, dc) {
  const pb = cls.some(c => c === "ProgressBar");
  const content = tc > 2 || dc > 2;
  if (xml.length < 500) return "app_closed";
  if (pb && !content) return "loading";
  if (pb && content) return "loading_with_content";
  if (content) return "other_content";
  return "unknown";
}
function screenSummary(xml) {
  const texts = []; const re = /text="([^"]+)"/g; let m;
  while ((m = re.exec(xml)) !== null) { const v = m[1].trim(); if (v && v.length > 2 && v.length < 60) texts.push(v); }
  return texts.slice(0, 12).join(" | ");
}
async function clickEl(browser, selector, label) {
  try {
    const el = await browser.$(selector);
    if (await el.isExisting()) { await el.click(); console.log(`  [OK] ${label}`); return true; }
  } catch {}
  console.log(`  [--] ${label}`); return false;
}

// Correct Unicode: C\u00e9dula = Cédula, \u00bf = ¿, \u00fan = ú, \u00e9 = é
const CEDULA = "C\u00e9dula de identidad";
const REGISTRATION = "\u00bfA\u00fan no tienes usuario o cuenta?";

async function main() {
  console.log("=== Loading observation: MOBILE-AA-94-002 ===\n");

  try { execSync("adb shell am force-stop " + PACKAGE, { stdio: "pipe" }); } catch {}
  await delay(1000);
  try { execSync("adb shell am start -n " + PACKAGE + "/" + ACTIVITY, { stdio: "pipe" }); } catch {}
  await delay(3000);

  const browser = await wdio.remote({
    hostname: "127.0.0.1", port: 4723, path: "/",
    capabilities: {
      platformName: "Android", "appium:automationName": "UiAutomator2",
      "appium:app": APK, "appium:appPackage": PACKAGE, "appium:appActivity": ACTIVITY,
      "appium:noReset": true, "appium:autoGrantPermissions": true, "appium:newCommandTimeout": 300,
    },
  });
  try {
    await delay(8000);
    let xml = await browser.getPageSource();
    console.log("Initial:", screenSummary(xml));

    // Step 1: Registration link
    console.log("\nStep 1: Registration...");
    await clickEl(browser, `android=new UiSelector().descriptionContains("${REGISTRATION}")`, "registration");
    await delay(6000);
    xml = await browser.getPageSource();
    console.log("After 1:", screenSummary(xml));

    // Step 2: Continuar on requirements
    console.log("\nStep 2: Continuar (requirements)...");
    await clickEl(browser, 'android=new UiSelector().description("Continuar").clickable(true)', "Continuar");
    await delay(8000);
    xml = await browser.getPageSource();
    console.log("After 2:", screenSummary(xml));

    // Step 3: Click document type dropdown
    console.log("\nStep 3: Document type...");
    await clickEl(browser, `android=new UiSelector().description("${CEDULA}")`, "Cedula dropdown");
    await delay(4000);
    xml = await browser.getPageSource();
    console.log("After 3:", screenSummary(xml));

    // Step 4: Select Cedula from dropdown
    console.log("\nStep 4: Select Cedula...");
    await clickEl(browser, `android=new UiSelector().description("${CEDULA}")`, "Cedula option");
    await delay(3000);
    xml = await browser.getPageSource();
    console.log("After 4:", screenSummary(xml));

    // Step 5: Fill ID
    console.log("\nStep 5: Fill ID...");
    try {
      const ef = await browser.$('android=new UiSelector().className("android.widget.EditText")');
      if (await ef.isExisting()) {
        await ef.setValue(ID_NUMBER);
        console.log("  [OK] ID filled");
        try { await browser.hideKeyboard(); } catch {}
      } else { console.log("  [--] EditText not found"); }
    } catch (e) { console.log("  [--] fill error:", e.message.slice(0, 80)); }
    await delay(3000);
    xml = await browser.getPageSource();
    console.log("After 5:", screenSummary(xml));

    // Step 6: Terms checkbox
    console.log("\nStep 6: Terms...");
    let termsOk = await clickEl(browser, 'android=new UiSelector().description("Acepto")', "Acepto desc");
    if (!termsOk) termsOk = await clickEl(browser, 'android=new UiSelector().textContains("Acepto")', "Acepto text");
    if (!termsOk) termsOk = await clickEl(browser, 'android=new UiSelector().textContains("acepto")', "acepto text");
    await delay(4000);
    xml = await browser.getPageSource();
    console.log("After 6:", screenSummary(xml));

    // Step 7: CLICK CONTINUAR (post-terms)
    console.log("\n=== STEP 7: CLICK CONTINUAR ===\n");
    const btn = await browser.$('android=new UiSelector().descriptionContains("Continuar").clickable(true)');
    if (!(await btn.isExisting())) {
      console.log("ERROR: Continuar not found");
      console.log("Screen:", screenSummary(xml));
      console.log("Fingerprint:", extractFingerprint(xml));
      // Try text-based
      const btnText = await browser.$('android=new UiSelector().text("Continuar").clickable(true)');
      if (await btnText.isExisting()) {
        console.log("Found via text selector, clicking...");
        const t0 = Date.now();
        await btnText.click();
        await observeClick(browser, t0);
        return;
      }
      return;
    }
    const t0 = Date.now();
    await btn.click();
    console.log("Click executed. Observing for 60s...\n");
    await observeClick(browser, t0);
  } catch (e) { console.error("FATAL:", e.message); }
  finally { try { await browser.deleteSession(); } catch {} }
}

async function observeClick(browser, t0) {
  const points = [0, 3000, 5000, 8000, 10000, 15000, 20000, 25000, 30000, 40000, 50000, 60000];
  let last = 0, finalState = "loading_persistent", endedAt = null;
  for (const t of points) {
    if (t > 0) await delay(t - last); last = t;
    const elapsed = Date.now() - t0;
    try {
      const xml = await browser.getPageSource();
      const fp = extractFingerprint(xml), cls = getClasses(xml), tc = countTexts(xml), dc = countDescs(xml), st = classify(xml, cls, tc, dc);
      console.log(`${String(elapsed).padStart(5)}ms | ${fp} | texts=${tc} descs=${dc} | [${cls.join(",")}] | ${st}`);
      if (st !== "loading" && st !== "loading_with_content" && st !== "unknown") {
        finalState = st; endedAt = elapsed;
        console.log(`\n>>> State changed at ${elapsed}ms: ${st} <<<`);
        console.log("Screen:", screenSummary(xml));
        break;
      }
    } catch (e) { console.log(`${String(elapsed).padStart(5)}ms | ERROR: ${e.message.slice(0, 60)}`); }
  }
  if (!endedAt) console.log("\n>>> 60s elapsed, loading never ended <<<\n");
  console.log(`\nfinalState=${finalState}`);
  console.log(`loadingEndedAtMs=${endedAt ?? "null"}`);
}
main();
