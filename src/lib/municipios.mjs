export const MUNICIPALITIES = [
  'A Coruña',
  'Arteixo',
  'Cambre',
  'Culleredo',
  'Oleiros',
  'Sada',
  'Betanzos',
  'Bergondo',
  'Carral',
  'Abegondo',
];

export const MUNICIPALITY_SLUGS = {
  'a coruna': 'a-coruna',
  'a coruña': 'a-coruna',
  'arteixo': 'arteixo',
  'cambre': 'cambre',
  'culleredo': 'culleredo',
  'oleiros': 'oleiros',
  'sada': 'sada',
  'betanzos': 'betanzos',
  'bergondo': 'bergondo',
  'carral': 'carral',
  'abegondo': 'abegondo',
};

export function slugify(str = '') {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export function municipalitySlug(name) {
  if (!name) return null;
  const key = name.toLowerCase().trim();
  return MUNICIPALITY_SLUGS[key] || slugify(name);
}

export function resolveMunicipality(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  for (const m of MUNICIPALITIES) {
    if (lower.includes(m.toLowerCase())) return m;
  }
  return null;
}

export function webBase(base = '/') {
  return base.endsWith('/') ? base : `${base}/`;
}
