# Arquitectura

## Objetivo

Vivienda Coruña separa presentación y adquisición de datos sin añadir infraestructura innecesaria. SQLite sigue siendo la única base de datos y el backend tiene una sola réplica escritora.

```text
Navegador
  │
  ▼
frontend · Astro SSR :4321
  │ HTTP interno, solo lectura
  ▼
backend · Fastify :3000 ─── Firecrawl compartido
  │
  ▼
/data/monitor.db · volumen persistente
```

`database-init` es un proceso de una sola ejecución. Inicializa el volumen desde el seed únicamente si no existe una base y siempre valida integridad y claves foráneas.

## Límites de dependencia

### Frontend

- Vive en `src/`.
- Renderiza HTML, filtros, mapa, metadatos y estados 404/503.
- Consume `BACKEND_INTERNAL_URL` mediante el cliente HTTP server-side.
- No importa `scripts/`, `node:sqlite` ni `node:fs`.
- No clasifica municipios, asocia entidades ni deduplica datos.

### Backend

- Vive en `backend/` y reutiliza el pipeline bajo `scripts/`.
- Expone DTO públicos y operaciones autenticadas.
- Es el único propietario del volumen SQLite.
- No contiene HTML ni decisiones visuales.

### Firecrawl y LLM

Firecrawl es infraestructura externa compartida y se configura con `FIRECRAWL_BASE_URL`. La extracción LLM es opcional: regex y validaciones deterministas siguen funcionando sin `LLM_API_KEY`.

## API v1

Pública:

- `GET /health`
- `GET /ready`
- `GET /api/v1/dashboard`
- `GET /api/v1/opportunities/:id`
- `GET /api/v1/gestoras`
- `GET /api/v1/gestoras/:id`
- `GET /api/v1/cooperatives`
- `GET /api/v1/municipalities/:slug`
- `GET /api/v1/seo/routes`

Operacional, con `Authorization: Bearer <OPERATIONS_API_KEY>`:

- `POST /api/v1/operations/runs`
- `GET /api/v1/operations/runs`
- `GET /api/v1/operations/runs/:id`
- `GET /api/v1/operations/diagnostics`
- `GET /api/v1/operations/sources`

No existe CRUD público, SQL arbitrario ni rollback HTTP.

## Escritura única y publicación atómica

1. Hermes solicita un run `fast` o `deep` con `Idempotency-Key`.
2. El backend crea un registro durable en `pipeline_runs`.
3. Solo un run puede pasar a `running`.
4. Se crea un backup consistente y una base candidata en el mismo volumen.
5. El pipeline trabaja contra la candidata; la base pública no cambia durante llamadas externas.
6. Se ejecutan quality gate, `integrity_check` y `foreign_key_check`.
7. La candidata se promociona mediante rename atómico.
8. En fallo se descarta y la base pública registra el error.

No hay Git, build del frontend ni push dentro del pipeline de producción.

## Seguridad

- La API pública es de solo lectura.
- Las rutas operacionales usan Bearer y comparación constante.
- Los modos de pipeline son un enum; nunca se interpolan en shell.
- Los secretos solo viven en Coolify/GitHub/Hermes.
- Frontend y backend ejecutan sin root; el init recibe únicamente capacidades de propiedad de archivos.
- Producción no publica puertos del host.
- Las imágenes se despliegan con etiquetas inmutables `sha-<commit>`.

## YAGNI

No se usan PostgreSQL, Redis, una cola externa, Kubernetes, ORM ni un segundo backend. Se ampliarían solo si métricas reales invalidan SQLite o la réplica única.
