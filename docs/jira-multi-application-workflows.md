# Jira workflows across applications

Jira scenario generation, Test Launch, Test Design and the Jira execution engine share a project-scoped workflow contract. Recording is separate and is not part of this feature.

## Configure application URLs

In Test Launch or Test Design, select the automation project and open **Flujos entre aplicaciones**. Add an alias and the application's base URL, then save. The alias `principal` is reserved for the project's normal application URL. Do not include usernames, passwords or API keys in the URL. SPA routes, including hash routes, are supported. Configuration is stored with the project profile at `automations/apps/<projectSlug>/app.config.json` and is preserved when other profile settings are saved.

Each secondary alias opens in its own browser context, so its cookies and authentication state do not replace the primary application's session. The primary page remains open while the scenario switches to another app and is restored when the scenario switches back to `principal`. Each app must be logged in through explicit scenario steps when authentication is required; credentials from the primary profile are not copied to another app.

## Authoring contract

Use the following steps only when the Jira story describes the corresponding operation. Labels and aliases must come from the Jira story or project configuration:

```text
Cambiar a la aplicación "Aprobaciones"
Capturar el valor de "Número de solicitud" como "solicitudId"
Ingresar el valor capturado "solicitudId" en "Número de solicitud"
Presionar "Aprobar" en la fila del valor capturado "solicitudId" en "Solicitudes"
Cambiar a la aplicación "principal"
Adjuntar los documentos requeridos en "Documentación"
```

The captured ID is read from the visible application page for every run. It is held only in that run's memory, is not an editable input, and is never emitted as a literal in the reusable spec. The approval action requires one uniquely matching row inside the named table/list. Ambiguous rows or labels fail the step instead of selecting by position.

## Dynamic document groups

One `Adjuntar los documentos requeridos en "..."` step handles the file fields observed inside that exact named dialog, region or group. In Test Design or Test Launch, add one row per source-backed document label and select/upload the corresponding project fixture. The application may expose a different number of fields on different runs; execution enumerates the visible fields and attaches the fixture mapped to each exact accessible label.

The runner resolves all currently observed labels and project-scoped file references before attaching any file. A missing fixture, duplicate/unlabelled field, ambiguous container or cross-project reference fails the workflow; it never attaches a file to another field. Keep the form's submit/continue action and the resulting success assertion as separate steps. Use the `si aparece` form only when the Jira source explicitly makes the dialog optional; if it is absent the step can pass, but if it appears every observed field still needs a fixture.

## Deployment

Application aliases live with each automation profile. A deployment that replaces the checkout must preserve the project's `automations/apps/<projectSlug>/app.config.json` (or carry forward its `jiraApplications` field) so secondary-app URLs are not lost. Project file bytes remain in the shared Test Design/Test Launch fixture store. Configure `TEST_FILE_STORAGE_DIR` to a durable server directory outside the release checkout, grant the QA Lab service account read/write access, back it up, and point every backend instance that may execute the same project at the same shared storage. See [test-file-fixtures.md](test-file-fixtures.md) for file limits, types and storage details.

The synthetic browser fixtures cover changing IDs, isolated sessions, returning to the primary page, and document groups of different sizes. They do not validate a real Portal Comercial web 2, its visible field labels, authentication, approval rules or server deployment. Those details must be verified with the project's configured URLs and a controlled QA scenario before relying on a live approval flow.
