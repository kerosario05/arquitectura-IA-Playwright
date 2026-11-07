# Recording: navegación entre pestañas y adjuntos

## Objetivo

Grabar y reproducir recorridos web que cambian de aplicación o pestaña, y conservar las acciones de adjuntar documentos en el paso a paso. La solución pertenece al motor de Grabación; Jira y su ejecución no deben depender de estas capacidades ni cambiar por ellas.

## Plan y recorrido de datos

1. **Captura:** el recorder asigna una identidad estable a cada página (`tab-1`, `tab-2`, …). La navegación desde la barra del panel registra la URL HTTP(S) y si abre una pestaña. Cada acción llega con la identidad de su página de origen; por eso el login, la búsqueda, la aprobación, las teclas y las cargas en Web B también quedan registrados aunque Web A siga abierta. Las contraseñas conservan su marca de dato sensible.
2. **Paso a paso:** una URL escrita en la barra del panel se presenta como `Navegar al link "URL"`; si abre una pestaña, como `Abrir una pestaña nueva y navegar al link "URL"`. Elegir una pestaña diferente en el panel crea un paso `Cambiar a la pestaña "URL segura"`, incluido al volver a la aplicación anterior. La carga genera un paso `Adjuntar ...` con el nombre del archivo observado y una referencia de conjunto, nunca el contenido del documento. Las rutas se conservan para distinguir pantallas; se excluyen credenciales, query y hashes de sesión.
3. **Archivos durante la grabación:** el navegador remoto abre el selector del sistema en el servidor, así que el panel ofrece un selector de archivos local solo cuando el recorder detecta un campo de tipo archivo activo. El servidor verifica acceso al proyecto, admite hasta cinco archivos por selección (25 MB por archivo y 50 MB en total) y suministra los bytes al `FileChooser` de Playwright. El evento de cambio alimenta la captura existente, que guarda cada archivo en almacenamiento del proyecto y registra metadatos/referencias opacas.
4. **Edición y reproducción:** en la lista expandida, el paso `Adjuntar ...` incluye su propio campo para agregar/quitar documentos y mapear cada etiqueta de la pantalla a un archivo del proyecto. No se duplica como un input suelto del escenario. `pageKey` y `opensNewPage` pasan por el contrato de Recording, plan y spec. Antes de cada acción, el runtime selecciona la pestaña asociada; solo puede asignar una página no registrada o crear una pestaña si el trace indicó una apertura. Los pasos de carga resuelven el conjunto configurado para esa ejecución y validan que el control observado admita el número de archivos solicitado.
5. **Aislamiento y seguridad:** las URLs de navegación se limitan a HTTP(S), sin credenciales embebidas. Los archivos quedan limitados a la selección de un campo activo, a acceso autorizado al proyecto y a límites de tamaño/cantidad. No se guardan bytes ni valores sensibles en el paso a paso, conocimiento o logs.

## Ejemplo del paso a paso

1. `Navegar al link "https://portal-a.example"`
2. `Ingresar ...` / `Presionar "Continuar"`
3. `Abrir una pestaña nueva y navegar al link "https://aprobaciones.example"`
4. `Ingresar ...` (usuario y contraseña sensible) / `Presionar "Iniciar sesión"` / `Buscar la solicitud ...`
5. `Presionar "Aprobar"`
6. `Cambiar a la pestaña "https://portal-a.example"`
7. `Adjuntar archivo(s) "constancia.pdf" en "Documentación"`
8. `Presionar "Continuar"` y validar el estado visible final

El valor identificador generado durante una ejecución se conserva solo en memoria y se enlaza con su paso dependiente; el motor no debe inventar números de solicitud, nombres de controles o selectores.

## Transporte de valores copiados entre pestañas

Un valor generado en una pestaña (por ejemplo un número de solicitud) se enlaza con el campo donde se pega en otra pestaña cuando la grabación ve un `copy` y un `paste` reales con el mismo texto (copiado hace menos de 120 s; el campo pegado debe grabarse en los 30 s siguientes). El paso del campo destino guarda `dependsOnEventRef` y no el valor.

- **Corte del valor:** además de la posición de la selección, la grabación guarda el texto estable que seguía al valor (`valueSelection.endContext`, cortado antes del primer dígito). En la reproducción el valor termina en ese texto, de modo que un valor que cambia de largo entre corridas no se recorta. Si ese texto ya no existe, la reproducción falla con `RECORDED_VALUE_SELECTION_ANCHOR_NOT_FOUND`. Las grabaciones sin `endContext` conservan el comportamiento anterior.
- **Diagnóstico durante la grabación:** `[recording:value-transfer] phase=copy_ignored reason=...` indica que el origen no tiene un identificador estable (`id`, `data-testid`, `aria-label` o `name`) y `phase=paste_unlinked reason=...` que el pegado no se enlazó; en ambos casos el valor se grabaría como texto escrito. `phase=copied ... sourceIdentity=true` y `phase=pasted sourceLinked=true` confirman el enlace.
- **Clic sobre texto frente a selección de texto:** un puntero sobre texto sin rol (`span`, `p`, `dd`...) puede ser un clic real sobre un manejador que la captura no atribuyó a la hoja, o el inicio de una selección para copiar. El recorder marca `target.copySelectionGesture`: `true` si hubo clics repetidos sobre el mismo texto (doble o triple clic) o un `copy` en los 8 s siguientes, `false` para un clic único. Con `false` el clic se conserva como acción reproducible; con `true`, o en grabaciones anteriores sin la marca, se aplica la regla anterior y se descarta como selección.
- **Origen sin identificador estable:** si ni el elemento ni sus ancestros tienen `id`, `data-testid`, `aria-label` o `name` estables (se ignoran ids con números generados), el navegador calcula una ruta CSS estructural (`body > ... > span`) y la entrega solo si apunta exactamente a ese elemento. En la reproducción debe resolver a un único elemento.
- **Forma del valor:** la grabación guarda la forma del valor copiado (`valueSelection.valueShape`, por ejemplo `^MPN\-\d+$`), nunca el valor. La reproducción rechaza con `RECORDED_VALUE_SHAPE_MISMATCH` un texto que no tenga esa forma.
- **Clics cuyo texto es el valor transportado:** en Discovery, un clic cuya etiqueta coincide por completo con la forma de un valor capturado en esa misma ejecución usa el valor de esa ejecución y se resuelve contra la página en vivo (se descartan los selectores técnicos de la corrida grabada). Si la etiqueta coincide con varios elementos, se aplica la resolución de etiquetas numéricas existente (primer elemento visible). Las formas solo numéricas se ignoran. El paso grabado conserva la etiqueta literal de la grabación; la sustitución ocurre al reproducir, y un plan ya promovido no la repite.
- **Listas desplegables cuyo botón de apertura no tiene dueño:** el icono de flecha de una lista personalizada puede no tener rol, ni puntero, ni nombre, y la captura lo registra como clic sin dueño; la opción elegida después quedaba como `Presionar "<opción>"` (en el log: `selection_orphan_option`). Si alguno de los contenedores de ese icono ya está asociado a un campo con nombre y el siguiente clic es una opción, el campo es el dueño de la selección y el paso sale como `Seleccionar "<opción>" en "<campo>"`. Solo se afirma el nombre del campo, no se inventa una identidad técnica; cualquier otro clic intermedio, otro documento o un cancelar descarta el vínculo. Sin campo con nombre, la opción sigue como antes.
- **Lista cuyo campo de apertura es un `input` editable con rol `combobox`:** un componente de formulario que se dibuja como `input` (por ejemplo `bzg-form-combo`) se resolvía como edición y nunca abría la sesión de selección, así que su opción quedaba como `Presionar "<opción>"`. Ahora ese clic abre la sesión; si después se registra una edición (el usuario escribió en el `input`), la sesión se descarta porque era un autocompletado. Un `input` de texto que no es `combobox` nunca abre sesión.
- **Origen del valor en el paso:** el paso que usa el valor transportado indica su procedencia, por ejemplo `Ingresar el valor copiado (pestaña tab-1) en "Buscar"`.
- **Secuencia de estados con varias pestañas:** `validateInteractionStateSequence` comparaba cada acción con la anterior aunque fuera de otra pestaña, así que toda grabación con una segunda pestaña quedaba con `state_sequence_invalid` y "Reproducción no disponible". Ahora cada acción se compara con la última de su propia pestaña; con una sola pestaña el resultado es el mismo de antes y una discontinuidad real dentro de una pestaña se sigue reportando.
- **Navegación directa a una URL:** una interacción de navegación fija su propia ruta (URL abierta directamente, o una redirección que ningún clic posee) y no se compara como salto desde la ruta de la acción anterior. Las acciones que la siguen sí se comparan con ella, y un salto de clic a clic sigue bloqueado.
- **Reproducción de `Navegar al link "URL"`:** el paso de navegación en la misma pestaña se leía como una aserción y se omitía en silencio; la página nunca cambiaba y, más adelante, la copia del valor fallaba porque su origen no existía. Ahora es una acción de navegación, igual que `Abrir una pestaña nueva y navegar al link`.
- **Siguiente control visible tras un clic:** un campo que se nombra solo por su placeholder, `aria-label` o nombre accesible (por ejemplo un buscador) ya cuenta como visible por ese nombre. Antes solo se miraba el primer valor no nulo entre `text`, `label` y `name`, y un `text` vacío ocultaba el resto.
- **Diagnóstico de esperas largas:** cuando una espera detecta un cargador, el log trae una línea `[async-wait] spinnerMatch ...` con la etiqueta, id, clases y opacidad del elemento (nunca texto), para distinguir un cargador real de uno que sigue dibujado con la página ya usable.
- **Valor transportado en varias filas:** si la etiqueta del clic es el valor capturado en esa ejecución y aparece en varios controles (por ejemplo una fila de bandeja por proceso del mismo caso), se abre el primero en el orden de la página, como hizo la grabación, y el log lo indica con `dynamicLabelAmbiguousFirst=true matches=N`. Solo aplica a un valor tomado de la captura de la propia ejecución, nunca a una etiqueta literal.
- **Contenedores que conservan una clase "loading":** si una página deja la clase `loading` en un contenedor de maquetación durante toda su vida (el log `spinnerMatch` muestra su etiqueta, id y clases), cada espera posterior a una acción llega al tope de 120 s. `ASYNC_WAIT_IGNORE_LOADER_SELECTOR` (lista de selectores CSS, vacía por defecto) los excluye de la detección de cargador.
- **Alcance actual:** el campo donde se pega y los clics cuya etiqueta es el valor se resuelven con el valor de la ejecución. Seleccionar una fila de una lista por su número antes de copiarlo sigue dependiendo de los datos de la pantalla.

## Criterios de aceptación

- El panel permite introducir una URL y navegar en la pestaña seleccionada o abrir una pestaña nueva; la URL aparece como paso reproducible.
- Se pueden alternar páginas capturadas; login, clicks, escritura, teclado y otras acciones permanecen en el orden real y asociados a la página correcta, incluido el regreso a la pestaña original.
- El botón de adjuntar en el panel está deshabilitado si no hay un selector de archivo activo; permite uno o varios archivos según el control observado.
- Los adjuntos se almacenan en el ámbito del proyecto y se reflejan como pasos con un campo de selección de documentos dentro del mismo paso; la publicación/replay puede resolverlos sin depender de rutas temporales del equipo cliente.
- Discovery, spec promovido y ejecución directa de plan respetan el mismo `pageKey` y no afectan planes antiguos ni el flujo Jira.
- Si falta una pestaña, la referencia no existe o el control no admite la cantidad de archivos, el flujo falla con un error explícito, sin seleccionar otra pestaña/control por conjetura.

## Estado de implementación

Implementado en el código y cubierto con pruebas deterministas de captura del paso a paso, navegación entre pestañas, compilador/runtime de specs, ejecución directa del plan y selección de archivos del panel. La validación viva con un flujo real en el proyecto Northstar Enterprise Demo y el replay completo aún debe ejecutarse; no se hizo como parte de esta implementación.
