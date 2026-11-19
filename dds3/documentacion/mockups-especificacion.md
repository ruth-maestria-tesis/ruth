# Especificación de Mockups y Diseño UI/UX
**Plataforma de Repositorio de Tesis de Posgrado — Universidad de Córdoba**  
**Stack de Interfaz:** Nuxt 4 + Vuetify 3 + Material Design Icons / Lucide

---

## 1. Sistema de Diseño e Identidad Visual

El diseño de interfaz está adaptado a la identidad corporativa de la **Universidad de Córdoba (Colombia)**, combinando solidez académica, alta legibilidad y dinamismo moderno.

### 1.1. Paleta de Colores Institucional

| Token | Nombre | Hex | Uso Principal |
| :--- | :--- | :---: | :--- |
| `primary` | Verde Unicórdoba | `#006837` | Barra de navegación, botones primarios, estados activos y acentos institucionales. |
| `primary-dark` | Verde Oscuro Bosque | `#004825` | Encabezados de tablas, estados hover y bordes de énfasis. |
| `secondary` | Dorado Académico | `#FDB913` | Alertas de plazo, estados intermedios, menciones meritorias y badges de advertencia. |
| `surface-light` | Fondo Canvas | `#F8FAFC` | Fondo general de la aplicación (alto contraste y descanso visual). |
| `surface-card` | Blanco Puro | `#FFFFFF` | Contenedores de tarjetas, modales y superficies de paneles. |
| `text-primary` | Gris Carbón | `#0F172A` | Títulos, textos principales y valores de datos. |
| `text-secondary`| Gris Neutro | `#64748B` | Subtítulos, metadatos, etiquetas y timestamps. |
| `error` | Rojo Rubí | `#DC2626` | Bloqueos por conflicto de interés, tesis reprobadas y errores de validación. |
| `success` | Verde Esmeralda | `#16A34A` | Tesis aprobadas, actas selladas y subsanaciones validadas. |
| `info` | Azul Zafiro | `#0284C7` | Grafo de trazabilidad, tokens seguros y enlaces de descarga. |

### 1.2. Tipografía
* **Familia Tipográfica:** `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`.
* **Escala Modular:**
  * H1 / Títulos de Módulo: `24px` / Semi-bold (600)
  * H2 / Títulos de Sección: `18px` / Semi-bold (600)
  * Body: `14px` / Regular (400) o Medium (500)
  * Badges / Metadatos: `12px` / Medium (500)
  * Monospace (Hash Criptográfico y Tokens): `'JetBrains Mono', 'Fira Code', monospace` (12px).

---

## 2. Catálogo de Vistas y Mockups Detallados

### Vista 1: Login Institucional y Acceso para Jurado Externo (`/login`)
* **Propósito:** Autenticar usuarios con credenciales universitarias y proveer un acceso express seguro mediante token único para evaluadores externos (**RF-J14**).
* **Componentes Principales:**
  * Tarjeta central dividida en dos paneles: panel izquierdo con identidad de la Universidad de Córdoba y lema institucional; panel derecho con formulario de autenticación.
  * Pestañas de acceso: **"Docentes y Coordinación"** (Usuario institucional + Contraseña) y **"Jurado Externo"** (Ingreso directo con Token de Acceso o enlace recibido al correo).
  * Enlace a políticas de confidencialidad académica y recuperación de credenciales.

---

### Vista 2: Dashboard General del Coordinador de Posgrado (`/coordinador`)
* **Propósito:** Centralizar el estado operativo del posgrado, supervisión de tesis, métricas clave y alertas de plazos por vencer.
* **Componentes Principales:**
  * **Barra de Métricas (KPI Cards):**
    * Tesis Radicadas (por asignar jurados).
    * En Evaluación por Jurados (con contador de alertas de retraso).
    * En Subsanación de Observaciones.
    * Listas para Sustentación / Programadas.
  * **Bandeja de Tesis Activas (`v-data-table`):**
    * Columnas: Código, Título de la Tesis, Estudiante, Director, Jurados Asignados (con badges de estado: Pendiente, Aceptado, Evaluado), Porcentaje de Avance (**RF-P02**) y Acciones.
    * Barra de filtros dinámicos: Filtro por Programa (Maestría en Ciencias Ambientales, Doctorado en Educación, etc.), Cohorte, Periodo y Estado.
  * **Botón de Acción Rápida:** *"Asignar Jurados"* en aquellas tesis en estado `RADICADA`.

---

### Vista 3: Modal Interactivo de Asignación de Jurados (`CU-01`, `RF-C13`, `RN-01`, `RF-C14`)
* **Propósito:** Permitir al Coordinador conformar el panel evaluador paritario con validación algorítmica estricta de reglas de negocio.
* **Componentes Principales:**
  * **Ficha de la Tesis:** Muestra título, autor, director y codirectores registrados.
  * **Selector Jurado 1 (Docente Unicórdoba):**
    * Autocompletado conectado a base de datos de profesores.
    * Bloqueo inmediato si se selecciona al director/codirector (**RN-01**).
  * **Selector Jurado 2:**
    * Opción de elegir docente Unicórdoba o activar switch *"Jurado Externo"*.
    * Si es externo: Despliegue de campos para Institución de Origen, Título/Doctorado, País y Correo Electrónico (**RF-C14**).
  * **Validador en Vivo de Negocio (Callout de Reglas):**
    * ✔ Exactamente 2 jurados designados.
    * ✔ Al menos 1 con afiliación a la Universidad de Córdoba (**RF-C13**).
    * ✔ Ausencia total de conflicto de interés (**RN-01**).
  * **Control de Plazo:** Selector numérico de días hábiles de respuesta (ej. 8 días hábiles).

---

### Vista 4: Portal del Jurado Evaluador y Aceptación de Designación (`CU-08`, `/jurado`)
* **Propósito:** Brindar al jurado un entorno claro para revisar convocatorias y confirmar o declinar su participación.
* **Componentes Principales:**
  * **Banner de Designación Pendiente:**
    * Cuenta regresiva en días y horas hábiles restantes (**RF-J13**).
    * Resumen de la tesis, estudiante, director y objetivos del trabajo.
  * **Botones de Decisión:**
    * Botón primario verde: *"Aceptar Designación"* (Desbloquea inmediatamente la descarga y evaluación).
    * Botón secundario outline: *"Declinar Designación"* (Abre modal de justificación obligatoria).
  * **Listado de Tesis Aceptadas:**
    * Tarjetas de trabajo con acceso directo a: Visor de Evaluación, Hilo de Retroalimentación y Acta de Sustentación.

---

### Vista 5: Visor de Evaluación de Tesis y Formulario de Concepto (`CU-02`, `/jurado/evaluacion/[id]`)
* **Propósito:** Proveer un entorno unificado de lectura y calificación sin necesidad de alternar ventanas externas.
* **Componentes Principales (Layout Split-Screen):**
  * **Columna Izquierda (60% ancho):** Visor PDF interactivo del manuscrito de tesis, con índice de navegación por capítulos y buscador de texto.
  * **Columna Derecha (40% ancho):** Panel de Calificación y Rúbrica Oficial:
    * Criterio 1: Rigor científico y coherencia metodológica (1 a 5).
    * Criterio 2: Relevancia, innovación y aportes al conocimiento (1 a 5).
    * Criterio 3: Calidad formal, estilo y manejo bibliográfico (1 a 5).
    * Selector de Concepto Final: `Aprobado para Sustentación`, `Aprobado con Modificaciones` o `Rechazado`.
    * Área de texto para observaciones cualitativas integrales.
    * Cargador de archivo para adjuntar manuscrito con anotaciones en PDF.
    * Botón *"Emitir Concepto Oficial"* con confirmación previa.

---

### Vista 6: Hilo Granular de Retroalimentación por Capítulos (`CU-06`, `RN-06`)
* **Propósito:** Facilitar la subsanación interactiva de observaciones entre jurado y estudiante con control estricto de estados.
* **Componentes Principales:**
  * **Selector de Capítulo / Sección:** Pestañas para "Introducción", "Metodología", "Resultados", "Conclusiones".
  * **Timeline / Lista de Observaciones:**
    * Cada tarjeta muestra: Autor (Jurado 1 / Jurado 2), Fecha, Párrafo referenciado y Contenido del requerimiento.
    * Badge de Estado: `Pendiente` (Naranja), `Atendida` (Azul), `Aprobada-Subsanada` (Verde).
  * **Reglas Visuales según Rol (RN-06):**
    * Si es **Estudiante**: Botón *"Responder y Cargar Corrección"* (habilita campo para justificar cambios y subir fe de erratas).
    * Si es **Jurado**: Botón *"Aprobar Subsanación"* (solo disponible cuando el estado es `Atendida`) o botón *"Reabrir Observación"* si la respuesta es insuficiente.

---

### Vista 7: Gestión de Discrepancia y Jurado Dirimente (`CU-05`, `RN-08`)
* **Propósito:** Resolver divergencias críticas cuando los conceptos de los dos jurados principales no coinciden.
* **Componentes Principales:**
  * **Alerta Crítica Superior:** *"Tesis en estado de Discrepancia Evaluativa — Se requiere designación de Jurado Dirimente"*.
  * **Matriz Comparativa de Conceptos:**
    * Columna Jurado 1: Concepto emitido (ej. Aprobado 4.5) + Observaciones principales.
    * Columna Jurado 2: Concepto emitido (ej. Rechazado 2.0) + Motivos de reprobación.
  * **Formulario de Jurado Dirimente:**
    * Selección del tercer evaluador con validación de no conflicto (**RN-01**).
    * Envío de expediente completo al dirimente con carácter preferente.

---

### Vista 8: Programación y Acta de Sustentación con Firma Electrónica (`CU-03`, `CU-04`, `RF-J10`, `RNF-04`)
* **Propósito:** Formalizar la defensa pública, consolidar deliberaciones y expedir el acta inmutable sellada criptográficamente.
* **Componentes Principales:**
  * **Cabecera Oficial:** Escudo de la Universidad de Córdoba, título del programa de posgrado y número de acta.
  * **Datos del Estudiante y Modalidad:** Fecha, hora, auditorio o enlace virtual de sesión.
  * **Panel de Deliberación:**
    * Calificación final numérica promediada (ej. 4.8).
    * Veredicto: Selección de mención (`Aprobada`, `Aprobada con Mención Meritoria`, `Aprobada con Mención Laureada`).
  * **Módulo de Confirmación Electrónica Simple (RF-J10):**
    * Fila para **Jurado 1**: Checkbox *"Doy fe y confirmo el acta"* + Botón de firma + Estado: Firmado (Fecha/Hora/IP).
    * Fila para **Jurado 2**: Estado: Firmado (Fecha/Hora/IP).
    * Fila para **Coordinador**: Estado: Pendiente de firma final.
  * **Bloque de Inmutabilidad Criptográfica (RNF-04):**
    * Generación del Hash SHA-256 del documento.
    * Badge de certificación de inmutabilidad: *"Documento sellado y registrado en bitácora de auditoría"*.

---

### Vista 9: Grafo Interactivo de Trazabilidad y Progreso (`CU-07`, `RF-C16`)
* **Propósito:** Ofrecer visualización de la ruta crítica de la tesis en un lienzo de nodos interactivo (Vue Flow / Cytoscape.js).
* **Componentes Principales:**
  * **Lienzo de Grafo:** Nodos conectados que muestran las etapas secuenciales y bifurcaciones del flujo:
    * `Radicación` ➔ `Asignación de Jurados` ➔ `Evaluación` ➔ `Subsanación de Observaciones` ➔ `Sustentación` ➔ `Acta Final`.
  * **Interactividad:**
    * Nodos completados en verde esmeralda con check.
    * Nodo actual en azul zafiro con pulso animado.
    * Nodos futuros en gris tenue.
    * Al hacer clic en un nodo: Panel lateral (Drawer) con fecha, responsable, evidencias descargables (conceptos, cartas, actas) y tiempo de permanencia en el estado.
