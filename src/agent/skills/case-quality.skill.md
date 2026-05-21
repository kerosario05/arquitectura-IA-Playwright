# Skill: case-quality

## id
case-quality

## purpose
Revisar el texto del caso de prueba original en TestRail. Detectar pasos duplicados, targets repetidos, assertions vagas y proponer una versión corregida del caso (sin modificar TestRail automáticamente).

## allowedFailureReasons
- poor_case_quality
- repeated_targets
- vague_assertions

## inputContract
- scenario (test case) del context-pack.json: custom_steps, expected, title
- discovery result: steps ejecutados con sus status
- repeated_targets detected during discovery (si aplica)
- vague_assertions detected during discovery (si aplica)

## outputContract
- agent-response.json con skillId="case-quality"
- proposedAction.type: "case_quality_suggestion"
- diagnosis: descripción de los problemas encontrados
- proposedAction.reason: texto con sugerencias de mejora
- shouldRetryExecution: false (no se debe re-ejecutar por calidad de caso)
- confidence: 0.0–1.0
- evidenceUsed: pasos y assertions del caso original
- risks: riesgos de mantener el caso como está

## forbiddenActions
- Modificar TestRail automáticamente
- Modificar registry estable
- Cambiar el plan de ejecución
- Generar código Playwright
- Modificar archivos del framework

## validationRules
- No puede modificar TestRail (solo sugerir cambios vía output)
- Debe citar pasos específicos del caso original en la diagnosis
- Las sugerencias deben ser específicas y accionables
- No puede cambiar el propósito del caso
- No puede hardcodear nombres de productos, URLs o perfiles
- No puede modificar archivos fuera del directorio handoff

## examples

### Ejemplo 1: Pasos duplicados
- scenario: El caso tiene dos pasos idénticos "Clic en 'Continuar'" en índices 2 y 5
- input: custom_steps=["1. Abrir URL del Kiosko","2. Clic en 'Continuar'","3. Validar datos","4. Clic en 'Continuar'"]
- output: {"diagnosis":"El paso 'Clic en 'Continuar'' aparece duplicado en índices 2 y 4. El segundo clic puede ser redundante si no hay cambio de estado entre ambos.","risks":["Duplicación puede causar fallos intermitentes"],"confidence":0.85}
- reasoning: Pasos duplicados sin cambios de estado intermedios son redundantes y propensos a fallos.

### Ejemplo 2: Assertions vagas
- scenario: El caso tiene assertions genéricas como "Validar que se muestre la información"
- input: expected=["Resultado visible","Validar que se muestre la información"]
- output: {"diagnosis":"La assertion 'Validar que se muestre la información' es muy genérica. Sugerir: 'Validar que se muestre los datos del producto' o un texto observable concreto.","risks":["Assertions vagas pueden causar falsos positivos"],"confidence":0.78}
- reasoning: Assertions sin target observable específico son difíciles de validar automáticamente.
