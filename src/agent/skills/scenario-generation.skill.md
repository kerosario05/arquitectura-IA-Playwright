# Skill: scenario-generation

## id
scenario-generation

## purpose
Generar múltiples casos de prueba profesionales para TestRail a partir de una historia de usuario de Jira, cubriendo el flujo exitoso, errores esperados y casos borde relevantes al tipo de funcionalidad.

## inputContract
- jiraKey: clave del issue (ej: AA-123)
- storyTitle: título de la historia de usuario
- acceptanceCriteria: criterios de aceptación limpios extraídos de la descripción Jira
- storyType: tipo de flujo detectado (auth | transfer | query | form | navigation | report | config | unknown)
- additionalContext: contexto adicional del issue fuera de los criterios

## outputContract
- scenarios[]: entre 2 y 5 escenarios de prueba
- scenarios[].title: nombre descriptivo y único — QUÉ se prueba y bajo QUÉ condición
- scenarios[].preconditions: lista con guiones de condiciones técnicas y de negocio previas al test
- scenarios[].steps[]: pasos ATÓMICOS — un paso = una sola acción usando el diccionario de verbos
- scenarios[].expectedResult: resultado final observable al completar todos los pasos
- Formato: { "scenarios": [ { "title", "preconditions", "steps": ["string"], "expectedResult" } ] }

## stepTaxonomy
Diccionario de verbos obligatorio:

| Tipo de acción        | Patrón                                              | Ejemplo                                               |
|-----------------------|-----------------------------------------------------|-------------------------------------------------------|
| Botón o enlace        | Clic en "[label]"                                   | Clic en "Iniciar"                                     |
| Campo de texto        | Ingresar [dato] en el campo "[nombre]"              | Ingresar el número de cédula en el campo "Identificación" |
| Lista o dropdown      | Seleccionar "[opción]"                              | Seleccionar "Cuenta de Ahorro"                        |
| Validar texto visible | Validar que se muestre "[texto]"                    | Validar que se muestre "Solicitar"                    |
| Verificar estado UI   | Verificar que [condición observable]                | Verificar que el botón "Continuar" está habilitado    |
| Esperar carga         | Esperar que se cargue [pantalla o sección]          | Esperar que se cargue la pantalla de confirmación     |

## forbiddenActions
- Verbos genéricos: "Navegar a", "Acceder a", "Ir a", "Revisar", "Comprobar", "Ver", "Abrir"
- Pasos combinados: "Ingresar y confirmar" — separar en dos pasos atómicos
- expectedResult genérico: "funciona correctamente", "el sistema responde"
- Generar solo 1 escenario cuando hay múltiples criterios o flujos
- Hardcodear valores reales: cédulas, montos, cuentas, nombres de usuario
- Agrupar validaciones con acciones — "Validar que se muestre" va AL FINAL
- Precondiciones genéricas: "El usuario existe", "La app está configurada"

## validationRules
- ATOMICIDAD: un paso = una sola acción. Navegación de 4 pantallas = 4 pasos de "Clic en"
- ORDEN en pasos: primero acciones (Clic, Ingresar, Seleccionar), luego validaciones (Validar que se muestre)
- LABELS en comillas dobles: cualquier texto visible de la UI va entre comillas
- PRIMER escenario siempre es el happy path completo
- Precondiciones como lista con guiones: disponibilidad app + estado auth + datos necesarios + condición específica
- Para AUTH: happy path + credenciales inválidas + bloqueo por intentos
- Para TRANSFER: flujo exitoso + saldo insuficiente + límite excedido
- Para FORM: datos válidos + campos obligatorios vacíos + formato inválido
- Para QUERY: resultados disponibles + estado vacío

## examples

### Ejemplo 1: Login con OTP (auth)
- input: [AA-45] "Inicio de sesión con cédula y OTP", criteria="Ingresa cédula válida; Sistema envía OTP; OTP correcto accede al dashboard"
- output:
```json
{
  "scenarios": [
    {
      "title": "Inicio de sesión exitoso con cédula válida y OTP correcto",
      "preconditions": "- La aplicación está disponible y accesible.\n- El usuario NO está autenticado (sesión cerrada).\n- El usuario tiene cuenta activa en el sistema.\n- El número de celular está registrado y activo.",
      "steps": [
        "Clic en \"Iniciar sesión\"",
        "Ingresar el número de cédula en el campo \"Identificación\"",
        "Clic en \"Continuar\"",
        "Ingresar el código OTP recibido en el campo \"Código de verificación\"",
        "Clic en \"Confirmar\"",
        "Validar que se muestre \"Bienvenido\"",
        "Validar que se muestre el menú principal de la aplicación"
      ],
      "expectedResult": "El usuario accede al dashboard principal con el menú de opciones disponibles y su nombre visible en la pantalla."
    },
    {
      "title": "Inicio de sesión fallido con cédula no registrada",
      "preconditions": "- La aplicación está disponible y accesible.\n- El usuario NO está autenticado.",
      "steps": [
        "Clic en \"Iniciar sesión\"",
        "Ingresar una cédula no registrada en el campo \"Identificación\"",
        "Clic en \"Continuar\"",
        "Validar que se muestre el mensaje de error de cédula no registrada",
        "Verificar que el usuario permanece en la pantalla de identificación"
      ],
      "expectedResult": "El sistema muestra el mensaje de error indicando que la cédula no está registrada y no permite continuar."
    }
  ]
}
```
- reasoning: Pasos atómicos con verbos del diccionario, validaciones al final, precondiciones técnicas en lista.
