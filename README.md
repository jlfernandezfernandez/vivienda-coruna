# Vivienda Coruña — Monitor de Cooperativas y Obra Nueva

Monitor de código abierto y sin servidores para detectar señales tempranas de **cooperativas de viviendas, promociones de obra nueva y vivienda protegida (VPA/VPP)** en el área metropolitana de A Coruña.

---

## 🎯 Qué cubre

El monitor filtra geográficamente de forma explícita para evitar falsos positivos provinciales y centrarse únicamente en la ciudad y su entorno metropolitano inmediato con resolución precisa por barrio y polígono:

* **A Coruña**: *Xuxán (Parque Ofimático)*, *Someso*, *San Pedro de Visma*, *Novo Mesoiro*, *Los Rosales*, *Matogrande*, *Cuatro Caminos*, *Monte Alto*, *Riazor*, *Ciudad Vieja*, *Eirís*, *Oza*, *Castrillón*, *A Zapateira*, etc.
* **Oleiros**: *Perillo*, *Santa Cruz*, *Bastiagueiro*, *Mera*, *Montrove*, *Iñás*, *Nos*, *Dorneda*, *Xaz*.
* **Culleredo**: *O Burgo*, *O Temple*, *Acea de Ama*, *Vilaboa*, *Portádego*, *Almeiras*.
* **Arteixo**: *Meicende*, *Pastoriza*, *Vilarrodís*, *Sabón*, *Barrañán*.
* **Cambre**: *A Barcala*, *Sigrás*, *Cecebre*.
* **Sada**: *Fontán*, *Carnoedo*, *Soñeiro*.
* **Bergondo**: *Guísamo*, *Gandarío*.
* **Carral** & **Abegondo**.

---

## 🛠️ Arquitectura Híbrida y Datos (GitOps)

El monitor utiliza un enfoque **Flat-File / GitOps** que permite archivar datos de forma ilimitada y servir el frontal de forma 100% gratuita y sin servidores dinámicos:

```text
Fuentes RSS / DOG / IGVS / Prensa Local / Rexistro Xunta
                         ↓
              scripts/fetch-rss.mjs
                         ↓
  [Extractor Regex Gratis (80-90% de noticias sin coste LLM)]
                         ↓
  [OpenRouter / OpenAI LLM (Structured Outputs para casos complejos)]
                         ↓
  [Geocodificador Metropolitano (scripts/lib/geocoder.mjs)]
                         ↓
        src/data/monitor.db  ← [Base de Datos SQLite (Histórico Completo)]
                         ↓
          Astro Build        ← [Compilación Estática en build time]
                         ↓
         GitHub Pages        ← [Hosting Gratuito y sin Servidores]
```

1. **Rastreador**: Consulta tablones oficiales de la Xunta (IGVS, DOG, Contratos Públicos) y canales de prensa local.
2. **Descarga y Scrapeo**: Firecrawl (o descarga HTML directa para fuentes oficiales) para obtener artículos completos sin paywalls ni bloqueos.
3. **Extracción Híbrida Zero-Token + IA**:
   - **Fase 1 (Regex)**: Extrae de forma instantánea precios, dormitorios, baños, viviendas, garaje, trastero, terraza, piscina, ascensor, fecha de entrega y estado.
   - **Fase 2 (LLM Structured Outputs)**: Extrae campos complejos o desestructurados con esquemas JSON estrictos.
4. **Geocodificador Metropolitano (`geocoder.mjs`)**: Resuelve las ubicaciones detectadas a coordenadas WGS84 GPS precisas para alimentar el mapa interactivo.
5. **Rexistro Oficial de Cooperativas**: Importa el CSV abierto de la Xunta de Galicia con diff por CIF para detectar cooperativas constituidas.
6. **Directorio de Gestoras**: Descubre promotoras y gestoras activas, extrayendo su catálogo real y contacto.
7. **Frontend Moderno (Astro + Leaflet + Tailwind v4)**:
   - **Novedades y Alertas**: Feed con filtros avanzados por precio, habitaciones, baños, equipamiento y ubicación.
   - **Mapa Interactivo (`/mapa`)**: Vista espacial completa con pines SVG y popups enriquecidos.
   - **Cooperativas (`/cooperativas`)**: Proyectos en captación de socios y censo oficial.
   - **Gestoras (`/gestoras`)**: Fichas de empresas y promociones asociadas.
   - **100% Responsivo**: Switcher de vista Lista/Mapa para móviles y tablets.

---

## 🚀 Puesta en Marcha y Desarrollo Local

### Requisitos
* Node.js 22 o superior (soporte nativo de `node:sqlite`).

### Instalación
```bash
git clone https://github.com/tu-usuario/vivienda-coruna.git
cd vivienda-coruna
npm ci
```

### Configuración local (`.env`)
```bash
cp .env.example .env
```
Rellena tus credenciales en `.env` (opcionales para desarrollo con datos en caché):
* **`LLM_API_KEY`**: Tu API Key de OpenRouter o OpenAI.
* **`FIRECRAWL_API_KEY`**: API Key de Firecrawl (opcional si usas instancia self-hosted).
* **`FIRECRAWL_BASE_URL`**: URL base de Firecrawl (por defecto `https://api.firecrawl.dev`).

### Comandos de desarrollo
```bash
npm test          # Ejecuta los 21 tests unitarios (geocoder, regex, pipeline, LLM)
npm run refresh   # Ejecuta el rastreador, enriquece datos y actualiza monitor.db
npm run dev       # Inicia el servidor de desarrollo local (Astro)
npm run build     # Compila el HTML estático en /dist
npm run preview   # Previsualiza la compilación de producción localmente
```

---

## 🤖 Automatización en Producción (GitHub Actions)

El flujo [.github/workflows/refresh-data.yml](.github/workflows/refresh-data.yml) se ejecuta automáticamente a diario:
1. Consulta las fuentes y rastrea novedades.
2. Enriquece los datos con regex y LLM.
3. Geocodifica y guarda en SQLite `monitor.db`.
4. Hace commit automático del archivo SQLite en Git.
5. Despliega la versión estática en GitHub Pages.

---

## ⚖️ Licencia

Proyecto distribuido bajo la licencia [MIT](LICENSE).
