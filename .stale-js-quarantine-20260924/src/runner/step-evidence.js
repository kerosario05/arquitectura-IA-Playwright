"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureStepScreenshot = captureStepScreenshot;
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
function sanitizeToken(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}
async function captureStepScreenshot(input) {
    await (0, promises_1.mkdir)(input.evidenceDir, { recursive: true });
    const fileName = `step-${String(input.stepIndex).padStart(3, "0")}-${sanitizeToken(input.action)}-${input.status}.png`;
    const screenshotPath = node_path_1.default.join(input.evidenceDir, fileName);
    await input.page.screenshot({ path: screenshotPath, fullPage: true });
    return screenshotPath;
}
