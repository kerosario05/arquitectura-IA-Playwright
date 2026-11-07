# Test file fixtures

Test Design, Test Launch, and the Recording replay flow use one project-scoped file store. Uploading or recording a fixture saves its bytes on the backend and the scenario stores only an opaque `fileRef`; generation never invents a local path or embeds file bytes in a step.

## Storage and deployment

Set `TEST_FILE_STORAGE_DIR` to a durable directory on the server, outside the versioned application/release directory. The service account running QA Lab needs read/write access. If unset, the backend uses a `test-files` sibling of `EVIDENCE_DIR`.

Example for a Windows service deployment:

```dotenv
EVIDENCE_DIR=C:\qa-v2\evidence
TEST_FILE_STORAGE_DIR=C:\qa-v2\test-files
```

Include this directory in the same backup policy as the project database and evidence. A release must not replace or clean it. Keep all application instances that execute the same project pointed at the same persistent storage, or provide shared durable storage. The reference is scoped by the automation project, so an attachment from one project cannot be resolved from another.

## Runtime behavior

For a Jira step such as `Adjuntar el archivo de prueba en "Formulario"`, the scenario has a required file input requirement. Discovery resolves the exact field label and proceeds only when it observes one `input[type=file]`; it attaches the stored bytes and confirms the selected file. Missing, ambiguous, non-file, or cross-project references fail the step without guessing another control.

During a web recording, Capture V2 observes the selected files from the actual file input and sends them in bounded chunks to the backend. Each selection group becomes one recorded upload action with its exact target references and one or more project-scoped `fileRef`s. Replay restores that captured group to the same uniquely resolved file input and verifies filenames and sizes. Selecting several files together is supported when the observed input accepts multiple files; separate file inputs or separate upload actions remain separate steps. The group size is the size recorded for that scenario: choosing a different count on each run is not yet a runtime input, so record separate scenario variants when the application can require different counts. A recorded upload group cannot be replayed into a newly opened tab or popup; navigation between applications is supported in the same browser tab.

The recorded request/identifier transfer is replayed from the live source field at execution time and kept in process memory only, so the captured example number is not baked into the scenario. Same-tab navigation preserves the browser context and cookies; whether the first application's pending request survives leaving that page depends on the application's own save behavior.

The initial accepted formats are PDF, Word, Excel, PNG/JPEG, TXT, CSV, and RTF, up to 25 MB per file. Each recording selection group accepts up to 20 files. A server deployment must preserve `TEST_FILE_STORAGE_DIR` across releases and make it available to every backend instance that may replay the project.
