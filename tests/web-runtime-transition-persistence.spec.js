"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const runtime_knowledge_persister_1 = require("../src/knowledge/runtime-knowledge-persister");
(0, test_1.test)("persists only validated technical Web transitions", () => {
    const appSlug = `test-web-transition-${Date.now()}`;
    const appDir = node_path_1.default.join(process.cwd(), "automations", "apps", appSlug);
    const knowledgePath = node_path_1.default.join(appDir, "app.knowledge.json");
    node_fs_1.default.mkdirSync(appDir, { recursive: true });
    try {
        const base = {
            sourceTechnicalScreenKey: "tech-A",
            destinationTechnicalScreenKey: "tech-B",
            transitionValidated: true,
            actionLocatorIdentity: "locator-1",
        };
        (0, runtime_knowledge_persister_1.persistRuntimeTransition)(appSlug, base);
        (0, runtime_knowledge_persister_1.persistRuntimeTransition)(appSlug, { ...base, transitionValidated: false, actionLocatorIdentity: "locator-2" });
        (0, runtime_knowledge_persister_1.persistRuntimeTransition)(appSlug, { ...base, destinationTechnicalScreenKey: undefined, actionLocatorIdentity: "locator-3" });
        const data = JSON.parse(node_fs_1.default.readFileSync(knowledgePath, "utf8"));
        (0, test_1.expect)(data.items).toHaveLength(1);
        (0, test_1.expect)(data.items[0]).toMatchObject({
            knowledgeKind: "route_transition",
            sourceTechnicalScreenKey: "tech-A",
            destinationTechnicalScreenKey: "tech-B",
            transitionValidated: true,
        });
        (0, test_1.expect)(data.items[0].sourceScreenKey).toBeUndefined();
        (0, test_1.expect)(data.items[0].destinationScreenKey).toBeUndefined();
        (0, test_1.expect)(data.items[0].destinationIdentity).toBeUndefined();
        (0, test_1.expect)(data.items[0].routeRole).toBeUndefined();
        (0, test_1.expect)(data.items[0].destinationRole).toBeUndefined();
    }
    finally {
        node_fs_1.default.rmSync(appDir, { recursive: true, force: true });
    }
});
