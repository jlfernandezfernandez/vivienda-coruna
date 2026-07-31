# Design System — Vivienda Coruña

## Tokens

### Colores
| Token | Uso | Valor |
|---|---|---|
| `canvas` | Fondo de página | `#f8f8f5` |
| `surface` | Cards, header, footer | `#ffffff` |
| `surface-hover` | Hover de items en listas | `#f5f5f0` |
| `ink` | Texto principal | `#1a1f1c` |
| `ink-muted` | Texto secundario | `#4a5750` |
| `ink-light` | Texto terciario, fechas | `#7a8a7e` |
| `brand-green` | Acciones, links, acentos | `#1a4d33` |
| `brand-green-soft` | Badges, fondos suaves | `#e8f1ec` |
| `brand-orange` | Cambios de precio | `#a8450a` |
| `brand-blue` | Cambios de estado | `#035a8a` |
| `status-ok` | Fuentes operativas | `#15803d` |
| `status-error` | Errores, fuentes caídas | `#c1261f` |

### Radios (sistema de 3 niveles)
| Clase | Radio | Uso |
|---|---|---|
| `rounded-2xl` | 16px | Cards, secciones, contenedores principales |
| `rounded-xl` | 12px | Inputs, sub-cards dentro de cards, promo cards |
| `rounded-lg` | 8px | Badges, chips, botones de navegación, tags |
| `rounded-full` | 999px | Solo puntos de estado (●), nunca badges |

### Sombras
| Token | Uso |
|---|---|
| `shadow-premium` | Cards en reposo (sutil, 2 capas) |
| `shadow-hover` | Cards en hover (un poco más pronunciada) |
| `shadow-sm` | Logo, elementos pequeños |

### Tipografía
- Fuente: Manrope (400, 500, 600, 700, 800)
- Tamaño base: 15px / line-height 1.6
- Pesos: `font-bold` (700) para títulos, `font-semibold` (600) para labels, `font-extrabold` (800) para h1/precio

### Espaciado
| Uso | Valor |
|---|---|
| Card padding | `p-4` |
| Detail page padding | `p-4 sm:p-6` |
| Gap entre cards | `gap-4` |
| Gap entre secciones | `gap-6` |
| Page header margin | `mb-6` |
| Section header margin | `mb-3` |

### Border opacity
| Uso | Opacidad |
|---|---|
| Border suave (cards, dividers) | `border-soft` (7%) |
| Border medio (hover, énfasis) | `border-medium` (14%) |
| Border fuerte (active) | `border-strong` (22%) |
| Badge border accent | `/10` o `/15` |

## Antipatrones a evitar

1. **No mezclar `rounded-full` con `rounded-lg` en badges del mismo tipo.** Todos los badges usan `rounded-lg`.
2. **No usar `shadow-sm` en cards.** Cards usan `shadow-premium` en reposo, `shadow-hover` al hover.
3. **No usar `translate-y` o `scale` en hover de cards.** Solo `border-color` y `box-shadow` cambian.
4. **No usar `font-mono`.** No hay necesidad de monoespaciado.
5. **No usar tokens Tailwind no definidos en el theme** (ej: `bg-green-50`, `text-amber-700`).
6. **No usar `p-5` o `p-6` en cards.** El estándar es `p-4`.
7. **No usar `mb-8` o `mb-10` en page headers.** El estándar es `mb-6`.