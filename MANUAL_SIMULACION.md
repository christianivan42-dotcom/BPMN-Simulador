# 📊 Manual del Simulador de Procesos

Guía completa de **todas las opciones** del simulador: qué significa cada dato, **cuándo
llenarlo** y cómo leer los resultados. Pensado para analistas que **no** son expertos en
simulación.

---

## 1. ¿Qué hace el simulador y para qué sirve?

Modelas un proceso en BPMN y el simulador lo **ejecuta cientos de veces** como si fueran
casos reales (pedidos, trámites, clientes…). Así respondes preguntas como:

- ¿Cuánto tarda en promedio un caso de principio a fin? (**cycle time**)
- ¿Dónde se forman **colas** y **cuellos de botella**?
- ¿Cuánto **cuesta** y qué tan **ocupados** están mis recursos?
- ¿El rediseño **TO-BE** mejora frente al **AS-IS**?

> **Idea clave:** un *token* (punto de color) representa **un caso** que recorre el proceso.
> La simulación mueve muchos tokens a la vez y mide tiempos, costos y colas.

**Pasos mínimos:** modela el diagrama → pulsa **Simular** → llena los datos → **Ejecutar** →
mira **Resultados**. Puedes pedir ayuda al **asistente de IA** en cualquier momento.

---

## 2. Escenario (configuración global)

Define el "mundo" de la simulación. Está en la pestaña **Configuración → Escenario**.

| Opción | Qué es | Cuándo / cómo llenarla |
|---|---|---|
| **Nº de instancias** | Cuántos casos vas a simular (p. ej. 200 pedidos). | Más casos = resultados más estables pero más lento. Empieza con 100–500. **Sin límite.** |
| **Tiempo entre llegadas** | Cada cuánto entra un caso nuevo al proceso. Tiene **distribución + valor + unidad**. | Si llegan ~1 por minuto → media 1, unidad minutos. Usa **Exponencial** para llegadas "aleatorias" reales. |
| **% warmup (excluir)** | Descarta los primeros X% de casos de las estadísticas (calentamiento). | Déjalo en 0 normalmente. Súbelo (5–10%) si el sistema arranca "vacío" y quieres medir el estado estable. |
| **Moneda** | Símbolo para los costos ($, USD, EUR…). | Solo es visual; elige la tuya. |
| **Inicio del escenario** | Fecha/hora en que arranca la simulación. | Importa **solo si usas horarios de trabajo** (para saber en qué día/hora empieza). |
| **Traslado/flujo (min)** | Tiempo que tarda el token en "viajar" por cada flecha. | Casi siempre 0 o un valor pequeño. Úsalo si el traspaso entre áreas tarda. |
| **Duración por defecto (min)** | Duración que usa una tarea **si no le pusiste una propia**. | Red de seguridad. Mejor define la duración de cada tarea. |

---

## 3. Recursos — **(esto es lo que preguntabas)** 👷

Un **recurso** es **quién o qué ejecuta las tareas**: una persona, un rol, una máquina, un
equipo. Ejemplos: *Operario*, *Analista*, *Agente de soporte*, *Montacargas*.

### ¿Por qué existen los recursos?

Porque en la vida real **la capacidad es limitada**. Si tienes **2 operarios** y llegan
**5 pedidos a la vez**, 3 esperan en cola. Eso genera **tiempo de espera** y define qué tan
**ocupado** (utilización) está cada recurso. **Sin recursos no hay colas** (capacidad infinita).

### Cada recurso tiene:

| Campo | Qué es | Ejemplo |
|---|---|---|
| **Nombre** | Cómo se llama el recurso/rol. | "Operario de bodega" |
| **#** (capacidad) | Cuántos hay disponibles en paralelo. | 3 |
| **$/h** (costo por hora) | Cuánto cuesta una hora de ese recurso. | 20 |
| **Horario** | El calendario en que trabaja (ver §4). | "Por defecto (L-V 9-17)" |

### Cómo se usan

1. En **Recursos**, pulsa **+ Añadir recurso** y define nombre, cantidad, costo/hora y horario.
2. Haz **clic en una tarea** del diagrama y, en su editor, elige ese recurso en **Recurso**.
3. Al simular, si todos los recursos están ocupados, los casos **hacen cola** → aparece
   **tiempo de espera** y **utilización**.

> **¿Cuándo llenar recursos?**
> - **Sí**, si quieres ver **colas, cuellos de botella, utilización y costo** (lo más útil).
> - **No** (deja la tarea en **"Sin recurso (24/7)"**), si solo te interesa el tiempo de
>   trabajo puro, sin límite de capacidad.

### ❓ "¿BIMP no llenaba recursos?"

**Sí los llena.** De hecho **BIMP es más estricto**: obliga a que **toda** tarea tenga un
recurso y le asigna *"Default Resource"* automáticamente. Aquí es **opcional**: puedes dejar
una tarea **"Sin recurso (24/7)"** (capacidad infinita) cuando no quieras modelar contención.
Así que esta herramienta hace lo mismo que BIMP en recursos, pero con **más flexibilidad**.

---

## 4. Horarios de trabajo (calendarios / timetables)

Definen **cuándo trabaja** un recurso: días y horas. Vienen dos por defecto:

- **Por defecto (L-V 9-17):** lunes a viernes, 9:00 a 17:00.
- **24/7:** todos los días, todo el día.

Puedes crear más con **+ Añadir horario** (nombre, día inicio/fin, hora inicio/fin).

**Efecto en la simulación:** las tareas con un recurso **solo avanzan dentro de su horario**.
Si una tarea empieza a las 16:50 y dura 30 min, **se pausa a las 17:00 y continúa al día
siguiente**. Por eso hay **dos cycle times** en los resultados:

- **Cycle time (reloj):** tiempo real de calendario (incluye noches y fines de semana).
- **Cycle time hábil:** solo cuenta horas laborables.

> **¿Cuándo usarlos?** Cuando quieras tiempos realistas de punta a punta (un trámite que
> "tarda 3 días" casi siempre es por horarios, no por trabajo puro). Si no te importa, deja
> los recursos en **24/7**.

---

## 5. Opciones por tarea (clic en el elemento)

Haz **clic en una tarea** del diagrama → se abre su editor con:

| Opción | Qué es | Cuándo llenarla |
|---|---|---|
| **Duración** | Cuánto tarda la tarea: **distribución + valor(es) + unidad**. | Siempre. Es el dato más importante. |
| **Recurso** | Quién la ejecuta (ver §3). | Si quieres modelar colas/costo/utilización. |
| **Costo fijo** | Costo extra por cada ejecución (además del costo del recurso). | Si la tarea tiene un costo fijo (materiales, comisión…). |
| **Umbral de costo** | Límite de costo para "marcar" ejecuciones caras. | Opcional. Cuenta cuántas ejecuciones lo superan. |
| **Umbral de duración** | Límite de tiempo para "marcar" ejecuciones lentas (con unidad). | Opcional. Útil para SLAs ("no debe pasar de 2 h"). |

---

## 6. Distribuciones (cuánto varía un tiempo)

Un tiempo casi nunca es fijo. La **distribución** describe **cómo varía**:

| Distribución | Cuándo usarla | Parámetros |
|---|---|---|
| **Fija (constante)** | El tiempo es siempre el mismo. | Media |
| **Exponencial** | Llegadas o eventos "aleatorios"; muchos cortos y pocos largos. | Media |
| **Normal** | Tiempos que se agrupan alrededor de un promedio (campana). | Media, Desv. est. |
| **Uniforme** | Cualquier valor entre un mínimo y un máximo, por igual. | Mín, Máx |
| **Triangular** | Conoces mínimo, **valor más probable** y máximo. | Mín, Moda, Máx |
| **Log-Normal** | Duraciones de tareas reales (sesgadas a la derecha). | Media, Desv. est. |
| **Gamma** | Tiempos de espera/servicio acumulados. | Media, Desv. est. |

> **Si dudas:** usa **Exponencial** para las **llegadas** y **Normal** o **Triangular** para
> la **duración** de las tareas. La **unidad** (seg/min/horas/días) se elige al lado.

---

## 7. Compuertas (decisiones)

En una compuerta **exclusiva** (X) el caso toma **una** rama. Le pones la **probabilidad** de
cada salida (de 0 a 1). Ejemplo: *¿Hay stock?* → **0.8** Sí / **0.2** No.

> **¿Cuándo llenarla?** Siempre que tengas una decisión. Si dejas todas iguales, se reparten
> por igual. Las probabilidades de cada compuerta deben sumar 1.

---

## 8. Eventos / esperas

Eventos intermedios que representan una **demora** (esperar un documento, un plazo, una
confirmación). Le pones una **duración** (distribución + unidad). Ej.: "Esperar 5 días".

---

## 9. Eventos de borde (boundary events) ⏱️

Un evento pegado al **borde** de una tarea (timer, error, mensaje, escalación). Modela algo
que puede ocurrir **mientras la tarea se ejecuta** (p. ej. "venció el plazo").

- Solo le pones una **duración** (sin probabilidad).
- Funciona como una **carrera**: si su tiempo es **menor** que el de la tarea, **se dispara**,
  interrumpe la tarea y el token sale por la **rama de excepción**.
- `0` = nunca se dispara.

> **¿Cuándo usarlo?** Para plazos/timeouts ("si tarda más de X, escalar") o reprocesos por error.

---

## 10. Cómo leer los Resultados

| Indicador | Qué significa |
|---|---|
| **Cycle time (reloj)** | Tiempo total promedio de un caso, de inicio a fin (incluye esperas y off-horario). |
| **Cycle time hábil** | Igual, pero solo contando horas laborables. |
| **Cycle min / máx** | El caso más rápido y el más lento. |
| **Tiempo de proceso** | Tiempo real trabajando (sin colas ni esperas). |
| **Tiempo de espera** | Tiempo en cola esperando un recurso libre. |
| **Eficiencia** | Proceso ÷ cycle time. Bajo = mucho tiempo "perdido" en esperas. |
| **Throughput** | Casos terminados por hora. |
| **Costo total** | Suma de costos de recursos + costos fijos. |
| **Completados** | Casos que llegaron al fin. |
| **Por actividad** | Visitas, tiempo de proceso, espera, costo y cuántas superan el umbral → revela el **cuello de botella**. |
| **Utilización de recursos** | % de tiempo ocupado. Cerca de 100% = recurso saturado (cuello de botella). |

### 📤 Exportar a Excel
- **Excel:** exporta el escenario actual (indicadores + por actividad + recursos).
- **AS-IS + TO-BE:** exporta ambos con una **hoja de comparación** automática.

---

## 11. Asistente de IA (pestaña **IA**)

Si no sabes qué poner o qué significa un resultado, el asistente te ayuda:

- **Ayúdame a llenar los datos** — lee tu diagrama y sugiere valores por elemento.
- **Interpretar resultados** — explica los KPIs y dice qué mejorar.
- **¿Qué metodología de mejora usar?** — recomienda Lean / Six Sigma / TOC / BPR / automatización.
- **Comparar AS-IS vs TO-BE** — compara ambos escenarios.

---

## 12. Flujo recomendado (paso a paso)

1. **Modela** el proceso en BPMN y dale un **nombre** + ubicación en el mapa.
2. Pulsa **Simular**.
3. En **Escenario**: pon el **nº de instancias** y el **tiempo entre llegadas**.
4. *(Opcional)* Crea **Recursos** y **Horarios**, y asígnalos a las tareas que tengan capacidad limitada.
5. **Clic en cada tarea** → pon su **duración** (y costo si aplica).
6. Pon las **probabilidades** de las compuertas.
7. *(Opcional)* Duración de **eventos de borde** y esperas.
8. **Ejecutar simulación** → observa los tokens y revisa **Resultados**.
9. Usa el **asistente de IA** para interpretar y mejorar. **Exporta a Excel** si quieres.

> **Consejo:** empieza simple (solo duraciones y llegadas), corre, y ve agregando recursos,
> horarios y costos a medida que necesites más realismo.

---

*Hecho con el simulador de procesos de **Agente BPMS — Copiloto Cognitivo de Procesos**.*
