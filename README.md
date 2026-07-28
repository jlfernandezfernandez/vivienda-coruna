# Vivienda Coruña — Monitor de Cooperativas y Obra Nueva

Monitor de código abierto y sin servidores para detectar señales tempranas de **cooperativas de viviendas, promociones de obra nueva y vivienda protegida (VPA/VPP)** en el área metropolitana de A Coruña.

---

## 🎯 Qué cubre

El monitor filtra geográficamente de forma explícita para evitar falsos positivos provinciales y centrarse únicamente en la ciudad y su entorno inmediato:

* A Coruña (incluyendo *Xuxán*, *Someso*, *Visma*, *Mesoiro*)
* Oleiros (incluyendo *Xaz*, *Perillo*, *Santa Cruz*, *Mera*)
* Arteixo
* Culleredo (incluyendo *O Burgo*)
* Cambre
* Sada
* Bergondo
* Carral
* Abegondo

---

## 🛠️ Arquitectura Híbrida y Datos (GitOps)

El monitor utiliza un enfoque **Flat-File / GitOps** que permite archivar datos de forma ilimitada y servir el frontal de forma 100% gratuita y sin servidores dinámicos:

```text
Fuentes RSS / IGVS / Prensa Local
              ↓
  scripts/fetch-rss.mjs
              ↓ [Firecrawl (Scrapeo de Artículo Completo)]
              ↓ [OpenRouter LLM (Structured Output)]
      src/data/monitor.db  ← [Base de Datos SQLite (Histórico Completo)]
              ↓
        Astro Build        ← [Compilación Estática (lee SQLite en build time)]
              ↓
       GitHub Pages        ← [Hosting Gratuito y sin Servidores]
```

1. **Rastreador**: Un script en Node.js consulta los tablones oficiales de la Xunta de Galicia y los canales de prensa local.
2. **Raspado avanzado (Firecrawl)**: Scrape, map y búsqueda web usan `FIRECRAWL_BASE_URL`; puede apuntar a la API oficial o a una instancia self-hosted sin autenticación.
3. **Extracción estructurada opcional (OpenRouter)**: Las expresiones regulares resuelven primero los campos deterministas. Si se configura `LLM_API_KEY`, el modelo completa únicamente los campos restantes.
4. **Base de Datos SQLite (`monitor.db`)**: Centraliza los datos en una base de datos relacional nativa en Node.js. Esto conserva todo el historial ilimitado de cooperativas y licencias sin perder las noticias que van saliendo de los feeds RSS.
5. **Astro + GitHub Pages**: Cada compilación lee SQLite en modo solo lectura y genera directamente el HTML estático con búsquedas, mapa y directorio de gestoras.

---

## 🚀 Puesta en Marcha y Desarrollo Local

### Requisitos
* Node.js 22 o superior (necesario para el soporte nativo del módulo `node:sqlite`).

### Instalación
```bash
git clone https://github.com/jlfernandezfernandez/vivienda-coruna.git
cd vivienda-coruna
npm ci
```

### Configuración local (`.env`)
Crea un archivo `.env` en la raíz copiando la plantilla:
```bash
cp .env.example .env
```
Rellena tus credenciales en el archivo `.env`:
* **`LLM_API_KEY`**: Tu API Key de OpenRouter.
* **`FIRECRAWL_API_KEY`**: Token opcional; puede omitirse en una instancia self-hosted sin autenticación.
* **`FIRECRAWL_BASE_URL`**: URL de tu Firecrawl self-hosted (opcional, por defecto la API oficial `https://api.firecrawl.dev`).

### Comandos de desarrollo
```bash
npm test                         # Tests de clasificación, grounding y deduplicación
npm run dev                      # Servidor local de Astro (solo lectura)
npm run build                    # Compila el HTML estático final en /dist
scripts/run-pipeline.sh fast     # Refresco rápido serializado
scripts/run-pipeline.sh deep     # Refresco completo, validación y publicación
```

Los scripts que escriben en SQLite son internos y rechazan ejecuciones directas. Usa siempre `run-pipeline.sh`: adquiere el mutex, restaura una ejecución interrumpida, valida, prueba, construye y publica.

---

## Automatización en producción

La captura se agenda exclusivamente mediante dos cron jobs de Hermes Agent:

- **Profundo:** 08:30, una vez al día.
- **Rápido:** 12:30, 16:30 y 20:30.

Ambos ejecutan `scripts/run-pipeline.sh` y comparten el mismo mutex. OpenRouter es opcional: sin `LLM_API_KEY` el pipeline conserva extracción regex validada y marca `regex-no-llm`; al añadir la clave, esas señales se enriquecen automáticamente una vez.

GitHub Actions no captura ni modifica datos. El único workflow, `.github/workflows/deploy.yml`, construye y despliega GitHub Pages después de cada push a `master`.

---

## ⚖️ Licencia

Proyecto distribuido bajo la licencia [MIT](LICENSE).
