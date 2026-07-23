/**
 * Daily self-tuning script for Vivienda Coruña.
 * Runs the full pipeline, audits data quality, auto-cleans garbage,
 * and reports what was fixed. Designed to run unattended via cron.
 *
 * Day 1-7: each run learns from previous runs and tightens filters.
 */
import { DatabaseSync } from 'node:sqlite';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const DB_PATH = join(ROOT, 'src', 'data', 'monitor.db');
const MONITOR_PATH = join(ROOT, 'scripts', 'lib', 'monitor.mjs');
const LOG_PATH = join(ROOT, 'scripts', 'tune-log.json');

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`[${ts}] ${msg}`);
}

function loadLog() {
  if (!existsSync(LOG_PATH)) return { runs: [], garbagePatterns: [] };
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

// ── STEP 2: Audit data quality ──
function step2_audit() {
  log('STEP 2: Auditing data quality...');
  const db = new DatabaseSync(DB_PATH);
  const report = {};

  // Count totals
  report.total = db.prepare('SELECT count(*) as n FROM opportunities').all()[0].n;
  report.enriched = db.prepare('SELECT count(*) as n FROM opportunities WHERE enriched=1').all()[0].n;
  report.noStatus = db.prepare('SELECT count(*) as n FROM opportunities WHERE status IS NULL').all()[0].n;
  report.noType = db.prepare("SELECT count(*) as n FROM opportunities WHERE type IS NULL OR type = ''").all()[0].n;
  report.badPrices = db.prepare('SELECT count(*) as n FROM opportunities WHERE precioMin IS NOT NULL AND precioMin < 100000').all()[0].n;

  // Duplicates by URL base
  const all = db.prepare('SELECT id, url, title FROM opportunities ORDER BY lastSeenAt DESC').all();
  const seen = new Map();
  report.duplicates = 0;
  for (const o of all) {
    const base = o.url.replace(/#.*$/, '').replace(/\?.*$/, '');
    if (seen.has(base)) report.duplicates++;
    else seen.set(base, o.id);
  }

  // Garbage: titles matching known junk patterns
  const garbagePatterns = [
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
  report.garbage = {};
  for (const g of garbagePatterns) {
    const n = db.prepare(`SELECT count(*) as n FROM opportunities WHERE title LIKE ? OR url LIKE ?`).all(g.pattern, g.pattern)[0].n;
    if (n > 0) report.garbage[g.label] = n;
  }

  // Gestoras without contact
  report.gestorasNoContact = db.prepare("SELECT name FROM gestoras WHERE (phone IS NULL OR phone = '' OR phone = '981 000 000') AND (email IS NULL OR email = '')").all().map(r => r.name);

  // Gestoras without promotions
  const gestoras = db.prepare('SELECT id, name FROM gestoras').all();
  const promoGestoraIds = new Set(db.prepare('SELECT DISTINCT gestoraId FROM gestora_promotions').all().map(r => r.gestoraId));
  report.gestorasNoPromos = gestoras.filter(g => !promoGestoraIds.has(g.id)).map(g => g.name);

  log(`  Total: ${report.total} | Enriched: ${report.enriched} | No status: ${report.noStatus} | Bad prices: ${report.badPrices} | Duplicates: ${report.duplicates}`);
  const garbageTotal = Object.values(report.garbage).reduce((a, b) => a + b, 0);
  if (garbageTotal > 0) log(`  GARBAGE: ${garbageTotal} items (${Object.entries(report.garbage).map(([k,v]) => `${k}:${v}`).join(', ')})`);

  return report;
}

// ── STEP 3: Auto-clean ──
function step3_clean(report) {
  log('STEP 3: Auto-cleaning...');
  const db = new DatabaseSync(DB_PATH);
  let cleaned = 0;

  // Remove bad prices
  if (report.badPrices > 0) {
    const r = db.prepare('UPDATE opportunities SET precioMin = NULL, precioMax = NULL WHERE precioMin IS NOT NULL AND precioMin < 100000').run();
    cleaned += r.changes;
    log(`  Fixed ${r.changes} bad prices`);
  }

  // Remove duplicates
  if (report.duplicates > 0) {
    const all = db.prepare('SELECT id, url FROM opportunities ORDER BY lastSeenAt DESC').all();
    const seen = new Set();
    for (const o of all) {
      const base = o.url.replace(/#.*$/, '').replace(/\?.*$/, '');
      if (seen.has(base)) {
        db.prepare('DELETE FROM opportunities WHERE id = ?').run(o.id);
        cleaned++;
      } else {
        seen.add(base);
      }
    }
    log(`  Removed ${cleaned} duplicates`);
  }

  // Remove garbage
  const garbagePatterns = [
    '%yaencontre%', '%Nestoria%', '%habitaclia%', '%fotocasa%', '%idealista%',
    '%Reforma De Viviendas%', '%reformantia%', '%SubastasDelBOE%',
    '%tramitesayuntamiento%', '%Promociones de obra nueva en%',
    '%Inmuebles de obra nueva en%', '%Obra Nueva en%', '%Obra nueva con entrega para%',
  ];
  for (const pattern of garbagePatterns) {
    const r = db.prepare('DELETE FROM opportunities WHERE title LIKE ? OR url LIKE ?').run(pattern, pattern);
    if (r.changes > 0) {
      cleaned += r.changes;
      log(`  Removed ${r.changes} garbage: ${pattern.replace(/%/g, '')}`);
    }
  }

  return cleaned;
}

// ── STEP 4: Learn — update garbage filter if new patterns found ──
function step4_learn(report, tuneLog) {
  log('STEP 4: Learning from this run...');

  // Check if there are new garbage patterns not yet in the filter
  const monitorSrc = readFileSync(MONITOR_PATH, 'utf8');
  const currentGarbage = monitorSrc.match(/GARBAGE_PATTERN\s*=\s*\/(.+?)\//s)?.[1] || '';

  const newPatterns = [];
  for (const [label, count] of Object.entries(report.garbage)) {
    if (count > 0 && !currentGarbage.includes(label.toLowerCase())) {
      newPatterns.push(label);
    }
  }

  if (newPatterns.length > 0) {
    log(`  New garbage patterns detected: ${newPatterns.join(', ')}`);
    log(`  These should be added to GARBAGE_PATTERN in monitor.mjs`);
    // We don't auto-edit code from cron (safety), but we log it for the next manual review
  }

  // Track run
  tuneLog.runs.push({
    date: new Date().toISOString(),
    total: report.total,
    enriched: report.enriched,
    noStatus: report.noStatus,
    badPrices: report.badPrices,
    duplicates: report.duplicates,
    garbage: report.garbage,
    gestorasNoContact: report.gestorasNoContact,
    gestorasNoPromos: report.gestorasNoPromos,
  });

  // Keep only last 14 runs
  if (tuneLog.runs.length > 14) tuneLog.runs = tuneLog.runs.slice(-14);
  saveLog(tuneLog);

  // Print trend
  if (tuneLog.runs.length >= 2) {
    const prev = tuneLog.runs[tuneLog.runs.length - 2];
    const curr = tuneLog.runs[tuneLog.runs.length - 1];
    log(`  Trend: total ${prev.total}→${curr.total} | enriched ${prev.enriched}→${curr.enriched} | garbage ${Object.values(prev.garbage||{}).reduce((a,b)=>a+b,0)}→${Object.values(curr.garbage||{}).reduce((a,b)=>a+b,0)}`);
  }
}

// ── STEP 5: Build, commit, push, deploy ──
function step5_deploy() {
  log('STEP 5: Building and deploying...');
  try {
    execSync('npm run build', { cwd: ROOT, stdio: 'pipe', timeout: 60_000 });
    log('  Build OK');
  } catch (e) {
    log(`  Build FAILED: ${e.message}`);
    return false;
  }

  // Check if monitor.db changed
  try {
    const status = execSync('git status --porcelain -- src/data/monitor.db', { cwd: ROOT, encoding: 'utf8' }).trim();
    if (!status) {
      log('  No data changes, skipping deploy.');
      return true;
    }
  } catch (e) {
    // git failed, skip
    return false;
  }

  try {
    execSync('git add src/data/monitor.db scripts/tune-log.json', { cwd: ROOT });
    execSync(`git commit -m "data: daily tune — ${new Date().toISOString().slice(0, 10)}"`, { cwd: ROOT });
    execSync('git push origin master', { cwd: ROOT, timeout: 30_000 });
    log('  Pushed to master');
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
  log(`=== DAILY TUNE RUN #${runNumber} ===`);

  const ok = await step1_refresh();
  if (!ok) {
    log('Pipeline failed. Skipping audit and deploy.');
    return;
  }

  const report = step2_audit();
  const cleaned = step3_clean(report);
  log(`  Total cleaned this run: ${cleaned}`);

  step4_learn(report, tuneLog);
  step5_deploy();

  log('=== DONE ===');
}

main().catch(e => {
  console.error(e);
  process.exitCode = 1;
});
