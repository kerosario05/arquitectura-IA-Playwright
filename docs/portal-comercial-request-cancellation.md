# Cancelación controlada de solicitudes QA

La cancelación está limitada al perfil Portal Comercial y se controla con el switch de **Configuración del proyecto**. No modifica los motores de Jira ni Grabación.

## Discovery y replay

Con la opción activada, Lanzar pruebas verifica el spec promovido después de que Discovery aprueba el caso. Justo antes de ese replay:

1. Usa el contexto de navegador autenticado que acaba de completar Discovery; no vuelve a pedir ni guarda el usuario o la contraseña.
2. Obtiene la cédula de la entrada de datos ligada al paso de identificación.
3. Identifica el ID recién creado mediante la transición de URL del mismo Portal y usa ese ID como ancla y cancela todas las solicitudes activas elegibles de la misma cédula y tipo del proyecto.
4. Vuelve a leer la solicitud y exige que coincidan cédula, tipo y estado elegible antes del cambio; vuelve a comprobar el estado después.
5. Si faltan el ID o la cédula, la sesión no está disponible, el estado cambió o el Portal no confirma la cancelación, bloquea la promoción/replay para evitar duplicar la solicitud.

La opción se activa por proyecto y se conserva al guardar la configuración. Sin ella, el flujo existente conserva su comportamiento.

## Contrato real de cancelación

El Portal desplegado cancela una solicitud en dos escrituras, igual que su acción de cancelar:

1. `PUT /api/proxy/api/Requests/ByType` con `AnularCaso` (solo si la solicitud ya tiene `requestCode`). Un `CustomData` solo deja la solicitud externa en `InProgress` con `subStatus`/`model.status` en `cancelled`, y el Portal la sigue tratando como caso activo (verificado de forma solo-lectura con la solicitud del job f9864a10).
2. `PUT /api/proxy/api/Requests/CustomData` con el `dataByType` completo, cambiando únicamente `model.status = "cancelled"`, añadiendo la transición a `statusTimeline`, `changeSubStatus = "cancelled"` y `changeSubType = "request"`.

La cancelación se acepta solo con un acuse del PUT con el mismo ID y estado `Canceled`, o cuando una relectura posterior muestra `Canceled`/`cancelled` externo. Una solicitud que quedó a medias (local `cancelled`, externa `InProgress`, con `requestCode`) se completa con la llamada de proceso, sin repetir `CustomData`. Si la relectura final aún muestra solicitudes activas de la identidad, el spec no arranca.

## Configuración del servidor

Las variables siguientes solo se requieren para los endpoints de cancelación manual, que muestran candidatos y requieren confirmación explícita. El flujo automático Discovery → replay reutiliza la sesión autenticada de Playwright y no necesita duplicar credenciales:

- `PORTAL_COMERCIAL_QA_API_BASE_URL`: URL HTTPS del proxy QA.
- `PORTAL_COMERCIAL_QA_API_ALLOWED_HOSTS`: lista separada por comas de hosts QA autorizados.
- `PORTAL_COMERCIAL_QA_API_AUTHORIZATION` o `PORTAL_COMERCIAL_QA_API_COOKIE`: autorización QA que ya utiliza una consulta funcional.

No guardes credenciales en el repositorio, en el proyecto, ni en el navegador. La API no escribe cédulas, cabeceras de autorización ni cuerpos de solicitudes en logs.

## Endpoints manuales

1. `GET /api/projects/portal-comercial/request-cancellation-config` consulta si la opción está activada y si la conexión manual del servidor está configurada.
2. `POST /api/projects/portal-comercial/requests/cancellation-preview` recibe `{ "identification": "<identidad QA>" }` y devuelve IDs y estados elegibles, sin devolver la identidad ni el objeto completo.
3. Revisa los IDs de la vista previa. Solo se consideran solicitudes activas `Draft`/`InProgress` en las transiciones verificadas `compliance → cancelled` y `simulation → cancelled`.
4. `POST /api/projects/portal-comercial/requests/cancel` recibe `{ "identification": "<identidad QA>", "requestIds": ["<ID revisado>"], "confirmed": true }`.

Antes de cada PUT, el backend vuelve a leer la solicitud completa y verifica identidad, tipo, estado, etapa y secuencia de estado. Después vuelve a leer y comprueba `Canceled`/`cancelled`. Ante un cambio o error, se detiene. La API manual exige permiso `tests.launch`, configuración del proyecto activada, conexión QA configurada, IDs explícitos revisados y `confirmed: true`.



## Cancelación completa por cédula

`POST /api/projects/portal-comercial/requests/cancel-all`

Cuerpo: `{ "identification": "<identidad QA>", "confirmed": true }`.

Requiere `tests.launch`, el switch del proyecto activo y acceso QA configurado. El flujo automático reutiliza la sesión de Discovery. Devuelve `{ "cancelledIds": [...], "failed": null }` al confirmar la limpieza. Las solicitudes de otra identidad o finalizadas se conservan. Un estado activo no soportado bloquea la operación antes de escribir. Tras cancelar, una consulta final exige que no queden solicitudes activas del tipo configurado para esa identidad; una concurrencia nueva produce `active_requests_remaining` y bloquea el replay. No hay reintento automático.

Las páginas se consultan en grupos de hasta cuatro; cada cambio mantiene su lectura previa y posterior para detectar modificaciones concurrentes. No se guarda una caché de estados para autorizar cancelaciones.


Un borrador que nunca llegó al proceso de negocio (sin equestCode) se cancela con el guardado CustomData solo, igual que la acción de cancelar del Portal: su relectura queda con estado externo Draft y subStatus/model.status en cancelled, y se acepta como cancelado. Las solicitudes con equestCode siguen exigiendo Canceled externo.


Tras cancelar, el servicio consulta la misma verificación de casos existentes que usa el Portal en «Depurar» (POST /api/proxy/api/Procesos/MDW/ConsultarCasosBizagiSQL, solo lectura) hasta que responda 204 (o lista vacía), con espera acotada (90 s, cada 3 s). Mientras el Portal siga viendo un caso, el spec no arranca (izagi_active_cases_remaining).
