"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthRouter = void 0;
const express_1 = require("express");
const env_1 = require("../../config/env");
exports.healthRouter = (0, express_1.Router)();
exports.healthRouter.get("/health", (_req, res) => {
    res.json({
        ok: true,
        timestamp: new Date().toISOString(),
        engine: {
            baseUrl: env_1.config.app.baseUrl,
            appSlug: process.env.APP_SLUG || "default",
            jiraProject: process.env.JIRA_PROJECT_KEY || null,
            testRailProject: env_1.config.integrations.testRail?.projectId || null
        }
    });
});
