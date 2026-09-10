import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test, { after, before } from "node:test";
import express from "express";
import { createReviewItem, getReviewItem } from "../../testrail/testrail-requirement-review-store";
import { testrailRouter } from "./testrail";

const app = express();
app.use(express.json());
app.use("/api/testrail", testrailRouter);

let server: Server;
let baseUrl: string;

before(async () => {
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not start");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

function seed(caseId: number) {
  return createReviewItem(caseId, [{ key: `input.${caseId}`, label: "Input", controlType: "text", confidence: 0.9, evidence: "fixture" }]);
}

test("GET returns existing reviews and ignores unknown caseIds", async () => {
  const review = seed(91001);
  const response = await fetch(`${baseUrl}/api/testrail/requirement-reviews?caseIds=91001,91002`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reviews: [review] });
});

test("approve changes pending to approved without processing", async () => {
  seed(91003);
  const response = await fetch(`${baseUrl}/api/testrail/requirement-reviews/91003/approve`, { method: "POST" });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "approved");
  assert.equal(getReviewItem(91003)?.status, "approved");
});

test("reject changes pending to rejected without processing", async () => {
  seed(91004);
  const response = await fetch(`${baseUrl}/api/testrail/requirement-reviews/91004/reject`, { method: "POST" });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, "rejected");
  assert.equal(getReviewItem(91004)?.status, "rejected");
});

test("invalid and missing caseIds return 400 and 404", async () => {
  const invalid = await fetch(`${baseUrl}/api/testrail/requirement-reviews/not-a-case/approve`, { method: "POST" });
  const missing = await fetch(`${baseUrl}/api/testrail/requirement-reviews/91005/approve`, { method: "POST" });

  assert.equal(invalid.status, 400);
  assert.equal(missing.status, 404);
});
