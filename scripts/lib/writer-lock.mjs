export function requirePipelineWriter() {
  if (process.env.VIVIENDA_PIPELINE_LOCKED === '1') return;
  throw new Error('Escritor directo bloqueado: usa scripts/run-pipeline.sh [deep|fast] para adquirir el mutex.');
}
