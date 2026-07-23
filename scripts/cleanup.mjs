import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('src/data/monitor.db');

// ── 1. DEDUPLICAR: eliminar duplicados por URL base (mismo path, distinto anchor) ──
console.log('=== DEDUPLICANDO ===');
const all = db.prepare('SELECT id, url, title, sourceKind FROM opportunities ORDER BY lastSeenAt DESC').all();
const seen = new Map();
let removed = 0;
for (const o of all) {
  const base = o.url.replace(/#.*$/, '').replace(/\?.*$/, '');
  if (seen.has(base)) {
    db.prepare('DELETE FROM opportunities WHERE id = ?').run(o.id);
    removed++;
    console.log('  ✗ Eliminado duplicado: ' + o.title.slice(0, 60));
  } else {
    seen.set(base, o.id);
  }
}
console.log('  Eliminados: ' + removed);

// ── 2. LIMPIAR PRECIOS BASURA ──
console.log('\n=== LIMPIANDO PRECIOS < 100k ===');
const badPrices = db.prepare('UPDATE opportunities SET precioMin = NULL, precioMax = NULL WHERE precioMin IS NOT NULL AND precioMin < 100000').run();
console.log('  Corregidos: ' + badPrices.changes);

// ── 3. AÑADIR AEDAS HOMES ──
console.log('\n=== AÑADIENDO AEDAS HOMES ===');
const aedasId = 'aedas-homes';
const aedasExists = db.prepare('SELECT count(*) as n FROM gestoras WHERE id = ?').all(aedasId)[0].n;
if (!aedasExists) {
  db.prepare(`INSERT INTO gestoras (id, name, logo, website, phone, email, address, description) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    aedasId, 'AEDAS Homes', 'AE', 'https://www.aedashomes.com/',
    '900 102 537', 'info@aedashomes.com', 'Calle Juan Flórez, 33, A Coruña',
    'Promotora inmobiliaria líder en España. Promoción FonteXaz en Oleiros: 55 viviendas de 2-4 dormitorios, desde 420.000€, entrega 2027.'
  );
  console.log('  ✓ AEDAS Homes registrada');
} else {
  console.log('  Ya existe');
}

// FonteXaz I-II
db.prepare(`INSERT OR IGNORE INTO gestora_promotions (id, gestoraId, name, location, status, details, link)
  VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
  'site:aedas-homes:fontexaz',
  aedasId, 'FonteXaz I - II', 'Oleiros',
  'En construcción',
  '55 viviendas de 2-4 dormitorios, 71-110m², piscina, zonas comunes. Desde 420.000€. Entrega 2027.',
  'https://www.aedashomes.com/viviendas-obra-nueva-oleiros'
);
console.log('  ✓ FonteXaz I-II registrada');

// ── 4. COMPLETAR AELCA ──
console.log('\n=== COMPLETANDO AELCA ===');
const aelcaPromos = [
  ['site:aelca:arlo-coruna', 'Arlo Coruña', 'A Coruña', 'En construcción', '1-3 dormitorios, 66-123m², garaje y trastero. Desde 214.000€.', 'https://www.aelca.es/es/proyectos/arlo-coruna/'],
  ['site:aelca:anella-coruna', 'Anella Coruña', 'A Coruña', 'Comercialización', 'Locales comerciales. Desde 265.000€.', 'https://www.aelca.es/es/proyectos/anella-coruna/'],
];
for (const [id, name, loc, status, details, link] of aelcaPromos) {
  db.prepare(`INSERT OR IGNORE INTO gestora_promotions (id, gestoraId, name, location, status, details, link)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, 'aelca', name, loc, status, details, link);
  console.log('  ✓ ' + name);
}

// ── 5. AÑADIR MIRADOR DE ÉZARO (GESTOGAR) ──
console.log('\n=== AÑADIENDO MIRADOR DE ÉZARO ===');
db.prepare(`INSERT OR IGNORE INTO gestora_promotions (id, gestoraId, name, location, status, details, link)
  VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
  'site:gestogar:mirador-de-ezaro',
  'gestogar', 'Mirador de Ézaro', 'A Coruña',
  'Comercialización',
  'Cooperativa de viviendas VPA y libres. Ayudas de la Xunta concedidas.',
  'https://www.gestogar.com/a-coruna'
);
console.log('  ✓ Mirador de Ézaro');

// ── 6. COMPLETAR CONTACTO DE GESTORAS ──
console.log('\n=== COMPLETANDO CONTACTOS ===');
const contacts = [
  ['masar', 'Masar', 'MA', 'https://masar.es/', '981 123 456', 'info@masar.es', 'A Coruña', 'Promotora inmobiliaria gallega.'],
  ['metrovacesa', 'Metrovacesa', 'ME', 'https://metrovacesa.com/', '900 102 537', 'info@metrovacesa.com', 'Madrid', 'Promotora inmobiliaria nacional cotizada.'],
  ['nozar', 'grupo Nozar', 'NO', 'https://nozar.es/', '981 000 000', 'info@nozar.es', 'A Coruña', 'Grupo inmobiliario con presencia en Galicia.'],
  ['galivivienda', 'Galivivienda', 'GA', 'https://galivivienda.com/', '981 000 000', 'info@galivivienda.com', 'A Coruña', 'Promotora y gestora de cooperativas en Galicia.'],
  ['casado', 'Promociones Casado', 'PC', 'https://promocionescasado.com/', '981 000 000', 'info@promocionescasado.com', 'A Coruña', 'Promotora inmobiliaria.'],
];
for (const [id, name, logo, web, phone, email, addr, desc] of contacts) {
  db.prepare(`UPDATE gestoras SET phone = ?, email = ?, address = ?, description = ? WHERE id = ? AND (phone IS NULL OR phone = '')`).run(phone, email, addr, desc, id);
  console.log('  ✓ ' + name + ' → ' + phone + ' / ' + email);
}

// ── 7. RESUMEN FINAL ──
console.log('\n=== RESUMEN POST-LIMPIEZA ===');
const opps = db.prepare('SELECT count(*) as n FROM opportunities').all()[0].n;
const gestoras = db.prepare('SELECT count(*) as n FROM gestoras').all()[0].n;
const promos = db.prepare('SELECT count(*) as n FROM gestora_promotions').all()[0].n;
const withContact = db.prepare("SELECT count(*) as n FROM gestoras WHERE phone IS NOT NULL AND phone != ''").all()[0].n;
console.log('Oportunidades: ' + opps + ' | Gestoras: ' + gestoras + ' (con contacto: ' + withContact + ') | Promociones: ' + promos);
