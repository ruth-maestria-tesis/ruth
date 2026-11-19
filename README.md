# Ruth — Plataforma de evaluación de trabajos de grado (MIETIA, Universidad de Córdoba)

Plataforma para gestionar el ciclo completo de un trabajo de grado de posgrado: radicación, asignación de jurados (CU-01, CU-08), evaluación (CU-02), discrepancias y dirimencia (CU-05), observaciones (CU-06), sustentación (CU-03), acta sellada en PDF (CU-04), trazabilidad (CU-07), notificaciones internas, alertas programadas, reportes y auditoría.

## Monorepo (pnpm)

| Carpeta | Contenido |
|---|---|
| `shared/` | Enums, tipos y códigos de error compartidos (`@thesis/shared`) |
| `server/` | API NestJS 11 + Mongoose 8 + MongoDB Atlas (archivos en GridFS). Ver [server/README.md](server/README.md) |
| `client/` | Nuxt 4 + Pinia + Vuetify 3 (SPA). Ver [client/README.md](client/README.md) |
| `docs/` | Diseño, contratos de API, planes y [guion de demostración](docs/demo-guion.md) |
| `dds3/` | Documentación fuente del proyecto (casos de uso, requisitos, mockups, sugerencias del asesor) |

El código, la base de datos y la API están en inglés. Solo los textos de la interfaz están en español.

## Puesta en marcha local

Requisitos: Node 22, pnpm, y un cluster de MongoDB Atlas (o un MongoDB local).

1. Instale las dependencias y compile `shared`:
   ```bash
   pnpm install && pnpm build:shared
   ```
2. Configure el servidor:
   ```bash
   cp server/.env.example server/.env
   ```
   Escriba `MONGODB_URI` y dos secretos JWT. `server/.env` nunca se versiona.
3. Cargue los datos de demostración. Solo crea o borra documentos con la etiqueta `DEMO`:
   ```bash
   pnpm --filter server seed -- --reset
   ```
4. Levante la API (`http://localhost:3001/api`; Swagger en `/api/docs`, solo en modo desarrollo):
   ```bash
   pnpm dev:server
   ```
5. Levante el cliente en `http://localhost:3000`. Si usa otro puerto, defina `CLIENT_URL` en el servidor para que CORS acepte las cookies:
   ```bash
   pnpm dev:client
   ```

Las credenciales de demostración están en [server/README.md](server/README.md#datos-de-demostración-seed); el recorrido por rol está en [docs/demo-guion.md](docs/demo-guion.md).

## Pruebas y calidad

```bash
pnpm test:server        # unitarias + e2e (MongoDB en memoria, nunca Atlas)
pnpm lint:server
pnpm typecheck:client
pnpm build:client
```

## Documentos clave

- **Diseño del servidor** (seguridad, máquina de estados, modelo de datos, reglas RN): `docs/superpowers/specs/2026-11-17-server-design.md`
- **Contratos de la API del MVP** (fuente de verdad para el cliente): `docs/superpowers/specs/2026-11-19-mvp-api-contracts.md`
