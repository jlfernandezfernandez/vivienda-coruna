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
    src/data/monitor.json  ← [Exportación Estática (Últimas 150 Novedades)]
              ↓
        Astro Build        ← [Compilación Estática]
              ↓
       GitHub Pages        ← [Hosting Gratuito y sin Servidores]
```

1. **Rastreador**: Un script en Node.js consulta los tablones oficiales de la Xunta de Galicia y los canales de prensa local.
2. **Raspado Avanzado (Firecrawl)**: Scrape, map y búsqueda web van por Firecrawl (`FIRECRAWL_BASE_URL`, por defecto la API oficial) (por defecto la API oficial de Firecrawl; opcionalmente tu instancia self-hosted vía `FIRECRAWL_BASE_URL`) que descarga el artículo completo en markdown limpio, saltándose paywalls y renderizaciones complejas.
3. **Extracción por IA (OpenRouter)**: El modelo `openai/gpt-4o-mini` analiza el texto completo de la noticia y extrae un JSON estructurado con el precio de salida, número de dormitorios, baños, promotora y equipamiento (garaje, trastero, terraza).
4. **Base de Datos SQLite (`monitor.db`)**: Centraliza los datos en una base de datos relacional nativa en Node.js. Esto conserva todo el historial ilimitado de cooperativas y licencias sin perder las noticias que van saliendo de los feeds RSS.
5. **Astro + GitHub Pages**: En cada compilación, se exportan las últimas 150 oportunidades a un JSON estático para renderizar el frontal con búsquedas instantáneas, mapa y un **Directorio de Gestoras de Cooperativas** (Gestogar/Nosogar, Xesta, Galivivienda, Libra GP) integrado.

---

## 🚀 Puesta en Marcha y Desarrollo Local

### Requisitos
* Node.js 22 o superior (necesario para el soporte nativo del módulo `node:sqlite`).

### Instalación
```bash
git clone https://github.com/tu-usuario/vivienda-coruna.git
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
* **`FIRECRAWL_API_KEY`**: API Key de tu instancia de Firecrawl (necesaria para scrape/map/search).
* **`FIRECRAWL_BASE_URL`**: URL de tu Firecrawl self-hosted (opcional, por defecto la API oficial `https://api.firecrawl.dev`).

### Comandos de desarrollo
```bash
npm test          # Ejecuta los tests de clasificación y reglas geográficas
npm run refresh   # Ejecuta el rastreador, consulta la IA y actualiza la base de datos SQLite
npm run dev       # Arranca el servidor de desarrollo local (Astro)
npm run build     # Compila el HTML estático final en /dist
```

---

## 🤖 Configuración en Producción (GitHub Actions)

Para que el monitor se ejecute solo y se actualice automáticamente en internet todos los días (a las 10:17 CET), debes configurar las credenciales en tu repositorio de GitHub:

1. Ve a tu repositorio en GitHub.
2. Navega a **Settings** (Configuración) -> **Secrets and variables** -> **Actions**.
3. Añade los siguientes dos **Repository Secrets**:
   * **`LLM_API_KEY`**: Tu API Key de OpenRouter.
   * **`FIRECRAWL_API_KEY`**: Tu API Key de Firecrawl.

El flujo de trabajo [.github/workflows/refresh-data.yml](.github/workflows/refresh-data.yml) se encargará de realizar las consultas diarias, guardar los nuevos datos en el archivo SQLite, confirmar los cambios mediante un commit automático en Git y redesplegar el frontal en tu página de GitHub Pages de forma transparente.

---

## ⚖️ Licencia

Proyecto distribuido bajo la licencia [MIT](LICENSE).
