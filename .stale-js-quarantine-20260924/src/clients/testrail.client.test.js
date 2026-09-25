"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const testrail_client_1 = require("./testrail.client");
function createClient() {
    return new testrail_client_1.TestRailClient({
        url: "https://testrail.example",
        email: "qa@example.com",
        apiKey: "api-key",
    });
}
(0, vitest_1.describe)("TestRail case field metadata", () => {
    (0, vitest_1.it)("returns normalized get_case_fields metadata", async () => {
        vitest_1.vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([
            {
                id: 7,
                name: "custom_data",
                label: "Execution data",
                type: "textarea",
                configs: { default: "" },
                is_active: true,
                ignored: "value",
            },
        ]), { status: 200 }));
        await (0, vitest_1.expect)(createClient().getCaseFields()).resolves.toEqual([{
                id: 7,
                name: "custom_data",
                label: "Execution data",
                type: "textarea",
                configs: { default: "" },
                is_active: true,
            }]);
    });
    (0, vitest_1.it)("returns an empty list when get_case_fields has no fields", async () => {
        vitest_1.vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ fields: [] }), { status: 200 }));
        await (0, vitest_1.expect)(createClient().getCaseFields()).resolves.toEqual([]);
    });
    (0, vitest_1.it)("propagates get_case_fields client errors", async () => {
        vitest_1.vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }));
        await (0, vitest_1.expect)(createClient().getCaseFields()).rejects.toThrow("TestRail API error (HTTP 403) at get_case_fields: forbidden");
    });
});
