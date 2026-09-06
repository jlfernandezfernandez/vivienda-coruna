# Vivienda Coruña — Monitor de Cooperativas y Obra Nueva

Monitor de código abierto para detectar señales tempranas de **cooperativas de viviendas, promociones de obra nueva y vivienda protegida (VPA/VPP)** en el área metropolitana de A Coruña.

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

## Encontrar vivienda

- **Novedades y mapa:** oportunidades localizadas y búsqueda por barrio o municipio, también sin tildes.
- **Gestoras:** filtra por nombre, zona, municipio del proyecto y precio máximo. Cada promoción enlaza con su ficha y el contacto de la gestora.
- **Cooperativas:** distingue los proyectos con captación confirmada, las entidades del registro y las señales de prensa. La inscripción o una noticia no prueban que haya plazas.
- Los filtros permiten mostrar solo captación confirmada y excluir promociones agotadas o entregadas. Las promociones sin precio siguen visibles como «precio a consultar»; la aportación inicial no se utiliza como precio total.

## Arquitectura

Astro renderiza las páginas en el servidor y consulta una API Fastify de solo lectura. El backend es el único escritor de SQLite, almacenado en un volumen persistente.

```text
Fuentes públicas / IGVS / DOG / prensa / Rexistro / gestoras
                         ↓
              Backend y pipeline de datos
                         ↓
              SQLite en volumen persistente
                         ↓
              API Fastify → Astro SSR → navegador
```

El pipeline combina extracción determinista, enriquecimiento opcional con LLM y geocodificación. Valida una base candidata antes de publicarla de forma atómica. Consulta [arquitectura](docs/architecture.md) para los contratos y la operación.

## Desarrollo local

Requiere Node.js 22.12 o posterior.

```bash
git clone https://github.com/jlfernandezfernandez/vivienda-coruna.git
cd vivienda-coruna
npm ci
cp .env.example .env
```

Configura `DB_PATH`, `BACKEND_INTERNAL_URL` y una `OPERATIONS_API_KEY` local de al menos 32 caracteres. En dos terminales:

```bash
node --env-file=.env backend/server.mjs
```

```bash
npm run dev
```

El enriquecimiento LLM es opcional: requiere configurar conjuntamente `LLM_BASE_URL`, `LLM_API_KEY` y `LLM_MODEL`. Firecrawl se configura con `FIRECRAWL_BASE_URL` y, si corresponde, `FIRECRAWL_API_KEY`.

```bash
npm test          # Pruebas de API, extracción, filtros y persistencia
npm run check     # Comprobación de Astro y TypeScript
npm run build     # Compilación del frontend SSR
npm run quality   # Validación de la base de datos configurada
```

## Producción

[GitHub Actions](.github/workflows/containers.yml) construye imágenes con etiquetas inmutables para Coolify. La adquisición de datos se ejecuta mediante operaciones autenticadas del backend. El pipeline no hace commits de SQLite ni reconstruye el frontend para publicar datos.

## ⚖️ Licencia

Proyecto distribuido bajo la licencia [MIT](LICENSE).
