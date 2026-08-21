# Project: Vivienda Coruña — Comprehensive Audit, Optimization & Verification

## Architecture
- **Framework & SSR**: Astro v5 SSR application with node adapter.
- **Frontend / UI**: Astro components (`src/components/*`), pages (`src/pages/*`), layouts (`src/layouts/*`), Tailwind CSS v4 design system tokens, interactive Leaflet map (`src/components/CoverageMap.astro`, `src/components/OpportunityMap.astro`), client-side island hydration with zero unwanted JS overhead.
- **Backend & Storage**: Node 22 native `node:sqlite` in WAL mode, shared data libraries in `scripts/lib/*` (`db.mjs`, `geocoder.mjs`, `dedup.mjs`, `schema.mjs`, `scraper.mjs`, `scoring.mjs`), ingestion scripts (`scripts/fetch-rss.mjs`, `scripts/enrich-firecrawl.mjs`, etc.).
- **Data Integrity & Reconciliation**: `scripts/quality-gate.mjs`, `scripts/reconcile-entities.mjs`, `scripts/repair-opportunity-grounding.mjs`.
- **Security & Quality**: Environment variable security, secret sanitization, npm audit vulnerability fixes, TypeScript/Astro check tooling, 100% passing test suite.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | DB Schema Auto-Migration | Add missing `sources.checkedAt` migration in `scripts/lib/db.mjs` to ensure legacy DB compatibility and allow quality gate to run | M1 (Backend) | survey (Explorer 2, 3) |
| 2 | Data Reconciliation & Grounding | Reconcile entities and repair opportunity grounding in DB | M1 (Backend) | survey (Explorer 2) |
| 3 | Pipeline Ingestion Robustness | Clean up LLM schema coordinate references and ensure network timeout/retry resilience | M1 (Backend) | survey (Explorer 2) |
| 4 | Secret Sanitization in Coolify Deploy | Remove hardcoded Coolify bearer token from `scripts/deploy-coolify.mjs`, enforce `process.env.COOLIFY_TOKEN` | M2 (Security & Tooling) | survey (Explorer 3) |
| 5 | Tooling Dependencies for Check | Add `@astrojs/check` and `typescript` to devDependencies for `npx astro check` | M2 (Security & Tooling) | survey (Explorer 3) |
| 6 | Dependency Vulnerability Remediation | Audit and resolve npm vulnerabilities (`fast-uri`, `js-yaml`, `nanoid`, `postcss`) | M2 (Security & Tooling) | survey (Explorer 3) |
| 7 | Command Palette Global Trigger Fix | Expose `window.openCommandPalette` in `CommandPalette.astro` so header search button works | M3 (Frontend & UI/UX) | survey (Explorer 1, 3) |
| 8 | Map Query Parameter Search Handling | Enable `CoverageMap.astro` to parse and filter by `?q=` URL parameter from MarketThermometer | M3 (Frontend & UI/UX) | survey (Explorer 1) |
| 9 | Design System & Token Alignment | Align `src/lib/statuses.mjs`, `MarketThermometer.astro`, and `OpportunityCard.astro` with `DESIGN.md` tokens | M3 (Frontend & UI/UX) | survey (Explorer 1) |
| 10 | Frontend A11y & Performance Optimization | Add `aria-live` to simulator, optimize font loading in `Layout.astro`, ensure responsive layout integrity | M3 (Frontend & UI/UX) | survey (Explorer 1, 3) |
| 11 | E2E & Unit Test Coverage Expansion | Comprehensive test suites covering migration edge cases, quality gate, scraper resilience, and UI logic | M4 (E2E Testing Track) | survey (Explorer 3) |
| 12 | Final Quality Gate & Astro Verification | Full pass of `npm test`, `npm run quality`, `npx astro check`, and `npm run build` | M5 (Final Verification) | ORIGINAL_REQUEST |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Backend & DB Integrity | Fix `scripts/lib/db.mjs` migration for `checkedAt`, run grounding/reconcile repairs, clean scraper coords | none | DONE |
| M2 | Security, Dependencies & Tooling | Sanitize `deploy-coolify.mjs`, install `@astrojs/check` & `typescript`, patch npm vulnerabilities | none | DONE |
| M3 | Frontend & UI/UX Optimization | Fix Command Palette trigger, map query param filter, align DESIGN.md tokens, a11y & font optimization | M1, M2 | DONE |
| M4 | E2E Testing & Coverage Expansion | Requirement-driven test harness, tests for migrations, quality gate, scrapers, UI logic; publish `TEST_READY.md` | M1, M2 | DONE |
| M5 | Final Verification & Quality Gate | 100% E2E test pass, `npm run quality` pass, `npx astro check` pass, `npm run build` pass, Reviewer & Auditor sign-off | M1, M2, M3, M4 | DONE |

## Interface Contracts
### Backend DB (`scripts/lib/db.mjs`) ↔ Quality Gate (`scripts/quality-gate.mjs`)
- `ensureSchema(db)` MUST idempotently add any missing columns (`sources.checkedAt`, etc.) before any queries run.
- `quality-gate.mjs` expects clean integrity checks, no missing columns, and valid entity references.

### Header Navigation (`Layout.astro`) ↔ Modal (`CommandPalette.astro`)
- `CommandPalette.astro` MUST define `window.openCommandPalette = () => { ... }` or dispatch an event that opens the modal dialog.

### MarketThermometer (`MarketThermometer.astro`) ↔ Map (`CoverageMap.astro`)
- When `CoverageMap.astro` mounts, it reads `new URLSearchParams(window.location.search).get('q')` and filters/focuses the relevant neighborhood or query.

## Code Layout
- `src/components/*` — Astro UI components (Header, CommandPalette, CoverageMap, OpportunityMap, OpportunityCard, MarketThermometer, etc.)
- `src/layouts/Layout.astro` — Main HTML layout, head metadata, global styles, fonts
- `src/pages/*` — Astro pages (index, mapa, oportunidades, etc.)
- `src/lib/*` — Frontend helper utilities and design tokens
- `scripts/lib/*` — Backend ingestion, database, scraper, geocoder, deduplication libraries
- `scripts/*` — Ingestion and maintenance CLI scripts (`quality-gate.mjs`, `fetch-rss.mjs`, `deploy-coolify.mjs`, etc.)
- `tests/*` — Unit and integration test suites executed via `node:test`
