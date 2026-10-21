import test from "node:test";
import assert from "node:assert/strict";
import { chromium, type Page } from "@playwright/test";
import { assertJiraDownloadContent, assertJiraTableBoundDownload,ensureJiraDownloadObserver, jiraDownloadSatisfies, observeJiraVisibleTableRows, parseJiraDownloadExpectation } from "./jira-download-assertion";

const requirement = 'Validar que se descarga "datos.csv" con encabezados "Fecha, Monto".';

test("parses a download-content requirement and ignores plain visibility text", () => {
  assert.deepEqual(parseJiraDownloadExpectation(requirement), { filename: "datos.csv", headers: ["Fecha", "Monto"], row: [], tokens: [] });
  assert.equal(parseJiraDownloadExpectation('Validar que se muestra "Fecha".'), undefined);
});

const natural = 'Validar que el archivo descargado "estado-de-cuenta-regression-lab.csv" incluya los encabezados Fecha, Descripción, Referencia, Monto y Estado, y la fila visible: 10 oct 2026, Transferencia propia, TRX-800124, − RD$2,500.00, Completada.';
const csvName = "estado-de-cuenta-regression-lab.csv";
const goodCsv = 'Fecha,Descripción,Referencia,Monto,Estado\n10 oct 2026,Transferencia propia,TRX-800124,"-RD$2,500.00",Completada\n';

test("natural-language contract: headers and row are parsed, not just the filename", () => {
  assert.deepEqual(parseJiraDownloadExpectation(natural), {
    filename: csvName,
    headers: ["Fecha", "Descripción", "Referencia", "Monto", "Estado"],
    row: ["10 oct 2026", "Transferencia propia", "TRX-800124", "− RD$2,500.00", "Completada"],
    tokens: [],
  });
  // Named headers/row that cannot be extracted fail closed.
  const broken = parseJiraDownloadExpectation('Validar que el archivo descargado "a.csv" incluya los encabezados.')!;
  assert.equal(broken.unparsed, true);
  assert.equal(jiraDownloadSatisfies("a.csv", "x,y\n1,2\n", broken), false);
});

test("natural-language contract: file content gates", () => {
  const expected = parseJiraDownloadExpectation(natural)!;
  assert.equal(jiraDownloadSatisfies(csvName, goodCsv, expected), true);
  assert.equal(jiraDownloadSatisfies(csvName, "", expected), false, "empty file");
  assert.equal(jiraDownloadSatisfies(csvName, undefined, expected), false, "unreadable file");
  assert.equal(jiraDownloadSatisfies(csvName, goodCsv.replace(",Estado", ",Otro"), expected), false, "missing header");
  assert.equal(jiraDownloadSatisfies(csvName, goodCsv.split("\n")[0] + "\n", expected), false, "header only, row missing");
  assert.equal(jiraDownloadSatisfies(csvName, goodCsv.replace("TRX-800124", "TRX-000000"), expected), false, "wrong row");
  assert.equal(jiraDownloadSatisfies("otro.csv", goodCsv, expected), false, "wrong filename");
});

test("unquoted filename / detail-free download narration still requires a real download", () => {
  const unquoted = parseJiraDownloadExpectation(`Validar que se descargue el archivo ${csvName} con los movimientos correspondientes a los filtros aplicados.`)!;
  assert.equal(unquoted.filename, csvName);
  assert.equal(unquoted.tableBound, true);
  assert.equal(jiraDownloadSatisfies(csvName, goodCsv, unquoted), false, "filter binding without observed table fails closed");
  const visible = [["10 oct 2026", "Transferencia propia", "TRX-800124", "-RD$2,500.00", "Completada"]];
  assert.equal(jiraDownloadSatisfies(csvName, goodCsv, { ...unquoted, tableRows: visible }), true, "matching export rows");
  assert.equal(jiraDownloadSatisfies(csvName, goodCsv, { ...unquoted, tableRows: [["10 oct 2026", "Transferencia propia", "TRX-1", "-RD$1.00", "Completada"]] }), false, "visible row missing from export");
  assert.equal(jiraDownloadSatisfies(csvName, goodCsv + '11 oct 2026,Otra,TRX-9,"-RD$9.00",Completada\n', { ...unquoted, tableRows: visible }), false, "export has unfiltered extra row");
  assert.equal(jiraDownloadSatisfies("otro.csv", goodCsv, { ...unquoted, tableRows: visible }), false, "filename mismatch");
  assert.equal(jiraDownloadSatisfies(csvName, "  \n", unquoted), false, "empty bytes");
  const bare = parseJiraDownloadExpectation("Validar que el archivo fue descargado correctamente.")!;
  assert.ok(bare, "must not degrade to a visibility check");
  assert.equal(jiraDownloadSatisfies(csvName, goodCsv, bare), true);
  assert.equal(parseJiraDownloadExpectation("Validar que se muestre el botón de descarga."), undefined);
});

test("visible table scoping: single table observed, ambiguous/none fails closed; missing download still rejected", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent("<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td> x </td></tr></tbody></table>");
    assert.deepEqual(await observeJiraVisibleTableRows(page), [["1", "x"]]);
    await page.setContent("<table><tr><td>1</td></tr></table><table><tr><td>2</td></tr></table>");
    assert.equal(await observeJiraVisibleTableRows(page), undefined);
    await page.setContent("<p>no table</p>");
    assert.equal(await observeJiraVisibleTableRows(page), undefined);
    const expected = { ...parseJiraDownloadExpectation(`Validar que se descargue el archivo ${csvName} con los movimientos correspondientes a los filtros aplicados.`)!, tableRows: [["1"]] };
    ensureJiraDownloadObserver(page);
    await assert.rejects(assertJiraDownloadContent(page, expected, 500), /JIRA_DOWNLOAD_NOT_OBSERVED/);
  } finally {
    await browser.close();
  }
});

test("table-bound runtime helper: match passes; missing download, mismatched/extra/missing rows, ambiguous/no table fail closed", async () => {
  const browser = await chromium.launch({ headless: true });
  const expected = parseJiraDownloadExpectation(`Validar que se descargue el archivo datos.csv con los movimientos correspondientes a los filtros aplicados.`)!;
  const table = (rows: string[]) => `<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody>${rows.map(r => `<tr><td>${r}</td><td>x</td></tr>`).join("")}</tbody></table><a href="/file" id="d">Exportar</a>`;
  const run = async (html: string, csv: string | undefined, click = true) => {
    const page = await browser.newPage();
    await page.route("https://fixture.test/**", route => route.request().url().endsWith("/file")
      ? route.fulfill({ body: csv ?? "", contentType: "text/csv", headers: { "content-disposition": 'attachment; filename="datos.csv"' } })
      : route.fulfill({ contentType: "text/html", body: html }));
    await page.goto("https://fixture.test/");
    ensureJiraDownloadObserver(page);
    if (click) await page.click("#d");
    return assertJiraTableBoundDownload(page, expected, 1000);
  };
  try {
    assert.equal((await run(table(["1", "2"]), "A,B\n1,x\n2,x\n")).filename, "datos.csv");
    await assert.rejects(run(table(["1"]), "A,B\n1,x\n", false), /JIRA_DOWNLOAD_NOT_OBSERVED/);
    await assert.rejects(run(table(["1"]), "A,B\n9,x\n"), /JIRA_DOWNLOAD_CONTENT_MISMATCH/);
    await assert.rejects(run(table(["1"]), "A,B\n1,x\n2,x\n"), /JIRA_DOWNLOAD_CONTENT_MISMATCH/);
    await assert.rejects(run(table(["1", "2"]), "A,B\n1,x\n"), /JIRA_DOWNLOAD_CONTENT_MISMATCH/);
    await assert.rejects(run(`${table(["1"])}<table><tr><td>2</td></tr></table>`, "A,B\n1,x\n"), /JIRA_DOWNLOAD_TABLE_UNOBSERVABLE/);
    await assert.rejects(run('<a href="/file" id="d">Exportar</a>', "A,B\n1,x\n"), /JIRA_DOWNLOAD_TABLE_UNOBSERVABLE/);
  } finally {
    await browser.close();
  }
});

async function pageOffering(page: Page, csv: string | undefined, pageText = "Fecha Monto datos.csv") {
  await page.route("https://fixture.test/**", route => route.request().url().endsWith("/file")
    ? route.fulfill({ body: csv ?? "", contentType: "text/csv", headers: { "content-disposition": 'attachment; filename="datos.csv"' } })
    : route.fulfill({ contentType: "text/html", body: `<p>${pageText}</p><a href="/file" id="d">Exportar</a>` }));
  await page.goto("https://fixture.test/");
  ensureJiraDownloadObserver(page);
}

test("download content: match passes, mismatch fails, page text without a download event fails", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const expected = parseJiraDownloadExpectation(requirement)!;

    const ok = await browser.newPage();
    await pageOffering(ok, "Fecha,Monto\n2026-01-01,10\n");
    await ok.click("#d");
    assert.equal((await assertJiraDownloadContent(ok, expected, 5000)).filename, "datos.csv");

    const bad = await browser.newPage();
    await pageOffering(bad, "Otro,Campo\n1,2\n");
    await bad.click("#d");
    await assert.rejects(assertJiraDownloadContent(bad, expected, 1000), /JIRA_DOWNLOAD_CONTENT_MISMATCH/);

    const full = parseJiraDownloadExpectation(natural)!;
    const fileOk = await browser.newPage();
    await fileOk.route("https://fixture.test/**", route => route.request().url().endsWith("/file")
      ? route.fulfill({ body: goodCsv, contentType: "text/csv", headers: { "content-disposition": `attachment; filename="${csvName}"` } })
      : route.fulfill({ contentType: "text/html", body: '<a href="/file" id="d">Exportar</a>' }));
    await fileOk.goto("https://fixture.test/");
    ensureJiraDownloadObserver(fileOk);
    await fileOk.click("#d");
    assert.equal((await assertJiraDownloadContent(fileOk, full, 5000)).filename, csvName);

    const emptyFile = await browser.newPage();
    await emptyFile.route("https://fixture.test/**", route => route.request().url().endsWith("/file")
      ? route.fulfill({ body: "", contentType: "text/csv", headers: { "content-disposition": `attachment; filename="${csvName}"` } })
      : route.fulfill({ contentType: "text/html", body: '<a href="/file" id="d">Exportar</a>' }));
    await emptyFile.goto("https://fixture.test/");
    ensureJiraDownloadObserver(emptyFile);
    await emptyFile.click("#d");
    await assert.rejects(assertJiraDownloadContent(emptyFile, full, 1000), /JIRA_DOWNLOAD_CONTENT_MISMATCH/);

    const none = await browser.newPage();
    await pageOffering(none, undefined, "Fecha Monto datos.csv descargado");
    await assert.rejects(assertJiraDownloadContent(none, expected, 1000), /JIRA_DOWNLOAD_NOT_OBSERVED/);
    await none.setContent(`<p>${natural} ${goodCsv}</p>`);
    await assert.rejects(assertJiraDownloadContent(none, full, 1000), /JIRA_DOWNLOAD_NOT_OBSERVED/);
  } finally {
    await browser.close();
  }
});
