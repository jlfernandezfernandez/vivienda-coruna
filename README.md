# Vivienda Coruña

Monitor abierto de cooperativas, vivienda protegida y promociones nuevas en el área metropolitana de A Coruña.

La aplicación prioriza señales tempranas, fuentes verificables y limpieza de datos. No pretende ser un portal inmobiliario generalista.

## Cobertura

- A Coruña
- Arteixo
- Culleredo
- Oleiros
- Cambre
- Sada
- Bergondo
- Carral
- Abegondo

## Arquitectura

```text
Fuentes RSS / IGVS / prensa
              │
              ▼
 backend · Fastify · pipeline ─── Firecrawl compartido
              │
              ▼
 /data/monitor.db · SQLite persistente
              │ API HTTP de solo lectura
              ▼
       frontend · Astro SSR
```

El Compose tiene tres servicios con responsabilidades explícitas:

- `frontend`: presentación, filtros, mapa y SEO; no accede a SQLite.
- `backend`: API, reglas de dominio, pipeline y operaciones para Hermes.
- `database-init`: inicialización/migración idempotente del volumen.

SQLite sigue siendo la única base de datos. No se usan Redis, PostgreSQL ni una cola externa. El backend se despliega con una sola réplica escritora.

Más detalle: [docs/architecture.md](docs/architecture.md).

## Desarrollo

### Requisitos

- Node.js 24 recomendado; mínimo 22.12.
- Docker Compose opcional para ejecutar la topología completa.

```bash
git clone https://github.com/jlfernandezfernandez/vivienda-coruna.git
cd vivienda-coruna
cp .env.example .env
npm ci
npm test
npm run quality
npm run build
```

Topología local:

```bash
docker compose up --build
```

- frontend: `http://127.0.0.1:4321`
- backend: `http://127.0.0.1:3000`

## Datos y pipeline

El pipeline aplica esta secuencia:

1. extracción determinista mediante regex;
2. enriquecimiento LLM opcional;
3. validación literal posterior al LLM;
4. reconciliación de aliases;
5. quality gate, integridad y claves foráneas;
6. promoción atómica de una SQLite candidata.

Firecrawl se configura con `FIRECRAWL_BASE_URL` y permanece como servicio externo compartido. Sin `LLM_API_KEY`, el monitor sigue funcionando con extracción determinista.

En producción el pipeline no ejecuta Git, builds ni pushes. Hermes lo solicita mediante la API operacional autenticada y consulta el resultado durable en `pipeline_runs`.

## API

Lectura pública:

- `/health`
- `/ready`
- `/api/v1/dashboard`
- `/api/v1/opportunities/:id`
- `/api/v1/gestoras`
- `/api/v1/gestoras/:id`
- `/api/v1/cooperatives`
- `/api/v1/municipalities/:slug`

Operación autenticada:

- `POST /api/v1/operations/runs`
- `GET /api/v1/operations/runs`
- `GET /api/v1/operations/runs/:id`
- `GET /api/v1/operations/diagnostics`
- `GET /api/v1/operations/sources`
- `GET /api/v1/operations/curation/candidates`
- `GET /api/v1/operations/curation/reviews`
- `POST /api/v1/operations/curation/reviews`

No existe SQL remoto ni CRUD público.

El curador semanal de Hermes revisa por hash todo dato nuevo o modificado,
registra evidencia y publica mediante un run atómico `curate`. Contrato y
controles: [docs/curation.md](docs/curation.md).

## Despliegue

Producción usa Coolify y dos imágenes GHCR separadas:

- `ghcr.io/jlfernandezfernandez/vivienda-coruna-frontend`
- `ghcr.io/jlfernandezfernandez/vivienda-coruna-backend`

Cada despliegue fija `IMAGE_TAG=sha-<commit>`. GitHub Actions valida, construye y publica las imágenes; Hermes actualiza Coolify y ejecuta los smoke tests.

El workflow legado de GitHub Pages se retiró tras verificar el cutover. El rollback fija Coolify al SHA anterior; la base se restaura solo desde un backup validado.

Runbook completo: [docs/deployment.md](docs/deployment.md).

## Calidad y seguridad

- tests de contrato, dominio y fronteras de arquitectura;
- SQLite con un único escritor;
- secretos solo en Hermes, Coolify y GitHub;
- operaciones con Bearer token y claves de idempotencia;
- contenedores sin root, salvo el init mínimo del volumen;
- imágenes por SHA, sin `latest`;
- backups consistentes y restauración verificable.

## Licencia

[MIT](LICENSE)
