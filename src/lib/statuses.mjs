export const STATUSES = [
  {
    id: 'agotada',
    label: 'Agotada/Vendida',
    colors: 'bg-red-50 text-red-700 border border-red-100',
  },
  {
    id: 'ultimas',
    label: 'Últimas unidades',
    colors: 'bg-amber-50 text-amber-700 border border-amber-100',
  },
  {
    id: 'construccion',
    label: 'En construcción',
    colors: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  },
  {
    id: 'entregada',
    label: 'Entregada',
    colors: 'bg-slate-100 text-slate-600 border border-slate-200',
  },
  {
    id: 'comercializacion',
    label: 'Comercialización',
    colors: 'bg-green-50 text-green-700 border border-green-100',
  },
  {
    id: 'suelo',
    label: 'Suelo/Proyecto',
    colors: 'bg-stone-100 text-stone-600 border border-stone-200',
  },
  {
    id: 'preventa',
    label: 'En preventa',
    colors: 'bg-violet-50 text-violet-700 border border-violet-100',
  },
];

const DEFAULT_COLORS = 'bg-brand-blue-soft text-brand-blue border border-brand-blue/10';

export function statusColors(label) {
  if (!label) return DEFAULT_COLORS;
  const match = STATUSES.find((s) => s.label.toLowerCase() === label.toLowerCase());
  return match ? match.colors : DEFAULT_COLORS;
}
