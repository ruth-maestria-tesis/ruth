# Guion de demostración — Ruth (MIETIA, Universidad de Córdoba)

Duración sugerida: 20–25 minutos. Antes de empezar, cargue los datos de demostración desde la raíz:

```bash
pnpm --filter server seed -- --reset
```

El seed imprime las credenciales y un **enlace de jurado externo**. Guárdelo para el paso 6.

- La **tesis N** pertenece a `estudianteN@correo.unicordoba.edu.co`; los códigos empiezan por `DEMO-MIETIA-`.
- Contraseñas: `Coord2026!` (coordinador), `Jurado2026!` (jurados internos), `Estudiante2026!` (estudiantes), `Admin2026!` (admin).
- Use una ventana privada distinta por rol, o cierre sesión entre pasos.

| Tesis | Estado inicial | Jurados | Para qué sirve en la demo |
|---|---|---|---|
| 1, 2 | SUBMITTED | — | CU-01: asignar jurados |
| 3 | JURORS_ASSIGNED | jurado1 + externo (pendientes) | CU-08: aceptar; enlace externo |
| 4 | PENDING_JUROR_REPLACEMENT | jurado3 aceptó, jurado2 declinó | Reemplazo de jurado |
| 5 | UNDER_EVALUATION | jurado1 (borrador), jurado4 | CU-02: emitir concepto |
| 7 | IN_DISPUTE | jurado3 / jurado5, dirimente jurado6 pendiente | CU-05: dirimencia |
| 8 | REVISIONS_IN_PROGRESS | jurado1, jurado2 | CU-06: observaciones |
| 10 | READY_FOR_DEFENSE (sustentación propuesta) | jurado5, jurado6 | CU-03: confirmar la sustentación |
| 11 | DEFENSE_SCHEDULED (confirmada) | jurado3, jurado4 | CU-04: acta y firmas |
| 13, 14 | COMPLETED_APPROVED | — | Acta sellada en PDF, trazabilidad |

## 1. Coordinador: panorama (2 min)
`coordinador@unicordoba.edu.co`
1. **Dashboard:** conteos por estado, alertas (plazos de respuesta por vencer, evaluaciones atrasadas) y actividad reciente.
2. **Bandeja de tesis:** filtre por estado o busque sin tildes (por ejemplo, "garcia").
3. **Exportar:** descargue el reporte Excel/PDF con los filtros activos.

## 2. Coordinador: asignación de jurados (CU-01, 4 min)
1. Abra la **tesis 1** y pulse **Asignar jurados**.
2. Muestre la validación en vivo:
   - Elegir al director o directora de la tesis lo rechaza por conflicto de interés.
   - Dos jurados externos se rechazan: debe haber al menos uno de Unicórdoba.
3. Asigne a dos jurados internos, o a uno interno y uno **externo nuevo** creado en línea (sin contraseña).
4. La tesis pasa a JURORS_ASSIGNED y aparece la cuenta regresiva de días hábiles.
5. **Tesis 4:** reemplace al jurado que declinó.

## 3. Jurado: aceptar y evaluar (CU-08 y CU-02, 4 min)
`jurado1@unicordoba.edu.co`
1. En **Mis asignaciones**, la tesis 3 aparece PENDIENTE: el jurado ve el resumen, pero no el manuscrito. Acéptela; ahora el PDF ya está disponible.
2. Abra la **tesis 5** (con borrador), complete la rúbrica, el veredicto y los comentarios, y pulse **Emitir concepto**. El concepto queda bloqueado.

## 4. Discrepancia y dirimente (CU-05, 3 min)
1. Como coordinador, abra la **tesis 7**, pestaña **Discrepancia**: ahí se ven los dos conceptos opuestos y el dirimente pendiente.
2. Entre como `jurado6@unicordoba.edu.co`, acepte la asignación de dirimente y emita su concepto. La tesis sale de IN_DISPUTE según RN-08.

## 5. Observaciones (CU-06, 3 min)
1. `estudiante8@correo.unicordoba.edu.co`: en **Observaciones**, marque como atendida la observación pendiente, con un comentario.
2. `jurado1` o `jurado2`: resuelva las observaciones atendidas. Al resolver la última, la tesis pasa sola a READY_FOR_DEFENSE.
   - Si una tesis queda en revisiones sin observaciones, el coordinador usa **Marcar lista para sustentación**.

## 6. Jurado externo por enlace (RF-J14, 2 min)
1. En una ventana privada, abra el enlace externo que imprimió el seed.
2. El jurado externo entra sin contraseña y solo ve su asignación. La sesión dura 4 horas, y cualquier otra ruta responde 401.

## 7. Sustentación y acta (CU-03 y CU-04, 4 min)
1. `jurado6`: en la **tesis 10**, confirme la sustentación propuesta. Con ambas confirmaciones la tesis pasa a DEFENSE_SCHEDULED.
2. Coordinador, **tesis 11**, pestaña **Sustentación**: registre el acta con el veredicto y la calificación.
3. `jurado3` y `jurado4` firman en orden. Con la última firma, el acta se **sella**: se genera el PDF con su hash y la tesis termina en COMPLETED_APPROVED (o COMPLETED_FAILED).
4. Descargue el PDF del acta de la **tesis 13**.

## 8. Estudiante y trazabilidad (CU-07, 2 min)
1. `estudiante13@correo.unicordoba.edu.co`: estado, progreso, conceptos emitidos (nunca los borradores), acta y grafo.
2. Coordinador, **tesis 14**, pestaña **Trazabilidad**: el grafo tesis → asignaciones → conceptos → dirimencia → sustentación → acta, y el historial de estados.
3. (Admin) **Auditoría:** la bitácora de acciones con su actor y su fecha.

## Si algo falla durante la demo
- Vuelva a ejecutar `pnpm --filter server seed -- --reset`: deja todo como al inicio. Solo borra lo etiquetado `DEMO`.
- La sesión externa expira a las 4 h. Genere un enlace nuevo desde la asignación (coordinador → tesis 3 → **Enlace externo**).
