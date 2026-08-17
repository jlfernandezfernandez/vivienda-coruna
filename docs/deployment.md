# Despliegue y operación

## Desarrollo local

```bash
cp .env.example .env
npm ci
npm test
npm run quality
docker compose up --build
```

Servicios locales:

- frontend: `http://127.0.0.1:4321`
- backend: `http://127.0.0.1:3000`

## Producción

Coolify ejecuta `compose.production.yml` con tres servicios:

- `database-init`
- `backend`
- `frontend`

Variables requeridas:

- `IMAGE_TAG=sha-<commit completo>`
- `OPERATIONS_API_KEY`
- `FIRECRAWL_BASE_URL`

Variables opcionales:

- `FIRECRAWL_API_KEY`
- `LLM_BASE_URL`
- `LLM_API_KEY`
- `LLM_MODEL`

Dominios internos asignados al servicio Coolify (el puerto es el del contenedor):

- frontend: `http://vivienda.jordixlab.com:4321`
- backend: `http://vivienda-api.jordixlab.com:3000`

NPMplus es el edge público: termina TLS con el certificado wildcard y reenvía ambos hosts a Traefik de Coolify (`192.168.0.73:80`) conservando la cabecera `Host`. Coolify no publica directamente los puertos 3000/4321 en la LAN.

## CI/CD y Despliegue en Coolify

`.github/workflows/containers.yml`:

1. instala dependencias;
2. ejecuta tests, quality gate y build SSR;
3. valida Compose;
4. construye ambos Dockerfiles;
5. publica dos imágenes GHCR por SHA (`vivienda-coruna-backend:sha-<commit>` y `vivienda-coruna-frontend:sha-<commit>`).

### Despliegue con un comando (`npm run deploy`)

Para desplegar la versión actual del repositorio en el clúster Coolify:

```bash
npm run deploy
```

O especificando un tag de commit concreto:

```bash
node scripts/deploy-coolify.mjs sha-<commit-sha>
```

El script [`scripts/deploy-coolify.mjs`](../scripts/deploy-coolify.mjs):
1. Actualiza `IMAGE_TAG` en el servicio Coolify (`o4m4tfd2zgjiq38qqug43p4p`) vía REST API (`PATCH /api/v1/services/{uuid}/envs`).
2. Desencadena el redespliegue de los contenedores (`POST /api/v1/services/{uuid}/start`).
3. Ejecuta smoke tests automáticos contra `https://vivienda-api.jordixlab.com/health`, `/ready` y `https://vivienda.jordixlab.com/mapa` hasta verificar la versión activa.

## Cutover inicial

1. Ejecutar por última vez el pipeline antiguo y comprobar quality gate.
2. Pausar los dos crons antiguos; no eliminarlos aún.
3. Verificar que no hay escritor activo.
4. Obtener un backup consistente de la SQLite y registrar SHA-256, tamaño, conteos, integridad y FK.
5. Importar el backup al volumen mediante `database-init`.
6. Desplegar frontend/backend y comparar conteos y rutas con Pages.
7. Configurar NPMplus para ambos dominios hacia Coolify conservando el Host.
8. Probar home, detalle, mapa, API, 404, 503 y operaciones autenticadas.
9. Cambiar los crons Hermes para llamar a la API.
10. Conservar la SQLite antigua congelada y su hash al menos siete días; retirar Pages tras verificar la estabilización.

## Operación con Hermes

Crear ejecución:

```bash
curl --fail --silent --show-error \
  -X POST \
  -H "Authorization: Bearer $OPERATIONS_API_KEY" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"mode":"fast"}' \
  https://vivienda-api.jordixlab.com/api/v1/operations/runs
```

Hermes debe consultar la URL `Location` hasta un estado terminal. No debe acceder al volumen, ejecutar SQL remoto ni llamar scripts dentro del contenedor.

## Backup

- Backup consistente antes de cada run.
- Validación de integridad/FK y hash posterior.
- Retención local limitada y copia cifrada fuera del volumen.
- Prueba periódica de restauración.

Un snapshot no probado no cuenta como backup.

## Rollback

Código:

1. fijar `IMAGE_TAG` al SHA anterior;
2. reiniciar el recurso;
3. verificar `/ready` y la web.

Datos:

1. pausar operaciones;
2. conservar la base fallida;
3. restaurar un backup validado mediante el init/runbook;
4. comprobar integridad, FK y conteos antes de reabrir escrituras.

Si una imagen nueva falla, fijar Coolify al SHA anterior. Nunca deben quedar activos simultáneamente dos escritores ni restaurarse datos salvo corrupción o migración incompatible.
