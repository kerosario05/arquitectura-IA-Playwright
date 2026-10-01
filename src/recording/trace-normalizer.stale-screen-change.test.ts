import assert from "node:assert/strict";
import { test } from "node:test";
import type { RecordedEvent } from "./session-trace.types";
import { isStaleScreenChange, normalizeEvents } from "./trace-normalizer";

/**
 * Recording e52ee42c: the screen after "Explora nuestros productos" was photographed on the Visa
 * Gold detail page (the capture queue lagged ~10 s), so the scenario asserted "Más detalles del
 * producto" right after opening the catalog and all 4 replays failed there. Navigations are
 * recorded live; a screen_change contradicting the navigation its own click caused is a later
 * step's evidence and is dropped.
 */

const BASE = "https://kiosk.test";
let seq = 0;
const ev = (kind: string, extra: Record<string, unknown> = {}) => ({ seq: seq++, t: seq * 100, kind, screenKey: "s", ...extra }) as unknown as RecordedEvent;
const tap = (label: string, path: string) => ev("tap", { url: BASE + path, target: { label, locators: [{ strategy: "role", value: `button|${label}` }] } });
const note = (label: string, path: string) => ev("note", { url: BASE + path, note: label });
const nav = (path: string) => ev("navigate", { url: BASE + path });
const change = (path: string, toScreenKey: string) => ev("screen_change", { url: BASE + path, screenKey: "from", toScreenKey });

test("recording e52ee42c: the late photo after Explora is dropped, the on-time one after Solicitar is kept", () => {
  seq = 0;
  const events = [
    nav("/"),
    note("Explora nuestros productos", "/"), tap("Explora nuestros productos", "/"),
    change("/product-extended?product=tarjeta-credito-visa-gold", "detail"), // photographed 3 clicks later
    nav("/product-catalog"),
    note("Tarjetas", "/product-catalog"), tap("Tarjetas", "/product-catalog"), nav("/product-subcategory?category=cards"),
    note("Visa Gold", "/product-subcategory?category=cards"), tap("Visa Gold", "/product-subcategory?category=cards"),
    nav("/product-extended?product=tarjeta-credito-visa-gold"),
    note("Solicitar", "/product-extended?product=tarjeta-credito-visa-gold"), tap("Solicitar", "/product-extended?product=tarjeta-credito-visa-gold"),
    change("/product-extended?product=tarjeta-credito-visa-gold", "modal"), // in-place modal: no navigation to contradict
  ];
  assert.equal(isStaleScreenChange(events, 3), true);
  assert.equal(isStaleScreenChange(events, 13), false);
  assert.deepEqual(normalizeEvents(events).filter((event) => event.kind === "screen_change").map((event) => event.toScreenKey), ["modal"]);
});

test("a photo taken where the click landed is kept; a trailing slash and the origin do not matter", () => {
  seq = 0;
  const events = [note("Explora", "/"), tap("Explora", "/"), change("/product-catalog/", "catalog"), ev("navigate", { url: "https://other.origin/product-catalog" })];
  assert.equal(isStaleScreenChange(events, 2), false);
});

test("the next action's navigations never count for this click", () => {
  seq = 0;
  const events = [tap("Tarjetas", "/c"), change("/sub?category=cards", "sub"), nav("/sub?category=cards"), note("Crédito", "/sub"), tap("Crédito", "/sub"), nav("/sub?category=cards&subcategory=credit")];
  assert.equal(isStaleScreenChange(events, 1), false);
});

test("no url (mobile) or no causal action: nothing to contradict", () => {
  seq = 0;
  const mobile = [tap("Abrir", "/"), ev("screen_change", { toScreenKey: "x" }), nav("/otra")];
  assert.equal(isStaleScreenChange(mobile, 1), false);
  const first = [change("/x", "x"), nav("/y")];
  assert.equal(isStaleScreenChange(first, 0), false);
});
