# Ordem brand

Ordem — code review, in order. Website: [ordem.sh](https://ordem.sh).

## Mark

The Dot Square: a lowercase geometric "o" drawn as a rounded-square ring, with a bite taken out of its upper-right corner and a small detached square sitting just outside it.

Construction on a 103-unit grid (`public/brand/ordem-mark.svg`):

| Part | Size |
| --- | --- |
| Ring | 90 × 90, stroke 20, outer radius 22 |
| Hole | 50 × 50, radius 6 |
| Corner bite | 17 × 17 at the ring's upper-right, corner radii 4 (convex) and 3 (concave) |
| Detached square | 22 × 22, radius 4, 8 units off the bite on both axes |

The mark is flat and monochrome: no gradients, shadows or extra ornaments. It stays recognizable down to 16px.

## Wordmark

Lowercase `ordem`, set in Inter Display Bold at -0.02em tracking and converted to outlines, so the logo files don't depend on installed fonts. In the lockup, the ring's top lines up with the ascender of the `d`, and the ring is centered on the x-height. Inside the app, the sidebar sets `ordem` in the system UI font (SF Pro, 700) next to the mark.

Use "Ordem" (capitalized) in running text, titles and alt text.

## Colors

| Name | Hex | Use |
| --- | --- | --- |
| Ink | `#0E0E0E` | Primary: mark on light backgrounds, app icon tile |
| Paper | `#F5F5F5` | Secondary: mark on dark backgrounds |

The app's default accent (`#ff7a3d`) is a UI color, not part of the logo.

## Files

| File | Use |
| --- | --- |
| `public/brand/ordem-mark.svg` | Mark for light backgrounds |
| `public/brand/ordem-mark-light.svg` | Mark for dark backgrounds |
| `public/brand/ordem-logo.svg` | Mark + wordmark for light backgrounds |
| `public/brand/ordem-logo-light.svg` | Mark + wordmark for dark backgrounds |
| `public/icon.svg`, `public/icon.png` | App icon (512px, Ink tile) |
| `public/favicon.svg`, `public/favicon.ico` | Browser tab icon (ICO has 16, 32 and 48px) |
| `public/apple-touch-icon.png` | iOS home screen (180px, full bleed; iOS rounds the corners) |
| `OrdemMark` in `frontend/src/components/Glyphs.tsx` | Mark inside the UI, colored with `currentColor` |
