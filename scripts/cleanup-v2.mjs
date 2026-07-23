import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('src/data/monitor.db');

// ── 1. ELIMINAR BASURA: portales, reformas, subastas, formularios ──
console.log('=== ELIMINANDO BASURA ===');
const garbagePatterns = [
  '%yaencontre%', '%Nestoria%', '%habitaclia%', '%fotocasa%', '%idealista%',
  '%Reforma De Viviendas%', '%reformantia%', '%SubastasDelBOE%', '%Subastas Publicas%',
  '%tramitesayuntamiento%', '%solicitud de licencias de obra para reforma%',
  '%Promociones de obra nueva en%', '%Inmuebles de obra nueva en%',
  '%Obra Nueva en%', '%Obra nueva en% - %Promociones%', '%Obra nueva con entrega para%',
];
let removed = 0;
for (const pattern of garbagePatterns) {
  const result = db.prepare('DELETE FROM opportunities WHERE title LIKE ? OR url LIKE ?').run(pattern, pattern);
  if (result.changes > 0) {
    console.log('  ✗ ' + result.changes + ' eliminados: ' + pattern.replace(/%/g, ''));
    removed += result.changes;
  }
}
console.log('  Total eliminados: ' + removed);

// ── 2. ARREGLAR PROMOTORA ROTA ──
console.log('\n=== ARREGLANDO PROMOTORA ROTA ===');
const fixed = db.prepare("UPDATE opportunities SET promotora = 'Gestogar' WHERE promotora LIKE '%de las cooperativas de Xaz%'").run();
console.log('  Corregidas: ' + fixed.changes);

// ── 3. AÑADIR DETALLES A PROMOS DE GESTOGAR ──
console.log('\n=== COMPLETANDO DETALLES GESTOGAR ===');
const gestogarDetails = {
  'Xardíns da Rabadeira': 'Pisos de 2 y 3 dormitorios, 1-2 plazas de garaje y trastero. VPA y libres. Desde 185.300€ + IVA.',
  'Luces de Mera': 'Cooperativa de viviendas en Mera. Promoción agotada.',
  'A Canteira de Perillo': 'Cooperativa de viviendas en Perillo. Promoción agotada.',
  'Bosques de Xaz': 'Cooperativa de viviendas en Xaz, Oleiros. Promoción agotada.',
  'Alto Paraíso': 'Cooperativa de viviendas en Oleiros. Promoción agotada.',
};
for (const [name, details] of Object.entries(gestogarDetails)) {
  db.prepare('UPDATE gestora_promotions SET details = ? WHERE gestoraId = ? AND name = ?').run(details, 'gestogar', name);
  console.log('  ✓ ' + name);
}

// ── 4. NORMALIZAR ESTADOS: "Sin confirmar" → null ──
console.log('\n=== NORMALIZANDO ESTADOS ===');
const normalized = db.prepare("UPDATE opportunities SET status = NULL WHERE status = 'Sin confirmar'").run();
console.log('  Normalizados: ' + normalized.changes);

// ── 5. RESUMEN ──
console.log('\n=== RESUMEN FINAL ===');
const opps = db.prepare('SELECT count(*) as n FROM opportunities').all()[0].n;
const enriched = db.prepare('SELECT count(*) as n FROM opportunities WHERE enriched=1').all()[0].n;
const gestoras = db.prepare('SELECT count(*) as n FROM gestoras').all()[0].n;
const promos = db.prepare('SELECT count(*) as n FROM gestora_promotions').all()[0].n;
const withStatus = db.prepare('SELECT count(*) as n FROM opportunities WHERE status IS NOT NULL').all()[0].n;
console.log('Oportunidades: ' + opps + ' | Enriquecidas: ' + enriched + ' | Con estado: ' + withStatus);
console.log('Gestoras: ' + gestoras + ' | Promociones: ' + promos);
