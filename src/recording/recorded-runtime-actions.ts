import { readFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import { takePendingDetachedFileInput, takePendingFileChooser } from "./file-chooser-capture";
import { recordedLocatorFactory } from "../discovery/target-resolver";
import type { RecordedFileAssetRef, RecordedLocator, RecordedValueSelection } from "./session-trace.types";
import { resolveTestFile } from "../test-files/test-file-store";

export type RecordedRuntimeValueCapture = {
  sourceEventRef: string;
  /** Recorder-owned tab identity containing the copied value; absent on legacy single-tab recordings. */
  sourcePageKey?: string;
  technicalTargetRefs: string[];
  valueSelection: RecordedValueSelection;
};

export type RecordedRuntimeFileInput = {
  projectSlug: string;
  technicalTargetRefs: string[];
  fileAssets?: RecordedFileAssetRef[];
  /** JSON label-to-fileRef dataset selected for this run; resolved server-side by project. */
  fileSetValue?: string;
};

export function parseRecordedFileSet(value: string): Array<{ label: string; fileRef: string }> {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error("RECORDED_FILE_SET_INVALID"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("RECORDED_FILE_SET_INVALID");
  const entries = Object.entries(parsed as Record<string, unknown>);
  if (entries.length < 1 || entries.length > 20 || entries.some(([label, ref]) =>
    !label.trim() || typeof ref !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(ref),
  )) throw new Error("RECORDED_FILE_SET_INVALID");
  return entries.map(([label, fileRef]) => ({ label, fileRef: fileRef as string }));
}

export async function fillRecordedValue(page: Page, technicalTargetRefs: string[], value: string): Promise<void> {
  if (!value || !Array.isArray(technicalTargetRefs) || technicalTargetRefs.length === 0) {
    throw new Error("RECORDED_FILL_CONTRACT_INVALID");
  }
  const locator = await resolveUniqueRecordedLocator(page, technicalTargetRefs);
  const control = await locator.evaluate((element) => {
    const node = element as HTMLInputElement | HTMLTextAreaElement;
    const tag = node.tagName.toLowerCase();
    return {
      editable: (tag === "input" && !["button", "submit", "checkbox", "radio", "reset", "image", "file", "password"].includes((node as HTMLInputElement).type))
        || tag === "textarea" || (element as HTMLElement).isContentEditable,
      disabled: (node as HTMLInputElement).disabled === true,
      readOnly: "readOnly" in node && node.readOnly === true,
    };
  }).catch(() => undefined);
  if (!control?.editable || control.disabled || control.readOnly) throw new Error("RECORDED_FILL_TARGET_NOT_EDITABLE");
  await locator.fill(value);
  const actual = await locator.evaluate((element) => {
    const node = element as HTMLInputElement | HTMLTextAreaElement;
    return "value" in node ? String(node.value ?? "") : String((element as HTMLElement).textContent ?? "");
  });
  if (actual !== value) throw new Error("RECORDED_FILL_NOT_CONFIRMED");
}

function parseRecordedLocatorRef(ref: string): RecordedLocator | undefined {
  const separator = ref.indexOf(":");
  if (separator < 1 || separator === ref.length - 1) return undefined;
  const strategy = ref.slice(0, separator).trim();
  const value = ref.slice(separator + 1).trim();
  if (!strategy || !value) return undefined;
  return { strategy, value, confidence: 1 };
}

async function resolveUniqueRecordedLocator(page: Page, refs: string[]): Promise<Locator> {
  let sawAmbiguous = false;
  for (const rawRef of refs) {
    const candidate = parseRecordedLocatorRef(rawRef);
    if (!candidate) continue;
    const locator = recordedLocatorFactory(page, candidate, true);
    if (!locator) continue;
    const count = await locator.count().catch(() => 0);
    if (count === 1) return locator;
    if (count > 1) sawAmbiguous = true;
  }
  throw new Error(sawAmbiguous ? "RECORDED_TARGET_AMBIGUOUS" : "RECORDED_TARGET_NOT_FOUND");
}

export function sliceRecordedValueSelection(value: string, selection: RecordedValueSelection): string {
  const start = selection.startOffset;
  let end = selection.endAtSourceEnd ? value.length : selection.endOffset;
  // The recorded end offset is only right while the value keeps its length. When the recording kept the stable
  // text that followed the value, end there instead; if it is gone, stop rather than return a clipped value.
  if (!selection.endAtSourceEnd && typeof selection.endContext === "string" && selection.endContext.trim()) {
    const anchorAt = Number.isInteger(start) && start >= 0 ? value.indexOf(selection.endContext, start + 1) : -1;
    if (anchorAt < 0) throw new Error("RECORDED_VALUE_SELECTION_ANCHOR_NOT_FOUND");
    end = anchorAt;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > value.length) {
    throw new Error("RECORDED_VALUE_SELECTION_INVALID");
  }
  const selected = value.slice(start, end).trim();
  if (!selected || selected.length > 512 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(selected)) {
    throw new Error("RECORDED_VALUE_SELECTION_EMPTY_OR_INVALID");
  }
  // The recording kept the kind of value it copied. Another kind of text means the source resolved to the wrong place.
  if (selection.valueShape) {
    let shape: RegExp | undefined;
    try { shape = new RegExp(selection.valueShape); } catch { shape = undefined; }
    if (shape && !shape.test(selected)) throw new Error("RECORDED_VALUE_SHAPE_MISMATCH");
  }
  return selected;
}

export async function captureRecordedApplicationValue(page: Page, capture: RecordedRuntimeValueCapture): Promise<string> {
  if (!capture.sourceEventRef || !Array.isArray(capture.technicalTargetRefs) || capture.technicalTargetRefs.length === 0) {
    throw new Error("RECORDED_VALUE_SOURCE_MISSING");
  }
  const locator = await resolveUniqueRecordedLocator(page, capture.technicalTargetRefs);
  if (!await locator.isVisible().catch(() => false)) throw new Error("RECORDED_VALUE_SOURCE_NOT_VISIBLE");
  const source = await locator.evaluate((element, sourceKind) => {
    const tag = element.tagName.toLowerCase();
    if (sourceKind === "input") {
      if (tag !== "input" && tag !== "textarea") return undefined;
      return String((element as HTMLInputElement | HTMLTextAreaElement).value ?? "");
    }
    return String(element.textContent ?? "");
  }, capture.valueSelection.sourceKind).catch(() => undefined);
  if (typeof source !== "string") throw new Error("RECORDED_VALUE_SOURCE_KIND_MISMATCH");
  return sliceRecordedValueSelection(source, capture.valueSelection);
}

/**
 * A file is sent in the background ("Subiendo...", "Cargando documento"). A recorded person waits for
 * it before touching the next row; replaying at machine speed re-clicks the same still-active control
 * and the later rows never get their file. Wait, bounded, until the upload indicator is gone.
 */
async function waitForUploadToSettle(page: Page, maxMs = 45_000): Promise<void> {
  if (typeof (page as Partial<Page>).getByText !== "function") return; // lightweight page doubles
  const indicator = page.getByText(/subiendo|sincronizando|cargando documento|uploading/i).first();
  const deadline = Date.now() + maxMs;
  await page.waitForTimeout(800).catch(() => undefined); // the indicator can appear a moment after the file is set
  let seen = false;
  while (Date.now() < deadline) {
    const visible = await indicator.isVisible().catch(() => false);
    if (visible) seen = true;
    if (!visible) break;
    await page.waitForTimeout(500).catch(() => undefined);
  }
  console.log(`[recorded-upload] settled indicatorSeen=${seen}`);
  await page.waitForTimeout(400).catch(() => undefined);
}

export async function uploadRecordedFiles(page: Page, input: RecordedRuntimeFileInput): Promise<void> {
  if (!input.projectSlug?.trim() || !Array.isArray(input.technicalTargetRefs) || input.technicalTargetRefs.length === 0) {
    throw new Error("RECORDED_FILE_UPLOAD_CONTRACT_INVALID");
  }
  let fileAssets = input.fileAssets ?? [];
  if (input.fileSetValue !== undefined) {
    const entries = parseRecordedFileSet(input.fileSetValue);
    fileAssets = await Promise.all(entries.map(async ({ label, fileRef }) => {
      const resolved = await resolveTestFile(input.projectSlug, fileRef);
      return { fileRef, filename: resolved.filename || label, contentType: resolved.contentType, size: resolved.size, sha256: resolved.sha256 };
    }));
  }
  if (fileAssets.length < 1 || fileAssets.length > 20) {
    throw new Error("RECORDED_FILE_UPLOAD_CONTRACT_INVALID");
  }
  let locator: Locator | undefined;
  try {
    locator = await resolveUniqueRecordedLocator(page, input.technicalTargetRefs);
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "RECORDED_TARGET_NOT_FOUND") throw error;
  }
  if (!locator) {
    // No file input in the DOM: the preceding click opened a chooser (detached input) -- answer it.
    const chooser = takePendingFileChooser(page);
    const detachedInput = chooser ? undefined : await takePendingDetachedFileInput(page);
    console.log(`[recorded-upload] noDomInput chooserPending=${Boolean(chooser)} detachedInputPending=${Boolean(detachedInput)}`);
    if (!chooser && !detachedInput) throw new Error("RECORDED_TARGET_NOT_FOUND");
    if (fileAssets.length > 1 && !(chooser?.isMultiple() ?? await detachedInput!.evaluate((node) => node.multiple))) throw new Error("RECORDED_FILE_COUNT_NOT_SUPPORTED");
    const payloads = await Promise.all(fileAssets.map(async (asset) => {
      const resolved = await resolveTestFile(input.projectSlug, asset.fileRef);
      if (resolved.filename !== asset.filename || resolved.sha256.toLowerCase() !== asset.sha256.toLowerCase() || resolved.size !== asset.size) {
        throw new Error("RECORDED_FILE_ASSET_CHANGED");
      }
      return { name: resolved.filename, mimeType: resolved.contentType, buffer: await readFile(resolved.path) };
    }));
    if (chooser) await chooser.setFiles(payloads);
    else await detachedInput!.setInputFiles(payloads);
    console.log(`[recorded-upload] fileChooserAnswered=true files=${payloads.length}`);
    await page.evaluate(() => {
      const scope = window as unknown as { __codexUploadSequence?: number };
      scope.__codexUploadSequence = (scope.__codexUploadSequence ?? 0) + 1;
    }).catch(() => undefined);
    await waitForUploadToSettle(page);
    return;
  }
  const control = await locator.evaluate((element) => {
    const node = element as HTMLInputElement;
    return { isFileInput: node.tagName.toLowerCase() === "input" && node.type === "file", multiple: node.multiple, disabled: node.disabled };
  }).catch(() => undefined);
  if (!control?.isFileInput || control.disabled) throw new Error("RECORDED_FILE_TARGET_NOT_ACTIONABLE");
  if (fileAssets.length > 1 && !control.multiple) throw new Error("RECORDED_FILE_COUNT_NOT_SUPPORTED");

  const assets = await Promise.all(fileAssets.map(async (asset) => {
    if (!asset.fileRef || !asset.filename || !Number.isInteger(asset.size) || asset.size < 1 || !/^[a-f0-9]{64}$/i.test(asset.sha256)) {
      throw new Error("RECORDED_FILE_ASSET_INVALID");
    }
    const resolved = await resolveTestFile(input.projectSlug, asset.fileRef);
    if (resolved.filename !== asset.filename || resolved.contentType !== asset.contentType
      || resolved.sha256.toLowerCase() !== asset.sha256.toLowerCase()) {
      throw new Error("RECORDED_FILE_ASSET_CHANGED");
    }
    // Resolve verifies the persisted size and SHA-256 before returning the durable path.
    if (resolved.size !== asset.size) throw new Error("RECORDED_FILE_ASSET_CHANGED");
    return { path: resolved.path, filename: resolved.filename, contentType: resolved.contentType, size: resolved.size };
  }));
  // The store keeps each file under its fileRef; hand the page the original name and type, not the store path.
  await locator.setInputFiles(await Promise.all(assets.map(async (asset) => ({
    name: asset.filename,
    mimeType: asset.contentType,
    buffer: await readFile(asset.path),
  }))));
  const selected = await locator.evaluate((element) => Array.from((element as HTMLInputElement).files ?? [])
    .map((file) => ({ name: file.name, size: file.size, type: file.type || "application/octet-stream" })));
  if (selected.length !== assets.length || selected.some((file, index) =>
    file.name !== assets[index].filename || file.size !== assets[index].size)) {
    // Names and sizes only (never paths or bytes) so a mismatch can be told apart from a re-rendered input.
    console.log(`[recorded-upload] not confirmed expected=${JSON.stringify(assets.map((asset) => `${asset.filename}:${asset.size}`))} selected=${JSON.stringify(selected.map((file) => `${file.name}:${file.size}`))}`);
    throw new Error("RECORDED_FILE_UPLOAD_NOT_CONFIRMED");
  }
  // Lets later clicks on repeated identical controls tell which activity (click, attach, click) they belong to.
  await page.evaluate(() => {
    const scope = window as unknown as { __codexUploadSequence?: number };
    scope.__codexUploadSequence = (scope.__codexUploadSequence ?? 0) + 1;
  }).catch(() => undefined);
}
