# Cancelar solicitudes en Portal Comercial (QA)

## Importar

Importa estos dos archivos en Postman:

- `Portal-Comercial-QA-Cancelar-Solicitudes.postman_collection.json`
- `Portal-Comercial-QA.postman_environment.json`

En la colección, configura la misma autorización QA que ya funciona en tu petición GET guardada. La colección no contiene tokens, cookies ni credenciales.

En el entorno, completa `cedula` con una identidad de QA. `baseUrl` está bloqueada al host QA confirmado; no cambies el host. No uses una cédula de cliente real.

## Preview antes de cancelar

1. Selecciona el entorno **Portal Comercial QA - Cancelaciones**.
2. Deja `modoEjecucion=PREVIEW` y `confirmarCancelacion=NO`.
3. Ejecuta la colección desde el primer request en Collection Runner, en una sola iteración. `Items=5` pagina toda la consulta.
4. Revisa la consola: muestra IDs y estados, nunca la cédula ni `dataByType`. Las solicitudes fuera de `Draft`/`InProgress` o ya canceladas quedan omitidas.

El preview es de solo lectura. No llames manualmente al request `03 - Cancelar solicitud actual`.

## Cancelar la lista confirmada

Solo después de revisar el preview:

1. Copia exactamente la lista de IDs elegibles.
2. Cambia `modoEjecucion=CANCELAR`, `confirmarCancelacion=SI` y pega los IDs separados por coma en `confirmarIds`.
3. Ejecuta de nuevo desde el primer request. La colección vuelve a buscar; si los IDs no coinciden exactamente, no envía PUT.
4. Procesa una solicitud por vez: GET completo actualizado → revisión del estado → PUT → GET de verificación. Ante error o resultado distinto de `status=Canceled` y `subStatus=cancelled`, se detiene.
5. El resumen final muestra encontradas, candidatas, canceladas, omitidas y fallidas. Al terminar vuelve a `PREVIEW` y `confirmarCancelacion=NO`.

## Límite por estado funcional

El único `model.status` permitido inicialmente es `compliance`, porque el ejemplo real confirma la transición `compliance → cancelled` con motivo `CANCEL`. Los demás estados (incluido `simulation`) se omiten. No agregues una transición a `cancelTransitionsJSON` hasta confirmar el payload aceptado para esa etapa con una solicitud QA autorizada.

## Datos y ejecución

- La colección guarda en variables temporales solo IDs y estados; el objeto completo se obtiene de nuevo justo antes del PUT y se elimina después de verificar.
- No guardes los cambios de variables de ejecución ni exportes el historial que contiene cuerpos de solicitud. Postman conserva el body enviado en el historial local.
- La colección se validó localmente como JSON y se comprobó la sintaxis de sus scripts. No se envió ninguna petición al portal desde Codex; configura la autorización y ejecuta primero el preview.
