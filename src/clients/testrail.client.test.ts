import { describe, expect, it, vi } from "vitest";
import { TestRailClient } from "./testrail.client";

function createClient(): TestRailClient {
  return new TestRailClient({
    url: "https://testrail.example",
    email: "qa@example.com",
    apiKey: "api-key",
  } as any);
}

describe("TestRail case field metadata", () => {
  it("returns normalized get_case_fields metadata", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([
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

    await expect(createClient().getCaseFields()).resolves.toEqual([{
      id: 7,
      name: "custom_data",
      label: "Execution data",
      type: "textarea",
      configs: { default: "" },
      is_active: true,
    }]);
  });

  it("returns an empty list when get_case_fields has no fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ fields: [] }), { status: 200 }));

    await expect(createClient().getCaseFields()).resolves.toEqual([]);
  });

  it("propagates get_case_fields client errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }));

    await expect(createClient().getCaseFields()).rejects.toThrow("TestRail API error (HTTP 403) at get_case_fields: forbidden");
  });
});
