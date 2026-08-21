// Bump when a deterministic extractor improvement should revisit previously
// enriched opportunities which still lack their market price.
export const EXTRACTOR_VERSION = '2026-08-price-context-v1';

export function shouldUseComplementaryExtraction(regexData, sourceKind) {
  return Boolean(regexData?._llmNeeded)
    || (sourceKind === 'market-alert' && regexData?.precioMin == null);
}

export function shouldReprocessOpportunity(opportunity) {
  return Boolean(
    opportunity?.enriched
    && opportunity.precioMin == null
    && opportunity.extractorVersion !== EXTRACTOR_VERSION,
  );
}
