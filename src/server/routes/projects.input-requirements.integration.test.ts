import assert from "node:assert/strict";
import express from "express";
import { test } from "node:test";
import { createProject } from "../../db/project-repository";
import { closeConnection } from "../../db/sql-connection";
import { deleteProject } from "../../db/project-service";
import { projectsRouter } from "./projects";

const requirementsA = [
  {
    key: "customer.email",
    label: "Customer email",
    controlType: "email",
    required: true,
    sensitive: false,
  },
  {
    key: "customer.country",
    label: "Country",
    controlType: "select",
    required: false,
    sensitive: false,
    allowedValues: ["CO", "MX"],
  },
];

const requirementsB = [
  {
    key: "account.phone",
    label: "Phone",
    controlType: "tel",
    required: true,
    sensitive: true,
  },
];

function semanticRequirements(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value
    .map((requirement) => JSON.stringify(requirement))
    .sort()
    .map((requirement) => JSON.parse(requirement));
}

async function request(baseUrl: string, method: string, projectSlug: string, caseId: number, body?: unknown) {
  const response = await fetch(`${baseUrl}/api/projects/${projectSlug}/cases/${caseId}/input-requirements`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

test("input requirements API round-trips and replaces persisted SQL state", async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/projects", projectsRouter);
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  });

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const projectSlug = `input-requirements-it-${crypto.randomUUID()}`;
  const caseId = 900001;

  try {
    await createProject({ slug: projectSlug, name: "Input requirements integration fixture", projectType: 1 });

    const firstPut = await request(baseUrl, "PUT", projectSlug, caseId, { inputRequirements: requirementsA });
    assert.equal(firstPut.response.status, 200, JSON.stringify(firstPut.body));
    assert.deepEqual(semanticRequirements(firstPut.body.inputRequirements), semanticRequirements(requirementsA));

    await closeConnection();
    const firstGet = await request(baseUrl, "GET", projectSlug, caseId);
    assert.equal(firstGet.response.status, 200);
    assert.deepEqual(semanticRequirements(firstGet.body.inputRequirements), semanticRequirements(requirementsA));

    const secondPut = await request(baseUrl, "PUT", projectSlug, caseId, { inputRequirements: requirementsB });
    assert.equal(secondPut.response.status, 200);
    assert.deepEqual(semanticRequirements(secondPut.body.inputRequirements), semanticRequirements(requirementsB));

    const secondGet = await request(baseUrl, "GET", projectSlug, caseId);
    assert.equal(secondGet.response.status, 200);
    assert.deepEqual(semanticRequirements(secondGet.body.inputRequirements), semanticRequirements(requirementsB));
    assert.equal(secondGet.body.inputRequirements.some((item: { key: string }) => item.key === requirementsA[0].key), false);
    assert.equal(secondGet.body.inputRequirements.some((item: { key: string }) => item.key === requirementsA[1].key), false);
  } finally {
    await deleteProject(projectSlug).catch(() => undefined);
    await closeConnection();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
