import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();
  response.headers.set('x-app-version', process.env.APP_VERSION || 'development');
  return response;
});
