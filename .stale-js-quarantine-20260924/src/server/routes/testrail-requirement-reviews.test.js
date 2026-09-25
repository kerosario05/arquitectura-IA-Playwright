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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const node_test_1 = __importStar(require("node:test"));
const express_1 = __importDefault(require("express"));
const testrail_requirement_review_store_1 = require("../../testrail/testrail-requirement-review-store");
const testrail_1 = require("./testrail");
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use("/api/testrail", testrail_1.testrailRouter);
let server;
let baseUrl;
(0, node_test_1.before)(async () => {
    server = (0, node_http_1.createServer)(app);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("test server did not start");
    baseUrl = `http://127.0.0.1:${address.port}`;
});
(0, node_test_1.after)(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});
function seed(caseId) {
    return (0, testrail_requirement_review_store_1.createReviewItem)(caseId, [{ key: `input.${caseId}`, label: "Input", controlType: "text", confidence: 0.9, evidence: "fixture" }]);
}
(0, node_test_1.default)("GET returns existing reviews and ignores unknown caseIds", async () => {
    const review = seed(91001);
    const response = await fetch(`${baseUrl}/api/testrail/requirement-reviews?caseIds=91001,91002`);
    strict_1.default.equal(response.status, 200);
    strict_1.default.deepEqual(await response.json(), { reviews: [review] });
});
(0, node_test_1.default)("approve changes pending to approved without processing", async () => {
    seed(91003);
    const response = await fetch(`${baseUrl}/api/testrail/requirement-reviews/91003/approve`, { method: "POST" });
    strict_1.default.equal(response.status, 200);
    strict_1.default.equal((await response.json()).status, "approved");
    strict_1.default.equal((0, testrail_requirement_review_store_1.getReviewItem)(91003)?.status, "approved");
});
(0, node_test_1.default)("reject changes pending to rejected without processing", async () => {
    seed(91004);
    const response = await fetch(`${baseUrl}/api/testrail/requirement-reviews/91004/reject`, { method: "POST" });
    strict_1.default.equal(response.status, 200);
    strict_1.default.equal((await response.json()).status, "rejected");
    strict_1.default.equal((0, testrail_requirement_review_store_1.getReviewItem)(91004)?.status, "rejected");
});
(0, node_test_1.default)("invalid and missing caseIds return 400 and 404", async () => {
    const invalid = await fetch(`${baseUrl}/api/testrail/requirement-reviews/not-a-case/approve`, { method: "POST" });
    const missing = await fetch(`${baseUrl}/api/testrail/requirement-reviews/91005/approve`, { method: "POST" });
    strict_1.default.equal(invalid.status, 400);
    strict_1.default.equal(missing.status, 404);
});
