/**
 * Canonical status master for housing opportunities.
 * Single source of truth — imported by regex extractor, LLM prompt builder,
 * and the Astro frontend. Add a new status here and everything stays in sync.
 *
 * @module statuses
 */

/** @type {Array<{id: string, label: string, patterns: RegExp[], colors: string}>} */
export const STATUSES = [
  {
    id: 'agotada',
    label: 'Agotada/Vendida',
    patterns: [
      /\b(?:agotad[ao]s?|vendid[ao]s?|tod[ao]s? vendid[ao]s?|no quedan|completamente vendido)\b/i,
    ],
    colors: 'bg-red-50 text-red-700 border border-red-100',
  },
  {
    id: 'ultimas',
    label: 'Últimas unidades',
    patterns: [
      /\b(?:[uú]ltimas?\s*(?:unidades|viviendas|disponibles)|quedan\s*poc[ao]s?)\b/i,
    ],
    colors: 'bg-amber-50 text-amber-700 border border-amber-100',
  },
  {
    id: 'construccion',
    label: 'En construcción',
    patterns: [
      /\b(?:en construcci[oó]n|en obras|actualmente en obra|fase de construcci[oó]n)\b/i,
    ],
    colors: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  },
  {
    id: 'entregada',
    label: 'Entregada',
    patterns: [
      /\b(?:entregad[ao]s?|finalizad[ao]s?|ya entregad[ao]s?|llaves entregadas)\b/i,
    ],
    colors: 'bg-slate-100 text-slate-600 border border-slate-200',
  },
  {
    id: 'comercializacion',
    label: 'Comercialización',
    patterns: [
      /\b(?:comercializaci[oó]n|en venta|a la venta|se comercializa|reservas? abiertas?)\b/i,
    ],
    colors: 'bg-green-50 text-green-700 border border-green-100',
  },
  {
    id: 'suelo',
    label: 'Suelo/Proyecto',
    patterns: [
      /\b(?:suelo|proyecto|anteproyecto|licencia|en tramitaci[oó]n|planeamiento|futuro desarrollo)\b/i,
    ],
    colors: 'bg-stone-100 text-stone-600 border border-stone-200',
  },
  {
    id: 'preventa',
    label: 'En preventa',
    patterns: [
      /\b(?:preventa|pre-venta|pre venta|prereservas?|pre-reservas?|pre reservas?|lista de espera)\b/i,
    ],
    colors: 'bg-violet-50 text-violet-700 border border-violet-100',
  },
];

const DEFAULT_COLORS = 'bg-brand-blue-soft text-brand-blue border border-brand-blue/10';

/**
 * Detect the canonical status from free text using regex patterns.
 * Returns the status label string, or null if nothing matches.
 * @param {string} text
 * @returns {string|null}
 */
export function detectStatus(text) {
  for (const status of STATUSES) {
    for (const pattern of status.patterns) {
      if (pattern.test(text)) return status.label;
    }
  }
  return null;
}

/**
 * Get Tailwind CSS classes for a status label.
 * @param {string|null} label
 * @returns {string}
 */
export function statusColors(label) {
  if (!label) return DEFAULT_COLORS;
  const found = STATUSES.find((s) => s.label === label);
  return found ? found.colors : DEFAULT_COLORS;
}

/**
 * All canonical status labels (for LLM enum / JSON schema).
 * @returns {string[]}
 */
export function statusLabels() {
  return STATUSES.map((s) => s.label);
}

/**
 * Human-readable description of all statuses (for LLM system prompt).
 * @returns {string}
 */
export function statusDescription() {
  return STATUSES
    .map((s) => `"${s.label}" = ${describeStatus(s)}`)
    .join(', ');
}

function describeStatus(s) {
  switch (s.id) {
    case 'agotada': return 'ya no quedan viviendas o están todas reservadas/vendidas';
    case 'ultimas': return 'quedan pocas unidades disponibles';
    case 'construccion': return 'en obra actualmente';
    case 'entregada': return 'obra finalizada y llaves entregadas';
    case 'comercializacion': return 'se están vendiendo/reservando activamente';
    case 'suelo': return 'aún no hay obra, está en fase de proyecto/licencia/suelo';
    case 'preventa': return 'reservas o lista de espera antes del lanzamiento oficial';
    default: return '';
  }
}
