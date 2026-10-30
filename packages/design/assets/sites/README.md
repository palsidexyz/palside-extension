# Site logos

146 site directory logos, one per site, named `<site-id>.webp` with the same `site-id` as `packages/shared/src/sites/catalog.ts`. They were verified on 2026-10-17. For every file, `sources.json` records the source page, download URL, source type, original size, bytes and SHA-256, and the exported SHA-256.

## Source order

Only artwork published by the owner is used, taking the first clear source in this order:

1. The icon declared by the site: SVG first, then the largest square bitmap in the manifest or `apple-touch-icon`. Safari mask icons, monochrome icons and maskable icons are not used.
2. The official App Store icon (512px), when the developer matches the site's owner.
3. For Etherscan-family explorers, the site's own chain mark `chain-light.svg`, because their favicons are 48px or generic.
4. The official brand resources page or documentation icon.
5. The official GitHub organization avatar, when the organization links to the site or is verified.

Sites behind bot protection were downloaded from inside a real Chrome page. Heaven and Kolscan publish only 48px icons, which are scaled up as is without claiming extra detail.

## Export

[`scripts/normalize-site-logo.mjs`](../../../../scripts/normalize-site-logo.mjs) applies one rule to every source: trim transparent margins, scale proportionally, center on a 96×96 transparent canvas, keep the original colors, and write lossless WebP. SVGs render at about 512px; ICO files use their largest frame. 96px covers a 40px container on 2× screens. The 146 files total about 596 KB; the largest is 13.6 KB.

Logos that are nearly all black or nearly all white on transparency are marked `plate` in the catalog. `SiteLogo` draws them on a light or dark plate (`--ui-logo-plate-light` / `--ui-logo-plate-dark`) in the theme where they would disappear.

## Use

[`scripts/sync-site-assets.mjs`](../../../../scripts/sync-site-assets.mjs) copies the files to each host's `public/site-logos/` before development, builds and packaging, according to the [host allowlist](../../../../scripts/lib/site-assets.mjs), and removes files outside the allowlist. Logos are bundled locally; no third-party image host is requested.

Trademarks and original artwork belong to their owners. Logos are used only to identify sites, do not imply partnership or endorsement, and are not covered by the Palside MIT license. A site logo never stands in for a token image; token images are checked against their chain and contract.
