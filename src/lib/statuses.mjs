export const STATUSES = [
  {
    id: 'agotada',
    label: 'Agotada/Vendida',
    colors: 'bg-brand-rose-soft text-brand-rose border border-brand-rose/15',
  },
  {
    id: 'ultimas',
    label: 'Últimas unidades',
    colors: 'bg-brand-orange-soft text-brand-orange border border-brand-orange/15',
  },
  {
    id: 'construccion',
    label: 'En construcción',
    colors: 'bg-brand-green-soft text-brand-green border border-brand-green/15',
  },
  {
    id: 'entregada',
    label: 'Entregada',
    colors: 'bg-canvas text-ink-muted border border-border-soft',
  },
  {
    id: 'comercializacion',
    label: 'Comercialización',
    colors: 'bg-brand-green-soft text-brand-green border border-brand-green/15',
  },
  {
    id: 'suelo',
    label: 'Suelo/Proyecto',
    colors: 'bg-brand-purple-soft text-brand-purple border border-brand-purple/15',
  },
  {
    id: 'preventa',
    label: 'En preventa',
    colors: 'bg-brand-blue-soft text-brand-blue border border-brand-blue/15',
  },
];

const DEFAULT_COLORS = 'bg-brand-blue-soft text-brand-blue border border-brand-blue/15';

export function statusColors(label) {
  if (!label) return DEFAULT_COLORS;
  const match = STATUSES.find((s) => s.label.toLowerCase() === label.toLowerCase());
  return match ? match.colors : DEFAULT_COLORS;
}
