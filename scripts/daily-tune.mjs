/**
 * Daily self-improving pipeline for Vivienda Coruña.
 *
 * Philosophy: don't just clean — understand WHY data is bad and fix the root cause.
 * Every run audits, diagnoses, patches code, and deploys. After 7 days the monitor
 * should be significantly more accurate than day 1.
 *
 * Capabilities:
 *   - Price analysis: why is this price wrong? (m²? nº viviendas? bad parse?)
 *   - Garbage detection: new portal/listings patterns not yet filtered
 *   - Name normalization: same gestora written differently across runs
 *   - Code patching: auto-adds new patterns to monitor.mjs and regex-extractor.mjs
 *   - Trend tracking: is each metric improving or degrading?
 */
import { DatabaseSync } from 'node:sqlite';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const DB_PATH = join(ROOT, 'src', 'data', 'monitor.db');
const MONITOR_PATH = join(ROOT, 'scripts', 'lib', 'monitor.mjs');
const REGEX_PATH = join(ROOT, 'scripts', 'lib', 'regex-extractor.mjs');
const LOG_PATH = join(ROOT, 'scripts', 'tune-log.json');

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`[${ts}] ${msg}`);
}

function loadLog() {
  if (!existsSync(LOG_PATH)) return { runs: [], patches: [] };
  return JSON.parse(readFileSync(LOG_PATH, 'utf8'));
}

function saveLog(data) {
  writeFileSync(LOG_PATH, JSON.stringify(data, null, 2));
}

// ── STEP 1: Run the full pipeline ──
async function step1_refresh() {
  log('STEP 1: Running full pipeline (RSS + Firecrawl enrichment)...');
  try {
    execSync('npm run refresh:all', { cwd: ROOT, stdio: 'inherit', timeout: 600_000 });
    log('  Pipeline completed.');
    return true;
  } catch (e) {
    log(`  Pipeline FAILED: ${e.message}`);
    return false;
  }
}

// ── STEP 2: Deep audit ──
function step2_audit() {
  log('STEP 2: Deep audit...');
  const db = new DatabaseSync(DB_PATH);
  const report = {};

  report.total = db.prepare('SELECT count(*) as n FROM opportunities').all()[0].n;
  report.enriched = db.prepare('SELECT count(*) as n FROM opportunities WHERE enriched=1').all()[0].n;
  report.noStatus = db.prepare('SELECT count(*) as n FROM opportunities WHERE status IS NULL').all()[0].n;
  report.noType = db.prepare("SELECT count(*) as n FROM opportunities WHERE type IS NULL OR type = ''").all()[0].n;

  // ── PRICE ANALYSIS: don't just count bad prices, understand them ──
  const badPrices = db.prepare(`
    SELECT id, title, summary, precioMin, precioMax, totalViviendas
    FROM opportunities
    WHERE precioMin IS NOT NULL AND precioMin < 100000
  `).all();
  report.badPrices = badPrices.map(p => {
    const title = (p.title || '').toLowerCase();
    const summary = (p.summary || '').toLowerCase();
    const combined = title + ' ' + summary;
    // Diagnose WHY the price is wrong
    let reason = 'unknown';
    if (/\d+\s*m²/.test(combined) && Math.abs(p.precioMin - (p.precioMax || p.precioMin)) < 500) {
      reason = 'price_per_m2'; // e.g. "1.800 €/m²" parsed as 1800
    } else if (p.totalViviendas && Math.abs(p.precioMin - p.totalViviendas) < 5) {
      reason = 'confused_with_unit_count'; // e.g. "24 viviendas" → precioMin=24
    } else if (/\b(?:desde|a partir de)\s*(\d{2,3})\s*[€euros]/i.test(combined)) {
      reason = 'thousands_as_units'; // e.g. "desde 180" (mil) parsed as 180
    } else if (/\b(?:metros|m²|m2|superficie)\b/i.test(combined)) {
      reason = 'area_not_price'; // m² number captured as price
    } else if (/\b(?:nº|número|total|un total de)\s*\d+/i.test(combined)) {
      reason = 'count_not_price';
    }
    return { id: p.id, title: p.title?.slice(0, 60), precioMin: p.precioMin, reason };
  });
  report.badPriceCount = badPrices.length;

  // ── DUPLICATES ──
  const all = db.prepare('SELECT id, url, title FROM opportunities ORDER BY lastSeenAt DESC').all();
  const seen = new Map();
  report.duplicates = [];
  for (const o of all) {
    const base = o.url.replace(/#.*$/, '').replace(/\?.*$/, '');
    if (seen.has(base)) {
      report.duplicates.push({ keep: seen.get(base), remove: o.id, title: o.title?.slice(0, 60) });
    } else {
      seen.set(base, o.id);
    }
  }

  // ── GARBAGE DETECTION: known + unknown patterns ──
  const knownGarbage = [
    { pattern: '%yaencontre%', label: 'yaencontre' },
    { pattern: '%Nestoria%', label: 'Nestoria' },
    { pattern: '%habitaclia%', label: 'habitaclia' },
    { pattern: '%fotocasa%', label: 'Fotocasa' },
    { pattern: '%idealista%', label: 'Idealista' },
    { pattern: '%Reforma De Viviendas%', label: 'reformas' },
    { pattern: '%reformantia%', label: 'reformantia' },
    { pattern: '%SubastasDelBOE%', label: 'subastas BOE' },
    { pattern: '%tramitesayuntamiento%', label: 'trámites ayuntamiento' },
    { pattern: '%Promociones de obra nueva en%', label: 'listados portales' },
    { pattern: '%Inmuebles de obra nueva en%', label: 'listados portales' },
    { pattern: '%Obra Nueva en%', label: 'listados portales' },
    { pattern: '%Obra nueva con entrega para%', label: 'listados portales' },
  ];
  report.knownGarbage = {};
  for (const g of knownGarbage) {
    const n = db.prepare(`SELECT count(*) as n FROM opportunities WHERE title LIKE ? OR url LIKE ?`).all(g.pattern, g.pattern)[0].n;
    if (n > 0) report.knownGarbage[g.label] = n;
  }

  // ── UNKNOWN GARBAGE: items with 0 enriched fields that aren't caught by known patterns ──
  const unenriched = db.prepare(`
    SELECT id, title, url, sourceKind FROM opportunities
    WHERE enriched = 0
    ORDER BY lastSeenAt DESC
    LIMIT 50
  `).all();
  report.suspiciousTitles = [];
  const garbageKeywords = /yaencontre|nestoria|habitaclia|fotocasa|idealista|reformantia|subastasdelboe|tramitesayuntamiento/i;
  for (const item of unenriched) {
    const t = (item.title || '').toLowerCase();
    if (garbageKeywords.test(t)) continue; // already caught
    // Heuristics for likely garbage
    const signals = [];
    if (/\b(?:obra nueva en|promociones de obra nueva|inmuebles de obra nueva)\b/i.test(t) && /\d+\s*(?:promociones|proyectos|resultados)/i.test(t)) {
      signals.push('portal_listing');
    }
    if (/\b(?:solicitud de licencias|trámites|formulario|ayuntamiento)\b/i.test(t) && !/\b(?:promoción|viviendas|cooperativa)\b/i.test(t)) {
      signals.push('administrative_form');
    }
    if (/\b(?:reforma|rehabilitación|reparación)\b/i.test(t) && !/\b(?:promoción|obra nueva|edificio)\b/i.test(t)) {
      signals.push('renovation_not_new');
    }
    if (/\b(?:subasta|concurso|licitación)\b/i.test(t) && !/\b(?:vivienda|promoción|suelo)\b/i.test(t)) {
      signals.push('auction_unrelated');
    }
    if (signals.length > 0) {
      report.suspiciousTitles.push({ id: item.id, title: item.title?.slice(0, 80), signals, url: item.url?.slice(0, 60) });
    }
  }

  // ── NAME NORMALIZATION: same gestora, different spellings ──
  const gestoras = db.prepare('SELECT id, name FROM gestoras').all();
  report.nameConflicts = [];
  const normalized = new Map();
  for (const g of gestoras) {
    const key = g.name.toLowerCase().replace(/[^a-záéíóúñ]/g, '').slice(0, 20);
    if (!normalized.has(key)) normalized.set(key, []);
    normalized.get(key).push(g);
  }
  for (const [key, group] of normalized) {
    if (group.length > 1) {
      report.nameConflicts.push({ key, names: group.map(g => g.name) });
    }
  }

  // ── GESTORA HEALTH ──
  const promoGestoraIds = new Set(db.prepare('SELECT DISTINCT gestoraId FROM gestora_promotions').all().map(r => r.gestoraId));
  report.gestorasNoPromos = gestoras.filter(g => !promoGestoraIds.has(g.id)).map(g => g.name);
  report.gestorasNoContact = db.prepare(`
    SELECT name FROM gestoras
    WHERE (phone IS NULL OR phone = '' OR phone = '981 000 000')
    AND (email IS NULL OR email = '')
  `).all().map(r => r.name);

  // Summary
  const knownGarbageTotal = Object.values(report.knownGarbage).reduce((a, b) => a + b, 0);
  log(`  Total: ${report.total} | Enriched: ${report.enriched} | No status: ${report.noStatus}`);
  log(`  Bad prices: ${report.badPriceCount} | Duplicates: ${report.duplicates.length} | Known garbage: ${knownGarbageTotal}`);
  log(`  Suspicious unenriched: ${report.suspiciousTitles.length} | Name conflicts: ${report.nameConflicts.length}`);
  if (report.gestorasNoContact.length) log(`  No contact: ${report.gestorasNoContact.join(', ')}`);

  return report;
}

// ── STEP 3: Smart clean + diagnose ──
function step3_clean(report) {
  log('STEP 3: Smart cleaning...');
  const db = new DatabaseSync(DB_PATH);
  let cleaned = 0;
  const diagnoses = [];

  // ── PRICES: fix intelligently, don't just nullify ──
  for (const bp of report.badPrices) {
    if (bp.reason === 'thousands_as_units') {
      // "desde 180" → probably 180.000, not 180
      const fixed = bp.precioMin * 1000;
      if (fixed >= 100000 && fixed <= 2000000) {
        db.prepare('UPDATE opportunities SET precioMin = ? WHERE id = ?').run(fixed, bp.id);
        diagnoses.push({ type: 'price_fix', detail: `"${bp.title}" → ${bp.precioMin}→${fixed} (thousands_as_units)`, id: bp.id });
        cleaned++;
        continue;
      }
    }
    if (bp.reason === 'price_per_m2' || bp.reason === 'area_not_price' || bp.reason === 'count_not_price' || bp.reason === 'confused_with_unit_count') {
      // These are genuinely wrong — nullify but log the pattern for regex improvement
      db.prepare('UPDATE opportunities SET precioMin = NULL, precioMax = NULL WHERE id = ?').run(bp.id);
      diagnoses.push({ type: 'price_nullify', detail: `"${bp.title}" → null (${bp.reason})`, id: bp.id });
      cleaned++;
      continue;
    }
    // Unknown reason — nullify to be safe
    db.prepare('UPDATE opportunities SET precioMin = NULL, precioMax = NULL WHERE id = ?').run(bp.id);
    diagnoses.push({ type: 'price_nullify', detail: `"${bp.title}" → null (unknown)`, id: bp.id });
    cleaned++;
  }

  // ── DUPLICATES: remove ──
  for (const dup of report.duplicates) {
    db.prepare('DELETE FROM opportunities WHERE id = ?').run(dup.remove);
    cleaned++;
  }

  // ── KNOWN GARBAGE: remove ──
  const garbagePatterns = [
    '%yaencontre%', '%Nestoria%', '%habitaclia%', '%fotocasa%', '%idealista%',
    '%Reforma De Viviendas%', '%reformantia%', '%SubastasDelBOE%',
    '%tramitesayuntamiento%', '%Promociones de obra nueva en%',
    '%Inmuebles de obra nueva en%', '%Obra Nueva en%', '%Obra nueva con entrega para%',
  ];
  for (const pattern of garbagePatterns) {
    const r = db.prepare('DELETE FROM opportunities WHERE title LIKE ? OR url LIKE ?').run(pattern, pattern);
    if (r.changes > 0) {
      diagnoses.push({ type: 'garbage_removed', detail: `${r.changes} items matching "${pattern.replace(/%/g, '')}"` });
      cleaned += r.changes;
    }
  }

  // ── SUSPICIOUS: remove if clearly garbage ──
  for (const sus of report.suspiciousTitles) {
    if (sus.signals.includes('portal_listing') || sus.signals.includes('administrative_form')) {
      db.prepare('DELETE FROM opportunities WHERE id = ?').run(sus.id);
      diagnoses.push({ type: 'suspicious_removed', detail: `"${sus.title}" (${sus.signals.join(', ')})` });
      cleaned++;
    }
  }

  log(`  Cleaned: ${cleaned} items (${diagnoses.filter(d => d.type === 'price_fix').length} prices fixed, ${diagnoses.filter(d => d.type === 'price_nullify').length} nullified)`);
  return { cleaned, diagnoses };
}

// ── STEP 4: Learn & patch code ──
function step4_learn(report, diagnoses, tuneLog) {
  log('STEP 4: Learning & patching code...');
  const patches = [];

  // ── 4a. New garbage domains/patterns → add to GARBAGE_PATTERN ──
  const monitorSrc = readFileSync(MONITOR_PATH, 'utf8');
  const currentGarbage = monitorSrc.match(/GARBAGE_PATTERN\s*=\s*\/\^?\(?\?\:(.+?)\)?\$?\//s)?.[1] || '';

  const newGarbageTerms = [];
  for (const sus of report.suspiciousTitles) {
    if (sus.signals.includes('portal_listing')) {
      // Extract domain from URL
      try {
        const domain = new URL(sus.url).hostname.replace('www.', '').split('.')[0];
        if (domain && !currentGarbage.includes(domain) && domain.length > 3) {
          newGarbageTerms.push(domain);
        }
      } catch {}
    }
    if (sus.signals.includes('renovation_not_new')) {
      if (!currentGarbage.includes('reforma de viviendas')) {
        newGarbageTerms.push('reforma de viviendas');
      }
    }
  }

  // Deduplicate
  const uniqueNewTerms = [...new Set(newGarbageTerms)].filter(t => t.length > 2);

  if (uniqueNewTerms.length > 0) {
    log(`  New garbage terms to add: ${uniqueNewTerms.join(', ')}`);
    // Build the new pattern string
    const terms = uniqueNewTerms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const oldPatternLine = monitorSrc.match(/const GARBAGE_PATTERN = .+;/)[0];
    // Insert new terms before the closing )\\b
    const newPatternLine = oldPatternLine.replace(/\)\\b\/i;/, `|${terms})\\b/i;`);
    if (newPatternLine !== oldPatternLine) {
      const newMonitorSrc = monitorSrc.replace(oldPatternLine, newPatternLine);
      writeFileSync(MONITOR_PATH, newMonitorSrc);
      patches.push({ file: 'monitor.mjs', change: `Added garbage terms: ${uniqueNewTerms.join(', ')}` });
      log(`  ✓ Patched monitor.mjs: added ${uniqueNewTerms.join(', ')} to GARBAGE_PATTERN`);
    }
  }

  // ── 4b. Price regex improvements ──
  const regexSrc = readFileSync(REGEX_PATH, 'utf8');
  const priceFixes = diagnoses.filter(d => d.type === 'price_fix');
  const priceNullifies = diagnoses.filter(d => d.type === 'price_nullify');

  // If we had "thousands_as_units" fixes, improve the regex to catch "desde X" without € symbol
  if (priceFixes.some(d => d.detail.includes('thousands_as_units'))) {
    // Check if the regex already handles bare numbers
    if (!regexSrc.includes('precioDesdeSinSimbolo')) {
      // Add a new regex pattern for "desde 180" (bare number, no €)
      const oldDesdeLine = regexSrc.match(/const precioDesde = .+;/)[0];
      const newDesdeBlock = `const precioDesde = t.match(/(?:desde|a partir de|precios? desde)\\s*[\\d.,]+\\s*[€euros]*/i);
  // Catch "desde 180" without € symbol — likely thousands (180 → 180.000)
  const precioDesdeSinSimbolo = t.match(/(?:desde|a partir de)\\s*(\\d{2,3})\\s*(?:€|euros|$|\\.|,|\\s)/i);`;
      const newRegexSrc = regexSrc.replace(oldDesdeLine, newDesdeBlock);
      // Also update the assignment to use it
      const oldAssign = newRegexSrc.match(/if \(precioDesde\) \{\s*result\.precioMin = parseNumber\(precioDesde\[0\]\);\s*\}/);
      if (oldAssign) {
        const newAssign = `if (precioDesde) {
    result.precioMin = parseNumber(precioDesde[0]);
  } else if (precioDesdeSinSimbolo) {
    const raw = parseInt(precioDesdeSinSimbolo[1], 10);
    result.precioMin = raw < 1000 ? raw * 1000 : raw;
  }`;
        const finalSrc = newRegexSrc.replace(oldAssign[0], newAssign);
        writeFileSync(REGEX_PATH, finalSrc);
        patches.push({ file: 'regex-extractor.mjs', change: 'Added bare-number price detection (thousands_as_units fix)' });
        log('  ✓ Patched regex-extractor.mjs: bare-number price detection');
      }
    }
  }

  // If we had "price_per_m2" nullifies, add a guard
  if (priceNullifies.some(d => d.detail.includes('price_per_m2') || d.detail.includes('area_not_price'))) {
    if (!regexSrc.includes('m² guard')) {
      const oldParseNumber = regexSrc.match(/function parseNumber\(str\) \{[\s\S]*?return rounded >= 100000 \? rounded : null;\s*\}/)?.[0];
      if (oldParseNumber) {
        const newParseNumber = `function parseNumber(str, context = '') {
  const cleaned = String(str).replace(/[^\\d.,]/g, '').replace(/\\./g, '').replace(',', '.');
  const n = parseFloat(cleaned);
  if (Number.isNaN(n)) return null;
  const rounded = Math.round(n);
  // m² guard: if context mentions m², this is area not price
  if (/m²|m2|metros cuadrados|superficie/i.test(context)) return null;
  // Filter out garbage prices: no real housing in this area is under 100k
  return rounded >= 100000 ? rounded : null;
}`;
        const newRegexSrc = regexSrc.replace(oldParseNumber, newParseNumber);
        writeFileSync(REGEX_PATH, newRegexSrc);
        patches.push({ file: 'regex-extractor.mjs', change: 'Added m² guard to parseNumber' });
        log('  ✓ Patched regex-extractor.mjs: m² guard in parseNumber');
      }
    }
  }

  // ── 4c. Track trends ──
  tuneLog.runs.push({
    date: new Date().toISOString(),
    total: report.total,
    enriched: report.enriched,
    noStatus: report.noStatus,
    badPriceCount: report.badPriceCount,
    duplicates: report.duplicates.length,
    knownGarbage: report.knownGarbage,
    suspiciousCount: report.suspiciousTitles.length,
    gestorasNoContact: report.gestorasNoContact,
    gestorasNoPromos: report.gestorasNoPromos,
    cleaned,
    patches: patches.map(p => p.change),
  });

  if (tuneLog.runs.length > 14) tuneLog.runs = tuneLog.runs.slice(-14);
  tuneLog.patches = [...(tuneLog.patches || []), ...patches];
  saveLog(tuneLog);

  // Print trend
  if (tuneLog.runs.length >= 2) {
    const prev = tuneLog.runs[tuneLog.runs.length - 2];
    const curr = tuneLog.runs[tuneLog.runs.length - 1];
    const prevGarbage = Object.values(prev.knownGarbage || {}).reduce((a, b) => a + b, 0);
    const currGarbage = Object.values(curr.knownGarbage || {}).reduce((a, b) => a + b, 0);
    log(`  Trend: enriched ${prev.enriched}→${curr.enriched} | garbage ${prevGarbage}→${currGarbage} | bad prices ${prev.badPriceCount}→${curr.badPriceCount} | suspicious ${prev.suspiciousCount}→${curr.suspiciousCount}`);
  }

  return patches;
}

// ── STEP 5: Build, commit, push, deploy ──
function step5_deploy(patches) {
  log('STEP 5: Building and deploying...');
  try {
    execSync('npm run build', { cwd: ROOT, stdio: 'pipe', timeout: 60_000 });
    log('  Build OK');
  } catch (e) {
    log(`  Build FAILED: ${e.message}`);
    return false;
  }

  const hasCodeChanges = patches.length > 0;
  const commitMsg = hasCodeChanges
    ? `fix: daily tune — ${patches.map(p => p.change).join('; ')}`
    : `data: daily tune — ${new Date().toISOString().slice(0, 10)}`;

  try {
    execSync('git add -A', { cwd: ROOT });
    execSync(`git commit -m "${commitMsg}"`, { cwd: ROOT });
    execSync('git push origin master', { cwd: ROOT, timeout: 30_000 });
    log(`  Pushed: "${commitMsg}"`);
    execSync('gh workflow run deploy.yml --ref master', { cwd: ROOT, timeout: 10_000 });
    log('  Deploy triggered');
  } catch (e) {
    log(`  Deploy step failed: ${e.message}`);
    return false;
  }

  return true;
}

// ── MAIN ──
async function main() {
  const tuneLog = loadLog();
  const runNumber = tuneLog.runs.length + 1;
  log(`=== DAILY SELF-IMPROVING RUN #${runNumber} ===`);

  const ok = await step1_refresh();
  if (!ok) {
    log('Pipeline failed. Skipping audit and deploy.');
    return;
  }

  const report = step2_audit();
  const { cleaned, diagnoses } = step3_clean(report);
  const patches = step4_learn(report, diagnoses, tuneLog);
  step5_deploy(patches);

  // Final summary
  const codeChanges = patches.length > 0
    ? `Código mejorado: ${patches.map(p => p.change).join('; ')}.`
    : 'Sin cambios de código necesarios.';
  log(`=== DONE === Cleaned: ${cleaned}. ${codeChanges}`);
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
