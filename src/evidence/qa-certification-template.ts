import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import type { Page } from "@playwright/test";
import type { EvidenceDocumentModel } from "./evidence-document-model";
import type { EvidenceScenarioRecord } from "./evidence-types";

export const QA_CERTIFICATION_TEMPLATE = path.resolve(__dirname, "../../templates/evidence/qa-certification-template.docx");

/** The old environment setting must not silently restore the retired report layout. */
export function resolveCertificationTemplate(templatePath: string): string {
  return !templatePath || path.basename(templatePath) === "execution-evidence-template.docx"
    ? QA_CERTIFICATION_TEMPLATE : templatePath;
}

/** Patch a copy of the real template DOM, then translate its paragraphs/tables to print HTML.
 * No Office dependency, and no generated markup or instructions from a report are executed.
 */
export async function buildCertificationHtml(page: Page, model: EvidenceDocumentModel, records: EvidenceScenarioRecord[], templatePath: string): Promise<string> {
  const zip = await JSZip.loadAsync(await fs.readFile(templatePath));
  const read = async (part: string) => zip.file(part)?.async("string") ?? "";
  const images: Record<string, string> = {};
  for (const scenario of model.scenarios) for (const image of scenario.images) {
    images[image.path] ??= `data:image/${/\.jpe?g$/i.test(image.path) ? "jpeg" : "png"};base64,${(await fs.readFile(image.path)).toString("base64")}`;
  }
  // tsx keepNames inserts this identity helper around named local functions.
  // This page is a fresh, isolated report renderer, never the application page.
  await page.evaluate("globalThis.__name = (fn) => fn");
  const html = await page.evaluate(({ xml, header, footer, model, records, images }) => {
    const ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const parse = (source: string) => new DOMParser().parseFromString(source, "application/xml");
    const doc = parse(xml);
    const body = doc.getElementsByTagNameNS(ns, "body")[0];
    if (!body || !xml.includes("CERTIFICACI")) throw new Error("qa_certification_template_invalid");
    const children = (e: Element, name: string) => Array.from(e.children).filter(c => c.localName === name);
    const all = (e: Element, name: string) => Array.from(e.getElementsByTagNameNS(ns, name));
    const txt = (e: Element) => all(e, "t").map(t => t.textContent).join("");
    const attr = (e: Element | undefined, key = "val") => e?.getAttributeNS(ns, key) ?? "";
    const prop = (e: Element, name: string) => children(e, name)[0];
    const replace = (e: Element, value: string) => {
      const texts = all(e, "t");
      if (!texts.length) throw new Error("qa_certification_template_slot_missing");
      texts[0].textContent = value;
      for (const t of texts.slice(1)) t.textContent = "";
    };
    const setCell = (table: Element, row: number, col: number, value: string) => replace(children(children(table, "tr")[row], "tc")[col], value);
    const nodes = Array.from(body.children);
    const tables = children(body, "tbl");
    if (tables.length !== 10) throw new Error("qa_certification_template_structure_invalid");
    const sourceById = new Map(records.map(r => [r.scenarioId, r]));
    const statusById = new Map(model.scenarios.map(s => [s.scenarioId, s.status]));
    const state = (s: string) => s === "Exitoso" ? "APROBADO" : s === "Fallido" ? "FALLIDO" : s === "No ejecutado" ? "NO EJECUTADO" : "CON OBSERVACIONES";
    const approved = model.scenarios.every(s => s.status === "Exitoso");
    const rejected = model.scenarios.some(s => s.status === "Fallido");
    const final = approved ? "APROBADO" : rejected ? "RECHAZADO" : "CON OBSERVACIONES";
    const expected = (id: string) => sourceById.get(id)?.expectedResult?.trim() || "No especificado en el escenario de origen.";
    const obtained = (id: string) => {
      const sc = sourceById.get(id)!;
      return sc.actualResult?.trim() || (sc.steps.some(s => s.status === "failed")
        ? "La ejecución registró pasos fallidos. Consulte el detalle y las evidencias."
        : statusById.get(id) === "Exitoso" ? "Ejecución completada con los resultados registrados en las evidencias."
        : statusById.get(id) === "No ejecutado" ? "El escenario no fue ejecutado." : `Estado registrado: ${statusById.get(id)}. Consulte el detalle.`);
    };
    const first = records[0];
    const testTypes = [...new Set(model.scenarios.map(s => s.testType).filter(Boolean))];
    const testApproaches = [...new Set(model.scenarios.map(s => s.testApproach).filter(Boolean))];
    const testTypeSummary = testTypes.length ? testTypes.join(", ") : "Funcional";
    const testApproachSummary = testApproaches.length > 1
      ? `Mixto: ${testApproaches.join(", ")}`
      : testApproaches[0] || "No clasificado";
    const jiraRequirement = first.issueKey ? first.requirement || first.issueKey : first.requirement || "No disponible";
    const coverValues = [model.requerimiento, first.sectionName || first.appSlug, jiraRequirement, first.environment || "No informado", testTypeSummary, model.fecha, model.analista, final];
    coverValues.forEach((v, i) => setCell(tables[0], i, 1, v));
    const testTypeRow = children(tables[0], "tr").find(row => txt(children(row, "tc")[0]).trim() === "Tipo de prueba");
    if (!testTypeRow) throw new Error("qa_certification_template_test_type_row_missing");
    const approachRow = testTypeRow.cloneNode(true) as Element;
    replace(children(approachRow, "tc")[0], "Enfoque del caso");
    replace(children(approachRow, "tc")[1], testApproachSummary);
    testTypeRow.after(approachRow);
    for (const p of children(body, "p")) if (txt(p) === "[NOMBRE DEL REQUERIMIENTO / PROYECTO]") replace(p, model.requerimiento);
    const replaceAfter = (label: string, value: string) => {
      const i = nodes.findIndex(n => n.localName === "p" && txt(n) === label);
      if (i < 0 || !nodes[i + 1]) throw new Error(`qa_certification_template_slot_missing: ${label}`);
      replace(nodes[i + 1], value);
    };
    replaceAfter("Objetivo general", first.objective || `Documentar la ejecución de ${model.scenarios.length} caso(s) de prueba para ${model.requerimiento}.`);
    replaceAfter("Descripción del cambio", first.changeDescription || "No se proporcionó una descripción del cambio.");
    replaceAfter("Alcance", records.map(r => `${r.scenarioId}: ${r.scenarioTitle}`).join("\n"));
    const formatPreconditions = (items: string[]) => items.map(item => item.trim()).filter(Boolean)
      .map(item => `• ${item.replace(/^[•*-]\s*/, "")}`).join("\n");
    replaceAfter("Precondiciones", formatPreconditions([...new Set(records.flatMap(r => r.preconditions || []))]) || "No especificadas en el origen.");
    replaceAfter("Criterios de aceptación", [...new Set(records.flatMap(r => r.acceptanceCriteria?.length ? r.acceptanceCriteria : (r.expectedResult ? [r.expectedResult] : [])).map(value => value.trim()).filter(Boolean))].join("\n") || "No especificados en el origen.");
    const summaryRow = children(tables[1], "tr")[1].cloneNode(true) as Element;
    children(tables[1], "tr").slice(1).forEach(r => r.remove());
    for (const sc of model.scenarios) {
      const row = summaryRow.cloneNode(true) as Element;
      [sc.scenarioId, sc.title, expected(sc.scenarioId), obtained(sc.scenarioId), state(sc.status)].forEach((v, i) => replace(children(row, "tc")[i], v));
      tables[1].appendChild(row);
    }
    const start = nodes.findIndex(n => n.localName === "p" && /^3\. CP-01/.test(txt(n)));
    const next = nodes.findIndex(n => n.localName === "p" && /^4\. CP-02/.test(txt(n)));
    const end = nodes.findIndex(n => n.localName === "p" && /^6\. Validaci/.test(txt(n)));
    if (start < 0 || next < start || end < next) throw new Error("qa_certification_template_cases_missing");
    const pattern = nodes.slice(start, next);
    const anchor = nodes[end];
    nodes.slice(start, end).forEach(n => n.remove());
    model.scenarios.forEach((sc, index) => {
      const record = sourceById.get(sc.scenarioId)!;
      const block = pattern.map(n => n.cloneNode(true) as Element);
      replace(block[0], `${index + 3}. ${sc.scenarioId} – ${sc.title}`);
      const table = block.find(n => n.localName === "tbl")!;
      const describeStep = (step: EvidenceScenarioRecord["steps"][number]) => {
        if (/^\s*project entry\s*$/i.test(step.stepText)) return "Abrir la aplicación configurada del proyecto";
        const inputAction = step.stepText.match(/^\s*(fill|select)\s+\[([^\]]+)\]\s*$/i);
        if (!inputAction) return step.stepText;
        const normalizeKey = (value: string) => value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
        const label = Object.entries(record.dataLabels ?? {}).find(([key]) => normalizeKey(key) === normalizeKey(inputAction[2]))?.[1]
          || inputAction[2].replace(/[_-]+/g, " ").replace(/\b\w/g, letter => letter.toLocaleUpperCase("es"));
        return `${inputAction[1].toLowerCase() === "fill" ? "Ingresar" : "Seleccionar"} ${label}`;
      };
      const testData = record.testData?.length
        ? record.testData.map(item => `${item.label}: ${item.value}`).join("\n")
        : "No se registraron datos de prueba para este escenario.";
      const values = [
        record.objective || sc.title,
        formatPreconditions(record.preconditions || []) || "No especificadas en el origen.",
        testData,
        record.steps.map((s, i) => `${i + 1}. ${describeStep(s)} [${s.status === "passed" ? "Correcto" : s.status === "failed" ? "Fallido" : "No ejecutado"}]`).join("\n"),
        expected(sc.scenarioId), obtained(sc.scenarioId), state(sc.status),
      ];
      values.forEach((v, i) => setCell(table, i, 1, v));
      const evidenceBox = block.filter(n => n.localName === "tbl")[1];
      const caption = block.find(n => n.localName === "p" && /^Figura X/.test(txt(n)));
      evidenceBox?.remove();
      const breaks = block.filter(n => all(n, "br").some(br => attr(br, "type") === "page"));
      for (const n of block) if (n !== evidenceBox && n !== caption && !breaks.includes(n)) body.insertBefore(n, anchor);
      if (!sc.images.length) {
        const p = doc.createElement("p"); p.textContent = "No se capturaron imágenes durante esta ejecución."; p.setAttribute("data-native", "true"); body.insertBefore(p, anchor);
      }
      sc.screens.forEach(screen => {
        const section = doc.createElement("section"); section.setAttribute("class", "screen-evidence"); section.setAttribute("data-native", "true");
        const heading = doc.createElement("h3"); heading.textContent = `Pantalla: ${screen.title || "Pantalla sin título"}`; section.appendChild(heading);
        if (screen.steps.length) {
          const steps = doc.createElement("ol"); steps.setAttribute("class", "screen-steps");
          for (const step of screen.steps) {
            const item = doc.createElement("li");
            item.appendChild(doc.createTextNode(`${step.number > 0 ? `${step.number}. ` : ""}${step.text} `));
            const status = doc.createElement("span");
            status.setAttribute("class", `step-status ${step.status === "passed" ? "passed" : step.status === "failed" ? "failed" : "skipped"}`);
            status.textContent = `[${step.status === "passed" ? "Correcto" : step.status === "failed" ? "Fallido" : "No ejecutado"}]`;
            item.appendChild(status); steps.appendChild(item);
          }
          section.appendChild(steps);
        }
        if (!screen.images.length) {
          const missing = doc.createElement("p"); missing.textContent = "No se guardó una captura de esta pantalla durante la ejecución."; section.appendChild(missing);
        }
        for (const image of screen.images) {
          const figure = doc.createElement("figure");
          const img = doc.createElement("img"); img.setAttribute("src", images[image.path]); img.setAttribute("alt", screen.title || "Evidencia");
          const label = doc.createElement("figcaption"); label.textContent = `Figura. ${screen.title || image.stepText}${image.path === sc.finalImagePath ? " — Estado final" : ""}`;
          figure.appendChild(img); figure.appendChild(label); section.appendChild(figure);
        }
        body.insertBefore(section, anchor);
      });
      for (const n of breaks) body.insertBefore(n, anchor);
    });
    replaceAfter("6. Validación de regresión / impacto", "Solo se documentan los casos ejecutados en este informe. No se certifican procesos adicionales.");
    replace(anchor, `${model.scenarios.length + 3}. Validación de regresión / impacto`);
    const regression = tables[8];
    const regressionRow = children(regression, "tr")[1].cloneNode(true) as Element;
    children(regression, "tr").slice(1).forEach(r => r.remove());
    for (const app of new Set(records.map(r => r.appSlug))) {
      const cases = model.scenarios.filter(s => sourceById.get(s.scenarioId)?.appSlug === app);
      const row = regressionRow.cloneNode(true) as Element;
      [app, `${cases.length} caso(s) documentado(s)`, cases.every(s => s.status === "Exitoso") ? "APROBADO" : "CON OBSERVACIONES", "Consulte el resumen y las evidencias de cada caso."].forEach((v, i) => replace(children(row, "tc")[i], v));
      regression.appendChild(row);
    }
    const defects = records.flatMap(r => r.steps.filter(s => s.status === "failed").map(s => `${r.scenarioId}, paso ${s.stepIndex ?? s.index}: ${s.errorMessage || s.stepText}`));
    replaceAfter("7. Defectos / observaciones", defects.join("\n") || (approved ? "Sin incidencias registradas en los casos ejecutados." : "Hay casos pendientes o con observaciones. Revise sus resultados antes de certificar."));
    replaceAfter("8. Conclusión de certificación", `${model.scenarios.filter(s => s.status === "Exitoso").length} de ${model.scenarios.length} caso(s) completado(s) con éxito. Resultado limitado a los escenarios y evidencias de esta ejecución.`);
    [final, approved ? "Revisión y aprobación QA pendientes." : "Requiere revisión y nueva validación de los casos pendientes o fallidos.", "Pendiente de aprobación."].forEach((v, i) => setCell(tables[9], i, 1, v));
    for (const p of children(body, "p")) {
      const t = txt(p);
      if (/^Nota: agregue/.test(t)) p.remove();
      if (t === "7. Defectos / observaciones") replace(p, `${model.scenarios.length + 4}. Defectos / observaciones`);
      if (t === "8. Conclusión de certificación") replace(p, `${model.scenarios.length + 5}. Conclusión de certificación`);
    }
    const escape = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const convert = (e: Element): string => {
      if (e.hasAttribute("data-native")) return e.outerHTML.replace(/ data-native="true"/g, "");
      if (e.localName === "p") {
        if (!txt(e).trim() && all(e, "br").some(br => attr(br, "type") === "page")) return '<div class="page-break"></div>';
        const pp = prop(e, "pPr"); const style = pp && attr(prop(pp, "pStyle"));
        const css: string[] = [];
        if (pp) {
          const align = attr(prop(pp, "jc")); if (align) css.push(`text-align:${align === "both" ? "justify" : align}`);
          const spacing = prop(pp, "spacing");
          for (const side of ["before", "after"]) { const v = attr(spacing, side); if (v) css.push(`margin-${side === "before" ? "top" : "bottom"}:${Number(v) / 20}pt`); }
          if (prop(pp, "pageBreakBefore")) css.push("break-before:page");
        }
        const runs = all(e, "r").map(r => {
          const rp = prop(r, "rPr"); const rc: string[] = [];
          if (rp) {
            if (prop(rp, "b")) rc.push("font-weight:bold");
            if (prop(rp, "i")) rc.push("font-style:italic");
            const sz = attr(prop(rp, "sz")); if (sz) rc.push(`font-size:${Number(sz) / 2}pt`);
            const color = attr(prop(rp, "color")); if (/^[0-9a-f]{6}$/i.test(color)) rc.push(`color:#${color}`);
          }
          const renderLine = (line: string) => {
            const status = line.match(/^(.*)\s+\[(Correcto|Fallido|No ejecutado)\]$/);
            if (!status) return `<span class="value-line">${escape(line)}</span>`;
            const statusClass = status[2] === "Correcto" ? "passed" : status[2] === "Fallido" ? "failed" : "skipped";
            return `<span class="value-line">${escape(status[1])} <span class="step-status ${statusClass}">[${escape(status[2])}]</span></span>`;
          };
          return `<span style="${rc.join(";")}">${Array.from(r.children).map(c => c.localName === "t" ? ((c.textContent || "").includes("\n") ? (c.textContent || "").split("\n").map(renderLine).join("") : renderLine(c.textContent || "")) : c.localName === "br" ? (attr(c, "type") === "page" ? '<span class="page-break"></span>' : "<br>") : "").join("")}</span>`;
        }).join("");
        return `<p class="${escape(style || "Normal")}" style="${css.join(";")}">${runs || "&#160;"}</p>`;
      }
      if (e.localName === "tbl") {
        const grid = prop(e, "tblGrid");
        const cols = grid ? children(grid, "gridCol").map(c => `<col style="width:${Number(attr(c, "w")) / 20}pt">`).join("") : "";
        return `<table><colgroup>${cols}</colgroup>${children(e, "tr").map((r, i) => `<${i === 0 && all(r, "shd").some(s => attr(s, "fill") === "17365D") ? "thead" : "tbody"}><tr>${children(r, "tc").map(c => {
          const cp = prop(c, "tcPr"); const fill = cp && attr(prop(cp, "shd"), "fill");
          return `<td style="${fill && /^[0-9a-f]{6}$/i.test(fill) ? `background:#${fill};` : ""}">${children(c, "p").map(convert).join("")}</td>`;
        }).join("")}</tr></${i === 0 && all(r, "shd").some(s => attr(s, "fill") === "17365D") ? "thead" : "tbody"}>`).join("")}</table>`;
      }
      return "";
    };
    const headerText = txt(parse(header).documentElement); const footerText = txt(parse(footer).documentElement);
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Certificación de pruebas</title><style>
      @page { size:Letter; margin:46.8pt 51.85pt; }
      *{box-sizing:border-box}body{margin:0;font-family:Aptos,Arial,sans-serif;font-size:10.5pt;line-height:1.15;color:#111}
      p{margin:0 0 10pt;white-space:normal;overflow-wrap:anywhere}p.Heading1{font-size:16pt;font-weight:bold;color:#17365D;margin-top:24pt;margin-bottom:0;break-after:avoid}
      p.Heading2{font-size:12pt;font-weight:bold;color:#2F75B5;margin-top:10pt;margin-bottom:0;break-after:avoid}
      table{width:100%;border-collapse:collapse;table-layout:fixed;margin:6pt 0}td{border:.5pt solid black;padding:4pt 6pt;vertical-align:top;overflow-wrap:anywhere}td p{margin:0;font-size:10pt}thead{display:table-header-group}thead td{color:white}thead p{font-size:8pt;font-weight:bold}
      .screen-evidence{margin:12pt 0;break-inside:avoid}.screen-evidence h3{font-size:11pt;color:#17365D;margin:10pt 0 5pt;break-after:avoid}.screen-steps{margin:0 0 8pt;padding-left:22pt}.screen-steps li{margin:2pt 0;break-inside:avoid}.screen-evidence figure{margin:8pt 0 14pt;break-inside:avoid}.screen-evidence figure img{display:block;max-width:100%;max-height:570pt;object-fit:contain;margin:auto}.screen-evidence figcaption{text-align:center;font-size:9pt;color:#666;margin-top:4pt}
      .value-line{display:block;break-inside:avoid}.step-status{font-weight:700}.step-status.passed{color:#188038}.step-status.failed{color:#c5221f}.step-status.skipped{color:#6b7280}.page-break{display:block;break-before:page} .print-header,.print-footer{display:none}
      </style></head><body><div class="print-header">${escape(headerText)}</div>${Array.from(body.children).map(convert).join("")}<div class="print-footer">${escape(footerText)}</div></body></html>`;
  }, { xml: await read("word/document.xml"), header: await read("word/header1.xml"), footer: await read("word/footer1.xml"), model, records, images });
  const font = await fs.readFile(path.join(path.dirname(QA_CERTIFICATION_TEMPLATE), "fonts/Aptos.ttf"));
  return html.replace("<style>", `<style>@font-face{font-family:Aptos;src:url(data:font/ttf;base64,${font.toString("base64")})}`);
}
