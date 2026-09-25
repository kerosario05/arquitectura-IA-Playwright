"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadMobileRouteProfile = loadMobileRouteProfile;
exports.saveMobileRouteProfile = saveMobileRouteProfile;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
function profilePath(appSlug) {
    return path.join(process.cwd(), "automations", "apps", appSlug, "mobile.config.json");
}
/**
 * Loads the real-screen grounding data for a mobile app, captured via manual or
 * automated exploration (see src/mobile/appium-session.ts + getPageSource()). Mirrors
 * automations/apps/<slug>/app.config.json's routeProfile for the web pipeline — same
 * purpose (ground AI-generated steps in real UI instead of guessing from HU text
 * alone), separate file because the schema is native-screen shaped, not DOM shaped.
 */
function loadMobileRouteProfile(appSlug) {
    const filePath = profilePath(appSlug);
    if (!fs.existsSync(filePath))
        return null;
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(content);
    }
    catch (err) {
        console.error(`[mobile:route-profile] failed to parse ${filePath}: ${err instanceof Error ? err.message : err}`);
        return null;
    }
}
function saveMobileRouteProfile(appSlug, profile) {
    const filePath = profilePath(appSlug);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), "utf-8");
}
