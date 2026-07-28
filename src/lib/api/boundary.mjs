import { ApiError } from './client.mjs';

export function applyApiFailure(response, error) {
  const notFound = error instanceof ApiError && error.kind === 'not_found';
  response.status = notFound ? 404 : 503;
  response.headers.set('x-robots-tag', 'noindex');
  if (!notFound) response.headers.set('retry-after', '60');
  return notFound ? 'not_found' : 'unavailable';
}
