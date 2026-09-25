"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const app_knowledge_writer_1 = require("../src/scenarios/app-knowledge-writer");
function suggestion(overrides = {}) {
    return {
        appSlug: "test-app",
        from: "source",
        to: "destination",
        relation: "child_route",
        source: "successful_transition",
        confidence: 0.99,
        status: "auto_approved",
        evidence: { beforeUrl: "https://example.test/source", afterUrl: "https://example.test/destination" },
        ...overrides,
    };
}
(0, test_1.test)("route functional observed remains provisional without semantic authority", async () => {
    const root = node_fs_1.default.mkdtempSync(node_path_1.default.join(node_os_1.default.tmpdir(), "route-authority-"));
    const knowledgeDir = node_path_1.default.join(root, "apps", "test-app");
    node_fs_1.default.mkdirSync(knowledgeDir, { recursive: true });
    const knowledgePath = node_path_1.default.join(knowledgeDir, "app.knowledge.json");
    try {
        const first = await (0, app_knowledge_writer_1.appendRouteSuggestionToKnowledge)("test-app", suggestion(), node_path_1.default.join(root));
        (0, test_1.expect)(first.persisted).toBe(true);
        let data = JSON.parse(node_fs_1.default.readFileSync(knowledgePath, "utf8"));
        (0, test_1.expect)(data.items[0]).toMatchObject({ validationStatus: "pending", trustedForReuse: false });
        const technical = suggestion({
            from: "technical-source",
            to: "technical-destination",
            evidence: {
                beforeUrl: "https://example.test/a",
                afterUrl: "https://example.test/b",
                transitionValidated: true,
                beforeTechnicalScreenKey: "tech-A",
                afterTechnicalScreenKey: "tech-B",
            },
        });
        await (0, app_knowledge_writer_1.appendRouteSuggestionToKnowledge)("test-app", technical, node_path_1.default.join(root));
        data = JSON.parse(node_fs_1.default.readFileSync(knowledgePath, "utf8"));
        const technicalItem = data.items.find((item) => item.routeFrom === "technical-source");
        (0, test_1.expect)(technicalItem).toMatchObject({
            validationStatus: "pending",
            trustedForReuse: false,
            transitionValidated: true,
            sourceTechnicalScreenKey: "tech-A",
            destinationTechnicalScreenKey: "tech-B",
        });
        data.items[0].validationStatus = "pending";
        data.items[0].trustedForReuse = false;
        data.items[0].source = "route_learning";
        node_fs_1.default.writeFileSync(knowledgePath, JSON.stringify(data));
        await (0, app_knowledge_writer_1.appendRouteSuggestionToKnowledge)("test-app", suggestion(), node_path_1.default.join(root));
        data = JSON.parse(node_fs_1.default.readFileSync(knowledgePath, "utf8"));
        (0, test_1.expect)(data.items[0]).toMatchObject({ validationStatus: "pending", trustedForReuse: false });
    }
    finally {
        node_fs_1.default.rmSync(root, { recursive: true, force: true });
    }
});
