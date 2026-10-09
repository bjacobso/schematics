import { defineMiddleware } from "astro:middleware";

// During development Astro owns routing. In production the static host serves
// index.html for /w/{id}; both paths boot the same client entry at the original URL.
export const onRequest = defineMiddleware((context, next) => {
  if (/\/w\/[^/]+\/?$/.test(context.url.pathname)) {
    return context.rewrite(new URL(import.meta.env.BASE_URL, context.url));
  }
  return next();
});
