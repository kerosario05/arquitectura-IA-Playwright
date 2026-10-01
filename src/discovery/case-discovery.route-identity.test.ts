import assert from "node:assert/strict";
import test from "node:test";
import { safePathname, safeRouteIdentity } from "./case-discovery";

test("a query-only screen change is a route change (kiosk subcategory -> category, recording 73f03712)", () => {
  const before = "https://172.27.4.50/product-subcategory?category=cards&subcategory=credit";
  const after = "https://172.27.4.50/product-subcategory?category=cards";
  assert.equal(safePathname(before), safePathname(after), "the pathname alone cannot see it");
  assert.notEqual(safeRouteIdentity(before), safeRouteIdentity(after));
});

test("the same surface keeps the same identity, and a bad URL never throws", () => {
  assert.equal(safeRouteIdentity("https://h/a?x=1#t"), "/a?x=1#t");
  assert.equal(safeRouteIdentity("https://h/a?x=1"), safeRouteIdentity("https://h/a?x=1"));
  assert.equal(safeRouteIdentity("::not a url::"), "/");
});
