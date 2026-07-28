export function requirePipelineWriter() {
  if (process.env.VIVIENDA_PIPELINE_LOCKED === '1') return;
  throw new Error('Escritor directo bloqueado: usa POST /api/v1/operations/runs o scripts/run-runtime-pipeline.sh.');
}