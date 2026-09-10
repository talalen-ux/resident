# Static assets

Anything in this folder is served from the site root. Drop a file here and it is
live at the matching path:

| File | URL |
|---|---|
| `public/brand/hero-route.png` | `/brand/hero-route.png` |
| `public/whitepaper.pdf` | `/whitepaper.pdf` |
| `public/brand/og.png` | `/brand/og.png` |

## What is in here now

Three marks, white with the dark green accent, on real transparency:

| File | Shape |
|---|---|
| `/brand/hero-route.png` | the stepped route |
| `/brand/hero-spiral.png` | the squared spiral |
| `/brand/hero-converge.png` | three lines converging into one |

They arrived as exports with the transparency checkerboard rendered into the
pixels and the alpha channel dropped, which would have put a grey grid behind
every mark. The checker sat entirely between luminance 110 and 209 with a clean
gap up to the white of the mark, so it could be keyed back out. If you export
more, ask for a transparent PNG and check that `file` says RGBA rather than
RGB.

Reference it in a component with a plain path, no import:

```tsx
<img src="/brand/logo.svg" alt="Resident" width={160} height={40} />
```

Use `next/image` for photographs and screenshots, which resizes and lazy-loads
them. Do not use it for SVGs or for the share card, where the file should be
served exactly as it is.

## What goes where

- `public/brand/` — logos, wordmarks, the share card, anything with the brand on
  it.
- `public/` root — files people download or link to directly: a paper, a
  one-pager, an audit report when there is one.

## Two things to know before dropping a file in

**Nothing here is processed.** No compression, no resizing, no cache-busting
hash in the filename. A 4MB PNG is a 4MB PNG on every page load, so compress
before committing rather than after someone notices the page is slow.

**Overwriting a file keeps the URL.** That is usually what you want, and it
means a stale copy can sit in a CDN or a browser cache after you replace it. If
a change has to be visible immediately, give the new file a new name.

## The share card is generated, not a file

`/opengraph-image` is drawn in code at `src/app/opengraph-image.tsx`, so it
always matches the site. Putting a `og.png` here will not replace it. To use a
fixed image instead, delete that route and point the `openGraph.images`
metadata in `src/app/layout.tsx` at the file.
