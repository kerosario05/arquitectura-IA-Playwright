import { describe, expect, it, vi } from "vitest";
import { JiraClient } from "./jira.client";

function createClient(): JiraClient {
  return new JiraClient({
    baseUrl: "https://jira.example",
    email: "qa@example.com",
    apiToken: "api-token",
    acceptanceCriteriaField: "customfield_10000",
  });
}

describe("additive Jira Test Design client methods", () => {
  it("returns only sub-task issue types from the create metadata API", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      issueTypes: [
        { id: "10001", name: "Task", subtask: false },
        { id: "10002", name: "Test", subtask: true },
      ],
    }), { status: 200 }));

    await expect(createClient().getSubtaskIssueTypes("PAY")).resolves.toEqual([
      { id: "10002", name: "Test", subtask: true },
    ]);
    expect(fetch.mock.calls[0]?.[0]).toBe("https://jira.example/rest/api/3/issue/createmeta/PAY/issuetypes?maxResults=200");
  });

  it("creates and updates Jira issues with explicit field payloads", async () => {
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "42", key: "PAY-42" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createClient();
    const fields = { summary: "Test cases", parent: { key: "PAY-7" } };

    await expect(client.createIssueWithFields(fields)).resolves.toEqual({ id: "42", key: "PAY-42" });
    await client.updateIssueFields("PAY-42", { summary: "Updated" });

    expect(fetch.mock.calls.map((call) => (call[1] as RequestInit).method)).toEqual(["POST", "PUT"]);
    expect(JSON.parse(String((fetch.mock.calls[0]?.[1] as RequestInit).body))).toEqual({ fields });
    expect(JSON.parse(String((fetch.mock.calls[1]?.[1] as RequestInit).body))).toEqual({ fields: { summary: "Updated" } });
  });

  it("reports a missing issue only for 404, propagating other Jira errors", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ errorMessages: ["Not found"] }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ errorMessages: ["Forbidden"] }), { status: 403 }));

    const client = createClient();
    await expect(client.issueExists("PAY-404")).resolves.toBe(false);
    await expect(client.issueExists("PAY-1")).rejects.toThrow("HTTP 403");
    expect(client.browseUrl("PAY-1")).toBe("https://jira.example/browse/PAY-1");
  });
});
