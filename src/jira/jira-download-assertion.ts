import type { Page } from "@playwright/test";

/** A requirement about a downloaded file: the file's own bytes must be observed, never page text. */
export type JiraDownloadExpectation = {
  filename?: string;
  /** Required header cells (exact cell match on the first line). */
  headers: string[];
  /** Required row cells, in order, all on one data line. */
  row: string[];
  /** Other quoted values that must appear anywhere in the file. */
  tokens: string[];
  /** The requirement named headers/row but they could not be fully parsed: never satisfiable. */
  unparsed?: boolean;
  /** The requirement ties the export to the currently filtered visible table; unsatisfiable until `tableRows` is observed live. */
  tableBound?: boolean;
  /** Live-observed visible data rows (cells) of the single scoped table; every one must be exported and nothing else. */
  tableRows?: string[][];
};

const MAX_DOWNLOAD_BYTES = 2_000_000;

type CapturedDownload = { filename: string; content: Promise<string | undefined> };
const captured = new WeakMap<Page, CapturedDownload[]>();

const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/["']/g, "").replace(/\s+/g, " ").trim();

const QUOTED = /["“«]([^"”»]+)["”»]/g;
const HEADER_KEYWORD = /\b(?:encabezad\w*|cabecer\w*|headers?|columnas?)\b/i;
const ROW_MARKER = /(?:,?\s*\b(?:y|and)\s+)?(?:\b(?:la|una|the|a)\s+)?\b(?:filas?|rows?|registros?)\b[^:]*:/i;
const UNQUOTED_FILE = /(?<![\w.-])[\w-]+(?:\.[\w-]+)*\.(?:csv|xlsx?|pdf|txt|json|xml|zip)\b/i;
const DOWNLOAD_HAPPENED = /\b(?:se\s+descarg\w+|descargad[oa]s?|descargue\w*|downloaded)\b/i;
const TABLE_BOUND = /\b(?:filtros?\s+aplicad\w*|filtrad[oa]s?|applied\s+filters?|filtered)\b|\b(?:filas|movimientos|registros|rows)\s+visibles?\b|\bvisible\s+rows\b/i;
const splitList = (value: string, separator: RegExp) => value.replace(/[\s.,;]+$/, "").split(separator).map(part => part.replace(/^(?:y|and)\s+/i, "").trim()).filter(Boolean);

/** Null unless the requirement is about a downloaded file and says what it must be/contain. Fails closed (unparsed) when headers/row are named but not extractable. */
export function parseJiraDownloadExpectation(text: string): JiraDownloadExpectation | undefined {
  if (!/\b(?:descarg\w*|download\w*)\b/i.test(text)) return undefined;
  let filename: string | undefined;
  const quotedTokens: string[] = [];
  for (const match of text.matchAll(QUOTED)) {
    const quoted = match[1].trim();
    if (/^[^\s,;|]+\.[a-z0-9]{2,5}$/i.test(quoted)) filename ??= quoted;
    else quotedTokens.push(...quoted.split(/[,;|]/).map(part => part.trim()).filter(Boolean));
  }
  const rest = text.replace(QUOTED, " ");
  filename ??= UNQUOTED_FILE.exec(rest)?.[0];
  const rowMatch = ROW_MARKER.exec(rest);
  const before = rowMatch ? rest.slice(0, rowMatch.index) : rest;
  const row = rowMatch ? splitList(rest.slice(rowMatch.index + rowMatch[0].length), /\s*[;|]\s*|,\s+/) : [];
  const headerMatch = HEADER_KEYWORD.exec(before);
  let headers = headerMatch ? splitList(before.slice(headerMatch.index + headerMatch[0].length), /\s*[;|]\s*|,\s*|\s+(?:y|and)\s+/i) : [];
  let tokens = quotedTokens;
  if (!headers.length && headerMatch && quotedTokens.length) [headers, tokens] = [quotedTokens, []];
  const unparsed = (!!headerMatch && !headers.length) || (!!rowMatch && !row.length);
  // A narrated download with no extractable detail still needs a real, non-empty download: never fall back to page text.
  if (!filename && !tokens.length && !headers.length && !row.length && !unparsed && !DOWNLOAD_HAPPENED.test(text)) return undefined;
  const tableBound = !row.length && TABLE_BOUND.test(text);
  return { filename, headers, row, tokens, ...(unparsed ? { unparsed } : {}), ...(tableBound ? { tableBound } : {}) };
}

/** Idempotent: start recording download events (bytes stay in memory, never logged). */
export function ensureJiraDownloadObserver(page: Page): CapturedDownload[] {
  const existing = captured.get(page);
  if (existing) return existing;
  const list: CapturedDownload[] = [];
  captured.set(page, list);
  page.on("download", download => {
    const content = (async () => {
      const stream = await download.createReadStream();
      if (!stream) return undefined;
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > MAX_DOWNLOAD_BYTES) return undefined;
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks).toString("utf8");
    })().catch(() => undefined);
    list.push({ filename: download.suggestedFilename(), content });
  });
  return list;
}

export function jiraDownloadSatisfies(filename: string, content: string | undefined, expected: JiraDownloadExpectation): boolean {
  if (content === undefined || !content.trim() || expected.unparsed) return false;
  if (expected.filename && normalize(filename) !== normalize(expected.filename)) return false;
  if (expected.tableBound && !expected.tableRows?.length) return false;
  const lines = content.replace(/^﻿/, "").split(/\r?\n/).filter(line => line.trim());
  const haystack = normalize(lines.join("\n"));
  if (!expected.tokens.every(token => haystack.includes(normalize(token)))) return false;
  if (expected.headers.length) {
    const headerCells = new Set(csvCells(lines[0] ?? "").map(cellKey));
    if (!expected.headers.every(header => headerCells.has(cellKey(header)))) return false;
  }
  if (expected.row.length && !lines.slice(1).some(line => rowInLine(expected.row, line))) return false;
  if (expected.tableRows) {
    // Exported data lines and visible table rows must be the same set: nothing missing, nothing extra.
    const data = lines.slice(1);
    if (!expected.tableRows.every(row => data.some(line => rowInLine(row, line)))) return false;
    if (!data.every(line => expected.tableRows!.some(row => rowInLine(row, line)))) return false;
  }
  return true;
}

/** Ordered subsequence of cells on a single data line. */
function rowInLine(row: string[], line: string): boolean {
  const wanted = row.map(cellKey);
  let next = 0;
  for (const cell of csvCells(line)) if (next < wanted.length && cellKey(cell) === wanted[next]) next++;
  return next === wanted.length;
}

/** Rows of the single visible table on the page; undefined when none/ambiguous/empty (fail closed, no guessing which table). */
export async function observeJiraVisibleTableRows(page: Page): Promise<string[][] | undefined> {
  return page.evaluate(() => {
    // No named local helpers: the transpiler would inject __name, undefined in the page context.
    const tables = [...document.querySelectorAll("table,[role=table],[role=grid]")].filter(element => { const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none"; });
    if (tables.length !== 1) return undefined;
    const rows = [...tables[0].querySelectorAll("tr,[role=row]")]
      .map(row => [...row.querySelectorAll("td,[role=cell],[role=gridcell]")].map(cell => ((cell as HTMLElement).innerText ?? "").trim()))
      .filter(cells => cells.some(Boolean));
    return rows.length ? rows : undefined;
  });
}

const cellKey = (value: string) => normalize(value).replace(/[−–—]/g, "-").replace(/\s+/g, "");

function csvCells(line: string): string[] {
  return [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)].slice(0, -1).map(match => match[1].replace(/^"|"$/g, "").replace(/""/g, '"'));
}

/** Spec runtime for table-bound exports: observe the single visible table now, then require a real download whose data rows equal it. Fails closed on no/ambiguous table. */
export async function assertJiraTableBoundDownload(page: Page, expected: JiraDownloadExpectation, timeoutMs = 15000) {
  ensureJiraDownloadObserver(page);
  const tableRows = await observeJiraVisibleTableRows(page);
  if (!tableRows) throw new Error("JIRA_DOWNLOAD_TABLE_UNOBSERVABLE");
  return assertJiraDownloadContent(page, { ...expected, tableBound: true, tableRows }, timeoutMs);
}

/** Fails closed: passes only when a real download event carries the expected file/content. */
export async function assertJiraDownloadContent(page: Page, expected: JiraDownloadExpectation, timeoutMs = 15000): Promise<{ kind: "download_content"; filename: string; bytes: number }> {
  const downloads = ensureJiraDownloadObserver(page);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const download of [...downloads]) {
      const content = await download.content;
      if (jiraDownloadSatisfies(download.filename, content, expected)) {
        return { kind: "download_content", filename: download.filename, bytes: Buffer.byteLength(content!) };
      }
    }
    if (Date.now() >= deadline) throw new Error(downloads.length ? "JIRA_DOWNLOAD_CONTENT_MISMATCH" : "JIRA_DOWNLOAD_NOT_OBSERVED");
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}
