import assert from "node:assert/strict";
import { test } from "node:test";
import { listProjects } from "./project-repository";
import { closeConnection } from "./sql-connection";
import { getByProjectAndCase } from "./project-case-input-requirement-service";

test("two input-requirements reads can run concurrently", async () => {
  const projects = await listProjects();
  assert.ok(projects.length > 0, "QA_LAB must contain a project fixture");
  const projectSlug = projects[0].slug;
  await closeConnection();

  const firstCaseId = Math.floor(Date.now() / 1000);
  const results = await Promise.allSettled([
    getByProjectAndCase(projectSlug, firstCaseId),
    getByProjectAndCase(projectSlug, firstCaseId + 1),
  ]);

  await closeConnection();
  assert.equal(results[0].status, "fulfilled", results[0].status === "rejected" ? results[0].reason?.message : undefined);
  assert.equal(results[1].status, "fulfilled", results[1].status === "rejected" ? results[1].reason?.message : undefined);
});
