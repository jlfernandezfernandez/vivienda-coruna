import { ApiError } from './client.mjs';

export function applyApiFailure(response, error) {
  const notFound = error instanceof ApiError && error.kind === 'not_found';
  response.status = notFound ? 404 : 503;
  response.headers.set('x-robots-tag', 'noindex');
  if (!notFound) response.headers.set('retry-after', '60');
  return notFound ? 'not_found' : 'unavailable';
}

/**
 * Ejecuta una llamada API, aplica el estado de respuesta correcto en caso de error
 * y devuelve un fallback tipado. Centraliza el try/catch + applyApiFailure boilerplate.
 */
export async function apiSafe(response, apiCall, fallback) {
  try {
    return await apiCall();
  } catch (error) {
    applyApiFailure(response, error);
    return fallback;
  }
}