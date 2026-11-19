# Alternativas a Lucidchart sin Límite de Nodos y Guía de Uso
**Repositorio de Tesis de Posgrado — Universidad de Córdoba**

---

## 1. ¿Por qué Lucidchart falló o se quedó corto?

El plan gratuito de Lucidchart impone restricciones severas que dificultan el modelado de sistemas de posgrado completos:
* **Límite estricto de 60 figuras/objetos** por diagrama (nuestro sistema completo supera ampliamente esta cifra al considerar actores, subsistemas, casos de uso, `<<include>>` y `<<extend>>`).
* Bloqueo de exportación vectorial de alta calidad en cuentas gratuitas.
* Importador de marcado limitado que a menudo aplana o corta las relaciones.

A continuación, se presentan las **mejores herramientas profesionales 100% gratuitas, sin límite de nodos ni marcas de agua**.

---

## 2. Comparativa de Diagramadores Recomendados

| Herramienta | Límite de Nodos | Costo / Licencia | Importación por Código | Entorno de Trabajo | Por qué es la mejor opción |
| :--- | :---: | :---: | :---: | :--- | :--- |
| **draw.io (diagrams.net)** ⭐ *(Recomendado #1)* | **ILIMITADO** | 100% Gratis / Open Source | PlantUML, Mermaid, CSV, SQL | Web, App de Escritorio (Mac/Win), Extensión VS Code | Estándar de la industria. Permite editar cada nodo libremente, tiene paletas completas de UML y exporta a SVG/PNG en 300 DPI sin marcas. |
| **Mermaid Live Editor** | **ILIMITADO** | 100% Gratis / Open Source | Mermaid nativo | Web ([mermaid.live](https://mermaid.live)) | El más rápido para ver y compartir. Panel interactivo código-gráfico con zoom infinito. |
| **PlantText (PlantUML Web)** | **ILIMITADO** | 100% Gratis | PlantUML nativo | Web ([planttext.com](https://www.planttext.com)) | Diseñado exclusivamente para PlantUML. Cero configuración, compila al instante diagramas con cientos de elementos. |
| **Excalidraw** | **ILIMITADO** | 100% Gratis / Open Source | Librerías de iconos y pegado | Web ([excalidraw.com](https://excalidraw.com)) | Lienzo infinito con estética moderna y limpia. Ideal para defensas de tesis y presentaciones ejecutivas. |

---

## 3. Opción 1 (Recomendada): Usar draw.io (diagrams.net)

### ¿Cómo usar draw.io con nuestros diagramas?

#### Método A: Importar el código PlantUML directamente (Nodos 100% editables)
1. Entra a **[app.diagrams.net](https://app.diagrams.net)** (no requiere crear cuenta).
2. Selecciona **"Crear nuevo diagrama"** ➔ **"Diagrama en blanco"**.
3. En la barra de menús superior, ve a:
   * **Español:** `Organizar` ➔ `Insertar` ➔ `Avanzado` ➔ `PlantUML...`
   * **Inglés:** `Arrange` ➔ `Insert` ➔ `Advanced` ➔ `PlantUML...`
4. Copia el contenido de cualquiera de nuestros archivos generados:
   * [01_general_sistema.puml](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/lucidchart-scripts/01_general_sistema.puml)
   * [02_modulo_asignacion_jurados.puml](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/lucidchart-scripts/02_modulo_asignacion_jurados.puml)
   * [03_modulo_evaluacion_retroalimentacion.puml](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/lucidchart-scripts/03_modulo_evaluacion_retroalimentacion.puml)
   * [04_modulo_sustentacion_acta.puml](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/lucidchart-scripts/04_modulo_sustentacion_acta.puml)
   * [05_modulo_trazabilidad_auditoria.puml](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/lucidchart-scripts/05_modulo_trazabilidad_auditoria.puml)
5. Pega el código en la ventana y haz clic en **"Insertar"**.
6. **Resultado:** Todos los casos de uso, actores y paquetes aparecerán organizados en el lienzo. Puedes cambiar colores, mover nodos, cambiar tipografías y agregar tantos elementos como desees **sin ninguna restricción**.

#### Método B: Arrastrar los gráficos vectoriales SVG ya generados
Ya generamos los archivos SVG en alta definición listos para usar en la carpeta [`documentacion/diagramas-svg/`](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/diagramas-svg/):
* Simplemente arrastra cualquiera de los archivos `.svg` directamente sobre la ventana de **draw.io**, Word, PowerPoint o LaTeX.

---

## 4. Opción 2: Usar Mermaid Live Editor

Si prefieres la sintaxis Mermaid de nuestro documento principal [casos-de-uso.md](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/casos-de-uso.md):
1. Entra a **[mermaid.live](https://mermaid.live)**.
2. Copia cualquier bloque mermaid de [casos-de-uso.md](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/casos-de-uso.md) (como el diagrama general o los módulos detallados).
3. Pégalo en el panel izquierdo.
4. En el panel derecho obtendrás la visualización interactiva con zoom y podrás descargarlo en formato **PNG** o **SVG** con un solo clic.

---

## 5. Opción 3: Visual Studio Code con Extensión Local

Si utilizas VS Code, puedes editar y visualizar los diagramas directamente en tu entorno sin abrir ningún navegador:
1. Instala la extensión oficial **Draw.io Integration** (autor: *Henning Dieterichs*).
2. Instala la extensión **PlantUML** (autor: *jebbs*).
3. Abre cualquier archivo `.puml` de tu repositorio y presiona `Option + D` (en Mac) o `Alt + D` (en Windows/Linux).
4. El diagrama se renderizará automáticamente en una pestaña lateral y se actualizará en tiempo real cada vez que modifiques el código.

---

## 6. Galería de Diagramas SVG Listos para Usar

Los siguientes diagramas vectoriales ya están compilados y listos en tu proyecto:

1. 📊 **[01_general_sistema.svg](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/diagramas-svg/01_general_sistema.svg)** — Diagrama General con los 4 paquetes funcionales.
2. 👥 **[02_modulo_asignacion_jurados.svg](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/diagramas-svg/02_modulo_asignacion_jurados.svg)** — Asignación paritaria, conflicto de interés (RN-01) y reglas institucionales (RF-C13).
3. 📝 **[03_modulo_evaluacion_retroalimentacion.svg](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/diagramas-svg/03_modulo_evaluacion_retroalimentacion.svg)** — Formulario de evaluación, rúbricas y subsanación de capítulos (RN-06).
4. 📜 **[04_modulo_sustentacion_acta.svg](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/diagramas-svg/04_modulo_sustentacion_acta.svg)** — Programación, acta de grado y firma electrónica inmutable (RF-J10 / RNF-04).
5. 🕸️ **[05_modulo_trazabilidad_auditoria.svg](file:///Users/kikret/Documents/develop/repositorio-tesis/documentacion/diagramas-svg/05_modulo_trazabilidad_auditoria.svg)** — Grafo interactivo de estados, avance porcentual y auditoría.
