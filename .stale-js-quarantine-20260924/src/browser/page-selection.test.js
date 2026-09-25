"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const page_selection_1 = require("./page-selection");
class FakePage {
    currentUrl;
    title;
    frontCount = 0;
    constructor(currentUrl, title = "") {
        this.currentUrl = currentUrl;
        this.title = title;
    }
    url() {
        return this.currentUrl;
    }
    async bringToFront() {
        this.frontCount += 1;
    }
}
function context(...pages) {
    return { pages: () => pages };
}
(0, node_test_1.default)("selects the target on the first page", async () => {
    const target = new FakePage("https://project-a.example.test/login");
    const selected = await (0, page_selection_1.selectRuntimePage)(context(target, new FakePage("https://auth.example.test/sign-in", "Sign in to your account")), "https://project-a.example.test/login");
    strict_1.default.equal(selected, target);
    strict_1.default.equal(target.frontCount, 1);
});
(0, node_test_1.default)("selects the target on the second page without using the first page", async () => {
    const target = new FakePage("https://project-a.example.test/dashboard");
    const selected = await (0, page_selection_1.selectRuntimePage)(context(new FakePage("https://auth.example.test/sign-in", "Sign in to your account"), target), "https://project-a.example.test/login");
    strict_1.default.equal(selected, target);
    strict_1.default.equal(target.frontCount, 1);
});
(0, node_test_1.default)("selects the target on the third page", async () => {
    const target = new FakePage("https://project-a.example.test/login");
    const selected = await (0, page_selection_1.selectRuntimePage)(context(new FakePage("https://auth.example.test/sign-in", "Sign in to your account"), new FakePage("https://other.example.test/"), target), "https://project-a.example.test/login");
    strict_1.default.equal(selected, target);
});
(0, node_test_1.default)("preserves the single-page runtime even before navigation", async () => {
    const onlyPage = new FakePage("about:blank");
    const selected = await (0, page_selection_1.selectRuntimePage)(context(onlyPage), "https://project-a.example.test/login");
    strict_1.default.equal(selected, onlyPage);
    strict_1.default.equal(onlyPage.frontCount, 1);
});
(0, node_test_1.default)("fails safely when multiple pages have no target match", async () => {
    await strict_1.default.rejects(() => (0, page_selection_1.selectRuntimePage)(context(new FakePage("https://auth.example.test/"), new FakePage("about:blank")), "https://project-a.example.test/login"), (error) => error instanceof page_selection_1.RuntimePageSelectionError && error.code === "TARGET_PAGE_NOT_FOUND");
});
(0, node_test_1.default)("does not use page titles to select the target", async () => {
    const target = new FakePage("https://project-b.example.test/landing", "Sign in to your account");
    const selected = await (0, page_selection_1.selectRuntimePage)(context(new FakePage("https://auth.example.test/", "Application dashboard"), target), "https://project-b.example.test/login");
    strict_1.default.equal(selected, target);
});
(0, node_test_1.default)("supports multiple project origins without application-specific rules", async () => {
    const targetA = new FakePage("https://project-a.example.test/home");
    const targetB = new FakePage("https://project-b.example.test/home");
    strict_1.default.equal(await (0, page_selection_1.selectRuntimePage)(context(new FakePage("https://auth.example.test/"), targetA), "https://project-a.example.test/login"), targetA);
    strict_1.default.equal(await (0, page_selection_1.selectRuntimePage)(context(new FakePage("https://auth.example.test/"), targetB), "https://project-b.example.test/login"), targetB);
});
(0, node_test_1.default)("reports ambiguity rather than falling back to page order", async () => {
    await strict_1.default.rejects(() => (0, page_selection_1.selectRuntimePage)(context(new FakePage("https://project-a.example.test/one"), new FakePage("https://project-a.example.test/two")), "https://project-a.example.test/login"), (error) => error instanceof page_selection_1.RuntimePageSelectionError && error.code === "AMBIGUOUS_TARGET_PAGE");
});
(0, node_test_1.default)("prefers the configured path when several pages share the target origin", async () => {
    const target = new FakePage("https://project-a.example.test/settings");
    const selected = await (0, page_selection_1.selectRuntimePage)(context(new FakePage("https://project-a.example.test/dashboard"), target), "https://project-a.example.test/start", { expectedPath: "/settings" });
    strict_1.default.equal(selected, target);
});
