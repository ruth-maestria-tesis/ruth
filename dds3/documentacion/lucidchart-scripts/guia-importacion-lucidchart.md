# Guía de Importación de Casos de Uso en Lucidchart
**Repositorio de Tesis de Posgrado — Universidad de Córdoba**

Lucidchart permite transformar código directamente en diagramas gráficos editables mediante su motor de **Marcado (Markup)** y su importador de **Diagramas de Proceso (CSV)**.

---

## Métodos Disponibles para Importar en Lucidchart

### Método 1: Importación por Marcado PlantUML (El más recomendado y nativo para Casos de Uso)

Este método genera figuras UML estándar de casos de uso (actores estilizados, óvalos, paquetes modulares y relaciones `<<include>>` / `<<extend>>`).

#### Pasos en Lucidchart:
1. Inicia sesión en [Lucidchart](https://lucid.app) y crea un **Documento en Blanco**.
2. En la barra de menús superior, dirígete a:
   * **Español:** `Insertar` ➔ `Marcado` (o `Insertar` ➔ `Importar datos` ➔ `PlantUML`).
   * **Inglés:** `Insert` ➔ `Markup` ➔ `PlantUML`.
3. Se abrirá una ventana emergente con un editor de código.
4. Abre cualquiera de los siguientes archivos generados en tu repositorio, copia todo su contenido y pégalo en la ventana de Lucidchart:
   * **Diagrama General Completo:** [`01_general_sistema.puml`](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/lucidchart-scripts/01_general_sistema.puml)
   * **Módulo 1 (Asignación y Jurados):** [`02_modulo_asignacion_jurados.puml`](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/lucidchart-scripts/02_modulo_asignacion_jurados.puml)
   * **Módulo 2 (Evaluación y Capítulos):** [`03_modulo_evaluacion_retroalimentacion.puml`](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/lucidchart-scripts/03_modulo_evaluacion_retroalimentacion.puml)
   * **Módulo 3 (Sustentación y Acta):** [`04_modulo_sustentacion_acta.puml`](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/lucidchart-scripts/04_modulo_sustentacion_acta.puml)
   * **Módulo 4 (Grafo y Auditoría):** [`05_modulo_trazabilidad_auditoria.puml`](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/lucidchart-scripts/05_modulo_trazabilidad_auditoria.puml)
   * *(O copia desde el consolidado [todos_los_casos_de_uso.puml](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/lucidchart-scripts/todos_los_casos_de_uso.puml))*
5. Haz clic en el botón azul **"Insertar" (Insert)**.
6. ¡Listo! Lucidchart renderizará automáticamente las figuras, conectores y textos en tu lienzo como elementos vectoriales 100% editables.

---

### Método 2: Importación por Marcado Mermaid

Si tu versión de cuenta de Lucidchart tiene habilitado el motor Mermaid:
1. Ve al menú: `Insertar` ➔ `Marcado` ➔ `Mermaid`.
2. Copia y pega cualquiera de los diagramas mermaid documentados en [casos-de-uso.md](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/casos-de-uso.md) (Secciones 3 o 4).
3. Haz clic en **"Insertar"**.

---

### Método 3: Importación por Archivo CSV (Diagrama de Proceso)

Si deseas importar el esquema mediante datos tabulares de Lucidchart:
1. En Lucidchart, ve al menú superior:
   * `Archivo` ➔ `Importar datos` ➔ `Diagrama de proceso (CSV)`.
   * *O en el panel lateral izquierdo: `Importar datos` ➔ `Process Diagram`.*
2. Selecciona y sube el archivo generado:
   [`lucidchart-casos-de-uso.csv`](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/lucidchart-scripts/lucidchart-casos-de-uso.csv).
3. Haz clic en **Siguiente / Finalizar**. Lucidchart conectará automáticamente los actores con sus respectivos casos de uso y subtareas.

---

## Archivos Generados en el Repositorio

| Archivo | Tipo / Formato | Contenido |
| :--- | :--- | :--- |
| [01_general_sistema.puml](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/lucidchart-scripts/01_general_sistema.puml) | PlantUML | Diagrama general con los 4 módulos funcionales y todos los actores. |
| [02_modulo_asignacion_jurados.puml](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/lucidchart-scripts/02_modulo_asignacion_jurados.puml) | PlantUML | CU-01, CU-08, CU-05 con reglas RN-01, RF-C13, RF-C14, RF-J13 y RN-08. |
| [03_modulo_evaluacion_retroalimentacion.puml](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/lucidchart-scripts/03_modulo_evaluacion_retroalimentacion.puml) | PlantUML | CU-02, CU-06 con rúbrica, concepto y transiciones de estados RN-06. |
| [04_modulo_sustentacion_acta.puml](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/lucidchart-scripts/04_modulo_sustentacion_acta.puml) | PlantUML | CU-03, CU-04 con confirmación electrónica RF-J10 y hash RNF-04. |
| [05_modulo_trazabilidad_auditoria.puml](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/lucidchart-scripts/05_modulo_trazabilidad_auditoria.puml) | PlantUML | CU-07, CU-09 con grafo de estados RF-C16, avance RF-P02 y logs. |
| [todos_los_casos_de_uso.puml](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/lucidchart-scripts/todos_los_casos_de_uso.puml) | PlantUML | Archivo único consolidado con los 5 diagramas listos para copiar. |
| [lucidchart-casos-de-uso.csv](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/lucidchart-scripts/lucidchart-casos-de-uso.csv) | CSV Lucidchart | Matriz estructurada de formas y conexiones para importación directa. |
