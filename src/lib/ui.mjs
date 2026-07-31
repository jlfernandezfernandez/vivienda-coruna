export function siteBase(baseUrl = '/') {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

export function statusToneClass(tone) {
  if (tone === 'positive') return 'bg-brand-green-soft text-brand-green border border-brand-green/10';
  if (tone === 'warning') return 'bg-brand-orange-soft text-brand-orange border border-brand-orange/10';
  return 'bg-canvas text-ink-muted border border-border-soft';
}
