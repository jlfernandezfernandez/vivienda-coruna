import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('src/data/monitor.db');

console.log('=== DUPLICADOS POR URL ===');
const dups = db.prepare("SELECT url, count(*) as n FROM opportunities GROUP BY url HAVING n > 1 ORDER BY n DESC").all();
console.log('  URLs duplicadas: ' + dups.length);
dups.slice(0, 10).forEach(d => console.log('  [' + d.n + 'x] ' + d.url.slice(0, 100)));

console.log('\n=== DUPLICADOS POR TÍTULO SIMILAR ===');
const all = db.prepare('SELECT id, title, url, sourceKind FROM opportunities').all();
const seen = new Map();
all.forEach(o => {
  const key = o.title.toLowerCase().replace(/[^a-záéíóúñ0-9]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!seen.has(key)) seen.set(key, []);
  seen.get(key).push(o);
});
let dupCount = 0;
for (const [key, items] of seen) {
  if (items.length > 1) {
    dupCount++;
    if (dupCount <= 15) {
      console.log('  [' + items.length + 'x] "' + key.slice(0, 70) + '"');
      items.forEach(i => console.log('    - ' + i.sourceKind + ': ' + i.url.slice(0, 80)));
    }
  }
}
console.log('  Total grupos duplicados: ' + dupCount);

console.log('\n=== PRECIOS ANÓMALOS ===');
const weird = db.prepare('SELECT title, precioMin, precioMax FROM opportunities WHERE precioMin IS NOT NULL AND (precioMin < 1000 OR precioMin > 2000000)').all();
weird.forEach(o => console.log('  €' + o.precioMin + ' - ' + o.title.slice(0, 80)));

console.log('\n=== SIN TIPO ===');
const noType = db.prepare("SELECT count(*) as n FROM opportunities WHERE type IS NULL OR type = ''").all()[0].n;
console.log('  Sin tipo: ' + noType);

console.log('\n=== GESTORAS SIN PROMOCIONES ===');
const gestoras = db.prepare('SELECT id, name FROM gestoras').all();
const promoGestoraIds = new Set(db.prepare('SELECT DISTINCT gestoraId FROM gestora_promotions').all().map(r => r.gestoraId));
gestoras.forEach(g => {
  if (!promoGestoraIds.has(g.id)) console.log('  ❌ ' + g.name + ' (' + g.id + ')');
});

console.log('\n=== GESTORAS SIN CONTACTO ===');
gestoras.forEach(g => {
  const c = db.prepare('SELECT phone, email, address FROM gestoras WHERE id = ?').all(g.id)[0];
  if (!c.phone && !c.email) console.log('  ❌ ' + g.name + ' - sin teléfono ni email');
});
