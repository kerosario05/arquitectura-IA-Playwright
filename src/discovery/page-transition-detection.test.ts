import assert from "node:assert/strict";
import test from "node:test";
import { hasPageTransition, type PageState } from "./page-transition-detection";

const state = (bodyText: string, elementCount = 71, url = "/requests/11234/edit"): PageState => ({ url, bodyText, elementCount });

test("a recorded target absent before and after does not imply a transition", () => {
  assert.equal(hasPageTransition(
    state("gestion documental continuar"),
    state("gestion documental continuar"),
    "Gestión Documental 9",
  ), false);
});

test("a target that was present and disappears can still prove a transition", () => {
  assert.equal(hasPageTransition(
    state("gestion documental continuar"),
    state("firma manual aceptar"),
    "Gestión Documental",
  ), true);
});

test("route changes remain transitions even when the recorded label was never present", () => {
  assert.equal(hasPageTransition(
    state("gestion documental", 71, "/requests/11171/edit"),
    state("gestion documental", 71, "/requests/11234/edit"),
    "Gestión Documental 9",
  ), true);
});
