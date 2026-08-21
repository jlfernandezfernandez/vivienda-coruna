import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldUseComplementaryExtraction, shouldReprocessOpportunity, EXTRACTOR_VERSION } from '../scripts/lib/extraction-policy.mjs';

test('la fuente de comercialización usa extracción complementaria si falta precio aunque haya tres campos regex', () => {
  assert.equal(shouldUseComplementaryExtraction({ _llmNeeded: false, precioMin: null }, 'market-alert'), true);
  assert.equal(shouldUseComplementaryExtraction({ _llmNeeded: false, precioMin: 220000 }, 'market-alert'), false);
  assert.equal(shouldUseComplementaryExtraction({ _llmNeeded: true, precioMin: null }, 'official'), true);
});

test('las filas enriquecidas sin precio se reprocesan una sola vez por versión de extractor', () => {
  assert.equal(shouldReprocessOpportunity({ enriched: 1, precioMin: null, extractorVersion: null }), true);
  assert.equal(shouldReprocessOpportunity({ enriched: 1, precioMin: null, extractorVersion: EXTRACTOR_VERSION }), false);
  assert.equal(shouldReprocessOpportunity({ enriched: 1, precioMin: 220000, extractorVersion: null }), false);
  assert.equal(shouldReprocessOpportunity(null), false);
});
