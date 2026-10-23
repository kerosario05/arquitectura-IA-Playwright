# Current State — 2026-10-23

## Active objective

Name downloaded evidence PDFs with Jira issue key and full requirement title when available (example: `AA-97 Inicio Fenix`), instead of the job UUID. Preserve the PDF content and path.

## First-loss boundary

- The download route `GET /api/runs/:jobId/evidence-docx` hard-coded `evidencia-${jobId}.pdf` in `Content-Disposition`; the generated PDF itself is stored as `evidencia.pdf`.
- Jira launch params persist `jiraKey` and `jiraTitle`, so the delivery route can construct the desired filename, including after restart.

## Changes

- `src/server/routes/runs.ts`: derive the download filename from Jira key/title, then other case title metadata; normalize accents and remove unsafe filename characters. Keep UUID filename as fallback when no title metadata exists.
- This file has earlier unrelated worktree changes (Jira title resolution and PDF-only delivery); preserve them.

## Validation

- `git diff --check -- src/server/routes/runs.ts` passed.
- No tests or typecheck were run.

## Remaining

- Download a Jira evidence PDF after restarting the server and confirm the browser receives a name such as `AA-97 Inicio Fenix.pdf`. No live job or external publication was performed.
