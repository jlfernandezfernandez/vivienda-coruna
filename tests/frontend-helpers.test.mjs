import assert from 'node:assert/strict';
import test from 'node:test';

import { STATUSES, statusColors } from '../src/lib/statuses.mjs';
import { siteBase, statusToneClass } from '../src/lib/ui.mjs';
import { slugify } from '../src/lib/municipios.mjs';

// French amortization and financing formula replicating src/components/MortgageSimulator.astro
function calculateMortgage({ price, downPct = 0.2, years = 30, interestRate = 0.0285 }) {
  const downPayment = price * downPct;
  const loanAmount = price - downPayment;
  const monthlyRate = interestRate / 12;
  const numMonths = years * 12;

  let monthlyPayment = 0;
  if (monthlyRate > 0) {
    monthlyPayment =
      (loanAmount * (monthlyRate * Math.pow(1 + monthlyRate, numMonths))) /
      (Math.pow(1 + monthlyRate, numMonths) - 1);
  } else {
    monthlyPayment = loanAmount / numMonths;
  }

  const taxesAndFees = price * 0.12; // 10% IVA + 2% AJD/Notary
  const totalUpfront = downPayment + taxesAndFees;
  const coopSavings = price * 0.18; // ~18% developer margin

  return {
    price,
    downPayment,
    loanAmount,
    monthlyPayment,
    monthlyPaymentRounded: Math.round(monthlyPayment),
    taxesAndFees,
    totalUpfront,
    coopSavings,
  };
}

// ── TIER 1: Category-Partition Tests ────────────────────────────────────────

test('Tier 1: statuses.mjs returns expected color classes for all canonical statuses', () => {
  for (const status of STATUSES) {
    const colors = statusColors(status.label);
    assert.equal(colors, status.colors, `statusColors for "${status.label}" must match canonical colors`);
    assert.ok(colors.includes('border'), `colors for "${status.label}" must include border`);
    assert.ok(colors.includes('text-'), `colors for "${status.label}" must include text color`);
    assert.ok(colors.includes('bg-'), `colors for "${status.label}" must include background color`);
  }
});

test('Tier 1: ui.mjs siteBase normalizes trailing slash correctly', () => {
  assert.equal(siteBase('/'), '/');
  assert.equal(siteBase('/vivienda'), '/vivienda/');
  assert.equal(siteBase('/vivienda/'), '/vivienda/');
  assert.equal(siteBase(''), '/');
});

test('Tier 1: ui.mjs statusToneClass maps tones to design tokens', () => {
  assert.equal(
    statusToneClass('positive'),
    'bg-brand-green-soft text-brand-green border border-brand-green/10'
  );
  assert.equal(
    statusToneClass('warning'),
    'bg-brand-orange-soft text-brand-orange border border-brand-orange/10'
  );
  assert.equal(
    statusToneClass('neutral'),
    'bg-canvas text-ink-muted border border-border-soft'
  );
  assert.equal(
    statusToneClass(undefined),
    'bg-canvas text-ink-muted border border-border-soft'
  );
});

// ── TIER 2: Boundary & Corner Cases ──────────────────────────────────────────

test('Tier 2: statusColors handles case-insensitivity, null, undefined, and empty string', () => {
  const defaultColors = 'bg-brand-blue-soft text-brand-blue border border-brand-blue/15';

  // Case insensitivity
  assert.equal(
    statusColors('en construcción'),
    'bg-brand-green-soft text-brand-green border border-brand-green/15'
  );
  assert.equal(
    statusColors('EN CONSTRUCCIÓN'),
    'bg-brand-green-soft text-brand-green border border-brand-green/15'
  );
  assert.equal(
    statusColors('Últimas Unidades'),
    'bg-brand-orange-soft text-brand-orange border border-brand-orange/15'
  );
  assert.equal(
    statusColors('Agotada/vendida'),
    'bg-brand-rose-soft text-brand-rose border border-brand-rose/15'
  );

  // Null, undefined, empty, unknown
  assert.equal(statusColors(null), defaultColors);
  assert.equal(statusColors(undefined), defaultColors);
  assert.equal(statusColors(''), defaultColors);
  assert.equal(statusColors('Estado No Existente'), defaultColors);
});

test('Tier 2: Mortgage calculation handles boundary price, 0% interest rate and extreme loan terms', () => {
  // 0% interest rate (e.g. interest-free family loan or promotional subsidized rate)
  const zeroInterest = calculateMortgage({
    price: 240000,
    downPct: 0.20,
    years: 20,
    interestRate: 0,
  });

  assert.equal(zeroInterest.loanAmount, 192000);
  assert.equal(zeroInterest.monthlyPaymentRounded, 800, '192000 / (20 * 12) = 800 €/mo');
  assert.equal(zeroInterest.taxesAndFees, 28800, '12% of 240000 = 28800 €');
  assert.equal(zeroInterest.totalUpfront, 48000 + 28800, '48000 + 28800 = 76800 €');
  assert.equal(zeroInterest.coopSavings, 43200, '18% of 240000 = 43200 €');

  // 10% down payment (minimum boundary)
  const minDown = calculateMortgage({
    price: 150000,
    downPct: 0.10,
    years: 30,
    interestRate: 0.03,
  });
  assert.equal(minDown.downPayment, 15000);
  assert.equal(minDown.loanAmount, 135000);

  // 40% down payment (maximum typical boundary)
  const maxDown = calculateMortgage({
    price: 500000,
    downPct: 0.40,
    years: 15,
    interestRate: 0.025,
  });
  assert.equal(maxDown.downPayment, 200000);
  assert.equal(maxDown.loanAmount, 300000);
});

// ── TIER 3: Cross-Feature Combinations ──────────────────────────────────────

test('Tier 3: URL query param building and parsing for map and market thermometer integration', () => {
  const testLocations = [
    { name: 'A Coruña', kind: 'municipio' },
    { name: 'Oleiros', kind: 'municipio' },
    { name: 'Xuxán', kind: 'barrio' },
    { name: 'Monte Alto', kind: 'barrio' },
    { name: 'San Pedro de Visma', kind: 'barrio' },
  ];

  for (const loc of testLocations) {
    if (loc.kind === 'municipio') {
      const url = `/municipio/${slugify(loc.name)}`;
      assert.ok(!url.includes(' '), 'Municipio URL should be slugified without spaces');
      assert.ok(!url.includes('ñ'), 'Slug should normalize special characters');
    } else {
      const queryParam = encodeURIComponent(loc.name);
      const url = `/mapa?q=${queryParam}`;
      const search = url.split('?')[1];
      const parsed = new URLSearchParams(search).get('q');
      assert.equal(parsed, loc.name, `Parsed query param must match original barrio name "${loc.name}"`);
    }
  }
});

test('Tier 3: Query string filtering accurately filters markers collection', () => {
  const sampleMarkers = [
    { id: '1', title: 'Edificio Xuxán 1', barrio: 'Xuxán', municipality: 'A Coruña' },
    { id: '2', title: 'Residencial Visma', barrio: 'San Pedro de Visma', municipality: 'A Coruña' },
    { id: '3', title: 'Villas de Oleiros', barrio: 'Santa Cruz', municipality: 'Oleiros' },
    { id: '4', title: 'Pisos en Monte Alto', barrio: 'Monte Alto', municipality: 'A Coruña' },
  ];

  function filterMarkersByQuery(markers, query) {
    if (!query) return markers;
    const q = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return markers.filter((m) => {
      const text = `${m.title} ${m.barrio || ''} ${m.municipality || ''}`
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      return text.includes(q);
    });
  }

  assert.equal(filterMarkersByQuery(sampleMarkers, 'xuxan').length, 1);
  assert.equal(filterMarkersByQuery(sampleMarkers, 'XUXÁN').length, 1);
  assert.equal(filterMarkersByQuery(sampleMarkers, 'A Coruña').length, 3);
  assert.equal(filterMarkersByQuery(sampleMarkers, 'oleiros').length, 1);
  assert.equal(filterMarkersByQuery(sampleMarkers, 'nonexistent').length, 0);
});

// ── TIER 4: Real-World Scenarios ─────────────────────────────────────────────

test('Tier 4: Mortgage calculation matches real-world standard scenario (220,000 €, 20% down, 30y, 2.85% TIN)', () => {
  const result = calculateMortgage({
    price: 220000,
    downPct: 0.20,
    years: 30,
    interestRate: 0.0285,
  });

  // Price: 220,000 €
  // Down payment: 44,000 € (20%)
  // Loan amount: 176,000 €
  // Monthly payment: 176000 * (0.0285/12 * (1 + 0.0285/12)^360) / ((1 + 0.0285/12)^360 - 1)
  // ~ 728 € / month
  assert.equal(result.downPayment, 44000);
  assert.equal(result.loanAmount, 176000);
  assert.equal(result.monthlyPaymentRounded, 728, 'Monthly quote for 176k at 2.85% for 30y is 728 €');

  // Taxes & fees: 12% = 26,400 €
  assert.equal(result.taxesAndFees, 26400);

  // Total upfront: 44,000 + 26,400 = 70,400 €
  assert.equal(result.totalUpfront, 70400);

  // Cooperative savings: 18% of 220,000 = 39,600 €
  assert.equal(result.coopSavings, 39600);
});
