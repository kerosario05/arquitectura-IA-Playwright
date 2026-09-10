import assert from "node:assert/strict";
import test from "node:test";
import { RuntimePageSelectionError, selectRuntimePage, type RuntimePageLike } from "./page-selection";

class FakePage implements RuntimePageLike {
  frontCount = 0;

  constructor(public readonly currentUrl: string, public readonly title = "") {}

  url(): string {
    return this.currentUrl;
  }

  async bringToFront(): Promise<void> {
    this.frontCount += 1;
  }
}

function context(...pages: FakePage[]) {
  return { pages: () => pages };
}

test("selects the target on the first page", async () => {
  const target = new FakePage("https://project-a.example.test/login");
  const selected = await selectRuntimePage(
    context(target, new FakePage("https://auth.example.test/sign-in", "Sign in to your account")),
    "https://project-a.example.test/login",
  );
  assert.equal(selected, target);
  assert.equal(target.frontCount, 1);
});

test("selects the target on the second page without using the first page", async () => {
  const target = new FakePage("https://project-a.example.test/dashboard");
  const selected = await selectRuntimePage(
    context(new FakePage("https://auth.example.test/sign-in", "Sign in to your account"), target),
    "https://project-a.example.test/login",
  );
  assert.equal(selected, target);
  assert.equal(target.frontCount, 1);
});

test("selects the target on the third page", async () => {
  const target = new FakePage("https://project-a.example.test/login");
  const selected = await selectRuntimePage(
    context(
      new FakePage("https://auth.example.test/sign-in", "Sign in to your account"),
      new FakePage("https://other.example.test/"),
      target,
    ),
    "https://project-a.example.test/login",
  );
  assert.equal(selected, target);
});

test("preserves the single-page runtime even before navigation", async () => {
  const onlyPage = new FakePage("about:blank");
  const selected = await selectRuntimePage(context(onlyPage), "https://project-a.example.test/login");
  assert.equal(selected, onlyPage);
  assert.equal(onlyPage.frontCount, 1);
});

test("fails safely when multiple pages have no target match", async () => {
  await assert.rejects(
    () => selectRuntimePage(context(new FakePage("https://auth.example.test/"), new FakePage("about:blank")), "https://project-a.example.test/login"),
    (error: unknown) => error instanceof RuntimePageSelectionError && error.code === "TARGET_PAGE_NOT_FOUND",
  );
});

test("does not use page titles to select the target", async () => {
  const target = new FakePage("https://project-b.example.test/landing", "Sign in to your account");
  const selected = await selectRuntimePage(
    context(new FakePage("https://auth.example.test/", "Application dashboard"), target),
    "https://project-b.example.test/login",
  );
  assert.equal(selected, target);
});

test("supports multiple project origins without application-specific rules", async () => {
  const targetA = new FakePage("https://project-a.example.test/home");
  const targetB = new FakePage("https://project-b.example.test/home");
  assert.equal(await selectRuntimePage(context(new FakePage("https://auth.example.test/"), targetA), "https://project-a.example.test/login"), targetA);
  assert.equal(await selectRuntimePage(context(new FakePage("https://auth.example.test/"), targetB), "https://project-b.example.test/login"), targetB);
});

test("reports ambiguity rather than falling back to page order", async () => {
  await assert.rejects(
    () => selectRuntimePage(context(new FakePage("https://project-a.example.test/one"), new FakePage("https://project-a.example.test/two")), "https://project-a.example.test/login"),
    (error: unknown) => error instanceof RuntimePageSelectionError && error.code === "AMBIGUOUS_TARGET_PAGE",
  );
});

test("prefers the configured path when several pages share the target origin", async () => {
  const target = new FakePage("https://project-a.example.test/settings");
  const selected = await selectRuntimePage(
    context(
      new FakePage("https://project-a.example.test/dashboard"),
      target,
    ),
    "https://project-a.example.test/start",
    { expectedPath: "/settings" },
  );
  assert.equal(selected, target);
});
