# Plan — Ajustes del tutor (prioritario)

Fecha: 2026-11-23 · Rama: `feat/ajustes-tutor-supabase`

**Alcance:** solo los cuatro requerimientos del tutor, sobre la infraestructura actual (MongoDB Atlas + GridFS/Vercel Blob). No se migra a Supabase.

**Tiempo estimado:** unos 2 días. Se reutiliza lo que ya existe en lugar de crear módulos nuevos.

## Punto de partida

| # | Requerimiento | Ya existe | Falta |
|---|---|---|---|
| R1 | Listado de trabajos → seleccionar uno → buscar jurados para ese trabajo | `/coordinator/theses` → ficha → "Asignar jurados" → `JuryAssignmentDialog` + `JurorSelector` (búsqueda general en `GET /users/faculty`) | La búsqueda no tiene en cuenta la tesis seleccionada, y no hay acción de asignar desde el listado |
| R2 | Agregar un jurado que no está en el listado | Crear un externo nuevo, solo en el Jurado 2 | Crear también un docente Unicórdoba nuevo, en ambos jurados |
| R3 | Revisión en una sola sección, sin ítems; el PDF se descarga completo y no se visualiza | Pestañas por capítulo en `FeedbackThread`; visor `PdfViewer` embebido en la página del jurado | Unificar todo en una sección y quitar el visor, dejando solo la descarga |
| R4 | Descargar el documento y subirlo con las correcciones | Descarga en `PdfViewer` y archivos de corrección en `EvaluationForm` (solo en borrador) | Un flujo claro "descargar → subir corregido", ligado a la versión del manuscrito y visible para el estudiante |

## Bloque 1 — R1 y R2: asignación de jurados (día 1, mañana y primera parte de la tarde)

Los dos requerimientos tocan los mismos componentes, así que se hacen juntos.

**Server**
1. `GET /theses/:id/juror-candidates?q=`, en `theses` o `assignments`.
   - Usa el mismo filtro de docentes que `/users/faculty` y añade:
     - `affinity`: las coincidencias entre `thesis.keywords` y `jurorProfile.expertise`;
     - `activeAssignments`: la carga actual del jurado;
     - `conflict`: el motivo, según RN-01 (director, codirector o jurado previo).
   - Ordena por afinidad y después por menor carga. Los candidatos en conflicto se marcan, no se ocultan.
2. Generalizar `newExternal` a `newJuror` con `isUnicordoba`. Se mantiene `newExternal` como alias para no romper el contrato.
   - Si `isUnicordoba` es verdadero, se crea el usuario con rol `INTERNAL_JUROR`. Si no, con `EXTERNAL_JUROR`.
   - Los dos reciben el enlace con token que ya existe.
   - Si el correo ya existe, se responde con un error claro que permite seleccionar al usuario existente.
3. Pruebas: e2e del endpoint de candidatos (orden y conflicto) y e2e de asignación con un jurado Unicórdoba nuevo.

**Cliente**
4. `/coordinator/theses`: acción de fila "Asignar jurados" (tesis en `SUBMITTED`), que abre el `JuryAssignmentDialog` sobre esa tesis.
5. `JurorSelector` recibe un `thesisId`:
   - arriba muestra "Sugeridos para este trabajo", con chips de afinidad, carga y Unicórdoba/Externo;
   - los candidatos en conflicto aparecen deshabilitados, con el motivo;
   - debajo queda la búsqueda libre.
6. El interruptor pasa a llamarse "Registrar jurado nuevo", está disponible en **ambos** jurados y trae la casilla "Docente de la Universidad de Córdoba". La regla RF-C13 (al menos un Unicórdoba) se sigue validando como hoy.

## Bloque 2 — R3: retroalimentación en un solo bloque (día 1, tarde)

1. **Server:** `chapter` pasa a ser opcional en el DTO y en el esquema de `feedback-item`, con valor por defecto `GENERAL`. Los datos antiguos con capítulo siguen siendo válidos. Se conserva el ciclo RN-06 (pendiente → atendida → resuelta) y las réplicas.
2. **Cliente:**
   - **`FeedbackThread`:** se eliminan las pestañas por capítulo (Introducción, Marco teórico, Metodología, Resultados, Conclusiones, Otro), el selector "Capítulo", los contadores por capítulo y el campo "referencia". Queda **una sola sección**: la observación general de cada jurado sobre el documento completo, en un área de texto amplia, con sus respuestas.
   - **Vista del estudiante y del coordinador:** muestran esa misma sección única, un bloque por jurado.
   - Se retiran `CHAPTER_LABELS` y el capítulo de los mocks y del seed.
3. **`/juror/evaluation/:id` sin visor:** se quita el `PdfViewer`, que hoy es el único lugar donde se usa, y el documento **no se muestra en pantalla**. En su lugar va un botón "Descargar documento completo (PDF, vN)" con el nombre del archivo, su versión y su fecha. El formulario de evaluación ocupa el ancho de la página.
   - El componente `PdfViewer.vue` se elimina.
   - La descarga se hace con `downloadFile` sobre la ruta actual del manuscrito.
4. **Pruebas:** se ajustan las e2e de feedback (crear sin `chapter`).

## Bloque 3 — R4: descargar y subir el documento corregido (día 2)

Se reutilizan los "archivos de corrección" que ya existen en la evaluación (pdf/doc/docx), sin crear una entidad nueva.

1. **Server:**
   - Cada archivo de corrección guarda `manuscriptVersion`, la versión que el jurado descargó.
   - Se permite subir correcciones **también después de enviar el concepto**, mientras la tesis esté en evaluación o subsanación. Hoy solo se puede en borrador.
   - La descarga del manuscrito por el jurado queda registrada en la auditoría con su versión.
   - El estudiante y la coordinación pueden listar y descargar esos archivos.
   - El estudiante sube la nueva versión del manuscrito por la ruta actual de manuscritos.
2. **Cliente (jurado):** una tarjeta "Documento con correcciones" con dos pasos visibles:
   1. **Descargar documento (vN):** el mismo botón de descarga del Bloque 2.
   2. **Subir documento corregido:** reutiliza `uploadFile`.

   La tarjeta muestra el historial y avisa si salió una versión nueva del manuscrito después de la descarga.
3. **Cliente (estudiante):** en "Observaciones", el documento corregido de cada jurado se puede descargar, y al lado está "Cargar nueva versión", que ya existe.
4. **Pruebas:** e2e de subida después del envío y de la visibilidad para el estudiante.

## Cierre (día 2, final)

- `pnpm lint`, `pnpm test` y las e2e en verde.
- Prueba manual del recorrido completo en local con el seed:
  1. el coordinador asigna un jurado nuevo desde el listado;
  2. el jurado acepta, descarga, sube el documento corregido y deja la observación general;
  3. el estudiante ve todo y sube la nueva versión.
- Actualizar `docs/superpowers/specs/2026-11-19-mvp-api-contracts.md` con los endpoints nuevos o modificados.

## Fuera de alcance (después)

- La migración a Supabase.
- Las sugerencias 9 y 10 del asesor: registrar que el estudiante vio y descargó el concepto, y la alerta al coordinador.
