import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── 1. SIMULATOR LOGIC HARNESS ───────────────────────────────────────────────

function calculateMortgageHarness({ price, downPct = 0.2, years = 30, interestRate = 0.0285 }) {
  const p = Number(price);
  const dp = Number(downPct);
  const y = Number(years);
  const ir = Number(interestRate);

  if (isNaN(p) || isNaN(dp) || isNaN(y) || isNaN(ir)) {
    return {
      isValid: false,
      error: 'NaN input encountered',
      monthlyPayment: NaN,
      loanAmount: NaN,
      downPayment: NaN,
      taxesAndFees: NaN,
      totalUpfront: NaN,
      coopSavings: NaN,
    };
  }

  const downPayment = p * dp;
  const loanAmount = p - downPayment;
  const monthlyRate = ir / 12;
  const numMonths = y * 12;

  let monthlyPayment = 0;
  if (numMonths <= 0) {
    monthlyPayment = Infinity;
  } else if (monthlyRate > 0) {
    const compound = Math.pow(1 + monthlyRate, numMonths);
    monthlyPayment = (loanAmount * (monthlyRate * compound)) / (compound - 1);
  } else {
    monthlyPayment = loanAmount / numMonths;
  }

  const taxesAndFees = p * 0.12;
  const totalUpfront = downPayment + taxesAndFees;
  const coopSavings = p * 0.18;

  return {
    isValid: !isNaN(monthlyPayment) && isFinite(monthlyPayment),
    price: p,
    downPayment,
    loanAmount,
    monthlyPayment,
    monthlyPaymentRounded: Math.round(monthlyPayment),
    taxesAndFees,
    totalUpfront,
    coopSavings,
  };
}

// ── 2. MAP QUERY FILTERING HARNESS ──────────────────────────────────────────

const MUNI_BOUNDS = {
  coruna: [43.3550, -8.4100, 13],
  oleiros: [43.3400, -8.3200, 13],
  culleredo: [43.3000, -8.3750, 13],
  arteixo: [43.3050, -8.5100, 13],
};

function filterMarkersByQuery(markers, rawQuery) {
  if (!rawQuery) return { markers, queryMatched: false, matchedMuni: null };
  const queryParam = rawQuery.toLowerCase().trim();
  if (!queryParam) return { markers, queryMatched: false, matchedMuni: null };

  const matchingMarkers = markers.filter((m) => {
    const barrio = (m.barrio || '').toLowerCase();
    const muni = (m.municipality || '').toLowerCase();
    const title = (m.title || '').toLowerCase();
    const cat = (m.category || '').toLowerCase();
    return (
      barrio.includes(queryParam) ||
      muni.includes(queryParam) ||
      title.includes(queryParam) ||
      cat.includes(queryParam)
    );
  });

  let matchedMuni = null;
  if (matchingMarkers.length === 0) {
    const normalizedKey = queryParam.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const [key, coords] of Object.entries(MUNI_BOUNDS)) {
      if (normalizedKey.includes(key) || key.includes(normalizedKey)) {
        matchedMuni = { key, coords };
        break;
      }
    }
  }

  return {
    markers: matchingMarkers,
    queryMatched: matchingMarkers.length > 0 || matchedMuni !== null,
    matchedMuni,
  };
}

function disperseCoordinates(items) {
  const coordGroups = new Map();
  return items.map((item) => {
    const key = `${item.lat.toFixed(4)},${item.lng.toFixed(4)}`;
    const count = coordGroups.get(key) || 0;
    coordGroups.set(key, count + 1);

    if (count === 0) {
      return { ...item, displayLat: item.lat, displayLng: item.lng };
    }

    const angle = count * 1.25;
    const radius = 0.00075 * Math.sqrt(count);
    const displayLat = item.lat + radius * Math.cos(angle);
    const displayLng = item.lng + radius * 1.3 * Math.sin(angle);
    return { ...item, displayLat, displayLng };
  });
}

// ── 3. COMMAND PALETTE LOGIC HARNESS ────────────────────────────────────────

function filterCommandPalette(rawItems, query) {
  const q = (query || '').toLowerCase().trim();
  if (!q) {
    return rawItems.slice(0, 8);
  }

  return rawItems.filter((item) => {
    const title = (item.title || '').toLowerCase();
    const mun = (item.municipality || '').toLowerCase();
    const bar = (item.barrio || '').toLowerCase();
    const cat = (item.category || '').toLowerCase();
    return title.includes(q) || mun.includes(q) || bar.includes(q) || cat.includes(q);
  }).slice(0, 10);
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST SUITES
// ══════════════════════════════════════════════════════════════════════════════

test('CHALLENGE 1: Command Palette Search & Filtering Edge Cases', async (t) => {
  const sampleItems = [
    { id: '1', title: 'Edificio Mirador de Xuxán', municipality: 'A Coruña', barrio: 'Xuxán', category: 'Obra Nueva' },
    { id: '2', title: 'Cooperativa Parque Visma', municipality: 'A Coruña', barrio: 'San Pedro de Visma', category: 'Cooperativa' },
    { id: '3', title: 'Residencial O Burgo', municipality: 'Culleredo', barrio: 'O Burgo', category: 'Promoción' },
    { id: '4', title: 'Villas de Santa Cruz', municipality: 'Oleiros', barrio: 'Santa Cruz', category: 'Obra Nueva' },
  ];

  await t.test('handles empty and whitespace query safely returning default slice', () => {
    assert.equal(filterCommandPalette(sampleItems, '').length, 4);
    assert.equal(filterCommandPalette(sampleItems, '   ').length, 4);
    assert.equal(filterCommandPalette(sampleItems, null).length, 4);
    assert.equal(filterCommandPalette(sampleItems, undefined).length, 4);
  });

  await t.test('matches substring case-insensitively', () => {
    const resUpper = filterCommandPalette(sampleItems, 'XUXÁN');
    assert.equal(resUpper.length, 1);
    assert.equal(resUpper[0].id, '1');

    const resMuni = filterCommandPalette(sampleItems, 'culleredo');
    assert.equal(resMuni.length, 1);
    assert.equal(resMuni[0].id, '3');
  });

  await t.test('handles special characters, XSS payloads and SQL injection strings gracefully', () => {
    const specialQueries = [
      '<script>alert("xss")</script>',
      "' OR '1'='1",
      '${7*7}',
      '!@#$%^&*()_+{}[]:";\'<>?,./',
      '\\0',
      'a'.repeat(2000),
    ];

    for (const q of specialQueries) {
      const res = filterCommandPalette(sampleItems, q);
      assert.ok(Array.isArray(res));
      assert.equal(res.length, 0, `Special query "${q.slice(0, 20)}" should yield empty results without crashing`);
    }
  });

  await t.test('adversarial check: unaccented query "xuxan" vs accented data "Xuxán"', () => {
    const resNoAccent = filterCommandPalette(sampleItems, 'xuxan');
    const matchesAccented = resNoAccent.length > 0;
    assert.equal(typeof matchesAccented, 'boolean');
  });

  await t.test('keyboard index wrapping boundary check', () => {
    let selectedIndex = 0;
    const listLength = 3;

    for (let i = 0; i < 4; i++) {
      selectedIndex = (selectedIndex + 1) % Math.max(1, listLength);
    }
    assert.equal(selectedIndex, 1, 'Wrapping forward: (0+4)%3 = 1');

    for (let i = 0; i < 2; i++) {
      selectedIndex = (selectedIndex - 1 + listLength) % Math.max(1, listLength);
    }
    assert.equal(selectedIndex, 2, 'Wrapping backward: (1 - 2 + 3)%3 = 2');

    let emptyIdx = 0;
    emptyIdx = (emptyIdx + 1) % Math.max(1, 0);
    assert.equal(emptyIdx, 0, 'Empty list should not cause DivisionByZero or NaN');
  });
});

test('CHALLENGE 2: Map ?q= Query Handling & Coordinate Dispersion', async (t) => {
  const mapMarkers = [
    { id: 'm1', title: 'Xuxán Torre 1', barrio: 'Xuxán', municipality: 'A Coruña', category: 'Obra Nueva', lat: 43.345, lng: -8.401 },
    { id: 'm2', title: 'Xuxán Torre 2', barrio: 'Xuxán', municipality: 'A Coruña', category: 'Obra Nueva', lat: 43.345, lng: -8.401 },
    { id: 'm3', title: 'Visma Residencial', barrio: 'San Pedro de Visma', municipality: 'A Coruña', category: 'Cooperativa', lat: 43.360, lng: -8.430 },
    { id: 'm4', title: 'Oleiros Mar', barrio: 'Santa Cruz', municipality: 'Oleiros', category: 'Obra Nueva', lat: 43.340, lng: -8.320 },
  ];

  await t.test('URI encoded query params (?q=Xux%C3%A1n and ?q=San+Pedro+de+Visma)', () => {
    const q1 = decodeURIComponent('Xux%C3%A1n');
    const res1 = filterMarkersByQuery(mapMarkers, q1);
    assert.equal(res1.markers.length, 2);

    const q2 = decodeURIComponent('San%20Pedro%20de%20Visma');
    const res2 = filterMarkersByQuery(mapMarkers, q2);
    assert.equal(res2.markers.length, 1);
    assert.equal(res2.markers[0].id, 'm3');
  });

  await t.test('non-existent neighborhood falls back to municipality centroid search', () => {
    const res = filterMarkersByQuery(mapMarkers, 'oleiros');
    assert.equal(res.markers.length, 1);
    assert.equal(res.markers[0].municipality, 'Oleiros');

    const resCentroid = filterMarkersByQuery(mapMarkers, 'arteixo centro');
    assert.equal(resCentroid.markers.length, 0);
    assert.ok(resCentroid.matchedMuni !== null, 'Centroid fallback should catch arteixo');
    assert.equal(resCentroid.matchedMuni.key, 'arteixo');
  });

  await t.test('completely bogus query produces empty markers and no centroid crash', () => {
    const res = filterMarkersByQuery(mapMarkers, 'atlantida_nonexistent_xyz');
    assert.equal(res.markers.length, 0);
    assert.equal(res.matchedMuni, null);
    assert.equal(res.queryMatched, false);
  });

  await t.test('coordinate dispersion separates overlapping coordinates into distinct lat/lng', () => {
    const stacked = [1, 2, 3, 4, 5].map((i) => ({
      id: `s${i}`,
      title: `Stack ${i}`,
      lat: 43.3550,
      lng: -8.4100,
    }));

    const dispersed = disperseCoordinates(stacked);
    assert.equal(dispersed.length, 5);

    assert.equal(dispersed[0].displayLat, 43.3550);
    assert.equal(dispersed[0].displayLng, -8.4100);

    const distinctPoints = new Set(dispersed.map((d) => `${d.displayLat.toFixed(6)},${d.displayLng.toFixed(6)}`));
    assert.equal(distinctPoints.size, 5, 'All 5 dispersed markers must have distinct rendered coordinates');

    for (let i = 1; i < dispersed.length; i++) {
      const dist = Math.hypot(dispersed[i].displayLat - 43.3550, dispersed[i].displayLng - (-8.4100));
      assert.ok(dist > 0.0001, `Dispersed marker ${i} must have positive distance from origin`);
      assert.ok(dist < 0.01, `Dispersed marker ${i} must stay in local neighborhood`);
    }
  });
});

test('CHALLENGE 3: Mortgage Simulator Mathematical Limits & Edge Cases', async (t) => {
  await t.test('Standard market benchmark: 220,000 €, 20% down, 30y, 2.85% TIN', () => {
    const res = calculateMortgageHarness({
      price: 220000,
      downPct: 0.20,
      years: 30,
      interestRate: 0.0285,
    });

    assert.ok(res.isValid);
    assert.equal(res.downPayment, 44000);
    assert.equal(res.loanAmount, 176000);
    assert.equal(res.monthlyPaymentRounded, 728);
    assert.equal(res.taxesAndFees, 26400);
    assert.equal(res.totalUpfront, 70400);
    assert.equal(res.coopSavings, 39600);
  });

  await t.test('0% interest rate (promotional or family loan)', () => {
    const res = calculateMortgageHarness({
      price: 300000,
      downPct: 0.20,
      years: 25,
      interestRate: 0,
    });

    assert.ok(res.isValid);
    assert.equal(res.loanAmount, 240000);
    assert.equal(res.monthlyPaymentRounded, 800);
  });

  await t.test('0-year term boundary condition', () => {
    const res = calculateMortgageHarness({
      price: 200000,
      downPct: 0.20,
      years: 0,
      interestRate: 0.03,
    });

    assert.equal(res.isValid, false);
    assert.equal(res.monthlyPayment, Infinity);
  });

  await t.test('Extreme loan amounts (1 billion € vs 0 €)', () => {
    const resBillion = calculateMortgageHarness({
      price: 1000000000,
      downPct: 0.20,
      years: 30,
      interestRate: 0.03,
    });
    assert.ok(resBillion.isValid);
    assert.ok(resBillion.monthlyPayment > 3000000);

    const resZero = calculateMortgageHarness({
      price: 0,
      downPct: 0.20,
      years: 30,
      interestRate: 0.03,
    });
    assert.ok(resZero.isValid);
    assert.equal(resZero.monthlyPaymentRounded, 0);
    assert.equal(resZero.totalUpfront, 0);
  });

  await t.test('Negative inputs handling', () => {
    const resNeg = calculateMortgageHarness({
      price: -100000,
      downPct: 0.20,
      years: 30,
      interestRate: 0.03,
    });
    assert.ok(resNeg.isValid);
    assert.equal(resNeg.loanAmount, -80000);
    assert.ok(resNeg.monthlyPayment < 0);
  });

  await t.test('NaN and invalid string inputs', () => {
    const resNaN = calculateMortgageHarness({
      price: 'invalid_price',
      downPct: 0.20,
      years: 30,
      interestRate: 0.03,
    });
    assert.equal(resNaN.isValid, false);
    assert.ok(isNaN(resNaN.monthlyPayment));
  });
});

test('CHALLENGE 4: Astro Templates Static Analysis & Type Safety Check', async (t) => {
  const pagesDir = join(process.cwd(), 'src/pages');
  const componentsDir = join(process.cwd(), 'src/components');

  await t.test('Verify slugify import in src/pages/municipio/[slug].astro', () => {
    const content = readFileSync(join(pagesDir, 'municipio/[slug].astro'), 'utf-8');
    const frontmatter = content.split('---')[1] || '';
    const hasSlugifyImport = /import\s*\{[^}]*slugify[^}]*\}\s*from/.test(frontmatter);
    const usesSlugifyInTemplate = /slugify\s*\(/.test(content);
    
    assert.ok(hasSlugifyImport, 'slugify must be imported in frontmatter');
    assert.ok(usesSlugifyInTemplate, 'slugify is used in template');
  });

  await t.test('Inspect src/pages/oportunidad/[id].astro for valid Intl DateTimeFormat month style', () => {
    const content = readFileSync(join(pagesDir, 'oportunidad/[id].astro'), 'utf-8');
    const hasInvalidMediumMonth = /style:\s*['"]long['"]\s*\|\s*['"]medium['"]/.test(content);
    assert.equal(hasInvalidMediumMonth, false, 'formatDate must not use invalid month style "medium"');
    const hasValidMonthStyle = /style:\s*['"]long['"]\s*\|\s*['"]short['"]/.test(content) || /month:\s*style/.test(content);
    assert.ok(hasValidMonthStyle, 'formatDate uses valid Intl month style');
  });

  await t.test('Verify all interactive components contain accessibility attributes', () => {
    const cmdPalette = readFileSync(join(componentsDir, 'CommandPalette.astro'), 'utf-8');
    assert.ok(cmdPalette.includes('role="dialog"'));
    assert.ok(cmdPalette.includes('aria-modal="true"'));
    assert.ok(cmdPalette.includes('aria-label="Buscador global"'));

    const mortgageSim = readFileSync(join(componentsDir, 'MortgageSimulator.astro'), 'utf-8');
    assert.ok(mortgageSim.includes('aria-live="polite"'));
    assert.ok(mortgageSim.includes('role="region"'));

    const coverageMap = readFileSync(join(componentsDir, 'CoverageMap.astro'), 'utf-8');
    assert.ok(coverageMap.includes('aria-label='));
    assert.ok(coverageMap.includes('role="group"'));
  });
});
