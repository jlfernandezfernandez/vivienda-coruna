import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  detectLocation,
  detectStatus,
  extractPublishedAt,
  isActionableMarketAlert,
  isFreshMarketAlert,
  isRelevantTitle,
  normalizeGestoraId,
  normalizeUrl,
  parseCooperativeRegistryCsv,
  toOpportunity,
} from '../scripts/lib/monitor.mjs';
import { classifyPromotionLocation } from '../scripts/lib/municipios.mjs';
import { finalizeRegistryImport, getAllCooperatives, getAllOpportunities, getRecentEvents, saveCooperative } from '../scripts/lib/db.mjs';

test('acepta únicamente A Coruña ciudad y su entorno inmediato', () => {
  const valid = [
    ['Construcción de 40 VPP en el municipio de A Coruña', 'A Coruña'],
    ['A Coruña - Sorteo de 14 viviendas de VPP en Xuxán', 'A Coruña'],
    ['Parcela residencial para vivienda protegida en Arteixo', 'Arteixo'],
    ['Cooperativa de vivendas en Perillo', 'Perillo'],
    ['Cohousing en Carral para vivienda colaborativa', 'Carral'],
    ['Autopromoción de vivienda en Abegondo', 'Abegondo'],
    ['Promoción nueva de obra nueva en Carral', 'Carral'],
    ['Promoción pública de vivienda en O Burgo', 'O Burgo'],
    ['VPP no Concello de Oleiros', 'Oleiros'],
  ];

  for (const [title, location] of valid) {
    assert.equal(isRelevantTitle(title), true, title);
    assert.equal(detectLocation(title), location);
  }
});

test('no confunde la provincia de A Coruña con la ciudad', () => {
  const invalid = [
    '58 VPP en O Bertón-Ferrol (A Coruña)',
    'Vivendas protexidas en Santiago de Compostela (A Coruña)',
    'VPP en Vigo (Pontevedra)',
    'Compra de vehículos híbridos en Arteixo',
  ];

  for (const title of invalid) assert.equal(isRelevantTitle(title), false, title);
});

test('descarta alertas de mercado antiguas', () => {
  assert.equal(isFreshMarketAlert({ publishedAt: '2026-07-01T00:00:00Z' }, new Date('2026-07-20T00:00:00Z')), true);
  assert.equal(isFreshMarketAlert({ publishedAt: '2025-12-01T00:00:00Z' }, new Date('2026-07-20T00:00:00Z')), false);
  assert.equal(isActionableMarketAlert({ title: 'Costes y demanda de vivienda en A Coruña', publishedAt: '2026-07-01T00:00:00Z' }, new Date('2026-07-20T00:00:00Z')), false);
  assert.equal(isActionableMarketAlert({ title: 'Nueva cooperativa de viviendas en Oleiros', publishedAt: '2026-07-01T00:00:00Z' }, new Date('2026-07-20T00:00:00Z')), true);
});

test('recupera la fecha editorial de metadatos y URLs de prensa', () => {
  assert.equal(extractPublishedAt({ publishedDate: '2026-06-15' }), '2026-06-15T00:00:00.000Z');
  assert.equal(extractPublishedAt('https://medio.gal/noticia/2025/12/01/proyecto/'), '2025-12-01T12:00:00.000Z');
  assert.equal(extractPublishedAt('https://medio.gal/0003_202510H26C10991.htm'), '2025-10-26T12:00:00.000Z');
  assert.equal(extractPublishedAt('https://medio.gal/economia/20250207/proyecto.html'), '2025-02-07T12:00:00.000Z');
  assert.equal(extractPublishedAt('https://medio.gal/noticia/sin-fecha'), null);
  assert.equal(extractPublishedAt('https://medio.gal/noticia/2025/02/31/imposible/'), null);
});

test('normaliza enlaces y extrae estado', () => {
  assert.equal(
    normalizeUrl('https://www.contratosdegalicia.gal//licitacion?N=123'),
    'https://www.contratosdegalicia.gal/licitacion?N=123',
  );
  assert.equal(detectStatus('Estado: En curso Órgano de contratación: IGVS'), 'En curso');
});

test('convierte un item RSS al esquema público', () => {
  const result = toOpportunity(
    {
      title: 'Obras para 20 vivendas de promoción pública en Perillo',
      link: 'https://example.com//expediente/20',
      pubDate: '2026-07-19T09:00:00Z',
      contentSnippet: 'Estado: En curso Órgano de contratación: IGVS',
    },
    'CPG · IGVS',
    '2026-07-20T09:00:00.000Z',
  );

  assert.equal(result.location, 'Perillo');
  assert.equal(result.type, 'Vivienda protegida');
  assert.equal(result.status, 'En curso');
  assert.equal(result.url, 'https://example.com/expediente/20');

  const igvs = toOpportunity(
    { title: '15/07/2026 A Coruña - Informe del sorteo de viviendas de VPP en Xuxán', link: 'https://example.com/xuxan', pubDate: '15/07/2026' },
    'IGVS · Adjudicaciones y sorteos',
  );
  // VPP adjudication notices are now filtered out (VPP_NOISE_PATTERN)
  assert.equal(igvs, null);
});

test('normaliza el nombre de una promotora al mismo id pese a variaciones de redacción del LLM', () => {
  assert.equal(normalizeGestoraId('grupo Nozar'), normalizeGestoraId('Nozar'));
  assert.equal(normalizeGestoraId('Nozar S.A.'), normalizeGestoraId('Nozar'));
  assert.equal(normalizeGestoraId('Promociones Casabriz'), normalizeGestoraId('Casabriz'));
});

test('filtra del rexistro solo cooperativas de vivienda del área metropolitana', () => {
  const csv = `Rexistro das cooperativas activas en Galicia
cif;numRegistro;denominacion;actividadEconomica/codigo;tipoCooperativa;claseCooperativa;fechaPrimeraInscripcion;capitalSocialMinimo;numSociosFundadores;datosDireccion/tipoVia/codigo;datosDireccion/nombreVia;datosDireccion/lugar;datosDireccion/parroquia;datosDireccion/codigoPostal;datosDireccion/municipio/codigo;datosDireccion/localidad;datosDireccion/provincia/codigo;datosDireccion/correoElectronico;datosDireccion/telefono
 F11111111;1-C;RESIDENCIAL ALBORADA ARTEIXO, S. COOP. GALEGA;;COOPERATIVA;VIVIENDAS;2026-03-02T00:00:00+01:00;3000.0;2;CL;RÚA X;;;15401;15005;ARTEIXO;15;a@b.gal;981000000
F22222222;2-C;TALLERES PEPA, S.COOP;;COOPERATIVA;TRABAJO_ASOCIADO;2026-01-01T00:00:00+01:00;3000.0;3;CL;X;;;15001;15030;A CORUÑA;15;;
F33333333;3-PO;COOP VIGO, S.COOP;;COOPERATIVA;VIVIENDAS;2026-01-01T00:00:00+01:00;3000.0;3;CL;X;;;36001;36057;VIGO;36;;
`;
  const rows = parseCooperativeRegistryCsv(csv);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cif, 'F11111111');
  assert.equal(rows[0].municipality, 'Arteixo');
  assert.equal(rows[0].foundedAt, '2026-03-02');
  assert.equal(rows[0].foundingPartners, 2);
  // codigoPostal (col 13) y municipio/codigo INE (col 14) son columnas distintas.
  assert.equal(rows[0].postalCode, '15401');
  assert.equal(rows[0].address, 'RÚA X, ARTEIXO');
});

test('detecta relevancia oficial por la descripción aunque el título no nombre el municipio', () => {
  const dogItem = toOpportunity(
    {
      title: 'ANUNCIO de aprobación do proxecto de urbanización para vivenda protexida',
      link: 'https://www.xunta.gal/dog/anuncio-1',
      pubDate: '2026-07-20T00:00:00Z',
      contentSnippet: 'b) Administración local. Concello de Oleiros',
    },
    'DOG · Sumario diario',
  );
  assert.equal(dogItem?.location, 'Oleiros');
  // Prensa: la descripción no se usa (los snippets de Google News son ruido).
  const pressItem = toOpportunity(
    { title: 'El mercado inmobiliario gallego', link: 'https://x.gal/2', pubDate: '2026-07-20T00:00:00Z', contentSnippet: 'Cooperativa de viviendas en Oleiros' },
    'Prensa · Cooperativas y Gestoras',
  );
  assert.equal(pressItem, null);
});

test('clasifica promociones libres por municipio y pone en cuarentena lo dudoso', () => {
  assert.deepEqual(classifyPromotionLocation('Rúa Barreira, Oleiros – A Coruña'), { municipality: 'Oleiros', scopeStatus: 'in_scope' });
  assert.deepEqual(classifyPromotionLocation('Plaza de Vigo, A Coruña'), { municipality: 'A Coruña', scopeStatus: 'in_scope' });
  assert.deepEqual(classifyPromotionLocation('Avenida de Arteixo, 123 – A Coruña'), { municipality: 'A Coruña', scopeStatus: 'in_scope' });
  assert.deepEqual(classifyPromotionLocation('Ares, A Coruña'), { municipality: null, scopeStatus: 'out_of_scope' });
  assert.deepEqual(classifyPromotionLocation('Canido, Ferrol, A Coruña'), { municipality: null, scopeStatus: 'out_of_scope' });
  assert.deepEqual(classifyPromotionLocation('San Pedro de Visma'), { municipality: 'A Coruña', scopeStatus: 'in_scope' });
  assert.deepEqual(classifyPromotionLocation('Novo Mesoiro'), { municipality: 'A Coruña', scopeStatus: 'in_scope' });
  assert.deepEqual(classifyPromotionLocation('Castiñeiriño, Santiago de Compostela'), { municipality: null, scopeStatus: 'out_of_scope' });
  assert.deepEqual(classifyPromotionLocation(''), { municipality: null, scopeStatus: 'unverified' });
});

test('presenta una sola señal por promoción canónica sin borrar el histórico', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE opportunities (
    id TEXT PRIMARY KEY, promotionId TEXT, publishedAt TEXT, firstSeenAt TEXT,
    lastSeenAt TEXT, garaje INTEGER, trastero INTEGER, terraza INTEGER, enriched INTEGER
  )`);
  const insert = db.prepare('INSERT INTO opportunities VALUES (?,?,?,?,?,?,?,?,?)');
  insert.run('noticia-antigua', 'promo:caleida', '2026-01-01', '2026-01-01', '2026-01-01', null, null, null, 1);
  insert.run('noticia-reciente', 'promo:caleida', '2026-02-01', '2026-02-01', '2026-02-01', null, null, null, 1);
  insert.run('senal-independiente', null, '2026-01-15', '2026-01-15', '2026-01-15', null, null, null, 1);
  const visible = getAllOpportunities(db);
  assert.deepEqual(visible.map((row) => row.id), ['noticia-reciente', 'senal-independiente']);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM opportunities').get().n, 3);
});

test('una baja del registro oficial se publica una vez y es idempotente', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE cooperatives (cif TEXT PRIMARY KEY, numRegistro TEXT, name TEXT NOT NULL, foundedAt TEXT, foundingPartners INTEGER, address TEXT, postalCode TEXT, municipality TEXT, email TEXT, phone TEXT, firstSeenAt TEXT NOT NULL, lastSeenAt TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, detectedAt TEXT NOT NULL, entityKind TEXT NOT NULL, entityId TEXT NOT NULL, kind TEXT NOT NULL, label TEXT, oldValue TEXT, newValue TEXT);
  `);
  saveCooperative(db, { cif: 'F00000001', name: 'Cooperativa Test', municipality: 'Oleiros', firstSeenAt: '2026-01-01', lastSeenAt: '2026-01-01' });
  finalizeRegistryImport(db, '2026-02-01');
  finalizeRegistryImport(db, '2026-02-01');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM events WHERE kind='disappeared'").get().n, 1);
  assert.equal(getAllCooperatives(db).length, 0);
});

test('últimos cambios oculta eventos huérfanos o contradichos', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE opportunities (id TEXT PRIMARY KEY, status TEXT, precioMin INTEGER);
    CREATE TABLE gestora_promotions (id TEXT PRIMARY KEY, status TEXT);
    CREATE TABLE cooperatives (cif TEXT PRIMARY KEY, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, detectedAt TEXT, entityKind TEXT, entityId TEXT, kind TEXT, label TEXT, oldValue TEXT, newValue TEXT);
    INSERT INTO opportunities VALUES ('op-1', 'Comercialización', 200000);
    INSERT INTO events(detectedAt,entityKind,entityId,kind,newValue) VALUES
      ('2026-01-01','opportunity','op-1','status','Suelo/Proyecto'),
      ('2026-01-02','opportunity','op-1','status','Comercialización'),
      ('2026-01-03','opportunity','eliminada','new','Obra nueva');
  `);
  assert.deepEqual(getRecentEvents(db).map((event) => event.id), [2]);
});
