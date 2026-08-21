# E2E Test Infra: Vivienda Coruña

## Test Philosophy
- Requirement-driven, opaque-box and functional verification.
- Framework: Native `node:test` runner executing unit, integration, and E2E verification suites.
- Coverage tiers: Category-Partition (Tier 1), Boundary & Corner Cases (Tier 2), Cross-Feature Combinations (Tier 3), Real-World Scenarios (Tier 4).

## Feature Inventory & Test Matrix
| # | Feature | Requirement | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---------|-------------|:------:|:------:|:------:|:------:|
| 1 | DB Schema & Migrations | Backward compatibility, idempotent column additions (`checkedAt`) | 5 | 5 | ✓ | ✓ |
| 2 | Ingestion & Scraper Resilience | Network timeout, 404/500 retry, malformed payload/XML | 5 | 5 | ✓ | ✓ |
| 3 | Quality Gate Verification | SQLite health, orphan detection, grounding checks (`npm run quality`) | 5 | 5 | ✓ | ✓ |
| 4 | Secret & Security Enforcement | No hardcoded tokens, env var fallback validation | 5 | 5 | ✓ | ✓ |
| 5 | Command Palette & Search | Modal open trigger, keyboard shortcut, search filtering | 5 | 5 | ✓ | ✓ |
| 6 | Map Navigation & Query Filtering | URL param parsing (`?q=`), geojson feature selection | 5 | 5 | ✓ | ✓ |
| 7 | Mortgage Simulator A11y & Logic | Loan calculation precision, input boundaries, aria-live updates | 5 | 5 | ✓ | ✓ |
| 8 | Design System Tokens | Consistent color tokens, badge styling, card hover behavior | 5 | 5 | ✓ | ✓ |

## Test Execution Commands
- Unit & Integration Tests: `npm test`
- Data Quality Gate: `npm run quality` (or `node scripts/quality-gate.mjs`)
- Type & Astro Component Checks: `npx astro check`
- Production Build Check: `npm run build`

## Target Acceptance Thresholds
- 100% tests pass on `npm test`.
- Quality gate passes with 0 errors and 0 warnings.
- `npx astro check` passes with 0 errors.
- `npm run build` completes successfully with zero bundle errors.
