/**
 * Site-level constants that need to be right before launch.
 *
 * SITE_URL is what metadataBase, the sitemap and every absolute OG URL resolve
 * against. Getting it wrong does not fail the build — it silently ships share
 * cards pointing at localhost — so it is one constant with one env override.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://resident.finance"
).replace(/\/$/, "");

/**
 * Where "Get $RES" points once the token exists.
 *
 * There is no launch yet. Rather than a link to "#" that silently does nothing
 * when someone clicks it expecting to buy, the CTA renders as a non-interactive
 * "Launching soon" until this is set. Set NEXT_PUBLIC_TOKEN_URL to the pool or
 * launch page and every call to action across the site becomes a real link.
 */
export const TOKEN_URL = process.env.NEXT_PUBLIC_TOKEN_URL ?? null;
