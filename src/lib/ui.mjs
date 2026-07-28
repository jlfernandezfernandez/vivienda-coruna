export function siteBase(baseUrl = '/') {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

export function statusToneClass(tone) {
  if (tone === 'positive') return 'bg-green-50 text-green-700 border border-green-100';
  if (tone === 'warning') return 'bg-amber-50 text-amber-700 border border-amber-100';
  return 'bg-brand-blue-soft text-brand-blue border border-brand-blue/10';
}
